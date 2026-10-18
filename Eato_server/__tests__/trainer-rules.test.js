// Unit tests for the trainer coaching rules (trainers/rules.js): no database, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const r = require("../trainers/rules.js");

describe("trainer rules", () => {
  it("a profile hides the approach, qualifications and languages until the trainer accepts", () => {
    const profile = { title: "Coach", approach: "Slow and steady", qualifications: ["ACE"], languages: ["English"] };
    assert.deepEqual(r.profileForViewer(profile), { ...profile, approach: null, qualifications: null, languages: null, locked: true });
    assert.deepEqual(r.profileForViewer(profile, { connected: true }), { ...profile, locked: false });
    assert.deepEqual(r.profileForViewer(profile, { own: true }), { ...profile, locked: false });
  });

  it("connection state and the messaging lock follow the open row", () => {
    assert.equal(r.connectionState(null), "none");
    assert.equal(r.connectionState({ status: "requested" }), "requested");
    assert.equal(r.connectionState({ status: "connected" }), "connected");
    assert.equal(r.connectionState({ status: "ended" }), "none");
    assert.equal(r.messageLockReason("connected", "Tara Trainer"), null);
    assert.equal(r.messageLockReason("requested", "Tara Trainer"), "Messaging unlocks when Tara accepts your request.");
    assert.equal(r.messageLockReason("none", "Tara Trainer"), "Send Tara a connection request to message them.");
  });

  it("a recommendation is new until applied", () => {
    assert.equal(r.recommendationIsNew(null), false);
    assert.equal(r.recommendationIsNew({ applied_at: null }), true);
    assert.equal(r.recommendationIsNew({ applied_at: new Date() }), false);
  });

  it("plan meals log into the diary's slots, with an idempotent key", () => {
    assert.equal(r.diarySlotFor("morning_snack"), "snack");
    assert.equal(r.diarySlotFor("evening_snack"), "snack");
    assert.equal(r.diarySlotFor("dinner"), "dinner");
    assert.equal(r.planLogKey("2026-10-20", "meal-1"), "2026-10-20:meal-1:1");
    assert.equal(r.planLogKey("2026-10-20", "meal-1", 3), "2026-10-20:meal-1:3");
  });

  it("servings scale the foods (0 skips one) and totals add up like the diary", () => {
    const items = [
      { name: "Oats", quantity: 60, unit: "g", kcal: 230, proteinG: 8, carbsG: 40, fatG: 4 },
      { name: "Milk", quantity: 200, unit: "ml", kcal: 100, proteinG: 7, carbsG: 10, fatG: 3.5 },
    ];
    const scaled = r.scaleItems(items, [1.5, 0]);
    assert.deepEqual(scaled, [{ name: "Oats", quantity: 90, unit: "g", kcal: 345, proteinG: 12, carbsG: 60, fatG: 6 }]);
    assert.deepEqual(r.totalsOf(items), { kcal: 330, proteinG: 15, carbsG: 50, fatG: 7.5 });
    assert.deepEqual(r.scaleItems(items, []), r.scaleItems(items, [1, 1]), "missing servings mean one serving");
  });
});
