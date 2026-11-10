// The Meals tab's catalogue (2026-11-09): the Super Admin's categories (tiles and food categories),
// banners and coupons, and the storefront members read in one request. Members only ever see what
// is switched on and inside its days, and only meals on the menu. Coupons are priced here for the
// cart's quote and, with the coupon row locked, for the order itself.
const { NotFoundError, ConflictError } = require("../errors");
const rules = require("./rules");
const catalogRules = require("./catalogRules");

const num = (v) => Number(v);
const day = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
const photoUrl = (kind, id, key) => (key ? `/api/meals/${kind}/${id}/photo?v=${encodeURIComponent(String(key).split(".")[0])}` : null);
const tagsOf = (value) => (typeof value === "string" && value ? value.split(",") : []);

// ---- Rows → objects ----

const categoryOf = (r) => ({
  id: num(r.id),
  kind: r.kind,
  name: r.name,
  subtitle: r.subtitle ?? null,
  badge: r.badge ?? null,
  imageUrl: photoUrl("categories", r.id, r.image_key),
  matchTag: r.match_tag ?? null,
  maxPrice: r.max_price_paise ? num(r.max_price_paise) / 100 : null,
  maxPricePaise: r.max_price_paise ? num(r.max_price_paise) : null,
  featured: num(r.featured) === 1,
  active: num(r.active) === 1,
  sortOrder: num(r.sort_order),
});
const bannerOf = (r) => ({
  id: num(r.id),
  title: r.title,
  description: r.description ?? null,
  badge: r.badge ?? null,
  ctaLabel: r.cta_label,
  target: { kind: r.target_kind, ref: r.target_ref },
  imageUrl: photoUrl("banners", r.id, r.image_key),
  startsOn: day(r.starts_on),
  endsOn: day(r.ends_on),
  active: num(r.active) === 1,
  sortOrder: num(r.sort_order),
});
const couponOf = (r) => ({
  id: num(r.id),
  code: r.code,
  title: r.title,
  kind: r.kind,
  percentOff: r.percent_off === null ? null : num(r.percent_off),
  flatOffPaise: r.flat_off_paise === null ? null : num(r.flat_off_paise),
  maxDiscountPaise: r.max_discount_paise === null ? null : num(r.max_discount_paise),
  minOrderPaise: num(r.min_order_paise),
  perMemberLimit: num(r.per_member_limit),
  firstOrderOnly: num(r.first_order_only ?? 0) === 1, // read as false before the 2027-01-28 migration
  startsOn: day(r.starts_on),
  endsOn: day(r.ends_on),
  active: num(r.active) === 1,
});
/** A coupon as the app shows it (rupees, its line and its state today) */
const couponToApi = (c, today, extra = {}) => ({
  id: c.id,
  code: c.code,
  title: c.title,
  kind: c.kind,
  percentOff: c.percentOff,
  flatOff: c.flatOffPaise === null ? null : c.flatOffPaise / 100,
  maxDiscount: c.maxDiscountPaise === null ? null : c.maxDiscountPaise / 100,
  minOrder: c.minOrderPaise / 100,
  perMemberLimit: c.perMemberLimit,
  firstOrderOnly: c.firstOrderOnly,
  startsOn: c.startsOn,
  endsOn: c.endsOn,
  active: c.active,
  state: catalogRules.couponState(c, today),
  ...catalogRules.couponLine(c),
  ...extra,
});

async function pickedByCategory(db) {
  const [rows] = await db.query("SELECT category_id, meal_id FROM meal_category_items");
  const picked = new Map();
  for (const r of rows) {
    const set = picked.get(num(r.category_id)) ?? new Set();
    set.add(r.meal_id);
    picked.set(num(r.category_id), set);
  }
  return picked;
}

// ---- Members: the storefront ----

/**
 * Everything the Meals tab shows, in one read: the meals on the menu (with the member's hearts),
 * the categories that list at least one of them (with their meal ids), today's banners whose button
 * goes somewhere real, and today's coupons the member can still use.
 */
