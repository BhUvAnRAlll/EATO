// Live gym crowd and best time to visit (Gym Hub ecosystem, the user's brief of 2026-11-09): pure
// rules, unit-tested. Two different things, never mixed up:
//   live: people inside right now, estimated from today's open visits (QR or staff check-ins not yet
//         checked out). A visit open longer than a stay can last is treated as someone who left
//         without checking out, so a forgotten check-out never keeps the gym "full".
//   forecast: how many people are usually inside each hour, from the last four weeks of visits
//         (each visit counted from check-in to check-out, or for the usual stay when it never
//         checked out), averaged per weekday. Only weekdays with two or more recorded days count.
// Nothing here is made up: with no capacity there is no crowd level; with too little history there
// is no forecast.
const { ValidationError } = require("../profile");
const { onlyKeys } = require("./rules");

const IST_OFFSET_MS = 330 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const CROWD = {
  defaultStayMin: 75, // a typical workout when the gym hasn't said and there's no history
  minStayMin: 20,
  maxStayMin: 240,
  staleFactor: 2, // an open visit older than twice the usual stay…
  minStaleMin: 120, // …and at least two hours is treated as gone
  historyDays: 28,
  minDaysPerWeekday: 2,
  firstHour: 5,
  lastHour: 22,
  defaultThresholds: { moderate: 40, busy: 70, veryBusy: 90 }, // % of capacity where each level starts
};
const LEVELS = ["low", "moderate", "busy", "very_busy"];
const LEVEL_LABEL = { low: "Low", moderate: "Moderate", busy: "Busy", very_busy: "Very busy" };
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const hourInIndia = (ms) => new Date(Number(ms) + IST_OFFSET_MS).getUTCHours();
// The weekday (0 = Sunday) of a YYYY-MM-DD date
const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
// Epoch ms of hh:mm on a YYYY-MM-DD India date
const indiaMs = (day, hour, minute = 0) => Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS + hour * HOUR_MS + minute * 60000;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ─── Settings ─────────────────────────────────────────────────────────────────────────────────

/** The gym's crowd settings as stored (null columns mean "not set") */
function settingsOf(row) {
  let thresholds = CROWD.defaultThresholds;
  try {
    const t = typeof row?.crowd_thresholds === "string" ? JSON.parse(row.crowd_thresholds) : row?.crowd_thresholds;
    if (t && [t.moderate, t.busy, t.veryBusy].every(Number.isInteger) && t.moderate < t.busy && t.busy < t.veryBusy) thresholds = { moderate: t.moderate, busy: t.busy, veryBusy: t.veryBusy };
  } catch {
    // a broken value reads as the defaults
  }
  return {
    capacity: row?.capacity ?? null,
    avgStayMin: row?.avg_stay_min ?? null,
    thresholds,
    customThresholds: thresholds !== CROWD.defaultThresholds,
  };
}

/** PUT /api/gym/attendance/crowd-settings { capacity, avgStayMin, thresholds } */
function settingsBody(body) {
  onlyKeys(body, ["capacity", "avgStayMin", "thresholds"]);
  const out = {};
  if (body.capacity !== undefined) {
    if (body.capacity !== null && (!Number.isInteger(body.capacity) || body.capacity < 5 || body.capacity > 2000)) throw new ValidationError("Enter how many people the gym can hold at once, 5 to 2,000.");
    out.capacity = body.capacity;
  }
  if (body.avgStayMin !== undefined) {
    if (body.avgStayMin !== null && (!Number.isInteger(body.avgStayMin) || body.avgStayMin < 15 || body.avgStayMin > 300)) throw new ValidationError("Enter the usual workout length in minutes, 15 to 300.");
    out.avgStayMin = body.avgStayMin;
  }
  if (body.thresholds !== undefined) {
    if (body.thresholds === null) out.thresholds = null;
    else {
      const t = body.thresholds;
      if (!t || typeof t !== "object" || Array.isArray(t)) throw new ValidationError("Send the crowd levels as percentages.");
      for (const key of Object.keys(t)) if (!["moderate", "busy", "veryBusy"].includes(key)) throw new ValidationError("Send the crowd levels as percentages.");
      if (![t.moderate, t.busy, t.veryBusy].every((n) => Number.isInteger(n) && n >= 5 && n <= 100)) throw new ValidationError("Each crowd level is a whole percentage, 5 to 100.");
      if (!(t.moderate < t.busy && t.busy < t.veryBusy)) throw new ValidationError("Moderate, Busy and Very busy must start at rising percentages.");
      out.thresholds = { moderate: t.moderate, busy: t.busy, veryBusy: t.veryBusy };
    }
  }
  if (Object.keys(out).length === 0) throw new ValidationError("Change the capacity, the workout length or the crowd levels.");
  return out;
}

