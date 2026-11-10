// Book a free trial's pure rules (gym/trialRules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../gym/trialRules");

describe("gym trial rules", () => {
  const today = "2026-11-10";
  const good = { name: "  Daniel   Kim ", age: 27, gender: "male", goal: "build_muscle", experience: "some", day: "2026-11-15", time: "evening", note: "After work" };

  it("cleans a good request and keeps the details apart", () => {
    assert.deepEqual(rules.trialBody(good, today), {
      name: "Daniel Kim",
      details: { age: 27, gender: "male", goal: "build_muscle", experience: "some", day: "2026-11-15", time: "evening" },
      note: "After work",
    });
    assert.deepEqual(rules.trialBody({ name: "Asha", day: today, time: "morning" }, today).details, { age: null, gender: null, goal: null, experience: null, day: today, time: "morning" });
  });

  it("refuses anything unexpected", () => {
    for (const bad of [
      { ...good, phone: "9123456789" }, { ...good, name: "" }, { ...good, name: "x".repeat(81) }, { ...good, age: 12 }, { ...good, age: 27.5 },
      { ...good, gender: "x" }, { ...good, goal: "fly" }, { ...good, day: "2026-11-09" }, { ...good, day: "2026-11-25" }, { ...good, day: "2026-02-30" },
      { ...good, time: "night" }, { ...good, time: undefined }, { ...good, note: "a\u0001b" }, null, [],
    ]) assert.throws(() => rules.trialBody(bad, today), JSON.stringify(bad));
  });

  it("checks the gym's booking and outcome", () => {
    assert.deepEqual(rules.scheduleBody({ day: "2026-11-15", time: "18:30" }, today), { day: "2026-11-15", time: "18:30" });
    for (const bad of [{ day: "2026-11-09", time: "18:30" }, { day: "2026-11-15", time: "6:30" }, { day: "2026-11-15", time: "24:00" }, { day: "2026-11-15", time: "18:30", note: "x" }]) assert.throws(() => rules.scheduleBody(bad, today));
    assert.deepEqual(rules.outcomeBody({ outcome: "no_show" }), { outcome: "no_show" });
    assert.throws(() => rules.outcomeBody({ outcome: "cancelled" }));
  });

  it("writes the labels in plain words", () => {
    assert.equal(rules.dayText("2026-11-15"), "Sun 15 Nov");
    assert.equal(rules.clockText("18:30"), "6:30 PM");
    assert.equal(rules.clockText("00:05"), "12:05 AM");
    assert.equal(rules.requestLabel({ day: "2026-11-15", time: "evening" }), "Free trial · Sun 15 Nov, evening");
    assert.equal(rules.scheduledLabel("2026-11-15", "07:00"), "Free trial · Sun 15 Nov, 7:00 AM");
  });

  it("reads a stored trial, ignoring anything odd", () => {
    const t = rules.trialOf({ trial_status: "scheduled", trial_details: JSON.stringify({ day: "2026-11-15", time: "evening", age: 27, gender: "robot" }), trial_day: "2026-11-15", trial_time: "18:30" });
    assert.equal(t.details.gender, null);
    assert.equal(t.preferred, "Sun 15 Nov, evening");
    assert.deepEqual(t.at, { day: "2026-11-15", time: "18:30", text: "Sun 15 Nov, 6:30 PM" });
    assert.equal(rules.trialOf({ trial_status: null }), null);
    assert.equal(rules.trialOf({ trial_status: "requested", trial_details: "{bad" }).details, null);
  });
});
