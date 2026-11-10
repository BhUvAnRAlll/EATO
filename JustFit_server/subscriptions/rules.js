// Meal subscriptions (pure, unit-tested in __tests__/subscription-rules.test.js; Meal Operations phase
// 5, 2026-11-10; per meal since 2027-01-10). Days are India's (YYYY-MM-DD). The plan rules (slotsFor,
// mealFor) stay for whole-plan subscriptions still running.
const { ValidationError } = require("../profile");

const SLOTS_BY_MEALS = { 1: ["lunch"], 2: ["lunch", "dinner"], 3: ["breakfast", "lunch", "dinner"] };
const START_WITHIN_DAYS = 14; // a subscription starts from tomorrow to two weeks ahead
const MAX_PAUSE_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function onlyFields(body, allowed) {
  if (!isObject(body)) throw new ValidationError("Send the details as an object.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
}
function text(value, label, max, { min = 1, required = true } = {}) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    if (required) throw new ValidationError(`Add the ${label}.`);
    return null;
  }
  if (typeof value !== "string" || CONTROL.test(value)) throw new ValidationError(`Write the ${label} as plain text.`);
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length < min) throw new ValidationError(`The ${label} is too short.`);
  if (clean.length > max) throw new ValidationError(`Keep the ${label} to ${max} characters.`);
  return clean;
}
const whole = (v, label, min, max) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new ValidationError(`${label} must be a whole number from ${min} to ${max}.`);
  return v;
};
function day(value, label) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`Pick the ${label} like 2026-11-20.`);
  }
  return value;
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The meal times a plan delivers */
const slotsFor = (mealsPerDay) => SLOTS_BY_MEALS[mealsPerDay] ?? SLOTS_BY_MEALS[3];

const MEAL_SLOTS = ["breakfast", "lunch", "dinner"];
const MAX_MEAL_QUANTITY = 3; // like the cart's limit for one meal
const MAX_RUNNING = 5; // meal subscriptions running at once per member

/** POST /api/subscriptions { clientId, mealId, lengthId, quantity, slot, startsOn, addressId }: one meal every day */
function subscribeMealBody(body, today) {
  onlyFields(body, ["clientId", "mealId", "lengthId", "quantity", "slot", "startsOn", "addressId"]);
  if (typeof body.clientId !== "string" || !UUID.test(body.clientId)) throw new ValidationError("Missing the request id.");
  if (typeof body.mealId !== "string" || !/^[a-z0-9-]{1,64}$/.test(body.mealId)) throw new ValidationError("Pick a meal from the menu.");
  if (!MEAL_SLOTS.includes(body.slot)) throw new ValidationError("Pick breakfast, lunch or dinner.");
  const startsOn = day(body.startsOn, "start day");
  if (startsOn <= today || startsOn > addDays(today, START_WITHIN_DAYS)) throw new ValidationError(`Start from tomorrow to ${START_WITHIN_DAYS} days ahead.`);
  return {
    clientId: body.clientId.toLowerCase(),
    mealId: body.mealId,
    lengthId: whole(body.lengthId, "The length", 1, 1e9),
    quantity: whole(body.quantity, "How many a day", 1, MAX_MEAL_QUANTITY),
    slot: body.slot,
    startsOn,
    addressId: whole(body.addressId, "The address", 1, 1e9),
  };
}

/** What a meal subscription costs, in paise rounded to the rupee: the meal's price × how many × days, less the length's % off */
function mealSubscriptionPrice(unitPaise, quantity, days, percentOff) {
  const full = unitPaise * quantity * days;
  return { fullPaise: full, totalPaise: Math.round((full * (100 - percentOff)) / 100 / 100) * 100 };
}

/** PUT /admin/kitchen/subscription-lengths { lengths: [{ label, days, percentOff, active }] }: 1 to 6, each length once */
function lengthsBody(body) {
  onlyFields(body, ["lengths"]);
  if (!Array.isArray(body.lengths) || body.lengths.length === 0 || body.lengths.length > 6) throw new ValidationError("Give 1 to 6 lengths.");
  const seen = new Set();
  const lengths = body.lengths.map((l) => {
    onlyFields(l, ["label", "days", "percentOff", "active"]);
    const d = whole(l.days, "Delivery days", 1, 90);
    if (seen.has(d)) throw new ValidationError("Each number of days once.");
    seen.add(d);
    if (typeof l.active !== "boolean") throw new ValidationError("Say whether members see each length.");
    return { label: text(l.label, "length's name", 20, { min: 2 }), days: d, percentOff: whole(l.percentOff, "The % off", 0, 50), active: l.active };
  });
  if (!lengths.some((l) => l.active)) throw new ValidationError("Keep at least one length on.");
  return { lengths: lengths.sort((a, b) => a.days - b.days) };
}

/** The meal times a subscription delivers: a meal subscription its one meal time, a plan its meals a day */
const slotsOf = (sub) => (sub.slot ? [sub.slot] : slotsFor(sub.mealsPerDay));

/** POST …/pause { from, until }: tomorrow onwards, at most 30 days, inside the subscription */
function pauseBody(body, today, sub) {
  onlyFields(body, ["from", "until"]);
  const from = day(body.from, "first paused day");
  const until = day(body.until, "last paused day");
  if (from <= today) throw new ValidationError("Pause from tomorrow at the earliest.");
  if (until < from) throw new ValidationError("The last paused day can't be before the first.");
  if (daysBetween(from, until) + 1 > MAX_PAUSE_DAYS) throw new ValidationError(`Pause for at most ${MAX_PAUSE_DAYS} days at a time.`);
  if (from > sub.endsOn) throw new ValidationError("That's after your plan ends.");
  return { from, until, days: daysBetween(from, until) + 1 };
}

/** POST …/skip { day }: a day still to come (tomorrow or later) inside the subscription */
function skipBody(body, today, sub) {
  onlyFields(body, ["day"]);
  const d = day(body.day, "day");
  if (d <= today) throw new ValidationError("You can skip tomorrow or a later day.");
  if (d < sub.startsOn || d > sub.endsOn) throw new ValidationError("That day isn't in your plan.");
  return { day: d };
}

/** The meal for a day and meal time: the plan's meals in turn, so a day's meal times differ */
function mealFor(mealIds, date, slotIndex, startsOn) {
  if (mealIds.length === 0) return null;
  const n = daysBetween(startsOn, date) * 3 + slotIndex;
  return mealIds[((n % mealIds.length) + mealIds.length) % mealIds.length];
}

/** Whether a subscription delivers on a day: active, inside its days, not paused then */
function deliversOn(sub, date) {
  if (sub.status !== "active" && sub.status !== "paused") return false;
  if (date < sub.startsOn || date > sub.endsOn) return false;
  if (sub.pausedFrom && date >= sub.pausedFrom && date <= sub.pausedUntil) return false;
  return true;
}

module.exports = {
  SLOTS_BY_MEALS, START_WITHIN_DAYS, MAX_PAUSE_DAYS, MAX_MEAL_QUANTITY, MAX_RUNNING, slotsFor, slotsOf, subscribeMealBody, mealSubscriptionPrice, lengthsBody,
  pauseBody, skipBody, mealFor, deliversOn, addDays, daysBetween, day, onlyFields,
};