// ─── Live ─────────────────────────────────────────────────────────────────────────────────────

/** The usual stay: the gym's own figure, else the average completed visit, else 75 minutes */
function usualStay(avgStayMin, completedDurations) {
  if (avgStayMin) return { minutes: avgStayMin, source: "gym" };
  const usable = completedDurations.filter((d) => Number.isFinite(d) && d >= 5 && d <= 600);
  if (usable.length >= 10) {
    const mean = usable.reduce((a, b) => a + b, 0) / usable.length;
    return { minutes: Math.min(CROWD.maxStayMin, Math.max(CROWD.minStayMin, Math.round(mean))), source: "history" };
  }
  return { minutes: CROWD.defaultStayMin, source: "default" };
}

/** The level for a share of capacity (a percentage) */
function levelFor(percent, thresholds) {
  if (percent >= thresholds.veryBusy) return "very_busy";
  if (percent >= thresholds.busy) return "busy";
  if (percent >= thresholds.moderate) return "moderate";
  return "low";
}

/**
 * now: epoch ms; openVisits: today's open visits [{ inMs }]; settings: settingsOf; stay: usualStay;
 * hasAnyAttendance: whether the branch has ever recorded a visit
 */
function live({ now, openVisits, settings, stay, hasAnyAttendance }) {
  const staleMs = Math.max(stay.minutes * CROWD.staleFactor, CROWD.minStaleMin) * 60000;
  const counted = openVisits.filter((v) => now - v.inMs <= staleMs);
  const inside = counted.length;
  const lastCheckInMs = openVisits.length ? Math.max(...openVisits.map((v) => v.inMs)) : null;
  const base = {
    kind: "live",
    inside,
    leftWithoutCheckout: openVisits.length - inside,
    capacity: settings.capacity,
    updatedAt: new Date(now).toISOString(),
    lastCheckInAt: lastCheckInMs ? new Date(lastCheckInMs).toISOString() : null,
  };
  if (!hasAnyAttendance) return { ...base, available: false, reason: "no_attendance", percent: null, level: null };
  if (!settings.capacity) return { ...base, available: false, reason: "no_capacity", percent: null, level: null };
  const percent = Math.min(100, Math.round((inside / settings.capacity) * 100));
  return { ...base, available: true, reason: null, percent, level: levelFor(percent, settings.thresholds) };
}

// ─── Forecast ─────────────────────────────────────────────────────────────────────────────────

/**
 * People inside at the middle of each hour, averaged per weekday over the recorded days.
 * visits: [{ day, inMs, outMs | null }] from the last historyDays (today left out); stay: minutes
 * a visit without a check-out is taken to last; firstRecordedDay: the branch's first visit.
 * → grid[weekday][hour] (one decimal) and which weekdays have enough days
 */
function weekGrid({ today, visits, stayMin, firstRecordedDay }) {
  const days = [];
  for (let i = 1; i <= CROWD.historyDays; i += 1) {
    const day = addDays(today, -i);
    if (firstRecordedDay && day >= firstRecordedDay) days.push(day);
  }
  const daysPerWeekday = new Array(7).fill(0);
  for (const day of days) daysPerWeekday[weekdayOf(day)] += 1;
  const byDay = new Map(days.map((d) => [d, []]));
  for (const v of visits) byDay.get(v.day)?.push(v);

  const sums = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const day of days) {
    const wd = weekdayOf(day);
    const list = byDay.get(day);
    for (let hour = 0; hour < 24; hour += 1) {
      const t = indiaMs(day, hour, 30);
      let n = 0;
      for (const v of list) {
        const end = v.outMs ?? v.inMs + stayMin * 60000;
        if (v.inMs <= t && t < end) n += 1;
      }
      sums[wd][hour] += n;
    }
  }
  const grid = sums.map((row, wd) => row.map((total) => (daysPerWeekday[wd] ? Math.round((total / daysPerWeekday[wd]) * 10) / 10 : 0)));
  const enough = daysPerWeekday.map((n) => n >= CROWD.minDaysPerWeekday);
  return { grid, enough, daysPerWeekday, daysUsed: days.length };
}

