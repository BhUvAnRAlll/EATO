// Input checks for the workout routes. Every problem is a ValidationError (400) with one
// line the screen can show. Dates are the member's local day as YYYY-MM-DD; the server only
// checks that "today" is within a day of its own UTC date (every time zone fits).
const { ValidationError } = require("../profile");
const { isoDate, isNearToday } = require("../macro/validate");

const limits = {
  weekDates: 14, // home({ dates }): the week strip, with room for a two-week view
  historyDays: 31, // history({ from, to })
  moveBackDays: 31, // moveSessionToToday: how far back a missed session can come from
  maxReps: 1000, // logSet: the spec's limits (the table checks the same)
  maxWeightKg: 1000,
  maxDurationSec: 3600,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

function today(value, now) {
  const iso = isoDate(value, "Today");
  if (!isNearToday(iso, now)) throw new ValidationError("Today doesn't match the server's date. Check your phone's date.");
  return iso;
}

function dates(value) {
  if (typeof value !== "string" || value === "") throw new ValidationError("Send the dates as a comma-separated list.");
  const list = value.split(",");
  if (list.length > limits.weekDates) throw new ValidationError(`Ask for at most ${limits.weekDates} days at once.`);
  return [...new Set(list.map((d) => isoDate(d)))];
}

// GET /home?date=…&dates=…&today=…
function homeQuery(query, now) {
  return { date: isoDate(query.date), dates: dates(query.dates), today: today(query.today, now) };
}

// GET /activity?today=… (the server works the week out from today)
function activityQuery(query, now) {
  return { today: today(query.today, now) };
}

// GET /history?from=…&to=…&today=…
function historyQuery(query, now) {
  const from = isoDate(query.from, "From");
  const to = isoDate(query.to, "To");
  const span = dayNumber(to) - dayNumber(from);
  if (span < 0) throw new ValidationError("From must be on or before To.");
  if (span >= limits.historyDays) throw new ValidationError(`Ask for at most ${limits.historyDays} days of history at once.`);
  return { from, to, today: today(query.today, now) };
}

// POST /plan/ensure { today }
function ensureBody(body, now) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the request as { today }.");
  const unknown = Object.keys(body).filter((key) => key !== "today");
  if (unknown.length > 0) throw new ValidationError(`Unexpected field: ${unknown[0]}.`);
  return { today: today(body.today, now) };
}

// A JSON object with exactly these keys and nothing else
function shape(body, keys) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError(`Send the request as { ${keys.join(", ")} }.`);
  const unknown = Object.keys(body).filter((key) => !keys.includes(key));
  if (unknown.length > 0) throw new ValidationError(`Unexpected field: ${unknown[0]}.`);
}

// POST /reschedule/move { from, today }: a missed session from the last month
function moveBody(body, now) {
  shape(body, ["from", "today"]);
  const t = today(body.today, now);
  const from = isoDate(body.from, "From");
  if (dayNumber(t) - dayNumber(from) > limits.moveBackDays) throw new ValidationError("Only a session from the last month can be moved");
  return { from, today: t };
}

// POST /reschedule/swap { a, b, today }: two dates in the next two weeks
function swapBody(body, now) {
  shape(body, ["a", "b", "today"]);
  const t = today(body.today, now);
  const a = isoDate(body.a, "The first date");
  const b = isoDate(body.b, "The second date");
  for (const d of [a, b]) if (dayNumber(d) - dayNumber(t) >= limits.weekDates) throw new ValidationError("Pick a date in the next two weeks");
  return { a, b, today: t };
}

// ---- running a session ----

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A log id that isn't even shaped like one reads the same as a missing log
function logId(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new ValidationError("Session not found");
  return value.toLowerCase();
}

// GET /session?date=…&today=…
function progressQuery(query, now) {
  return { date: isoDate(query.date), today: today(query.today, now) };
}

// POST /session/start { date, today }
function startBody(body, now) {
  shape(body, ["date", "today"]);
  const t = today(body.today, now);
  let date;
  try { date = isoDate(body.date); } catch { throw new ValidationError("Invalid date"); }
  return { date, today: t };
}

// A whole number in a range, or absent
function optionalInt(value, max, message) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > max) throw new ValidationError(message);
  return value;
}

// POST /session/sets { logId, dayExerciseId, setIndex, reps?, weightKg?, durationSec? }
function setBody(body) {
  shape(body, ["logId", "dayExerciseId", "setIndex", "reps", "weightKg", "durationSec"]);
  if (typeof body.dayExerciseId !== "string" || !UUID.test(body.dayExerciseId)) throw new ValidationError("That exercise is not part of this session");
  if (!Number.isInteger(body.setIndex) || body.setIndex < 0 || body.setIndex > 99) throw new ValidationError("Invalid set");
  let weightKg;
  if (body.weightKg !== undefined && body.weightKg !== null) {
    // Kilograms to one decimal place, like the table stores them
    if (typeof body.weightKg !== "number" || !Number.isFinite(body.weightKg) || body.weightKg < 0 || body.weightKg > limits.maxWeightKg) {
      throw new ValidationError(`Weight must be between 0 and ${limits.maxWeightKg} kg.`);
    }
    weightKg = Math.round(body.weightKg * 10) / 10;
  }
  return {
    logId: logId(body.logId),
    dayExerciseId: body.dayExerciseId.toLowerCase(),
    setIndex: body.setIndex,
    reps: optionalInt(body.reps, limits.maxReps, `Reps must be a whole number from 0 to ${limits.maxReps}.`),
    weightKg,
    durationSec: optionalInt(body.durationSec, limits.maxDurationSec, `Duration must be a whole number of seconds up to ${limits.maxDurationSec}.`),
  };
}

