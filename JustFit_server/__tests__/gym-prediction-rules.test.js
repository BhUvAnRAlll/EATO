// Gym predictions: the renewal-risk score, its reasons and the list's query (gym/predictionRules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { RENEWAL, renewalRisk, renewalWindows, showsLevel, renewalsQuery, daysBetween, BUSY, busyDates, busyHours, hourInIndia, REVENUE, monthRange, revenueForecast, ENQUIRY, enquiryScore } = require("../gym/predictionRules");
const { addDays } = require("../gym/rules");

const today = "2026-11-06";
const days = (n) => addDays(today, n);
// A member with nothing against them: plan runs for months, visited yesterday, steady visits, nothing due
const fine = { today, expiresOn: days(90), joinedOn: days(-120), lastVisit: days(-1), visitsLast: 12, visitsPrior: 12, dueAmount: 0, ptUntil: null };
const refuses = (fn, pattern) => assert.throws(fn, (error) => error.status === 400 && pattern.test(error.message));
const texts = (risk) => risk.reasons.map((r) => r.text);

describe("renewal risk: the score and its reasons", () => {
  it("a member with nothing against them scores 0, Low, no reasons", () => {
    assert.deepEqual(renewalRisk(fine), { score: 0, level: "low", reasons: [] });
  });

  it("Ravi: plan ends in 5 days, no visit for 12 days, ₹800 due → 80, High, with the three reasons", () => {
    const risk = renewalRisk({ ...fine, expiresOn: days(5), lastVisit: days(-12), visitsLast: 2, visitsPrior: 3, dueAmount: 800 });
    assert.equal(risk.score, 80);
    assert.equal(risk.level, "high");
    assert.deepEqual(texts(risk), ["Plan ends in 5 days", "No visit in 12 days", "₹800 due"]);
    assert.deepEqual(risk.reasons.map((r) => r.points), [30, 30, 20]);
  });

  it("each sign on its own, with its wording", () => {
    assert.deepEqual(texts(renewalRisk({ ...fine, expiresOn: today })), ["Plan ends today"]);
    assert.deepEqual(texts(renewalRisk({ ...fine, expiresOn: days(1) })), ["Plan ends in 1 day"]);
    assert.deepEqual(texts(renewalRisk({ ...fine, expiresOn: days(7) })), ["Plan ends in 7 days"]);
    assert.deepEqual(texts(renewalRisk({ ...fine, expiresOn: days(8) })), [], "8 days away isn't soon");
    assert.deepEqual(texts(renewalRisk({ ...fine, expiresOn: days(-3) })), ["Plan ended 3 days ago"]);
    assert.deepEqual(texts(renewalRisk({ ...fine, lastVisit: days(-10) })), ["No visit in 10 days"]);
    assert.deepEqual(texts(renewalRisk({ ...fine, lastVisit: days(-9) })), [], "9 days is still recent");
    assert.deepEqual(texts(renewalRisk({ ...fine, lastVisit: null, joinedOn: days(-15) })), ["No visit since joining 15 days ago"]);
    assert.deepEqual(texts(renewalRisk({ ...fine, lastVisit: null, joinedOn: days(-3) })), [], "a new member who hasn't come yet isn't flagged");
    assert.deepEqual(texts(renewalRisk({ ...fine, visitsLast: 6, visitsPrior: 12 })), ["Visits down from 12 to 6 a month"]);
    assert.deepEqual(texts(renewalRisk({ ...fine, visitsLast: 7, visitsPrior: 12 })), [], "more than half is not a drop");
    assert.deepEqual(texts(renewalRisk({ ...fine, visitsLast: 1, visitsPrior: 3 })), [], "fewer than 4 earlier visits is too little to compare");
    assert.deepEqual(texts(renewalRisk({ ...fine, dueAmount: 2500 })), ["₹2,500 due"]);
    assert.deepEqual(texts(renewalRisk({ ...fine, dueAmount: "800" })), ["₹800 due"], "a string amount from the driver still counts");
  });

  it("the score never goes below 0, and PT takes 15 off", () => {
    assert.deepEqual(renewalRisk({ ...fine, ptUntil: days(10) }), { score: 0, level: "low", reasons: [{ points: -15, text: "On personal training" }] });
    assert.equal(renewalRisk({ ...fine, ptUntil: days(-1), expiresOn: days(2) }).score, 30, "PT that has ended doesn't count");
    assert.equal(renewalRisk({ ...fine, ptUntil: today, expiresOn: days(2) }).score, 15, "PT ending today still counts");
  });

  it("the levels at their boundaries", () => {
    const at = (score) => renewalRisk({ ...fine, ...score });
    assert.equal(at({ expiresOn: days(2) }).level, "low", "30 is Low");
    assert.equal(at({ expiresOn: days(2), dueAmount: 1, ptUntil: days(5) }).score, 35);
    assert.equal(at({ expiresOn: days(2), dueAmount: 1, ptUntil: days(5) }).level, "medium", "35 is Medium");
    assert.equal(at({ expiresOn: days(2), dueAmount: 1 }).level, "medium", "50 is Medium");
    assert.equal(at({ expiresOn: days(2), lastVisit: days(-11) }).level, "high", "60 is High");
    assert.equal(at({ expiresOn: days(2), lastVisit: days(-11), ptUntil: days(5) }).score, 45);
    assert.equal(at({ expiresOn: days(2), lastVisit: days(-11), ptUntil: days(5) }).level, "medium", "45 is Medium");
    assert.equal(RENEWAL.levels.high, 60);
    assert.equal(RENEWAL.levels.medium, 35);
  });

  it("missing or odd counts are treated as none", () => {
    assert.equal(renewalRisk({ ...fine, visitsLast: null, visitsPrior: undefined }).score, 0);
    assert.equal(renewalRisk({ ...fine, visitsLast: "abc", visitsPrior: 12 }).score, 20, "an unreadable last count reads as 0 visits");
    assert.equal(renewalRisk({ ...fine, dueAmount: null }).score, 0);
  });
});

