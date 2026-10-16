// Input checks for the workout routes. Every problem is a ValidationError (400) with one
// line the screen can show. Dates are the member's local day as YYYY-MM-DD; the server only
// checks that "today" is within a day of its own UTC date (every time zone fits).
const { ValidationError } = require("../profile");
const { isoDate, isNearToday } = require("../macro/validate");

const limits = {
  weekDates: 14, // home({ dates }): the week strip, with room for a two-week view
  historyDays: 31, // history({ from, to })
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

module.exports = { limits, homeQuery, historyQuery, ensureBody, dayNumber };
