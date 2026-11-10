// Offer notices (meal marketing phase 4, 2026-11-10): the Super Admin taps "Tell members about this
// offer" on a live coupon and every member gets one in-app notification about it, linking to the
// Meals tab. Never sent by itself, never twice for the same coupon to the same person (the dedupe
// key), a first-order coupon only to members who have never ordered. Before migration
// 2027-02-03-offer-notifications.sql (the 'offers' category) it answers 503 naming it.
const notifications = require("../notifications/service");
const catalog = require("./catalog");
const { NotFoundError, ConflictError } = require("../errors");

const MIGRATION = "Offer notices need the 2027-02-03-offer-notifications migration on this server.";
const BATCH = 1000;

class NotReady extends Error {
  constructor() {
    super(MIGRATION);
    this.name = "NotReadyError";
    this.status = 503;
  }
}
async function hasOffersCategory(db) {
  const [[row]] = await db.query("SELECT COLUMN_TYPE AS t FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'category'");
  return Boolean(row && String(row.t).includes("'offers'"));
}

const offerBody = (c) => [c.off, c.above].filter(Boolean).join(" · ") + ` with code ${c.code}. Order on the Meals tab.`;

/** → { sent, coupon } where sent counts the members told now (those told before are skipped) */
async function announceCoupon(pool, couponId) {
  if (!(await hasOffersCategory(pool))) throw new NotReady();
  const { coupons } = await catalog.adminCoupons(pool);
  const coupon = coupons.find((c) => c.id === couponId);
  if (!coupon) throw new NotFoundError("That coupon was deleted.");
  if (coupon.state !== "live") throw new ConflictError("Only a coupon members can use today can be announced.");
  const [rows] = await pool.query(
    `SELECT u.id FROM users u WHERE u.role = 'user'${coupon.firstOrderOnly ? " AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled', 'awaiting_payment'))" : ""}`,
  );
  const ids = rows.map((r) => r.id);
  let sent = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    sent += await notifications.notify(pool, ids.slice(i, i + BATCH), {
      kind: "meal.offer",
      key: `coupon:${coupon.id}`,
      title: coupon.title || `Offer: ${coupon.code}`,
      body: offerBody(coupon),
      link: "/meals",
    });
  }
  return { sent, members: ids.length, coupon };
}

module.exports = { announceCoupon, hasOffersCategory, offerBody, MIGRATION };
