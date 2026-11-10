// The daily follow-up's pure rules (coach/followupRules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../coach/followupRules");

describe("coach follow-up rules", () => {
  const now = Date.parse("2026-11-10T15:00:00Z");

  it("takes only today's date", () => {
    assert.deepEqual(rules.followupBody({ date: "2026-11-10" }, now), { date: "2026-11-10" });
    assert.throws(() => rules.followupBody({ date: "2026-11-10", userId: "x" }, now), /Unexpected field/);
    assert.throws(() => rules.followupBody({ date: "2020-01-01" }, now));
    assert.throws(() => rules.followupBody([], now));
    assert.throws(() => rules.followupBody(null, now));
  });

  it("gives one stable UUID per member, day and coach", () => {
    const id = rules.followupId("u1", "2026-11-10", "priya");
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(id.length, 36);
    assert.equal(rules.followupId("u1", "2026-11-10", "priya"), id);
    assert.notEqual(rules.followupId("u1", "2026-11-11", "priya"), id);
    assert.notEqual(rules.followupId("u1", "2026-11-10", "arjun"), id);
    assert.notEqual(rules.followupId("u2", "2026-11-10", "priya"), id);
  });

  it("says what happened with today's workout", () => {
    // 2026-11-10 is a Tuesday (2)
    assert.equal(rules.workoutLine({ weekdays: [2] }, "2026-11-10", "completed"), "Today's workout: done.");
    assert.equal(rules.workoutLine({ weekdays: [1, 3] }, "2026-11-10", null), "Today is a rest day.");
    assert.equal(rules.workoutLine({ weekdays: [2] }, "2026-11-10", null), "Today's workout: not done yet.");
    assert.equal(rules.workoutLine({ weekdays: [2] }, "2026-11-10", "skipped"), "Today's workout: skipped.");
  });

  it("writes the check-in as the member's coach, with no plan changes", () => {
    const text = rules.followupInstructions({ coach: "priya", coachStyle: "supportive" });
    assert.match(text, /Coach Priya/);
    assert.match(text, /evening check-in/);
    assert.match(text, /Leave mealChanges and workoutChanges empty/);
  });
});
