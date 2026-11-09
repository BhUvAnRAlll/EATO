// Attendance corrections (Gym Hub ecosystem, the user's brief of 2026-11-09): pure rules, unit-tested.
// Staff fix a visit's times or add a visit a member forgot to scan, always with a reason. Times are
// India's clock on the visit's own day; a visit can't be in the future, end before it starts, last
// more than 12 hours or be older than 30 days.
const { ValidationError } = require("../profile");
const { onlyKeys, cleanText, addDays } = require("./rules");

const IST_OFFSET_MS = 330 * 60 * 1000;
const MAX_DAYS_BACK = 30;
const MAX_MINUTES = 12 * 60;
const REASON_MAX = 200;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isoDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Epoch ms of HH:MM on a YYYY-MM-DD India date */
const indiaMs = (day, time) => Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))) * 60000;
/** HH:MM in India of an epoch ms */
const indiaTime = (ms) => new Date(Number(ms) + IST_OFFSET_MS).toISOString().slice(11, 16);

function reason(value) {
  if (typeof value !== "string" || value.length > REASON_MAX * 2) throw new ValidationError("Write why the visit is being corrected.");
  const text = cleanText(value, REASON_MAX + 1);
  if (text.length < 5) throw new ValidationError("Write why the visit is being corrected.");
  if (text.length > REASON_MAX) throw new ValidationError(`Keep the reason to ${REASON_MAX} characters.`);
  return text;
}

function time(value, label, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !TIME.test(value)) throw new ValidationError(`Enter the ${label} as HH:MM.`);
  return value;
}

/** The visit's times as epoch ms, checked: in before out, not in the future, at most 12 hours */
function span(day, inTime, outTime, nowMs) {
  const inMs = indiaMs(day, inTime);
  const outMs = outTime === null ? null : indiaMs(day, outTime);
  if (inMs > nowMs) throw new ValidationError("The check-in can't be in the future.");
  if (outMs !== null) {
    if (outMs <= inMs) throw new ValidationError("The check-out must be after the check-in, on the same day.");
    if (outMs > nowMs) throw new ValidationError("The check-out can't be in the future.");
    if ((outMs - inMs) / 60000 > MAX_MINUTES) throw new ValidationError("A visit can't be longer than 12 hours.");
  }
  return { inMs, outMs, durationMin: outMs === null ? null : Math.round((outMs - inMs) / 60000) };
}

/** POST /api/gym/attendance/visits { memberId, date, inTime, outTime, reason }: a missed visit */
function addBody(body, today, nowMs) {
  onlyKeys(body, ["memberId", "date", "inTime", "outTime", "reason"]);
  if (!Number.isInteger(body.memberId) || body.memberId < 1) throw new ValidationError("Pick the member.");
  if (!isoDay(body.date) || body.date > today || body.date < addDays(today, -MAX_DAYS_BACK)) throw new ValidationError(`Pick a day from ${MAX_DAYS_BACK} days ago to today.`);
  const inTime = time(body.inTime, "check-in time");
  const outTime = time(body.outTime, "check-out time");
  return { memberId: body.memberId, date: body.date, ...span(body.date, inTime, outTime, nowMs), reason: reason(body.reason) };
}

/** PATCH /api/gym/attendance/visits/:id { inTime?, outTime?, reason }: new times on the visit's day */
function editBody(body) {
  onlyKeys(body, ["inTime", "outTime", "reason"]);
  if (body.inTime === undefined && body.outTime === undefined) throw new ValidationError("Change the check-in or the check-out time.");
  return {
    inTime: body.inTime === undefined ? undefined : time(body.inTime, "check-in time"),
    outTime: body.outTime === undefined ? undefined : time(body.outTime, "check-out time", { optional: true }),
    reason: reason(body.reason),
  };
}

/** The corrected visit: the visit's day, its current times, the change → the new span */
function editedSpan(visit, change, today, nowMs) {
  if (visit.day < addDays(today, -MAX_DAYS_BACK)) throw new ValidationError(`Visits older than ${MAX_DAYS_BACK} days can't be corrected.`);
  const inTime = change.inTime ?? indiaTime(visit.inMs);
  const outTime = change.outTime === undefined ? (visit.outMs ? indiaTime(visit.outMs) : null) : change.outTime;
  if (outTime === null && visit.day < today) throw new ValidationError("A past visit needs a check-out time.");
  return span(visit.day, inTime, outTime, nowMs);
}

/** Whether two visits overlap (an open one runs to `nowMs`) */
const overlaps = (a, b, nowMs) => a.inMs < (b.outMs ?? nowMs) && b.inMs < (a.outMs ?? nowMs);

/** GET /api/gym/attendance/corrections?page= */
function listQuery(query = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new ValidationError("That page doesn't exist.");
  return { page };
}

module.exports = { MAX_DAYS_BACK, MAX_MINUTES, REASON_MAX, indiaMs, indiaTime, span, addBody, editBody, editedSpan, overlaps, listQuery };
