// Meal ordering's rules (pure, unit-tested in __tests__/meal-rules.test.js): what an admin's new
// meal and delivery times may hold, which meal times are still open, what a member's order may
// hold, and the order's steps. Times are India's (UTC+5:30, no daylight saving).
const crypto = require("node:crypto");
const { ValidationError } = require("../profile");

const DIETS = ["vegetarian", "non-vegetarian", "eggetarian", "vegan"];
const TAGS = ["bestseller", "gourmet", "high_protein", "special"];
const SLOTS = ["breakfast", "lunch", "dinner"];
// The order's steps, in order; the admin moves it one step at a time
const STEPS = ["placed", "preparing", "out_for_delivery", "delivered"];
const CUTOFF_MINUTES = 120; // orders close 2 hours before the meal time starts
const ORDER_DAYS = 7; // today and the next six days
const MAX_LINES = 10; // different meals in one order
const MAX_QUANTITY = 3; // of one meal (keeps a delivered meal inside the Macro diary's limits)
const DEFAULT_SLOTS = {
  breakfast: { startsAt: "07:00", endsAt: "09:00", active: true },
  lunch: { startsAt: "12:30", endsAt: "14:00", active: true },
  dinner: { startsAt: "19:00", endsAt: "21:00", active: true },
};
const limits = {
  name: 80, description: 300, calories: { min: 20, max: 1500 }, macro: 200, price: { min: 1, max: 5000 },
  search: 40, reason: { min: 3, max: 200 }, servingSize: 40, ingredients: 300,
};