describe("renewal risk: windows, levels and the query", () => {
  it("the windows: scored from 7 days back, the last 30 days (today included) and the 30 before", () => {
    assert.deepEqual(renewalWindows(today), { scoredFrom: "2026-10-30", lastFrom: "2026-10-08", priorFrom: "2026-09-08", priorTo: "2026-10-07" });
    assert.equal(daysBetween("2026-10-08", today), 29);
    assert.equal(daysBetween("2026-09-08", "2026-10-07"), 29);
  });

  it("which levels a list shows", () => {
    assert.equal(showsLevel("all", "high"), true);
    assert.equal(showsLevel("all", "medium"), true);
    assert.equal(showsLevel("all", "low"), false, "Low never shows: the list is who needs attention");
    assert.equal(showsLevel("high", "medium"), false);
    assert.equal(showsLevel("medium", "medium"), true);
  });

  it("the query: a level from the list and a bounded search", () => {
    assert.deepEqual(renewalsQuery({}), { level: "all", search: "" });
    assert.deepEqual(renewalsQuery({ level: "high", search: "  Ravi " }), { level: "high", search: "Ravi" });
    assert.deepEqual(renewalsQuery({ level: "medium", search: "' OR 1=1 --" }), { level: "medium", search: "' OR 1=1 --" }, "a search is only ever a bound parameter");
    refuses(() => renewalsQuery({ level: "low" }), /all, high or medium/);
    refuses(() => renewalsQuery({ level: "DROP TABLE" }), /all, high or medium/);
    refuses(() => renewalsQuery({ search: "x".repeat(61) }), /at most 60/);
  });
});

