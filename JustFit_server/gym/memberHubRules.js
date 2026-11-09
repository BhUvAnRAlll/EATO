// Gym Hub's membership page (pure, unit-tested): the month asked for and its calendar. A member
// sees their own visits a month at a time, from 24 months back to the current month (India's).
const { ValidationError } = require("../profile");

const MONTHS_BACK = 24;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const monthOf = (day) => day.slice(0, 7);
const monthIndex = (month) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const fromIndex = (index) => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

// ?month=YYYY-MM (default: this month); only these query fields
function hubQuery(query = {}, today) {
  if (Object.keys(query).some((key) => key !== "month")) throw new ValidationError("That request has fields we don't use.");
  const current = monthOf(today);
  if (query.month === undefined) return { month: current };
  if (typeof query.month !== "string" || !MONTH.test(query.month)) throw new ValidationError("Pick a month like 2026-11.");
  const gap = monthIndex(current) - monthIndex(query.month);
  if (gap < 0) throw new ValidationError("That month hasn't started yet.");
  if (gap > MONTHS_BACK) throw new ValidationError(`Pick a month in the last ${MONTHS_BACK} months.`);
  return { month: query.month };
}

// The month's first and last day, and the months either side (null past the range)
function monthBounds(month, today) {
  const index = monthIndex(month);
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const current = monthIndex(monthOf(today));
  return {
    from: `${month}-01`,
    to: `${month}-${String(days).padStart(2, "0")}`,
    days,
    previous: current - (index - 1) <= MONTHS_BACK ? fromIndex(index - 1) : null,
    next: index + 1 <= current ? fromIndex(index + 1) : null,
  };
}

// One entry per day of the month that had a visit: how many check-ins and the minutes spent
function calendarDays(visits) {
  const byDay = new Map();
  for (const v of visits) {
    const day = byDay.get(v.date) ?? { date: v.date, visits: 0, minutes: 0 };
    day.visits += 1;
    day.minutes += v.durationMin ?? 0;
    byDay.set(v.date, day);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { MONTHS_BACK, hubQuery, monthBounds, calendarDays };