// POST /session/complete and /session/abandon { logId }
function logBody(body) {
  shape(body, ["logId"]);
  return { logId: logId(body.logId) };
}

// ---- preferences ----

const GOALS = ["lose_weight", "build_muscle", "get_fitter", "stay_healthy"];
const LEVELS = ["beginner", "intermediate", "advanced"];
const SPLITS = ["auto", "full_body", "upper_lower", "push_pull_legs"];

// PUT /preferences { today, goal, level, weekdays, split }
function preferencesBody(body, now) {
  shape(body, ["today", "goal", "level", "weekdays", "split"]);
  const t = today(body.today, now);
  if (!GOALS.includes(body.goal)) throw new ValidationError("Pick a fitness goal.");
  if (!LEVELS.includes(body.level)) throw new ValidationError("Pick a fitness level.");
  if (!SPLITS.includes(body.split)) throw new ValidationError("Pick a workout split.");
  const days = body.weekdays;
  if (!Array.isArray(days) || days.length > 7 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(days).size !== days.length) {
    throw new ValidationError("Workout days must be different days of the week.");
  }
  if (days.length < 3) throw new ValidationError("Pick at least 3 training days");
  return { today: t, goal: body.goal, level: body.level, weekdays: [...days], split: body.split };
}

// ---- rebuild my plan ----

const GENDERS = ["female", "male", "other"];
const BODY_TYPES = ["lean", "athletic", "average", "overweight", "obese"];
const PACES = ["slow", "standard", "brisk"];
const isScore = (n) => n === 1 || n === 2 || n === 3 || n === 4;
const RECREATE_KEYS = ["today", "gender", "ageYears", "weightKg", "heightCm", "bodyType", "goal", "weekdays", "pace", "fitnessBase", "squatScore", "pushScore", "pullScore", "seriousInjury"];

// POST /recreate { today, ...thirteen answers }: each refused with the flow's own words
function recreateBody(body, now) {
  shape(body, RECREATE_KEYS);
  const t = today(body.today, now);
  const b = body;
  if (!GENDERS.includes(b.gender)) throw new ValidationError("Pick your gender");
  if (!Number.isInteger(b.ageYears) || b.ageYears < 13 || b.ageYears > 100) throw new ValidationError("Enter an age between 13 and 100");
  if (typeof b.weightKg !== "number" || !Number.isFinite(b.weightKg) || b.weightKg < 25 || b.weightKg > 300) throw new ValidationError("Enter a weight between 25 and 300 kg");
  if (!Number.isInteger(b.heightCm) || b.heightCm < 100 || b.heightCm > 250) throw new ValidationError("Enter a height between 100 and 250 cm");
  if (!BODY_TYPES.includes(b.bodyType)) throw new ValidationError("Pick the closest body type");
  if (!GOALS.includes(b.goal)) throw new ValidationError("Pick a goal");
  const days = b.weekdays;
  if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || new Set(days).size !== days.length || days.length > 7) {
    throw new ValidationError("Workout days must be different days of the week.");
  }
  if (days.length < 3) throw new ValidationError(`Select at least 3 days (${days.length} chosen)`);
  if (!PACES.includes(b.pace)) throw new ValidationError("Pick a pace");
  if (!isScore(b.fitnessBase)) throw new ValidationError("Pick the statement that fits you");
  for (const key of ["squatScore", "pushScore", "pullScore"]) if (!isScore(b[key])) throw new ValidationError("Pick a range");
  if (typeof b.seriousInjury !== "boolean") throw new ValidationError("Answer yes or no");
  return {
    today: t,
    answers: {
      gender: b.gender, ageYears: b.ageYears, weightKg: Math.round(b.weightKg * 10) / 10, heightCm: b.heightCm, bodyType: b.bodyType,
      goal: b.goal, weekdays: [...days], pace: b.pace, fitnessBase: b.fitnessBase, squatScore: b.squatScore, pushScore: b.pushScore,
      pullScore: b.pullScore, seriousInjury: b.seriousInjury,
    },
  };
}

// GET /recreate?today=…
function recreateQuery(query, now) {
  return { today: today(query.today, now) };
}

module.exports = { limits, recreateBody, recreateQuery, preferencesBody, homeQuery, activityQuery, historyQuery, ensureBody, moveBody, swapBody, progressQuery, startBody, setBody, logBody, dayNumber, shape };
