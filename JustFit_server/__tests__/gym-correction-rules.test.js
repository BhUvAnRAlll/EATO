// Attendance corrections and the member's streak (Gym Hub ecosystem, 2026-11-10): what staff may send
// to add or fix a visit (a reason always, India's times on the visit's day, nothing in the future or
// over 12 hours), overlaps, and the streak and this week's visit days
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/correctionRules");
const hub = require("../gym/memberHubRules");

const TODAY = "2026-11-10";
const NOW = rules.indiaMs(TODAY, "20:00");

describe("Attendance correction rules", () => {
  it("adds a missed visit with India's times and a reason", () => {
    const out = rules.addBody({ memberId: 4, date: "2026-11-08", inTime: "06:30", outTime: "07:45", reason: "Forgot to scan the QR." }, TODAY, NOW);
    assert.equal(out.durationMin, 75);
    assert.equal(rules.indiaTime(out.inMs), "06:30");
    assert.equal(out.reason, "Forgot to scan the QR.");
  });

  it("refuses what can't be a real visit", () => {
    const base = { memberId: 4, date: "2026-11-08", inTime: "06:30", outTime: "07:45", reason: "Forgot to scan the QR." };
    assert.throws(() => rules.addBody({ ...base, reason: "x" }, TODAY, NOW), /why/);
    assert.throws(() => rules.addBody({ ...base, outTime: "06:00" }, TODAY, NOW), /after the check-in/);
    assert.throws(() => rules.addBody({ ...base, inTime: "6:30" }, TODAY, NOW), /HH:MM/);
    assert.throws(() => rules.addBody({ ...base, date: "2026-09-01" }, TODAY, NOW), /30 days/);
    assert.throws(() => rules.addBody({ ...base, date: "2026-11-11" }, TODAY, NOW), /30 days/);
    assert.throws(() => rules.addBody({ ...base, date: TODAY, inTime: "21:00", outTime: "22:00" }, TODAY, NOW), /future/);
    assert.throws(() => rules.addBody({ ...base, inTime: "05:00", outTime: "18:00" }, TODAY, NOW), /12 hours/);
    assert.throws(() => rules.addBody({ ...base, memberId: "4 OR 1=1" }, TODAY, NOW), /member/);
    assert.throws(() => rules.addBody({ ...base, gymId: 2 }, TODAY, NOW), /fields/);
  });

  it("corrects a visit on its own day, keeping what isn't changed", () => {
    const visit = { day: "2026-11-09", inMs: rules.indiaMs("2026-11-09", "18:00"), outMs: null };
    const change = rules.editBody({ outTime: "19:10", reason: "Left without checking out." });
    const span = rules.editedSpan(visit, change, TODAY, NOW);
    assert.equal(span.durationMin, 70);
    assert.throws(() => rules.editedSpan(visit, rules.editBody({ inTime: "17:00", reason: "Came in earlier." }), TODAY, NOW), /needs a check-out/);
    assert.throws(() => rules.editBody({ reason: "Nothing to change." }), /Change/);
    assert.throws(() => rules.editedSpan({ day: "2026-09-01", inMs: 0, outMs: 1 }, change, TODAY, NOW), /older than 30 days/);
  });

  it("finds overlapping visits, an open one running to now", () => {
    const at = (t) => rules.indiaMs(TODAY, t);
    assert.equal(rules.overlaps({ inMs: at("06:00"), outMs: at("07:00") }, { inMs: at("06:30"), outMs: at("08:00") }, NOW), true);
    assert.equal(rules.overlaps({ inMs: at("06:00"), outMs: at("07:00") }, { inMs: at("07:00"), outMs: at("08:00") }, NOW), false);
    assert.equal(rules.overlaps({ inMs: at("18:00"), outMs: null }, { inMs: at("19:00"), outMs: at("19:30") }, NOW), true);
  });

  it("counts the streak and this week's visit days", () => {
    assert.equal(hub.streakDays(["2026-11-08", "2026-11-09"], TODAY), 2, "no visit yet today: up to yesterday");
    assert.equal(hub.streakDays(["2026-11-08", "2026-11-09", TODAY], TODAY), 3);
    assert.equal(hub.streakDays(["2026-11-07"], TODAY), 0);
    assert.equal(hub.weekVisits(["2026-11-08", "2026-11-09", TODAY, TODAY], TODAY), 2, "Monday the 9th to today; Sunday the 8th is last week");
  });
});
