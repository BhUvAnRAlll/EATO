// Which kitchen cooks an order, and the order's kitchen steps (pure, unit-tested in
// __tests__/assign-rules.test.js; Meal Operations phase 3, 2026-11-10).
// A kitchen can take an order when it is active, serves the delivery pincode, is open when the meal
// time starts, cooks every meal in the order and has them available, has the stock the recipes need,
// and has room left in its orders for the day and its meals for that meal time. Among those, the
// nearest (when both places are on the map) wins, then the least busy.
const { ValidationError } = require("../profile");

// The kitchen's steps, in order; the admin moves an order one step at a time
const STEPS = ["placed", "accepted", "preparing", "quality_check", "ready", "out_for_delivery", "delivered"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The step after this one, or null (delivered, cancelled, awaiting payment) */
function nextStep(status) {
  const i = STEPS.indexOf(status);
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null;
}

/** Steps before cooking starts: the kitchen can still be changed and the order rejected */
const beforeCooking = (status) => status === "placed" || status === "accepted";

const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};

/** Open at that day's meal time start: a session that contains it */
function openFor(hours, date, startsAt) {
  const day = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const at = minutes(startsAt);
  return (hours?.[day] ?? []).some(([open, close]) => at >= minutes(open) && at < minutes(close));
}

/** Kilometres between two points (haversine) */
function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Why a kitchen can't take the order, or null. `k`: { status, hours, pincodes: Set, menu: Map
 * mealId → available, stock: Map ingredientId → quantity, dayOrders, maxDailyOrders, slotMeals,
 * prepCapacity, latitude, longitude, radiusKm }. `order`: { pincode, date, startsAt, items:
 * [{ mealId, quantity }], need: Map ingredientId → quantity, lat, lng }.
 */
function problem(k, order) {
  if (k.status !== "active") return "not active";
  if (!k.pincodes.has(order.pincode)) return "doesn't deliver to this pincode";
  if (!openFor(k.hours, order.date, order.startsAt)) return "closed at this meal time";
  for (const item of order.items) {
    if (!k.menu.has(item.mealId)) return "doesn't cook a meal in it";
    if (!k.menu.get(item.mealId)) return "a meal in it is off today";
  }
  for (const [ingredientId, qty] of order.need) if ((k.stock.get(ingredientId) ?? 0) < qty) return "short of an ingredient";
  if (k.dayOrders + 1 > k.maxDailyOrders) return "full for the day";
  const meals = order.items.reduce((sum, i) => sum + i.quantity, 0);
  if (k.slotMeals + meals > k.prepCapacity) return "full for this meal time";
  if (k.latitude !== null && order.lat !== null && distanceKm({ lat: k.latitude, lng: k.longitude }, { lat: order.lat, lng: order.lng }) > k.radiusKm) return "too far";
  return null;
}

/** The best of the kitchens that can take it (nearest, then least busy, then lowest id), or null */
function choose(kitchens, order) {
  const able = kitchens.filter((k) => problem(k, order) === null);
  const score = (k) => ({
    km: k.latitude !== null && order.lat !== null ? distanceKm({ lat: k.latitude, lng: k.longitude }, { lat: order.lat, lng: order.lng }) : Infinity,
    load: k.dayOrders / Math.max(1, k.maxDailyOrders),
  });
  able.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    return sa.km - sb.km || sa.load - sb.load || a.id - b.id;
  });
  return able[0] ?? null;
}

/** What an order's meals need, by ingredient: recipe quantity × servings, summed */
function needs(items, recipes) {
  const need = new Map();
  for (const item of items) {
    for (const r of recipes.get(item.mealId) ?? []) need.set(r.ingredientId, Math.round(((need.get(r.ingredientId) ?? 0) + r.quantity * item.quantity) * 1000) / 1000);
  }
  return need;
}

/** POST /orders/:id/advance { from, override?, note? } (override: start cooking without enough stock) */
function advanceBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the step you saw.");
  for (const key of Object.keys(body)) if (!["from", "override", "note"].includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
  if (!STEPS.includes(body.from) || body.from === "delivered") throw new ValidationError("That step can't move on.");
  if (body.override !== undefined && typeof body.override !== "boolean") throw new ValidationError("Say whether to override the stock check.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
  if (body.override && note.length < 3) throw new ValidationError("Give a reason to start without enough stock.");
  return { from: body.from, to: nextStep(body.from), override: body.override === true, note: note || null };
}

/** POST /orders/:id/kitchen { kitchenId }: a positive whole number */
function kitchenBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => k !== "kitchenId")) throw new ValidationError("Send the kitchen to move it to.");
  if (!Number.isInteger(body.kitchenId) || body.kitchenId < 1) throw new ValidationError("Pick a kitchen.");
  return { kitchenId: body.kitchenId };
}

/** POST /holidays { day, note } and the slots' capacity */
function holidayBody(body, today) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !["day", "note"].includes(k))) throw new ValidationError("Send the day and a note.");
  if (typeof body.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.day) || Number.isNaN(Date.parse(`${body.day}T00:00:00Z`))) throw new ValidationError("Pick a day like 2026-11-14.");
  if (body.day < today) throw new ValidationError("Pick today or a day ahead.");
  const note = typeof body.note === "string" ? body.note.trim().replace(/\s+/g, " ") : "";
  if (note.length < 3 || note.length > 80) throw new ValidationError("Write a note of 3 to 80 characters (members see it).");
  return { day: body.day, note };
}

module.exports = { STEPS, nextStep, beforeCooking, openFor, distanceKm, problem, choose, needs, advanceBody, kitchenBody, holidayBody };
