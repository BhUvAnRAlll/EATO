// Input checks for the Macro diary routes: one friendly line per problem. Pure functions
// (no database, the clock passed in), so they are unit-tested directly. Identity never
// comes from here: every route reads the member from the verified session.
const { ValidationError } = require("../profile");

const SLOTS = ["breakfast", "lunch", "snack", "dinner"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const limits = {
  itemsPerMeal: 50,
  mealsPerDay: 50, // a guard against abuse, far above any real day
  favorites: 200,
  nameLength: 120,
  unitLength: 40,
  quantityMax: 10000,
  kcalMax: 5000,
  macroMax: 2000,
  recentDays: 3,
  recentMax: 50,
  recentDefault: 12,
  progressDates: 40,
  loggedAtPastHours: 36,
  loggedAtFutureHours: 18,
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function requireObject(body, label) {
  if (!isPlainObject(body)) throw new ValidationError(`Send the ${label} as an object.`);
  return body;
}

function rejectUnknownKeys(body, allowed, label) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new ValidationError(`${label} has an unexpected field: ${key}.`);
  }
}

// Trimmed, control characters dropped, never empty, cut to `max` characters (the spec
// truncates names rather than refusing them)
function label(value, what, max) {
  if (typeof value !== "string") throw new ValidationError(`${what} is required.`);
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) throw new ValidationError(`${what} is required.`);
  return clean.slice(0, max);
}