// The hours a day is shown for: the gym's opening hours when it has them, else 5 am to 10 pm plus
// any hour people were there
function hoursFor(weekday, row, hours) {
  const sessions = hours?.[WEEKDAYS[weekday]];
  if (Array.isArray(sessions)) {
    const open = new Set();
    for (const [from, to] of sessions) {
      const start = Number(from.slice(0, 2));
      const endH = Number(to.slice(0, 2)) + (Number(to.slice(3, 5)) > 0 ? 1 : 0);
      for (let h = start; h < endH && h < 24; h += 1) open.add(h);
    }
    return [...open].sort((a, b) => a - b);
  }
  const busy = row.map((v, h) => (v > 0 ? h : null)).filter((h) => h !== null);
  const from = Math.min(CROWD.firstHour, ...busy);
  const to = Math.max(CROWD.lastHour, ...busy);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// A forecast cell's level: against capacity when the gym gave one, else against the week's peak
function forecastLevel(expected, settings, weekPeak) {
  if (settings.capacity) return levelFor(Math.round((expected / settings.capacity) * 100), settings.thresholds);
  if (weekPeak <= 0) return "low";
  const share = (expected / weekPeak) * 100;
  return share >= 75 ? "very_busy" : share >= 50 ? "busy" : share >= 25 ? "moderate" : "low";
}

/** One day's hourly forecast with its busiest and quietest open hour; null without enough days */
function dayForecast(day, gridInfo, settings, hours, weekPeak) {
  const wd = weekdayOf(day);
  if (!gridInfo.enough[wd]) return { date: day, weekday: WEEKDAYS[wd], enough: false, hours: [], busiest: null, quietest: null };
  const row = gridInfo.grid[wd];
  const shown = hoursFor(wd, row, hours);
  const list = shown.map((hour) => ({ hour, expected: row[hour], people: Math.round(row[hour]), level: forecastLevel(row[hour], settings, weekPeak) }));
  const pick = (better) => (list.length ? list.reduce((best, h) => (better(h, best) ? h : best)) : null);
  const busiest = pick((h, best) => h.expected > best.expected);
  const quietest = pick((h, best) => h.expected < best.expected);
  return { date: day, weekday: WEEKDAYS[wd], enough: true, closed: list.length === 0, hours: list, busiest, quietest };
}

/**
 * The forecast for today, tomorrow and the week. now: epoch ms (today's hours already past are
 * left out of "best time today"); hours: the gym's opening hours or null.
 */
function forecast({ now, today, visits, stayMin, firstRecordedDay, settings, hours }) {
  const gridInfo = weekGrid({ today, visits, stayMin, firstRecordedDay });
  const weekPeak = Math.max(0, ...gridInfo.grid.flat());
  const enough = gridInfo.enough.some(Boolean);
  const base = { kind: "forecast", basedOnDays: gridInfo.daysUsed, relativeLevels: !settings.capacity, enough };
  if (!enough) return { ...base, today: null, tomorrow: null, week: [] };
  const todayF = dayForecast(today, gridInfo, settings, hours, weekPeak);
  const nowHour = hourInIndia(now);
  const ahead = todayF.hours.filter((h) => h.hour >= nowHour);
  const bestLeft = ahead.length ? ahead.reduce((best, h) => (h.expected < best.expected ? h : best)) : null;
  // Monday first, as Indian calendars and the gym's hours editor show the week
  const order = [1, 2, 3, 4, 5, 6, 0];
  const week = order.map((wd) => ({
    weekday: WEEKDAYS[wd],
    enough: gridInfo.enough[wd],
    hours: gridInfo.enough[wd] ? hoursFor(wd, gridInfo.grid[wd], hours).map((hour) => ({ hour, expected: gridInfo.grid[wd][hour], level: forecastLevel(gridInfo.grid[wd][hour], settings, weekPeak) })) : [],
  }));
  return { ...base, today: { ...todayF, bestLeft }, tomorrow: dayForecast(addDays(today, 1), gridInfo, settings, hours, weekPeak), week };
}

module.exports = { CROWD, LEVELS, LEVEL_LABEL, WEEKDAYS, settingsOf, settingsBody, usualStay, levelFor, live, weekGrid, forecast, hourInIndia, indiaMs, weekdayOf };
