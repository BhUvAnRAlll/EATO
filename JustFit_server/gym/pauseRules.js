// Pause Membership's rules (pure, unit-tested): what a member or a staff login may send, whether
// a membership can be paused right now, and what an approved pause does to the plan's end date.
// A pause is whole days, from `from` to `until` inclusive; approving one adds its days to
// gym_members.expires_on, so the member keeps every paid day. Only one open pause (pending, or
// approved and not yet over) per member at a time.
const { ValidationError } = require("../profile");
const rules = require("./rules");

const MIN_PAUSE_DAYS = 1;
const MAX_PAUSE_DAYS = 90;
// How far ahead a pause may start; how far back a staff login may date one (a member who was away)
const MAX_START_AHEAD_DAYS = 60;
const MAX_STAFF_BACKDATE_DAYS = 30;
const REASON_MAX = 200;
const NOTE_MAX = 200;
const STATUSES = ["pending", "approved", "rejected", "cancelled"];
const LIST_VIEWS = ["pending", "all"];

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isoDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const daysBetween = (from, until) => Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

// POST /api/membership/:id/pause and POST /api/gym/members/:id/pause: { from, until, reason }.
// A member's pause starts today or later; a staff login may date it up to 30 days back.
function pauseBody(body, today = rules.todayInIndia(), { staff = false } = {}) {
  if (!isPlainObject(body)) throw new ValidationError("Send the details as JSON.");
  const extra = Object.keys(body).filter((key) => !["from", "until", "reason"].includes(key));
  if (extra.length > 0) throw new ValidationError("That request has fields we don't use.");
  const earliest = staff ? rules.addDays(today, -MAX_STAFF_BACKDATE_DAYS) : today;
  const latest = rules.addDays(today, MAX_START_AHEAD_DAYS);
  if (!isoDay(body.from) || body.from < earliest || body.from > latest) {
    throw new ValidationError(staff ? `Pick a start date from ${MAX_STAFF_BACKDATE_DAYS} days ago to ${MAX_START_AHEAD_DAYS} days ahead.` : `Pick a start date from today to ${MAX_START_AHEAD_DAYS} days ahead.`);
  }
  if (!isoDay(body.until) || body.until < body.from) throw new ValidationError("Pick an end date on or after the start date.");
  const days = daysBetween(body.from, body.until);
  if (days < MIN_PAUSE_DAYS || days > MAX_PAUSE_DAYS) throw new ValidationError(`A pause is ${MIN_PAUSE_DAYS} to ${MAX_PAUSE_DAYS} days.`);
  const reason = rules.requiredText(body.reason, "reason for the pause", REASON_MAX, 3);
  return { from: body.from, until: body.until, days, reason };
}

// POST /api/gym/pauses/:id/approve|reject: { note? }
function decisionBody(body) {
  if (body === undefined || body === null) return { note: null };
  if (!isPlainObject(body)) throw new ValidationError("Send the details as JSON.");
  const extra = Object.keys(body).filter((key) => key !== "note");
  if (extra.length > 0) throw new ValidationError("That request has fields we don't use.");
  if (body.note === undefined || body.note === null || body.note === "") return { note: null };
  if (typeof body.note !== "string" || body.note.length > NOTE_MAX * 2) throw new ValidationError(`Keep the note to ${NOTE_MAX} characters.`);
  const note = rules.cleanText(body.note, NOTE_MAX + 1);
  if (note.length > NOTE_MAX) throw new ValidationError(`Keep the note to ${NOTE_MAX} characters.`);
  return { note: note || null };
}

// GET /api/gym/pauses?view=pending|all
function listQuery(query = {}) {
  const view = query.view === undefined || query.view === "" ? "pending" : query.view;
  if (!LIST_VIEWS.includes(view)) throw new ValidationError("Pick pending or all.");
  return { view };
}

// A pause id from the path
function pauseId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) throw new ValidationError("That pause request doesn't exist.");
  return Number(value);
}

// Whether a pause row is still open: waiting for a decision, or approved and not yet over
const isOpen = (pause, today) => Boolean(pause) && (pause.status === "pending" || (pause.status === "approved" && pause.until >= today));
// Approved and running today
const pausedOn = (pause, today) => Boolean(pause) && pause.status === "approved" && pause.from <= today && pause.until >= today;

// Why a new pause can't be made for this member now, or null when it can.
// member: { expiresOn }; open: the member's open pause (isOpen) or null; from: the wanted start
function pauseProblem(member, open, from, today = rules.todayInIndia()) {
  if (member.expiresOn < today) return "This membership has ended. Renew it before pausing it.";
  if (open?.status === "pending") return "A pause request is already waiting for the gym's answer.";
  if (open) return `The membership is already paused until ${open.until}.`;
  if (from > member.expiresOn) return "The pause would start after the plan ends. Pick an earlier date.";
  return null;
}

// Why this request can't be decided, or null
function decisionProblem(pause) {
  if (pause.status !== "pending") return pause.status === "approved" ? "This request was already approved." : pause.status === "rejected" ? "This request was already rejected." : "The member cancelled this request.";
  return null;
}

// The plan's end once a pause of `days` is approved
const extendedUntil = (expiresOn, days) => rules.addDays(expiresOn, days);

module.exports = { MIN_PAUSE_DAYS, MAX_PAUSE_DAYS, MAX_START_AHEAD_DAYS, MAX_STAFF_BACKDATE_DAYS, REASON_MAX, NOTE_MAX, STATUSES, LIST_VIEWS, pauseBody, decisionBody, listQuery, pauseId, isOpen, pausedOn, pauseProblem, decisionProblem, extendedUntil, daysBetween };
