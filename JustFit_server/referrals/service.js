// Referrals (meal marketing phase 5): each member's code, entering a friend's code, and the reward
// when the friend's first order is delivered. Identity is always the session's user. Before
// migration 2027-02-04-meal-referrals.sql the routes answer 503 naming it.
const rules = require("./rules");
const mealRules = require("../meals/rules");
const notifications = require("../notifications/service");
const { inTransaction } = require("../gym/service");
const { ConflictError, NotFoundError } = require("../errors");

const MIGRATION = "Referrals need the 2027-02-04-meal-referrals migration on this server.";
class NotReady extends Error {
  constructor() {
    super(MIGRATION);
    this.name = "NotReadyError";
    this.status = 503;
  }
}

let ready = { has: false, at: 0 };
async function isReady(db) {
  if (ready.has || Date.now() - ready.at < 60000) return ready.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meal_referrals'");
  ready = { has: Number(row.n) > 0, at: Date.now() };
  return ready.has;
}
async function needReady(db) {
  if (!(await isReady(db))) throw new NotReady();
}

// A personal ₹50-off coupon for one member; a clashing code (very rare) is tried again
async function personalCoupon(db, ownerId, { title, firstOrderOnly, days }) {
  const endsOn = mealRules.addDays(mealRules.indiaNow().date, days);
  for (let tries = 0; tries < 5; tries++) {
    const code = rules.couponCode();
    try {
      const [result] = await db.query(
        `INSERT INTO meal_coupons (code, title, kind, flat_off_paise, min_order_paise, per_member_limit, first_order_only, owner_user_id, ends_on, active)
         VALUES (?, ?, 'flat', ?, ?, 1, ?, ?, ?, 1)`,
        [code, title, rules.REWARD_PAISE, rules.MIN_ORDER_PAISE, firstOrderOnly ? 1 : 0, ownerId, endsOn],
      );
      return { id: result.insertId, code, endsOn };
    } catch (error) {
      if (error?.code !== "ER_DUP_ENTRY") throw error;
    }
  }
  throw new Error("Couldn't make a coupon code");
}

async function codeFor(pool, userId) {
  const [[row]] = await pool.query("SELECT code FROM referral_codes WHERE user_id = ?", [userId]);
  if (row) return row.code;
  for (let tries = 0; tries < 5; tries++) {
    const [result] = await pool.query("INSERT IGNORE INTO referral_codes (user_id, code) VALUES (?, ?)", [userId, rules.referralCode()]);
    if (result.affectedRows === 1) break;
    const [[again]] = await pool.query("SELECT code FROM referral_codes WHERE user_id = ?", [userId]);
    if (again) return again.code; // made at the same moment by another request
  }
  const [[made]] = await pool.query("SELECT code FROM referral_codes WHERE user_id = ?", [userId]);
  return made.code;
}

/** GET /api/referrals: my code, my friends who joined and were rewarded, and whether I can enter a friend's code */
async function mine(pool, userId) {
  await needReady(pool);
  const code = await codeFor(pool, userId);
  const [[[counts]], [[claimed]], [[me]], [[placed]]] = await Promise.all([
    pool.query("SELECT COUNT(*) AS joined, COUNT(rewarded_at) AS rewarded FROM meal_referrals WHERE referrer_id = ?", [userId]),
    pool.query("SELECT id FROM meal_referrals WHERE referred_id = ?", [userId]),
    pool.query("SELECT TIMESTAMPDIFF(DAY, created_at, NOW()) AS age FROM users WHERE id = ?", [userId]),
    pool.query("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status NOT IN ('cancelled', 'awaiting_payment')", [userId]),
  ]);
  const canClaim = !claimed && Number(placed.n) === 0 && Number(me?.age ?? 999) <= rules.CLAIM_WITHIN_DAYS;
  return {
    code,
    shareText: rules.shareText(code),
    reward: rules.REWARD_PAISE / 100,
    minOrder: rules.MIN_ORDER_PAISE / 100,
    joined: Number(counts.joined),
    rewarded: Number(counts.rewarded),
    maxRewards: rules.MAX_REWARDS,
    usedFriendCode: Boolean(claimed),
    canClaim,
  };
}

