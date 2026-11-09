// The Meals tab's catalogue rules (pure, unit-tested in __tests__/meal-catalog-rules.test.js): what
// the Super Admin's categories, banners and coupons may hold, which ones members see today, which
// meals a category lists, and what a coupon takes off an order. Days are India's (YYYY-MM-DD).
const { ValidationError } = require("../profile");
const { TAGS, DATE, isObject, onlyFields, text, number, mealId } = require("./rules");

const KINDS = ["tile", "food"];
const TARGETS = ["category", "meal", "tag"];
const COUPON_KINDS = ["percent", "flat"];
const MAX_PICKED = 100; // meals picked for one category
const limits = { name: 40, subtitle: 80, badge: 16, title: 60, description: 140, bannerBadge: 20, cta: 20, couponTitle: 60, sort: 999 };

function flag(value, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new ValidationError(`Say whether ${label}.`);
  return value;
}
function sortOrder(value) {
  if (value === undefined) return 0;
  return number(value, "Order", 0, limits.sort, { whole: true });
}
function day(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(value))) throw new ValidationError(`Pick the ${label} as a date.`);
  return value;
}
function days(body) {
  const startsOn = day(body.startsOn, "start day");
  const endsOn = day(body.endsOn, "end day");
  if (startsOn && endsOn && endsOn < startsOn) throw new ValidationError("The end day must be on or after the start day.");
  return { startsOn, endsOn };
}
const id = (value, label) => {
  const n = Number(value);
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value) || n > 4294967295) throw new ValidationError(`That isn't a ${label}.`);
  return n;
};

// ---- Categories ----

/**
 * POST/PUT …/categories: a tile or a food category. Which meals it lists is one of: the meals
 * picked (`mealIds`), every meal with a tag (`matchTag`), or every meal up to a price (`maxPrice`).
 */
function categoryBody(body) {
  onlyFields(body, ["kind", "name", "subtitle", "badge", "matchTag", "maxPrice", "mealIds", "featured", "active", "sortOrder"]);
  if (!KINDS.includes(body.kind)) throw new ValidationError("Pick Tile or Food category.");
  const matchTag = body.matchTag === undefined || body.matchTag === null ? null : body.matchTag;
  if (matchTag !== null && !TAGS.includes(matchTag)) throw new ValidationError("Pick a tag from the list.");
  const maxPricePaise = body.maxPrice === undefined || body.maxPrice === null ? null : number(body.maxPrice, "Price limit", 1, 5000, { whole: true }) * 100;
  const picked = body.mealIds === undefined ? [] : body.mealIds;
  if (!Array.isArray(picked) || picked.length > MAX_PICKED) throw new ValidationError(`Pick up to ${MAX_PICKED} meals.`);
  const mealIds = [...new Set(picked.map(mealId))];
  const rules = [matchTag !== null, maxPricePaise !== null, mealIds.length > 0].filter(Boolean).length;
  if (rules !== 1) throw new ValidationError("Choose which meals it lists: pick meals, a tag or a price limit.");
  return {
    kind: body.kind,
    name: text(body.name, "Name", limits.name, { min: 2 }),
    subtitle: text(body.subtitle, "Subtitle", limits.subtitle, { required: false }),
    badge: text(body.badge, "Label", limits.badge, { required: false }),
    matchTag,
    maxPricePaise,
    mealIds,
    featured: flag(body.featured, "it shows as a row of meals", false),
    active: flag(body.active, "members see it", true),
    sortOrder: sortOrder(body.sortOrder),
  };
}

/** Whether a category lists a meal (`picked`: the meal ids picked for it) */
function categoryHas(category, meal, picked) {
  if (category.matchTag) return meal.tags.includes(category.matchTag);
  if (category.maxPricePaise) return meal.pricePaise <= category.maxPricePaise;
  return picked.has(meal.id);
}

// ---- Banners ----

/** POST/PUT …/banners: the carousel's slide and where its button goes */
function bannerBody(body) {
  onlyFields(body, ["title", "description", "badge", "ctaLabel", "target", "startsOn", "endsOn", "active", "sortOrder"]);
  if (!isObject(body.target) || !TARGETS.includes(body.target.kind)) throw new ValidationError("Pick where the button goes.");
  onlyFields(body.target, ["kind", "ref"]);
  const ref = body.target.kind === "category" ? String(id(String(body.target.ref ?? ""), "category"))
    : body.target.kind === "meal" ? mealId(body.target.ref)
    : TAGS.includes(body.target.ref) ? body.target.ref : null;
  if (ref === null) throw new ValidationError("Pick a tag from the list.");
  return {
    title: text(body.title, "Heading", limits.title, { min: 3 }),
    description: text(body.description, "Description", limits.description, { required: false }),
    badge: text(body.badge, "Badge", limits.bannerBadge, { required: false }),
    ctaLabel: text(body.ctaLabel, "Button", limits.cta, { required: false }) ?? "Explore now",
    target: { kind: body.target.kind, ref },
    ...days(body),
    active: flag(body.active, "members see it", true),
    sortOrder: sortOrder(body.sortOrder),
  };
}