async function storefront(pool, userId, { mealToApi }, now = Date.now()) {
  const today = rules.indiaNow(now).date;
  const [[meals], [categoryRows], [bannerRows], [couponRows], picked] = await Promise.all([
    pool.query(
      `SELECT m.*, (f.meal_id IS NOT NULL) AS fav FROM meals m
       LEFT JOIN favorite_meals f ON f.meal_id = m.id AND f.user_id = ?
       WHERE m.is_available = TRUE ORDER BY m.name LIMIT 300`,
      [userId],
    ),
    pool.query("SELECT * FROM meal_categories WHERE active = 1 ORDER BY sort_order, name"),
    pool.query("SELECT * FROM meal_banners WHERE active = 1 ORDER BY sort_order, id"),
    pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.coupon_id = c.id AND o.user_id = ? AND o.status <> 'cancelled') AS used
       FROM meal_coupons c WHERE c.active = 1 ORDER BY c.created_at DESC`,
      [userId],
    ),
    pickedByCategory(pool),
  ]);
  // A first-order coupon is shown only to a member who has never ordered
  const ordered = couponRows.some((r) => num(r.first_order_only ?? 0) === 1) ? (await ordersPlaced(pool, userId)) > 0 : false;
  const menu = meals.map((r) => ({ api: mealToApi(r, num(r.fav) === 1), id: r.id, tags: tagsOf(r.tags), pricePaise: num(r.price_paise) }));
  const onMenu = new Set(menu.map((m) => m.id));
  const categories = categoryRows
    .map((r) => {
      const c = categoryOf(r);
      const mealIds = menu.filter((m) => catalogRules.categoryHas(c, m, picked.get(c.id) ?? new Set())).map((m) => m.id);
      const { maxPricePaise: _, active: __, ...shown } = c;
      return { ...shown, mealIds };
    })
    .filter((c) => c.mealIds.length > 0);
  const listed = new Set(categories.map((c) => String(c.id)));
  const banners = bannerRows
    .map(bannerOf)
    .filter((b) => catalogRules.showsOn(b, today))
    .filter((b) => (b.target.kind === "category" ? listed.has(b.target.ref) : b.target.kind === "meal" ? onMenu.has(b.target.ref) : true))
    .map(({ active: _, sortOrder: __, startsOn: ___, ...b }) => b);
  const coupons = couponRows
    .map((r) => ({ c: couponOf(r), used: num(r.used) }))
    .filter(({ c, used }) => catalogRules.couponState(c, today) === "live" && used < c.perMemberLimit && !(c.firstOrderOnly && ordered))
    .map(({ c, used }) => couponToApi(c, today, { usesLeft: c.perMemberLimit - used }));
  return { today, meals: menu.map((m) => m.api), categories, banners, coupons };
}

/**
 * A coupon for this member and subtotal: its id, code, title and discount, or `problem` saying why
 * it can't be used. `lock` (inside the order's transaction) locks the coupon row so two orders at
 * once can't both take its last use.
 */
// The orders a member has placed: every one but those cancelled or still waiting for payment (a new
// Pay cancels the member's unpaid order, so an abandoned checkout never spends a first order)
// `lock` (inside the order's transaction): a locking read, which sees orders committed a moment ago
// rather than the transaction's first snapshot, so two first orders at once can't both pass
async function ordersPlaced(db, userId, { lock = false } = {}) {
  const [[row]] = await db.query(`SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status NOT IN ('cancelled', 'awaiting_payment')${lock ? " FOR SHARE" : ""}`, [userId]);
  return num(row.n);
}

// Whether meal_coupons.first_order_only exists (migration 2027-01-28), checked once a minute until it does
let firstOrderColumn = { has: false, at: 0 };
async function hasFirstOrderColumn(db) {
  if (firstOrderColumn.has || Date.now() - firstOrderColumn.at < 60000) return firstOrderColumn.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meal_coupons' AND COLUMN_NAME = 'first_order_only'");
  firstOrderColumn = { has: num(row.n) > 0, at: Date.now() };
  return firstOrderColumn.has;
}
const FIRST_ORDER_MIGRATION = "First-order coupons need the 2027-01-28-first-order-coupons migration on this server.";
// A 503 the shared error handler answers with its message (it knows the name "NotReadyError")
class ServiceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotReadyError";
    this.status = 503;
  }
}

async function couponFor(db, userId, code, subtotalPaise, { lock = false, now = Date.now() } = {}) {
  const [[row]] = await db.query(`SELECT * FROM meal_coupons WHERE code = ?${lock ? " FOR UPDATE" : ""}`, [code]);
  const coupon = row ? couponOf(row) : null;
  const [[{ used }]] = coupon
    ? await db.query("SELECT COUNT(*) AS used FROM orders WHERE coupon_id = ? AND user_id = ? AND status <> 'cancelled'", [coupon.id, userId])
    : [[{ used: 0 }]];
  const orders = coupon?.firstOrderOnly ? await ordersPlaced(db, userId, { lock }) : 0;
  const problem = catalogRules.couponProblem(coupon, { today: rules.indiaNow(now).date, subtotalPaise, used: num(used), orders });
  if (problem) return { problem };
  return { id: coupon.id, code: coupon.code, title: coupon.title, discountPaise: catalogRules.discountFor(coupon, subtotalPaise) };
}

/** A category's or banner's photo file name (any that exists; they hold nothing private) */
async function photoKey(pool, kind, id) {
  const [[row]] = await pool.query(`SELECT image_key FROM ${kind === "categories" ? "meal_categories" : "meal_banners"} WHERE id = ?`, [id]);
  if (!row?.image_key) throw new NotFoundError("No photo.");
  return row.image_key;
}

// ---- The admin: categories ----

async function adminCategories(pool) {
  const [[rows], picked] = await Promise.all([pool.query("SELECT * FROM meal_categories ORDER BY kind, sort_order, name"), pickedByCategory(pool)]);
  return {
    categories: rows.map((r) => {
      const { maxPricePaise: _, ...c } = categoryOf(r);
      return { ...c, mealIds: [...(picked.get(c.id) ?? [])] };
    }),
  };
}

async function writePicked(db, categoryId, mealIds) {
  await db.query("DELETE FROM meal_category_items WHERE category_id = ?", [categoryId]);
  if (mealIds.length === 0) return;
  const [found] = await db.query("SELECT id FROM meals WHERE id IN (?)", [mealIds]);
  if (found.length !== mealIds.length) throw new ConflictError("One of the meals picked was deleted. Pick again.");
  await db.query("INSERT INTO meal_category_items (category_id, meal_id) VALUES ?", [mealIds.map((m) => [categoryId, m])]);
}

const CATEGORY_FIELDS = (f) => [f.kind, f.name, f.subtitle, f.badge, f.matchTag, f.maxPricePaise, f.featured ? 1 : 0, f.active ? 1 : 0, f.sortOrder];

async function saveCategory(pool, inTransaction, id, fields, imageKey) {
  const savedId = await inTransaction(pool, async (db) => {
    let categoryId = id;
    if (id === null) {
      const [result] = await db.query(
        "INSERT INTO meal_categories (kind, name, subtitle, badge, match_tag, max_price_paise, featured, active, sort_order, image_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [...CATEGORY_FIELDS(fields), imageKey ?? null],
      );
      categoryId = result.insertId;
    } else {
      const [[row]] = await db.query("SELECT id FROM meal_categories WHERE id = ? FOR UPDATE", [id]);
      if (!row) throw new NotFoundError("That category was deleted.");
      await db.query(
        `UPDATE meal_categories SET kind = ?, name = ?, subtitle = ?, badge = ?, match_tag = ?, max_price_paise = ?, featured = ?, active = ?, sort_order = ?
         ${imageKey !== undefined ? ", image_key = ?" : ""} WHERE id = ?`,
        [...CATEGORY_FIELDS(fields), ...(imageKey !== undefined ? [imageKey] : []), id],
      );
    }
    await writePicked(db, categoryId, fields.mealIds);
    return categoryId;
  });
  const { categories } = await adminCategories(pool);
  return { category: categories.find((c) => c.id === savedId) };
}

// ---- The admin: banners ----

async function adminBanners(pool, now = Date.now()) {
  const today = rules.indiaNow(now).date;
  const [rows] = await pool.query("SELECT * FROM meal_banners ORDER BY sort_order, id");
  return { banners: rows.map((r) => ({ ...bannerOf(r), live: catalogRules.showsOn(bannerOf(r), today) })) };
}

async function checkTarget(pool, target) {
  if (target.kind === "category") {
    const [[row]] = await pool.query("SELECT id FROM meal_categories WHERE id = ?", [target.ref]);
    if (!row) throw new NotFoundError("That category was deleted.");
  }
  if (target.kind === "meal") {
    const [[row]] = await pool.query("SELECT id FROM meals WHERE id = ?", [target.ref]);
    if (!row) throw new NotFoundError("That meal was deleted.");
  }
}

const BANNER_FIELDS = (f) => [f.title, f.description, f.badge, f.ctaLabel, f.target.kind, f.target.ref, f.startsOn, f.endsOn, f.active ? 1 : 0, f.sortOrder];

async function saveBanner(pool, id, fields, imageKey) {
  await checkTarget(pool, fields.target);
  let bannerId = id;
  if (id === null) {
    const [result] = await pool.query(
      "INSERT INTO meal_banners (title, description, badge, cta_label, target_kind, target_ref, starts_on, ends_on, active, sort_order, image_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [...BANNER_FIELDS(fields), imageKey ?? null],
    );
    bannerId = result.insertId;
  } else {
    const [result] = await pool.query(
      `UPDATE meal_banners SET title = ?, description = ?, badge = ?, cta_label = ?, target_kind = ?, target_ref = ?, starts_on = ?, ends_on = ?,
         active = ?, sort_order = ? ${imageKey !== undefined ? ", image_key = ?" : ""} WHERE id = ?`,
      [...BANNER_FIELDS(fields), ...(imageKey !== undefined ? [imageKey] : []), id],
    );
    if (result.affectedRows === 0) throw new NotFoundError("That banner was deleted.");
  }
  const { banners } = await adminBanners(pool);
  return { banner: banners.find((b) => b.id === bannerId) };
}

// ---- The admin: coupons ----

async function adminCoupons(pool, now = Date.now()) {
  const today = rules.indiaNow(now).date;
  const [rows] = await pool.query(
    `SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.coupon_id = c.id AND o.status <> 'cancelled') AS uses
     FROM meal_coupons c ORDER BY c.created_at DESC, c.id DESC`,
  );
  return { coupons: rows.map((r) => couponToApi(couponOf(r), today, { uses: num(r.uses) })) };
}

const COUPON_FIELDS = (f) => [f.code, f.title, f.kind, f.percentOff, f.flatOffPaise, f.maxDiscountPaise, f.minOrderPaise, f.perMemberLimit, f.startsOn, f.endsOn, f.active ? 1 : 0];

async function saveCoupon(pool, id, fields) {
  let couponId = id;
  // Before the 2027-01-28 migration coupons save as before; only "first order only" needs it
  const firstOrder = await hasFirstOrderColumn(pool);
  if (!firstOrder && fields.firstOrderOnly) throw new ServiceUnavailableError(FIRST_ORDER_MIGRATION);
  const extraColumn = firstOrder ? ", first_order_only" : "";
  const extraValue = firstOrder ? [fields.firstOrderOnly ? 1 : 0] : [];
  try {
    if (id === null) {
      const [result] = await pool.query(
        `INSERT INTO meal_coupons (code, title, kind, percent_off, flat_off_paise, max_discount_paise, min_order_paise, per_member_limit, starts_on, ends_on, active${extraColumn})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${firstOrder ? ", ?" : ""})`,
        [...COUPON_FIELDS(fields), ...extraValue],
      );
      couponId = result.insertId;
    } else {
      const [result] = await pool.query(
        `UPDATE meal_coupons SET code = ?, title = ?, kind = ?, percent_off = ?, flat_off_paise = ?, max_discount_paise = ?, min_order_paise = ?,
           per_member_limit = ?, starts_on = ?, ends_on = ?, active = ?${firstOrder ? ", first_order_only = ?" : ""} WHERE id = ?`,
        [...COUPON_FIELDS(fields), ...extraValue, id],
      );
      if (result.affectedRows === 0) throw new NotFoundError("That coupon was deleted.");
    }
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") throw new ConflictError(`There's already a coupon ${fields.code}.`);
    throw error;
  }
  const { coupons } = await adminCoupons(pool);
  return { coupon: coupons.find((c) => c.id === couponId) };
}

/** Deletes a category, banner or coupon (orders keep a deleted coupon's code); returns its photo's file name */
async function remove(pool, kind, id) {
  const table = { categories: "meal_categories", banners: "meal_banners", coupons: "meal_coupons" }[kind];
  const [[row]] = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw new NotFoundError("That was already deleted.");
  await pool.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
  return { label: row.name ?? row.title ?? row.code, imageKey: row.image_key ?? null };
}

/** The photo file a category or banner has now (to delete after a replace) */
async function currentPhoto(pool, kind, id) {
  const [[row]] = await pool.query(`SELECT image_key FROM ${kind === "categories" ? "meal_categories" : "meal_banners"} WHERE id = ?`, [id]);
  if (!row) throw new NotFoundError("That was deleted.");
  return row.image_key ?? null;
}

module.exports = {
  storefront, couponFor, photoKey, adminCategories, saveCategory, adminBanners, saveBanner, adminCoupons, saveCoupon, remove, currentPhoto,
};
