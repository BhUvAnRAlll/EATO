// Meal plans and subscriptions (pure, unit-tested in __tests__/subscription-rules.test.js; Meal
// Operations phase 5, 2026-11-10). Days are India's (YYYY-MM-DD).
const { ValidationError } = require("../profile");

const GOALS = ["fat_loss", "muscle_gain", "maintain", "custom"];
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

/** What a length costs a day, and how much a longer one saves against the shortest: "Save 12%" */
function lengthsWithSavings(lengths) {
  const sorted = [...lengths].sort((a, b) => a.days - b.days);
  const base = sorted[0] ? sorted[0].price / sorted[0].days : null;
  return sorted.map((l) => {
    const perDay = l.price / l.days;
    const save = base && l !== sorted[0] ? Math.round((1 - perDay / base) * 100) : 0;
    return { ...l, perDay: Math.round(perDay), savePercent: save > 0 ? save : 0 };
  });
}

/** POST /api/subscriptions { clientId, planId, days, startsOn, addressId } */
function subscribeBody(body, today) {
  onlyFields(body, ["clientId", "planId", "days", "startsOn", "addressId"]);
  if (typeof body.clientId !== "string" || !UUID.test(body.clientId)) throw new ValidationError("Missing the request id.");
  const startsOn = day(body.startsOn, "start day");
  if (startsOn <= today || startsOn > addDays(today, START_WITHIN_DAYS)) throw new ValidationError(`Start from tomorrow to ${START_WITHIN_DAYS} days ahead.`);
  return {
    clientId: body.clientId.toLowerCase(),
    planId: whole(body.planId, "The plan", 1, 1e9),
    days: whole(body.days, "The length", 1, 365),
    startsOn,
    addressId: whole(body.addressId, "The address", 1, 1e9),
  };
}

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

/** POST/PUT /admin/kitchen/subscription-plans … */
function planBody(body) {
  onlyFields(body, ["name", "tagline", "description", "goal", "mealsPerDay", "calories", "proteinG", "carbsG", "fatG", "waterL", "included", "lengths", "mealIds", "active", "sortOrder"]);
  if (!GOALS.includes(body.goal)) throw new ValidationError("Pick the plan's goal.");
  if (!Array.isArray(body.included) || body.included.length > 8) throw new ValidationError("List up to 8 things the plan includes.");
  if (!Array.isArray(body.lengths) || body.lengths.length === 0 || body.lengths.length > 4) throw new ValidationError("Give 1 to 4 lengths with prices.");
  const seen = new Set();
  const lengths = body.lengths.map((l) => {
    onlyFields(l, ["days", "price"]);
    const d = whole(l.days, "A length", 1, 365);
    if (seen.has(d)) throw new ValidationError("Each length once.");
    seen.add(d);
    return { days: d, pricePaise: whole(l.price, "A price", 1, 1_000_000) * 100 };
  });
  if (!Array.isArray(body.mealIds) || body.mealIds.length > 60 || body.mealIds.some((m) => typeof m !== "string" || !/^[a-z0-9-]{1,64}$/.test(m))) throw new ValidationError("Pick the plan's meals from the menu.");
  if (typeof body.active !== "boolean") throw new ValidationError("Say whether members see the plan.");
  if (typeof body.waterL !== "number" || !Number.isFinite(body.waterL) || body.waterL < 0 || body.waterL > 10) throw new ValidationError("Water must be from 0 to 10 litres.");
  return {
    name: text(body.name, "plan's name", 40, { min: 3 }),
    tagline: text(body.tagline, "short line", 60, { min: 3 }),
    description: text(body.description, "description", 200, { min: 10 }),
    goal: body.goal,
    mealsPerDay: whole(body.mealsPerDay, "Meals a day", 1, 3),
    calories: whole(body.calories, "Calories a day", 800, 6000),
    proteinG: whole(body.proteinG, "Protein", 0, 500),
    carbsG: whole(body.carbsG, "Carbs", 0, 1000),
    fatG: whole(body.fatG, "Fat", 0, 400),
    waterL: Math.round(body.waterL * 10) / 10,
    included: body.included.map((i) => text(i, "included item", 60, { min: 3 })),
    lengths: lengths.sort((a, b) => a.days - b.days),
    mealIds: [...new Set(body.mealIds)],
    active: body.active,
    sortOrder: body.sortOrder === undefined ? 0 : whole(body.sortOrder, "The order", 0, 1000),
  };
}

/** A plan's slug from its name: "Fat Loss Plan" → "fat-loss-plan" (a short tail when taken) */
const slugFor = (name, tail = "") => `${name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "plan"}${tail}`;

module.exports = {
  GOALS, SLOTS_BY_MEALS, START_WITHIN_DAYS, MAX_PAUSE_DAYS, slotsFor, lengthsWithSavings, subscribeBody, pauseBody, skipBody, mealFor, deliversOn,
  planBody, slugFor, addDays, daysBetween, day, onlyFields,
};
