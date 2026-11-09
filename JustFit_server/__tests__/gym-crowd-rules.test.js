// Live gym crowd and best time to visit (Gym Hub ecosystem, 2026-11-09): the live estimate (forgotten
// check-outs don't count), levels against capacity, the per-weekday forecast and its "not enough
// data" state, and the gym's settings
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/crowdRules");

const settings = (over = {}) => ({ ...rules.settingsOf({ capacity: 50 }), ...over });
const at = (day, hour, minute = 0) => rules.indiaMs(day, hour, minute);
const TODAY = "2026-11-10"; // a Tuesday

describe("Gym crowd rules", () => {
  it("counts open visits, but not one open longer than a workout can last", () => {
    const now = at(TODAY, 18, 0);
    const stay = { minutes: 60, source: "gym" };
    const open = [{ inMs: at(TODAY, 17, 30) }, { inMs: at(TODAY, 16, 45) }, { inMs: at(TODAY, 9, 0) }];
    const out = rules.live({ now, openVisits: open, settings: settings(), stay, hasAnyAttendance: true });
    assert.equal(out.inside, 2);
    assert.equal(out.leftWithoutCheckout, 1);
    assert.equal(out.percent, 4);
    assert.equal(out.level, "low");
    assert.equal(out.kind, "live");
  });

  it("has no level without a capacity, and nothing without any attendance", () => {
    const base = { now: at(TODAY, 18), openVisits: [], stay: { minutes: 75 }, hasAnyAttendance: true };
    assert.deepEqual([rules.live({ ...base, settings: settings({ capacity: null }) }).available, rules.live({ ...base, settings: settings({ capacity: null }) }).reason], [false, "no_capacity"]);
    assert.equal(rules.live({ ...base, hasAnyAttendance: false, settings: settings() }).reason, "no_attendance");
  });

  it("levels follow the gym's thresholds", () => {
    const t = rules.CROWD.defaultThresholds;
    assert.deepEqual([39, 40, 69, 70, 89, 90, 100].map((p) => rules.levelFor(p, t)), ["low", "moderate", "moderate", "busy", "busy", "very_busy", "very_busy"]);
  });

  it("the usual stay: the gym's figure, else history with enough visits, else 75 minutes", () => {
    assert.deepEqual(rules.usualStay(50, []), { minutes: 50, source: "gym" });
    assert.deepEqual(rules.usualStay(null, new Array(10).fill(90)), { minutes: 90, source: "history" });
    assert.deepEqual(rules.usualStay(null, [90, 90]), { minutes: 75, source: "default" });
    assert.equal(rules.usualStay(null, new Array(12).fill(500)).minutes, 240, "capped");
  });

  it("forecasts per weekday from two or more recorded days, using check-out or the usual stay", () => {
    // Two Tuesdays and two Mondays before today, 3 people at 6-7 pm on Tuesdays
    const visits = [];
    for (const day of ["2026-11-03", "2026-10-27"]) {
      visits.push({ day, inMs: at(day, 18, 0), outMs: at(day, 19, 0) });
      visits.push({ day, inMs: at(day, 18, 10), outMs: null }); // never checked out: lasts the usual 60 min
      visits.push({ day, inMs: at(day, 17, 50), outMs: at(day, 19, 10) });
      visits.push({ day, inMs: at(day, 7, 0), outMs: at(day, 7, 45) });
    }
    for (const day of ["2026-11-09", "2026-11-02"]) visits.push({ day, inMs: at(day, 7, 0), outMs: at(day, 8, 0) });
    const out = rules.forecast({ now: at(TODAY, 6, 0), today: TODAY, visits, stayMin: 60, firstRecordedDay: "2026-10-27", settings: settings({ capacity: 10 }), hours: null });
    assert.equal(out.enough, true);
    assert.equal(out.kind, "forecast");
    const six = out.today.hours.find((h) => h.hour === 18);
    assert.equal(six.expected, 3);
    assert.equal(six.level, "low", "3 of 10 is 30%, under Moderate (40%)");
    assert.equal(out.today.busiest.hour, 18);
    assert.equal(out.tomorrow.enough, true, "Wednesdays on record with nobody in still count");
    assert.equal(out.tomorrow.busiest.expected, 0);

    // Records only from 4 Nov: one day of each weekday at most, so no forecast at all
    const thin = rules.forecast({ now: at(TODAY, 6, 0), today: TODAY, visits, stayMin: 60, firstRecordedDay: "2026-11-04", settings: settings({ capacity: 10 }), hours: null });
    assert.equal(thin.enough, false);
    assert.equal(thin.today, null);
    assert.deepEqual(thin.week, []);
  });

  it("shows only the gym's opening hours when it has them, and levels relative to the peak without a capacity", () => {
    const visits = ["2026-11-03", "2026-10-27"].map((day) => ({ day, inMs: at(day, 18, 0), outMs: at(day, 19, 0) }));
    const hours = { mon: [], tue: [["06:00", "10:00"], ["17:00", "21:00"]], wed: [], thu: [], fri: [], sat: [], sun: [] };
    const out = rules.forecast({ now: at(TODAY, 6), today: TODAY, visits, stayMin: 60, firstRecordedDay: "2026-10-27", settings: settings({ capacity: null }), hours });
    assert.deepEqual(out.today.hours.map((h) => h.hour), [6, 7, 8, 9, 17, 18, 19, 20]);
    assert.equal(out.relativeLevels, true);
    assert.equal(out.today.hours.find((h) => h.hour === 18).level, "very_busy");
    assert.equal(out.today.quietest.expected, 0);
  });

  it("checks the gym's settings", () => {
    assert.deepEqual(rules.settingsBody({ capacity: 80, avgStayMin: 70, thresholds: { moderate: 30, busy: 60, veryBusy: 85 } }), { capacity: 80, avgStayMin: 70, thresholds: { moderate: 30, busy: 60, veryBusy: 85 } });
    assert.deepEqual(rules.settingsBody({ capacity: null }), { capacity: null });
    assert.throws(() => rules.settingsBody({ capacity: 3 }), /5 to 2,000/);
    assert.throws(() => rules.settingsBody({ avgStayMin: 400 }), /15 to 300/);
    assert.throws(() => rules.settingsBody({ thresholds: { moderate: 70, busy: 60, veryBusy: 90 } }), /rising/);
    assert.throws(() => rules.settingsBody({ thresholds: { moderate: 30, busy: 60, veryBusy: 90, extra: 1 } }), /percentages/);
    assert.throws(() => rules.settingsBody({ gymId: 2 }), /fields/);
    assert.throws(() => rules.settingsBody({}), /Change/);
    assert.deepEqual(rules.settingsOf({ crowd_thresholds: "not json" }).thresholds, rules.CROWD.defaultThresholds);
  });
});