const IST_OFFSET_MS = 330 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MEAL_ID = /^[a-z0-9-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function onlyFields(body, allowed) {
  if (!isObject(body)) throw new ValidationError("Send the details as an object.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
}
function text(value, label, max, { required = true, min = required ? 1 : 0 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ValidationError(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new ValidationError(`${label} must be text.`);
  const trimmed = value.trim().replace(/\s+/g, " ");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value.replace(/\n/g, ""))) throw new ValidationError(`${label} has characters that aren't allowed.`);
  if (trimmed.length < min) throw new ValidationError(required && min <= 1 ? `${label} is required.` : `${label} is too short (at least ${min} characters).`);
  if (trimmed.length > max) throw new ValidationError(`${label} is too long (max ${max} characters).`);
  return trimmed === "" ? null : trimmed;
}
function number(value, label, min, max, { whole = false, step = 0.1 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ValidationError(`${label} must be a number.`);
  if (whole && !Number.isInteger(value)) throw new ValidationError(`${label} must be a whole number.`);
  if (value < min || value > max) throw new ValidationError(`${label} must be between ${min} and ${max}.`);
  return whole ? value : Math.round(value / step) * step;
}

// ---- India's date and time ----

/** India's date (YYYY-MM-DD) and minutes since midnight at `now` (ms) */
function indiaNow(now = Date.now()) {
  const shifted = new Date(now + IST_OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const minutesOf = (time) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};
/** The moment (ms) orders for `date`'s meal time starting at `startsAt` close */
function cutoffAt(date, startsAt) {
  return Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS + (minutesOf(startsAt) - CUTOFF_MINUTES) * 60 * 1000;
}
/** "07:00:00" (MySQL TIME) or "07:00" → "07:00" */
const hhmm = (time) => String(time).slice(0, 5);

/**
 * The days a member can order for, each with its three meal times and whether each is still open:
 * switched on, and now is before its cutoff (2 hours before it starts).
 */
function orderDays(slots, now = Date.now()) {
  const today = indiaNow(now).date;
  return Array.from({ length: ORDER_DAYS }, (_, i) => {
    const date = addDays(today, i);
    return {
      date,
      slots: SLOTS.map((slot) => {
        const s = slots[slot];
        const closesAt = cutoffAt(date, s.startsAt);
        return { slot, open: s.active && now < closesAt, closesAt: new Date(closesAt).toISOString() };
      }),
    };
  });
}

/** Why a member can't order `slot` on `date` now, or null when they can */
function slotProblem(slots, date, slot, now = Date.now()) {
  const day = orderDays(slots, now).find((d) => d.date === date);
  if (!day) return "Pick a day from today to 6 days ahead.";
  const s = slots[slot];
  if (!s.active) return `We aren't delivering ${slot} right now. Pick another meal time.`;
  if (!day.slots.find((x) => x.slot === slot).open) return `Orders for ${slot} on that day have closed. Pick another meal time or day.`;
  return null;
}

// ---- The admin ----

/**
 * POST /api/admin/kitchen/meals and PUT …/meals/:id: a meal (price in whole rupees). Tags, serving
 * size, ingredients, the price before a discount (more than the price) and whether members see it
 * are optional; an edit sends every field.
 */
function mealBody(body) {
  onlyFields(body, ["name", "description", "diet", "calories", "proteinG", "carbsG", "fatG", "price", "mrp", "tags", "servingSize", "ingredients", "available"]);
  if (!DIETS.includes(body.diet)) throw new ValidationError("Pick Veg, Non-veg, Egg or Vegan.");
  const tags = body.tags === undefined ? [] : body.tags;
  if (!Array.isArray(tags) || tags.some((t) => !TAGS.includes(t)) || new Set(tags).size !== tags.length) throw new ValidationError("Pick tags from the list.");
  const pricePaise = number(body.price, "Price", limits.price.min, limits.price.max, { whole: true }) * 100;
  let mrpPaise = null;
  if (body.mrp !== undefined && body.mrp !== null) {
    mrpPaise = number(body.mrp, "Original price", limits.price.min, limits.price.max, { whole: true }) * 100;
    if (mrpPaise <= pricePaise) throw new ValidationError("The original price must be more than the price.");
  }
  if (body.available !== undefined && typeof body.available !== "boolean") throw new ValidationError("Say whether members see the meal.");
  return {
    name: text(body.name, "Meal name", limits.name, { min: 2 }),
    description: text(body.description, "Description", limits.description, { required: false }),
    diet: body.diet,
    calories: number(body.calories, "Calories", limits.calories.min, limits.calories.max, { whole: true }),
    proteinG: number(body.proteinG, "Protein", 0, limits.macro),
    carbsG: number(body.carbsG, "Carbs", 0, limits.macro),
    fatG: number(body.fatG, "Fat", 0, limits.macro),
    pricePaise,
    mrpPaise,
    tags: TAGS.filter((t) => tags.includes(t)),
    servingSize: text(body.servingSize, "Serving size", limits.servingSize, { required: false }),
    ingredients: text(body.ingredients, "Ingredients", limits.ingredients, { required: false }),
    available: body.available ?? true,
  };
}

/** A new meal's id: its name as a slug plus a short random tail (never two the same) */
function mealIdFor(name, random = () => crypto.randomBytes(3).toString("hex")) {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "meal";
  return `${slug}-${random()}`;
}

function mealId(value) {
  if (typeof value !== "string" || !MEAL_ID.test(value)) throw new ValidationError("That isn't a meal.");
  return value;
}

/** PUT /api/admin/kitchen/slots: all three meal times, each with its start, end and on/off */
function slotsBody(body) {
  onlyFields(body, ["slots"]);
  if (!isObject(body.slots)) throw new ValidationError("Send the three meal times.");
  for (const key of Object.keys(body.slots)) if (!SLOTS.includes(key)) throw new ValidationError(`Unexpected meal time: ${key}.`);
  const out = {};
  for (const slot of SLOTS) {
    const s = body.slots[slot];
    if (!isObject(s)) throw new ValidationError(`Send the ${slot} time.`);
    onlyFields(s, ["startsAt", "endsAt", "active", "capacity"]);
    if (!TIME.test(s.startsAt ?? "") || !TIME.test(s.endsAt ?? "")) throw new ValidationError(`Set the ${slot} time as HH:MM.`);
    if (minutesOf(s.startsAt) >= minutesOf(s.endsAt)) throw new ValidationError(`The ${slot} time must end after it starts.`);
    if (typeof s.active !== "boolean") throw new ValidationError(`Say whether ${slot} is on.`);
    // Orders a day across justFit (phase 3): a whole number 1 to 10,000, or null for no limit
    if (s.capacity !== undefined && s.capacity !== null && (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > 10000)) {
      throw new ValidationError(`The ${slot} capacity must be a whole number from 1 to 10,000, or empty.`);
    }
    out[slot] = { startsAt: s.startsAt, endsAt: s.endsAt, active: s.active, capacity: s.capacity ?? null };
  }
  return out;
}

/** GET /api/admin/kitchen/orders?day=YYYY-MM-DD (today by default; a year back to a week ahead) */
function adminDay(query, now = Date.now()) {
  onlyFields(query, ["day"]);
  const today = indiaNow(now).date;
  if (query.day === undefined || query.day === "") return today;
  if (typeof query.day !== "string" || !DATE.test(query.day) || Number.isNaN(Date.parse(query.day))) throw new ValidationError("Pick a day as YYYY-MM-DD.");
  if (query.day < addDays(today, -365) || query.day > addDays(today, ORDER_DAYS - 1)) throw new ValidationError("Pick a day within the last year or the next week.");
  return query.day;
}

/** POST …/orders/:id/advance { from }: the step the admin saw, so a double tap moves it once */
function advanceBody(body) {
  onlyFields(body, ["from"]);
  if (!STEPS.slice(0, -1).includes(body.from)) throw new ValidationError("That order can't move on from there.");
  return { from: body.from, to: STEPS[STEPS.indexOf(body.from) + 1] };
}

/** Cancel { reason } (the admin must give one; a member may) */
function cancelBody(body, { required }) {
  onlyFields(body ?? {}, ["reason"]);
  return { reason: text(body?.reason, "Reason", limits.reason.max, { required, min: required ? limits.reason.min : 0 }) };
}

function orderId(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new ValidationError("That isn't an order.");
  return value;
}

// ---- Members ----

/** GET /api/meals?search=&diet= */
function menuQuery(query) {
  onlyFields(query, ["search", "diet"]);
  const search = query.search === undefined ? null : text(query.search, "Search", limits.search, { required: false });
  if (query.diet !== undefined && query.diet !== "" && !DIETS.includes(query.diet)) throw new ValidationError("Unknown diet.");
  return { search, diet: query.diet || null };
}

/** The cart's lines: 1 to 10 different meals, 1 to 3 of each */
function cartItems(list) {
  if (!Array.isArray(list) || list.length === 0) throw new ValidationError("Your cart is empty.");
  if (list.length > MAX_LINES) throw new ValidationError(`At most ${MAX_LINES} different meals in one order.`);
  const seen = new Set();
  return list.map((item) => {
    onlyFields(item, ["mealId", "quantity"]);
    const id = mealId(item.mealId);
    if (seen.has(id)) throw new ValidationError("A meal can only be listed once.");
    seen.add(id);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) throw new ValidationError(`Order 1 to ${MAX_QUANTITY} of each meal.`);
    return { mealId: id, quantity: item.quantity };
  });
}

/** A coupon code as typed: letters and digits, any case → upper case; null when none */
function couponCode(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9]{3,16}$/.test(value.trim())) throw new ValidationError("That coupon code isn't valid.");
  return value.trim().toUpperCase();
}

/** POST /api/orders/quote { items, couponCode? } */
function quoteBody(body) {
  onlyFields(body, ["items", "couponCode"]);
  return { items: cartItems(body.items), couponCode: couponCode(body.couponCode) };
}

/** POST /api/orders { clientId, addressId, date, slot, items: [{ mealId, quantity }] } */
function orderBody(body) {
  onlyFields(body, ["clientId", "addressId", "date", "slot", "items", "couponCode"]);
  if (typeof body.clientId !== "string" || !UUID.test(body.clientId)) throw new ValidationError("Missing the order's request id.");
  if (!Number.isInteger(body.addressId) || body.addressId < 1) throw new ValidationError("Pick a delivery address.");
  if (typeof body.date !== "string" || !DATE.test(body.date)) throw new ValidationError("Pick a delivery day.");
  if (!SLOTS.includes(body.slot)) throw new ValidationError("Pick breakfast, lunch or dinner.");
  const items = cartItems(body.items);
  return { clientId: body.clientId.toLowerCase(), addressId: body.addressId, date: body.date, slot: body.slot, items, couponCode: couponCode(body.couponCode) };
}

/** The address as one line for the delivery person */
function addressLine(a) {
  return [a.house, a.street, a.landmark ? `Near ${a.landmark}` : null, a.city, a.pincode].filter(Boolean).join(", ").slice(0, 400);
}

/** A meal's picture for the app: its uploaded photo (a signed-in route, ?v= changes with it), else the bundled or https image */
function mealImageUrl(row) {
  if (row.image_key) return `/api/meals/${encodeURIComponent(row.id)}/photo?v=${encodeURIComponent(String(row.image_key).split(".")[0])}`;
  return row.image_url ?? null;
}

/** A test payment's reference: TEST- and 10 random characters */
const testPaymentRef = () => `TEST-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

module.exports = {
  DIETS, TAGS, SLOTS, STEPS, CUTOFF_MINUTES, ORDER_DAYS, MAX_LINES, MAX_QUANTITY, DEFAULT_SLOTS, limits,
  indiaNow, addDays, cutoffAt, hhmm, orderDays, slotProblem,
  mealBody, mealIdFor, mealId, slotsBody, adminDay, advanceBody, cancelBody, orderId,
  menuQuery, orderBody, cartItems, couponCode, quoteBody, onlyFields, text, number, isObject, DATE, addressLine, mealImageUrl, testPaymentRef,
};
