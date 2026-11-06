// Gym predictions, the pure part (unit-tested, no database): the renewal-risk score and its
// reasons, worked out from facts the portal already keeps (the plan's end, the member's visits,
// what they owe, their PT). No AI and no guessing: a member's score is the sum of the points
// below, and every point comes with its reason so staff can see why. Thresholds are constants
// here so they can be tuned in one place.
const { ValidationError } = require("../profile");
const { limits, addDays, addMonths } = require("./rules");

const RENEWAL = {
  points: { endingSoon: 30, noRecentVisit: 30, attendanceDrop: 20, paymentDue: 20, activePt: -15 },
  endingWithinDays: 7, // "plan ends soon": today up to this many days ahead
  noVisitDays: 10, // "no recent visit": the last visit (or the joining day, if never) is this old or older
  windowDays: 30, // visits are compared over the last 30 days against the 30 days before
  dropMinPriorVisits: 4, // a drop only counts when the earlier month had at least this many visits
  dropShare: 0.5, // ...and the last month has half of them or fewer
  lapsedGraceDays: 7, // members whose plan ended within this many days are still scored (they can be won back)
  levels: { high: 60, medium: 35 }, // the score at which a member is High / Medium; below Medium is Low
};
const LEVELS = ["all", "high", "medium"];

const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const rupees = (amount) => `₹${Number(amount).toLocaleString("en-IN")}`;

const level = (score) => (score >= RENEWAL.levels.high ? "high" : score >= RENEWAL.levels.medium ? "medium" : "low");

// One member's renewal risk. Dates are YYYY-MM-DD; lastVisit is null when they have never
// checked in; visitsLast and visitsPrior count distinct days in the two 30-day windows.
function renewalRisk({ today, expiresOn, joinedOn, lastVisit, visitsLast, visitsPrior, dueAmount, ptUntil }) {
  const reasons = [];
  const add = (points, text) => reasons.push({ points, text });

  const daysLeft = daysBetween(today, expiresOn);
  if (daysLeft >= 0 && daysLeft <= RENEWAL.endingWithinDays) add(RENEWAL.points.endingSoon, daysLeft === 0 ? "Plan ends today" : `Plan ends in ${plural(daysLeft, "day")}`);
  else if (daysLeft < 0) add(RENEWAL.points.endingSoon, `Plan ended ${plural(-daysLeft, "day")} ago`);

  const sinceVisit = daysBetween(lastVisit ?? joinedOn, today);
  if (sinceVisit >= RENEWAL.noVisitDays) add(RENEWAL.points.noRecentVisit, lastVisit ? `No visit in ${plural(sinceVisit, "day")}` : `No visit since joining ${plural(sinceVisit, "day")} ago`);

  const last = Number(visitsLast) || 0;
  const prior = Number(visitsPrior) || 0;
  if (prior >= RENEWAL.dropMinPriorVisits && last <= prior * RENEWAL.dropShare) add(RENEWAL.points.attendanceDrop, `Visits down from ${prior} to ${last} a month`);

  if (Number(dueAmount) > 0) add(RENEWAL.points.paymentDue, `${rupees(dueAmount)} due`);

  if (ptUntil && ptUntil >= today) add(RENEWAL.points.activePt, "On personal training");

  const score = Math.max(0, reasons.reduce((sum, reason) => sum + reason.points, 0));
  return { score, level: level(score), reasons };
}

// The 30-day windows the visit counts come from: [last 30 days including today], [the 30 before]
function renewalWindows(today) {
  return {
    scoredFrom: addDays(today, -RENEWAL.lapsedGraceDays),
    lastFrom: addDays(today, -(RENEWAL.windowDays - 1)),
    priorFrom: addDays(today, -(2 * RENEWAL.windowDays - 1)),
    priorTo: addDays(today, -RENEWAL.windowDays),
  };
}

// Which levels a list asks for: all (Medium and High), high or medium
const showsLevel = (wanted, actual) => (wanted === "all" ? actual !== "low" : actual === wanted);

// GET /api/gym/predictions/renewals?level=&search=
function renewalsQuery(query = {}) {
  const wanted = query.level === undefined || query.level === "" ? "all" : query.level;
  if (!LEVELS.includes(wanted)) throw new ValidationError("Pick a level: all, high or medium.");
  const search = typeof query.search === "string" ? query.search.trim() : "";
  if (search.length > limits.search) throw new ValidationError(`Search for at most ${limits.search} characters.`);
  return { level: wanted, search };
}