describe("busy hours: tomorrow's check-ins per hour from the last four same weekdays", () => {
  // today is a Friday (2026-11-06); tomorrow Saturday 7 Nov; the last four Saturdays before it
  const { forDate, dates } = busyDates(today);
  const at = (day, hour, memberId, minute = 15) => ({ day, memberId, inMs: Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`) });

  it("the dates: tomorrow and the four earlier weeks, last week first", () => {
    assert.equal(forDate, "2026-11-07");
    assert.deepEqual(dates, ["2026-10-31", "2026-10-24", "2026-10-17", "2026-10-10"]);
    assert.equal(hourInIndia(Date.parse("2026-11-01T18:30:00+05:30")), 18, "the hour is India's, whatever zone the server runs in");
    assert.equal(hourInIndia(Date.parse("2026-11-01T00:10:00+05:30")), 0);
  });

  it("averages each hour over the weeks, rounding to a whole visit; busiest and quietest hours", () => {
    const rows = [
      // 6 pm: 3, 2, 4, 3 members → 3
      at(dates[0], 18, 1), at(dates[0], 18, 2), at(dates[0], 18, 3),
      at(dates[1], 18, 1), at(dates[1], 18, 4),
      at(dates[2], 18, 1), at(dates[2], 18, 2), at(dates[2], 18, 3), at(dates[2], 18, 4),
      at(dates[3], 18, 2), at(dates[3], 18, 3), at(dates[3], 18, 5),
      // 7 am: 1, 1, 0, 0 → 1 (half rounds up); the same member twice in the hour counts once
      at(dates[0], 7, 1, 5), at(dates[0], 7, 1, 50), at(dates[1], 7, 2),
      // a different weekday is ignored
      at("2026-11-05", 18, 1), at("2026-11-05", 18, 2),
    ];
    const r = busyHours({ today, rows, firstRecordedDay: "2026-09-01" });
    assert.deepEqual([r.enough, r.weeksUsed, r.forDate], [true, 4, "2026-11-07"]);
    const byHour = Object.fromEntries(r.hours.map((h) => [h.hour, h]));
    assert.deepEqual(byHour[18], { hour: 18, samples: [3, 2, 4, 3], expected: 3 });
    assert.deepEqual(byHour[7], { hour: 7, samples: [1, 1, 0, 0], expected: 1 });
    assert.deepEqual(byHour[12].samples, [0, 0, 0, 0]);
    assert.equal(r.total, 4);
    assert.deepEqual(r.busiest, { hour: 18, expected: 3 });
    assert.deepEqual(r.quietest, { hour: 5, expected: 0 }, "the earliest shown hour with nothing expected");
    assert.deepEqual(r.hours.map((h) => h.hour), Array.from({ length: 18 }, (_, i) => i + 5), "5 am to 10 pm by default");
    assert.deepEqual(r.lastWeek, { date: dates[0], total: 4 }, "last Saturday: 3 at 6 pm and 1 at 7 am");
  });

  it("hours outside 5 am to 10 pm join the chart when they had visits", () => {
    const r = busyHours({ today, rows: [at(dates[0], 23, 1), at(dates[1], 4, 2)], firstRecordedDay: "2026-09-01" });
    assert.deepEqual([r.hours[0].hour, r.hours[r.hours.length - 1].hour], [4, 23]);
  });

  it("only the weeks the branch was recording count; fewer than two means no forecast", () => {
    assert.deepEqual(busyHours({ today, rows: [], firstRecordedDay: null }), { forDate, dates, weeksUsed: 0, enough: false, hours: [], total: 0, busiest: null, quietest: null, lastWeek: null });
    assert.equal(busyHours({ today, rows: [at(dates[0], 18, 1)], firstRecordedDay: dates[0] }).enough, false, "one recorded week isn't enough, even with visits");
    const two = busyHours({ today, rows: [at(dates[0], 18, 1), at(dates[0], 18, 2), at(dates[1], 18, 3)], firstRecordedDay: dates[1] });
    assert.deepEqual([two.enough, two.weeksUsed], [true, 2]);
    assert.deepEqual(two.hours.find((h) => h.hour === 18), { hour: 18, samples: [2, 1], expected: 2 }, "the average is over the two weeks that count, not four");
    const recordedButQuiet = busyHours({ today, rows: [], firstRecordedDay: "2026-01-01" });
    assert.deepEqual([recordedButQuiet.enough, recordedButQuiet.total, recordedButQuiet.busiest, recordedButQuiet.quietest], [true, 0, null, null], "recording for months with no visits on that weekday: a forecast of none");
    assert.equal(BUSY.minWeeks, 2);
  });
});

describe("month-end revenue: collected so far plus likely renewals and dues", () => {
  const base = { today, collected: 120000, expiring: [{ price: 1200 }, { price: 1500 }, { price: null }], renewed: 7, lapsed: 3, duesOutstanding: 20000, duePaid: 3000, dueOverdue: 2000, lastMonthTotal: 150000 };

  it("the month: its first and last day and the days left", () => {
    assert.deepEqual(monthRange("2026-11-06"), { from: "2026-11-01", to: "2026-11-30", daysLeft: 24 });
    assert.deepEqual(monthRange("2026-02-28"), { from: "2026-02-01", to: "2026-02-28", daysLeft: 0 });
    assert.deepEqual(monthRange("2028-02-01").to, "2028-02-29", "a leap year");
  });

  it("the full forecast: 70% of the priced plans ending, 60% of the dues, plus what's collected", () => {
    const r = revenueForecast(base);
    assert.deepEqual(r.renewals, { expiring: 3, priced: 2, sample: { renewed: 7, lapsed: 3 }, rate: 0.7, amount: 1890 }, "(1200 + 1500) × 0.7; the unpriced member is counted but adds nothing");
    assert.deepEqual(r.dues, { outstanding: 20000, sample: { paid: 3000, overdue: 2000 }, rate: 0.6, amount: 12000 });
    assert.deepEqual([r.collected, r.expected, r.complete, r.lastMonth], [120000, 133890, true, 150000]);
    assert.deepEqual(r.month, monthRange(today));
  });

  it("too little renewal history: that part is null and the total is incomplete, never guessed", () => {
    const r = revenueForecast({ ...base, renewed: 2, lapsed: 2 });
    assert.deepEqual([r.renewals.rate, r.renewals.amount, r.renewals.sample], [null, null, { renewed: 2, lapsed: 2 }]);
    assert.deepEqual([r.expected, r.complete], [132000, false], "collected plus the dues only");
    assert.equal(revenueForecast({ ...base, renewed: 5, lapsed: 0 }).renewals.rate, 1, "five endings are enough");
    assert.equal(REVENUE.minRenewalSample, 5);
  });

  it("dues: nothing outstanding is 0; outstanding with no history is null; a rate of 0 is honest", () => {
    assert.deepEqual(revenueForecast({ ...base, duesOutstanding: 0, duePaid: 0, dueOverdue: 0 }).dues, { outstanding: 0, sample: { paid: 0, overdue: 0 }, rate: null, amount: 0 });
    const none = revenueForecast({ ...base, duePaid: 0, dueOverdue: 0 });
    assert.deepEqual([none.dues.rate, none.dues.amount, none.complete], [null, null, false]);
    assert.deepEqual(revenueForecast({ ...base, duePaid: 0, dueOverdue: 5000 }).dues.amount, 0, "nobody has paid a due in 90 days: expect none");
    assert.equal(revenueForecast({ ...base, duePaid: 1000, dueOverdue: 2000 }).dues.rate, 0.33, "rates are rounded to two places");
  });

  it("nothing ending and nothing collected yet", () => {
    const r = revenueForecast({ today, collected: 0, expiring: [], renewed: 0, lapsed: 0, duesOutstanding: 0, duePaid: 0, dueOverdue: 0, lastMonthTotal: 0 });
    assert.deepEqual([r.expected, r.complete, r.renewals.amount, r.dues.amount], [0, false, null, 0]);
  });
});

describe("enquiry conversion: how likely an open enquiry is to join", () => {
  const { contactBody } = require("../gym/rules");
  const open = { today, status: "new", enquiredOn: days(-1), source: null, interest: null, contacts: [] };
  const contact = (kind, outcome, daysAfter) => ({ kind, outcome, contactedOn: addDays(open.enquiredOn, daysAfter) });
  const texts = (r) => r.reasons.map((x) => x.text);

  it("nothing known yet: 0, Cold; closed enquiries aren't scored", () => {
    assert.deepEqual(enquiryScore(open), { score: 0, level: "cold", reasons: [] });
    assert.equal(enquiryScore({ ...open, status: "joined" }), null);
    assert.equal(enquiryScore({ ...open, status: "lost" }), null);
    assert.equal(enquiryScore({ ...open, status: "follow_up" }).level, "cold", "follow-up is open");
  });

  it("Kiran: a referral who walked in and was called the next day → 70, Hot", () => {
    const r = enquiryScore({ ...open, source: "referral", contacts: [contact("visit", "visited", 0), contact("call", "reached", 1)] });
    assert.deepEqual([r.score, r.level, texts(r)], [70, "hot", ["Referral", "Visited the gym", "Called back within 2 days"]]);
  });

  it("each sign and its wording", () => {
    assert.deepEqual(texts(enquiryScore({ ...open, interest: "trial" })), ["Wants a trial"]);
    assert.deepEqual(texts(enquiryScore({ ...open, source: "referral", interest: "trial" })), ["Referral · wants a trial"], "both count once");
    assert.equal(enquiryScore({ ...open, source: "referral", interest: "trial" }).score, 30);
    assert.deepEqual(texts(enquiryScore({ ...open, source: "walk_in" })), ["Walked in"]);
    assert.equal(enquiryScore({ ...open, source: "walk_in", contacts: [contact("visit", "visited", 3)] }).score, 20, "walking in and visiting count once");
    assert.deepEqual(texts(enquiryScore({ ...open, contacts: [contact("whatsapp", "reached", 2)] })), ["Messaged within 2 days"]);
    assert.deepEqual(texts(enquiryScore({ ...open, contacts: [contact("call", "no_answer", 3)] })), [], "three days later is not quick");
    assert.deepEqual(texts(enquiryScore({ ...open, contacts: [contact("call", "no_answer", 0), contact("call", "no_answer", 1)] })), ["Called back within 2 days", "No answer twice"], "a quick call that wasn't answered still counts as quick; two no-answers count against");
    assert.equal(enquiryScore({ ...open, contacts: [contact("call", "no_answer", 0), contact("call", "no_answer", 1)] }).score, 0, "20 − 30, floored at 0");
    assert.deepEqual(texts(enquiryScore({ ...open, contacts: [contact("call", "no_answer", 5), contact("whatsapp", "no_answer", 6), contact("call", "no_answer", 7)] })), ["No answer 3 times"]);
    assert.deepEqual(texts(enquiryScore({ ...open, enquiredOn: days(-15) })), ["Asked 15 days ago"]);
    assert.deepEqual(texts(enquiryScore({ ...open, enquiredOn: days(-14) })), [], "14 days is not yet stale");
  });

  it("the levels at their boundaries", () => {
    assert.equal(enquiryScore({ ...open, source: "referral", interest: "trial", source: "referral" }).level, "warm", "30 is Warm");
    assert.equal(enquiryScore({ ...open, source: "walk_in", enquiredOn: days(-20) }).level, "cold", "20 − 20 = 0");
    assert.equal(enquiryScore({ ...open, source: "referral", contacts: [contact("call", "reached", 1)] }).score, 50);
    assert.equal(enquiryScore({ ...open, source: "referral", contacts: [contact("call", "reached", 1)] }).level, "warm");
    assert.equal(enquiryScore({ ...open, source: "referral", contacts: [contact("call", "reached", 1), contact("visit", "visited", 2)] }).level, "hot", "70");
    const old = days(-20);
    assert.equal(enquiryScore({ ...open, enquiredOn: old, interest: "trial", contacts: [{ kind: "call", outcome: "reached", contactedOn: addDays(old, 1) }, { kind: "visit", outcome: "visited", contactedOn: addDays(old, 2) }] }).score, 50, "70 − 20 for age");
    assert.deepEqual([ENQUIRY.levels.hot, ENQUIRY.levels.warm], [60, 30]);
  });

  it("the contact body: kind and outcome from the lists, a visit is always visited", () => {
    assert.deepEqual(contactBody({ kind: "call", outcome: "no_answer" }), { kind: "call", outcome: "no_answer" });
    assert.deepEqual(contactBody({ kind: "whatsapp", outcome: "reached" }), { kind: "whatsapp", outcome: "reached" });
    assert.deepEqual(contactBody({ kind: "visit" }), { kind: "visit", outcome: "visited" });
    assert.deepEqual(contactBody({ kind: "visit", outcome: "reached" }), { kind: "visit", outcome: "visited" });
    refuses(() => contactBody({ kind: "call", outcome: "visited" }), /reached or no answer/);
    refuses(() => contactBody({ kind: "email", outcome: "reached" }), /call, WhatsApp or a visit/);
    refuses(() => contactBody({ kind: "call" }), /reached or no answer/);
    refuses(() => contactBody({ kind: "call", outcome: "reached", note: "x" }), /fields we don't use/);
    refuses(() => contactBody(null), /JSON/);
  });
});