// "YYYY-MM-DD" that is a real calendar day
function isoDate(value, what = "The date") {
  if (typeof value !== "string" || !ISO_DATE.test(value)) throw new ValidationError(`${what} must look like YYYY-MM-DD.`);
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new ValidationError(`${what} isn't a real day.`);
  return value;
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

// The member's "today" is their local day, which the server can't see. Any day within one
// day of the server's UTC date covers every time zone (UTC−12 to UTC+14).
function isNearToday(iso, now) {
  return Math.abs(dayNumber(iso) - dayNumber(utcDay(now))) <= 1;
}

function assertToday(iso, now, message) {
  if (!isNearToday(iso, now)) throw new ValidationError(message);
}

function slot(value) {
  if (!SLOTS.includes(value)) throw new ValidationError("Choose breakfast, lunch, snack or dinner.");
  return value;
}

function number(value, what, min, max, { exclusiveMin = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ValidationError(`${what} must be a number.`);
  if ((exclusiveMin ? value <= min : value < min) || value > max) throw new ValidationError(`${what} is out of range.`);
  return Math.round(value * 10) / 10;
}

// A food quantity: rounded to the two decimals the column stores, then checked, so a value that
// rounds to 0 is refused here (a 400) instead of by the database's CHECK (a 500)
function quantity(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ValidationError("The quantity must be a number.");
  const rounded = Math.round(value * 100) / 100;
  if (rounded <= 0 || rounded > limits.quantityMax) throw new ValidationError("The quantity is out of range.");
  return rounded;
}

function loggedAt(value, now) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ValidationError("The meal time isn't valid.");
  if (value < now - limits.loggedAtPastHours * 3600_000 || value > now + limits.loggedAtFutureHours * 3600_000) {
    throw new ValidationError("The meal time is too far from now.");
  }
  return Math.round(value);
}

function item(body, index) {
  requireObject(body, "food");
  rejectUnknownKeys(body, ["name", "quantity", "unit", "kcal", "proteinG", "carbsG", "fatG"], `Food ${index + 1}`);
  return {
    name: label(body.name, "The food name", limits.nameLength),
    quantity: quantity(body.quantity),
    unit: label(body.unit, "The unit", limits.unitLength),
    kcal: number(body.kcal, "Calories", 0, limits.kcalMax),
    proteinG: number(body.proteinG, "Protein", 0, limits.macroMax),
    carbsG: number(body.carbsG, "Carbs", 0, limits.macroMax),
    fatG: number(body.fatG, "Fat", 0, limits.macroMax),
  };
}

function items(value) {
  if (!Array.isArray(value) || value.length === 0) throw new ValidationError("A meal needs at least one food");
  if (value.length > limits.itemsPerMeal) throw new ValidationError("Too many foods in one meal");
  return value.map(item);
}

// POST /meals. `favorite` is not accepted here: that source is only written by logging a
// favourite, which checks the favourite belongs to the caller.
function validateMeal(body, now) {
  requireObject(body, "meal");
  rejectUnknownKeys(body, ["date", "slot", "title", "loggedAt", "source", "items"], "The meal");
  const date = isoDate(body.date);
  assertToday(date, now, "Meals can only be logged for today");
  const source = body.source === undefined ? "manual" : body.source;
  if (!["manual", "repeat"].includes(source)) throw new ValidationError("The meal source isn't valid.");
  return {
    date,
    slot: slot(body.slot),
    title: label(body.title, "The meal name", limits.nameLength),
    loggedAt: loggedAt(body.loggedAt, now),
    source,
    items: items(body.items),
  };
}

// POST /favorites/toggle. A source key ("meal:<uuid>") makes the heart a true toggle.
function validateFavoriteToggle(body) {
  requireObject(body, "favourite");
  rejectUnknownKeys(body, ["name", "items", "sourceKey"], "The favourite");
  let sourceKey = null;
  if (body.sourceKey !== undefined && body.sourceKey !== null) {
    if (typeof body.sourceKey !== "string" || !/^meal:[0-9a-f-]{36}$/i.test(body.sourceKey) || !UUID.test(body.sourceKey.slice(5))) {
      throw new ValidationError("The favourite key isn't valid.");
    }
    sourceKey = body.sourceKey.toLowerCase();
  }
  return { name: label(body.name, "The favourite name", limits.nameLength), items: items(body.items), sourceKey };
}

// POST /favorites/:id/log
function validateFavoriteLog(body, now) {
  requireObject(body, "request");
  rejectUnknownKeys(body, ["date", "slot", "loggedAt"], "The request");
  const date = isoDate(body.date);
  assertToday(date, now, "Meals can only be logged for today");
  return { date, slot: slot(body.slot), loggedAt: loggedAt(body.loggedAt, now) };
}

function id(value, what) {
  if (typeof value !== "string" || !UUID.test(value)) throw new ValidationError(`${what} isn't valid.`);
  return value.toLowerCase();
}

// ?dates=2026-10-08,2026-10-09,…
function dateList(value) {
  if (typeof value !== "string" || value === "") throw new ValidationError("Send the dates as a comma-separated list.");
  const dates = value.split(",");
  if (dates.length > limits.progressDates) throw new ValidationError(`Ask for at most ${limits.progressDates} days at once.`);
  return [...new Set(dates.map((d) => isoDate(d)))];
}

// ?today=…&limit=… for recent meals: `today` is the member's local day (near the server's)
function recentQuery(query, now) {
  const today = isoDate(query.today, "today");
  if (!isNearToday(today, now)) throw new ValidationError("today doesn't match the current date.");
  let limit = limits.recentDefault;
  if (query.limit !== undefined && query.limit !== "") {
    const n = Number(query.limit);
    if (!Number.isInteger(n) || n < 1 || n > limits.recentMax) throw new ValidationError(`limit must be between 1 and ${limits.recentMax}.`);
    limit = n;
  }
  return { today, limit };
}

// ?period=today|week|month&today=… for the averages: 1, 7 or 30 days ending on `today`
const PERIOD_DAYS = { today: 1, week: 7, month: 30 };
function summaryQuery(query, now) {
  if (!Object.hasOwn(PERIOD_DAYS, query.period)) throw new ValidationError("period must be today, week or month.");
  const today = isoDate(query.today, "today");
  if (!isNearToday(today, now)) throw new ValidationError("today doesn't match the current date.");
  return { period: query.period, days: PERIOD_DAYS[query.period], today };
}

// The day `n` days before an ISO date
function daysBefore(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);
}

module.exports = { SLOTS, limits, isoDate, isNearToday, validateMeal, validateFavoriteToggle, validateFavoriteLog, id, dateList, recentQuery, summaryQuery, daysBefore };
