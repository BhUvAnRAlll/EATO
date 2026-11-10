// Gym Hub › Book a free trial (2026-11-10, the user's request; pure, unit-tested). A member asks a
// gym for a trial visit with a few details about themselves (filled in by the app from their
// profile, and editable) and a preferred day and time of day. It is an enquiry in the gym's
// Enquiries (interest 'trial', source 'app'); the gym follows it up, then schedules the trial for a
// date and time, and afterwards marks it done or no-show. Times are India's (stored as written).
const { ValidationError } = require("../profile");

const GENDERS = ["male", "female", "other"];
const GOALS = ["lose_weight", "build_muscle", "get_fit", "strength", "other"];
const GOAL_LABEL = { lose_weight: "Lose weight", build_muscle: "Build muscle", get_fit: "Get fit", strength: "Get stronger", other: "Other" };
const EXPERIENCE = ["new", "some", "regular"];
const EXPERIENCE_LABEL = { new: "New to the gym", some: "Trained before", regular: "Trains regularly" };
const TIMES = ["morning", "afternoon", "evening"];
const TIME_LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
const STATUSES = ["requested", "scheduled", "done", "no_show", "cancelled"];
const AHEAD_DAYS = 14; // a preferred day: today to two weeks ahead
const SCHEDULE_AHEAD_DAYS = 60; // the gym may book it up to two months ahead
const NOTE_MAX = 200;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DAY_MS = 24 * 60 * 60 * 1000;

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;

function onlyFields(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the details as an object.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new ValidationError(`Unexpected field: ${key}.`);
}

function text(value, { label, max, required = false }) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ValidationError(`Add your ${label}.`);
    return null;
  }
  if (typeof value !== "string") throw new ValidationError(`Write your ${label} as text.`);
  const clean = value.replace(/\s+/g, " ").trim();
  if (CONTROL.test(clean)) throw new ValidationError(`Your ${label} has characters we can't show.`);
  if (required && clean.length < 2) throw new ValidationError(`Add your ${label}.`);
  if (clean.length > max) throw new ValidationError(`Keep your ${label} to ${max} characters.`);
  return clean || null;
}

const pick = (value, list, message) => {
  if (value === undefined || value === null) return null;
  if (!list.includes(value)) throw new ValidationError(message);
  return value;
};

/**
 * POST /api/gyms/:id/trials { name, age?, gender?, goal?, experience?, day, time, note? }: the
 * member's details (the phone is always the account's, never sent) and when they'd like to come.
 */
function trialBody(body, today) {
  onlyFields(body, ["name", "age", "gender", "goal", "experience", "day", "time", "note"]);
  const name = text(body.name, { label: "name", max: 80, required: true });
  let age = null;
  if (body.age !== undefined && body.age !== null) {
    if (!Number.isInteger(body.age) || body.age < 13 || body.age > 90) throw new ValidationError("Age must be a whole number from 13 to 90.");
    age = body.age;
  }
  if (!isDay(body.day)) throw new ValidationError("Pick the day you'd like to come.");
  if (body.day < today || body.day > addDays(today, AHEAD_DAYS)) throw new ValidationError(`Pick a day from today to ${AHEAD_DAYS} days ahead.`);
  const time = pick(body.time, TIMES, "Pick morning, afternoon or evening.");
  if (!time) throw new ValidationError("Pick morning, afternoon or evening.");
  return {
    name,
    details: {
      age,
      gender: pick(body.gender, GENDERS, "Pick a gender from the list."),
      goal: pick(body.goal, GOALS, "Pick a goal from the list."),
      experience: pick(body.experience, EXPERIENCE, "Pick your experience from the list."),
      day: body.day,
      time,
    },
    note: text(body.note, { label: "message", max: NOTE_MAX }),
  };
}

/** PUT /api/gym/enquiries/:id/trial { day, time: "18:30" }: the gym books (or moves) the trial */
function scheduleBody(body, today) {
  onlyFields(body, ["day", "time"]);
  if (!isDay(body.day)) throw new ValidationError("Pick the trial's day.");
  if (body.day < today || body.day > addDays(today, SCHEDULE_AHEAD_DAYS)) throw new ValidationError(`Pick a day from today to ${SCHEDULE_AHEAD_DAYS} days ahead.`);
  if (typeof body.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) throw new ValidationError("Pick the trial's time.");
  return { day: body.day, time: body.time };
}

/** POST /api/gym/enquiries/:id/trial/outcome { outcome: done | no_show } */
function outcomeBody(body) {
  onlyFields(body, ["outcome"]);
  if (!["done", "no_show"].includes(body.outcome)) throw new ValidationError("Mark the trial as done or no-show.");
  return { outcome: body.outcome };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "2026-11-15" → "Sat 15 Nov" */
function dayText(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** "18:30" → "6:30 PM" */
function clockText(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The enquiry's plan line the gym reads: "Free trial · Sat 15 Nov, evening" */
const requestLabel = (details) => `Free trial · ${dayText(details.day)}, ${TIME_LABEL[details.time].toLowerCase()}`;
/** Once booked: "Free trial · Sat 15 Nov, 6:30 PM" */
const scheduledLabel = (day, time) => `Free trial · ${dayText(day)}, ${clockText(time)}`;

/** The stored details (JSON) → what the gym's card shows, or null for anything unreadable */
function readDetails(stored) {
  let d = stored;
  try {
    if (typeof stored === "string") d = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || !isDay(d.day) || !TIMES.includes(d.time)) return null;
  return {
    age: Number.isInteger(d.age) ? d.age : null,
    gender: GENDERS.includes(d.gender) ? d.gender : null,
    goal: GOALS.includes(d.goal) ? d.goal : null,
    experience: EXPERIENCE.includes(d.experience) ? d.experience : null,
    day: d.day,
    time: d.time,
  };
}

/** A trial as the member and the gym read it: { status, preferred, at } (null when it isn't one) */
function trialOf({ trial_status: status, trial_details: details, trial_day: day, trial_time: time }) {
  if (!STATUSES.includes(status)) return null;
  const read = readDetails(details);
  return {
    status,
    details: read,
    preferred: read ? `${dayText(read.day)}, ${TIME_LABEL[read.time].toLowerCase()}` : null,
    at: day && time ? { day, time, text: `${dayText(day)}, ${clockText(time)}` } : null,
  };
}

const isOpenTrial = (status) => status === "requested" || status === "scheduled";

module.exports = {
  GENDERS, GOALS, GOAL_LABEL, EXPERIENCE, EXPERIENCE_LABEL, TIMES, TIME_LABEL, STATUSES, AHEAD_DAYS, NOTE_MAX,
  trialBody, scheduleBody, outcomeBody, dayText, clockText, requestLabel, scheduledLabel, readDetails, trialOf, isOpenTrial, addDays,
};