/** POST /api/referrals/claim: a new member enters a friend's code → their own ₹50-off first-order coupon */
async function claim(pool, userId, { code }) {
  await needReady(pool);
  return inTransaction(pool, async (db) => {
    const [[owner]] = await db.query(
      "SELECT r.user_id, u.role FROM referral_codes r JOIN users u ON u.id = r.user_id WHERE r.code = ? FOR SHARE",
      [code],
    );
    if (!owner) throw new NotFoundError("That code isn't valid.");
    // The member's own row locked: two claims at once can't both pass
    const [[me]] = await db.query("SELECT TIMESTAMPDIFF(DAY, created_at, NOW()) AS age FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [[claimed]] = await db.query("SELECT id FROM meal_referrals WHERE referred_id = ?", [userId]);
    const [[placed]] = await db.query("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status NOT IN ('cancelled', 'awaiting_payment') FOR SHARE", [userId]);
    const problem = rules.claimProblem({ self: owner.user_id === userId, referrerRole: owner.role, ageDays: Number(me?.age ?? 999), orders: Number(placed.n), claimed: Boolean(claimed) });
    if (problem) throw new ConflictError(problem);
    await db.query("INSERT INTO meal_referrals (referrer_id, referred_id) VALUES (?, ?)", [owner.user_id, userId]);
    const coupon = await personalCoupon(db, userId, { title: `Friend's welcome: ₹${rules.REWARD_PAISE / 100} off`, firstOrderOnly: true, days: rules.FRIEND_DAYS });
    return { coupon: { code: coupon.code, off: rules.REWARD_PAISE / 100, minOrder: rules.MIN_ORDER_PAISE / 100, endsOn: coupon.endsOn } };
  });
}

/**
 * Called when a member's order is delivered: if a friend's code brought them and nobody has been
 * rewarded for it yet, the member who shared gets their coupon (up to 20 in all) and a notice.
 * Never fails the delivery; errors are logged.
 */
async function onDelivered(pool, userId) {
  try {
    if (!(await isReady(pool))) return;
    const reward = await inTransaction(pool, async (db) => {
      const [[ref]] = await db.query("SELECT id, referrer_id FROM meal_referrals WHERE referred_id = ? AND rewarded_at IS NULL FOR UPDATE", [userId]);
      if (!ref) return null;
      const [[{ n }]] = await db.query("SELECT COUNT(*) AS n FROM meal_referrals WHERE referrer_id = ? AND referrer_coupon_id IS NOT NULL", [ref.referrer_id]);
      const coupon = Number(n) < rules.MAX_REWARDS
        ? await personalCoupon(db, ref.referrer_id, { title: `Thanks for sharing: ₹${rules.REWARD_PAISE / 100} off`, firstOrderOnly: false, days: rules.REFERRER_DAYS })
        : null;
      await db.query("UPDATE meal_referrals SET rewarded_at = NOW(), referrer_coupon_id = ? WHERE id = ?", [coupon?.id ?? null, ref.id]);
      return coupon ? { to: ref.referrer_id, coupon } : null;
    });
    if (reward) {
      await notifications.notify(pool, [reward.to], {
        kind: "meal.referral",
        key: `coupon:${reward.coupon.id}`,
        title: `Your friend ordered: ₹${rules.REWARD_PAISE / 100} off for you`,
        body: `Use code ${reward.coupon.code} on an order above ₹${rules.MIN_ORDER_PAISE / 100} by ${reward.coupon.endsOn}.`,
        link: "/meals",
      });
    }
  } catch (error) {
    console.error(`Referral reward not given: ${error?.code ?? error?.message ?? "unknown"}`);
  }
}

module.exports = { mine, claim, onDelivered, MIGRATION };