// ---- Busy hours ------------------------------------------------------------------------------
// Tomorrow's expected check-ins per hour: the average, hour by hour, of the same weekday over the
// last four weeks. A member counts once per hour per day (two scans in one hour are one visit).
// Only weeks the branch was already recording attendance count; fewer than two means no forecast.
const BUSY = {
  weeks: 4,
  minWeeks: 2,
  firstHour: 5, // the hours always shown, 5 am to 10 pm; earlier or later hours join when they have visits
  lastHour: 22,
};
const IST_OFFSET_MS = 330 * 60 * 1000;
const hourInIndia = (ms) => new Date(Number(ms) + IST_OFFSET_MS).getUTCHours();

// Tomorrow, and the four earlier days with the same weekday (last week first)
function busyDates(today) {
  const forDate = addDays(today, 1);
  return { forDate, dates: Array.from({ length: BUSY.weeks }, (_, i) => addDays(forDate, -7 * (i + 1))) };
}

// rows: every check-in on those dates ({ day, memberId, inMs }); firstRecordedDay: the branch's
// earliest attendance date, or null when it has none
function busyHours({ today, rows, firstRecordedDay }) {
  const { forDate, dates } = busyDates(today);
  const weeksUsed = firstRecordedDay ? dates.filter((d) => d >= firstRecordedDay) : [];
  const base = { forDate, dates, weeksUsed: weeksUsed.length, enough: weeksUsed.length >= BUSY.minWeeks };
  if (!base.enough) return { ...base, hours: [], total: 0, busiest: null, quietest: null, lastWeek: null };

  // counts[day][hour] = distinct members who checked in that hour
  const counts = new Map(weeksUsed.map((d) => [d, new Array(24).fill(0)]));
  const seen = new Set();
  for (const row of rows) {
    const perHour = counts.get(row.day);
    if (!perHour) continue;
    const hour = hourInIndia(row.inMs);
    const key = `${row.day}|${row.memberId}|${hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    perHour[hour] += 1;
  }
  const all = Array.from({ length: 24 }, (_, hour) => {
    const samples = weeksUsed.map((d) => counts.get(d)[hour]);
    return { hour, samples, expected: Math.round(samples.reduce((a, b) => a + b, 0) / weeksUsed.length) };
  });
  const withVisits = all.filter((h) => h.samples.some((n) => n > 0)).map((h) => h.hour);
  const from = Math.min(BUSY.firstHour, ...withVisits);
  const to = Math.max(BUSY.lastHour, ...withVisits);
  const hours = all.slice(from, to + 1);
  const total = hours.reduce((sum, h) => sum + h.expected, 0);
  const pick = (better) => (total === 0 ? null : hours.reduce((best, h) => (better(h, best) ? h : best)));
  const busiest = pick((h, best) => h.expected > best.expected);
  const quietest = pick((h, best) => h.expected < best.expected);
  const lastWeek = counts.has(dates[0]) ? { date: dates[0], total: counts.get(dates[0]).reduce((a, b) => a + b, 0) } : null;
  return { ...base, hours, total, busiest: busiest && { hour: busiest.hour, expected: busiest.expected }, quietest: quietest && { hour: quietest.hour, expected: quietest.expected }, lastWeek };
}

// ---- Month-end revenue ----------------------------------------------------------------------
// Expected by month end = collected so far + plans ending this month × the branch's own renewal
// rate × each member's last plan payment + eligible dues × the branch's due-collection rate.
// Rates come from the last 90 days; where that history is too thin the part is null ("needs
// history") and the total is marked incomplete rather than guessed.
const REVENUE = {
  historyDays: 90,
  minRenewalSample: 5, // plan endings (renewed + lapsed) needed before a renewal rate is used
};

// This month's first and last day and the days left after today
function monthRange(today) {
  const from = `${today.slice(0, 8)}01`;
  const to = addDays(addMonths(from, 1), -1);
  return { from, to, daysLeft: daysBetween(today, to) };
}

const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) / 100 : null);

// collected: rupees taken this month so far; expiring: the members whose plan ends this month,
// each with the amount of their last plan payment (null when they never paid for a plan);
// renewed / lapsed: members who renewed in the last 90 days / whose plan ended in that time and
// still hasn't been renewed; duesOutstanding: dues due by month end (or overdue, or undated);
// duePaid / dueOverdue: due payments taken in the last 90 days / dues now past their date
function revenueForecast({ today, collected, expiring, renewed, lapsed, duesOutstanding, duePaid, dueOverdue, lastMonthTotal }) {
  const month = monthRange(today);
  const priced = expiring.filter((m) => m.price !== null && m.price !== undefined);
  const renewalRate = renewed + lapsed >= REVENUE.minRenewalSample ? share(renewed, renewed + lapsed) : null;
  const renewals = {
    expiring: expiring.length,
    priced: priced.length,
    sample: { renewed, lapsed },
    rate: renewalRate,
    amount: renewalRate === null ? null : Math.round(priced.reduce((sum, m) => sum + Number(m.price), 0) * renewalRate),
  };
  const dueRate = share(duePaid, duePaid + dueOverdue);
  const dues = {
    outstanding: duesOutstanding,
    sample: { paid: duePaid, overdue: dueOverdue },
    rate: dueRate,
    amount: duesOutstanding === 0 ? 0 : dueRate === null ? null : Math.round(duesOutstanding * dueRate),
  };
  const complete = renewals.amount !== null && dues.amount !== null;
  return { month, collected, renewals, dues, expected: collected + (renewals.amount ?? 0) + (dues.amount ?? 0), complete, lastMonth: lastMonthTotal };
}

// ---- Enquiry conversion ----------------------------------------------------------------------
// How likely an open enquiry is to join, from what was recorded about them and every contact
// attempt (gym_enquiry_contacts). Hot enquiries are called first.
const ENQUIRY = {
  points: { referralOrTrial: 30, walkedIn: 20, quickCallback: 20, noAnswerTwice: -30, stale: -20 },
  callbackDays: 2, // a first call or message within this many days of the enquiry
  noAnswerCount: 2, // this many "no answer" contacts count against
  staleDays: 14, // older than this counts against
  levels: { hot: 60, warm: 30 }, // Hot at 60+, Warm at 30-59, Cold below
};
const OPEN_STATUSES = ["new", "follow_up"];
const enquiryLevel = (score) => (score >= ENQUIRY.levels.hot ? "hot" : score >= ENQUIRY.levels.warm ? "warm" : "cold");

// contacts: [{ kind, outcome, contactedOn }] oldest first. Closed enquiries (joined, lost) are null.
function enquiryScore({ today, status, enquiredOn, source, interest, contacts = [] }) {
  if (!OPEN_STATUSES.includes(status)) return null;
  const reasons = [];
  const add = (points, text) => reasons.push({ points, text });

  const referral = source === "referral";
  const trial = interest === "trial";
  if (referral || trial) add(ENQUIRY.points.referralOrTrial, referral && trial ? "Referral · wants a trial" : referral ? "Referral" : "Wants a trial");

  const visited = contacts.some((c) => c.outcome === "visited");
  if (source === "walk_in" || visited) add(ENQUIRY.points.walkedIn, source === "walk_in" ? "Walked in" : "Visited the gym");

  const first = contacts.find((c) => c.kind === "call" || c.kind === "whatsapp");
  if (first && daysBetween(enquiredOn, first.contactedOn) <= ENQUIRY.callbackDays) add(ENQUIRY.points.quickCallback, first.kind === "call" ? "Called back within 2 days" : "Messaged within 2 days");

  const noAnswer = contacts.filter((c) => c.outcome === "no_answer").length;
  if (noAnswer >= ENQUIRY.noAnswerCount) add(ENQUIRY.points.noAnswerTwice, `No answer ${noAnswer === 2 ? "twice" : `${noAnswer} times`}`);

  const age = daysBetween(enquiredOn, today);
  if (age > ENQUIRY.staleDays) add(ENQUIRY.points.stale, `Asked ${plural(age, "day")} ago`);

  const score = Math.max(0, reasons.reduce((sum, r) => sum + r.points, 0));
  return { score, level: enquiryLevel(score), reasons };
}

module.exports = { RENEWAL, LEVELS, renewalRisk, renewalWindows, showsLevel, renewalsQuery, daysBetween, BUSY, busyDates, busyHours, hourInIndia, REVENUE, monthRange, revenueForecast, ENQUIRY, enquiryScore };