/** Shown today: switched on and inside its days */
const showsOn = (item, today) => item.active && (!item.startsOn || item.startsOn <= today) && (!item.endsOn || item.endsOn >= today);

// ---- Coupons ----

/** POST/PUT …/coupons: amounts in whole rupees */
function couponBody(body) {
  onlyFields(body, ["code", "title", "kind", "percentOff", "flatOff", "maxDiscount", "minOrder", "perMemberLimit", "startsOn", "endsOn", "active"]);
  if (typeof body.code !== "string" || !/^[A-Za-z0-9]{3,16}$/.test(body.code.trim())) throw new ValidationError("The code is 3 to 16 letters and digits.");
  if (!COUPON_KINDS.includes(body.kind)) throw new ValidationError("Pick % off or ₹ off.");
  const percent = body.kind === "percent";
  return {
    code: body.code.trim().toUpperCase(),
    title: text(body.title, "Title", limits.couponTitle, { min: 3 }),
    kind: body.kind,
    percentOff: percent ? number(body.percentOff, "% off", 1, 90, { whole: true }) : null,
    flatOffPaise: percent ? null : number(body.flatOff, "₹ off", 1, 2000, { whole: true }) * 100,
    maxDiscountPaise: percent && body.maxDiscount !== undefined && body.maxDiscount !== null ? number(body.maxDiscount, "Most off", 1, 2000, { whole: true }) * 100 : null,
    minOrderPaise: body.minOrder === undefined || body.minOrder === null ? 0 : number(body.minOrder, "Minimum order", 0, 10000, { whole: true }) * 100,
    perMemberLimit: body.perMemberLimit === undefined ? 1 : number(body.perMemberLimit, "Uses per member", 1, 20, { whole: true }),
    ...days(body),
    active: flag(body.active, "members can use it", true),
  };
}

/** off · scheduled · expired · live, for a coupon on `today` */
function couponState(coupon, today) {
  if (!coupon.active) return "off";
  if (coupon.endsOn && coupon.endsOn < today) return "expired";
  if (coupon.startsOn && coupon.startsOn > today) return "scheduled";
  return "live";
}

/** What a coupon takes off a subtotal (paise): never more than the subtotal */
function discountFor(coupon, subtotalPaise) {
  const raw = coupon.kind === "percent" ? Math.floor((subtotalPaise * coupon.percentOff) / 100) : coupon.flatOffPaise;
  const capped = coupon.maxDiscountPaise ? Math.min(raw, coupon.maxDiscountPaise) : raw;
  return Math.max(0, Math.min(capped, subtotalPaise));
}

/** Why a coupon can't be used now, or null: `used` is how many of the member's orders already have it */
function couponProblem(coupon, { today, subtotalPaise, used }) {
  if (!coupon) return "That coupon code isn't valid.";
  const state = couponState(coupon, today);
  if (state === "off") return "That coupon isn't available.";
  if (state === "expired") return "That coupon has expired.";
  if (state === "scheduled") return `That coupon starts on ${coupon.startsOn}.`;
  if (used >= coupon.perMemberLimit) return coupon.perMemberLimit === 1 ? "You've already used that coupon." : `You've used that coupon ${coupon.perMemberLimit} times already.`;
  if (subtotalPaise < coupon.minOrderPaise) return `Add ₹${Math.ceil((coupon.minOrderPaise - subtotalPaise) / 100)} more to use this coupon.`;
  return null;
}

/** "50% off up to ₹100" / "₹50 off", and "Above ₹149" when there's a minimum */
function couponLine(coupon) {
  const off = coupon.kind === "percent" ? `${coupon.percentOff}% off${coupon.maxDiscountPaise ? ` up to ₹${coupon.maxDiscountPaise / 100}` : ""}` : `₹${coupon.flatOffPaise / 100} off`;
  return { off, above: coupon.minOrderPaise > 0 ? `Above ₹${coupon.minOrderPaise / 100}` : null };
}

module.exports = {
  KINDS, TARGETS, COUPON_KINDS, MAX_PICKED, limits,
  categoryBody, categoryHas, bannerBody, showsOn, couponBody, couponState, discountFor, couponProblem, couponLine, id,
};
