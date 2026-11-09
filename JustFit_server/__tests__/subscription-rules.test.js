// Meal plans and subscriptions: the pure rules (subscriptions/rules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../subscriptions/rules");
const { ValidationError } = require("../profile");

const today = "2026-11-10";
const plan = (over = {}) => ({
  name: "Fat Loss Plan", tagline: "Calorie deficit, high protein", description: "Sustainable weight loss with balanced meals", goal: "fat_loss",
  mealsPerDay: 3, calories: 2200, proteinG: 150, carbsG: 220, fatG: 70, waterL: 3, included: ["Fresh & hygienic preparation"],
  lengths: [{ days: 28, price: 6999 }, { days: 7, price: 1899 }], mealIds: ["paneer-bowl-1a2b3c"], active: true, ...over,
});

describe("subscription rules", () => {
  it("meal times by meals a day, and savings against the shortest length", () => {
    assert.deepEqual(rules.slotsFor(1), ["lunch"]);
    assert.deepEqual(rules.slotsFor(2), ["lunch", "dinner"]);
    assert.deepEqual(rules.slotsFor(3), ["breakfast", "lunch", "dinner"]);
    const lengths = rules.lengthsWithSavings([{ days: 90, price: 18999 }, { days: 7, price: 1899 }, { days: 28, price: 6999 }]);
    assert.deepEqual(lengths.map((l) => [l.days, l.savePercent]), [[7, 0], [28, 8], [90, 22]]);
  });

  it("reads a subscription: a start from tomorrow to 14 days ahead", () => {
    const body = { clientId: "6f1c2a0e-1111-4222-8333-944455556666", planId: 1, days: 28, startsOn: "2026-11-11", addressId: 3 };
    assert.equal(rules.subscribeBody(body, today).startsOn, "2026-11-11");
    for (const bad of [{ ...body, startsOn: today }, { ...body, startsOn: "2026-11-30" }, { ...body, days: 0 }, { ...body, clientId: "x" }, { ...body, price: 1 }, { ...body, startsOn: "2026-02-30" }]) {
      assert.throws(() => rules.subscribeBody(bad, today), ValidationError, JSON.stringify(bad));
    }
  });

  it("reads pauses and skips inside the plan", () => {
    const sub = { startsOn: "2026-11-11", endsOn: "2026-12-08" };
    assert.deepEqual(rules.pauseBody({ from: "2026-11-15", until: "2026-11-17" }, today, sub), { from: "2026-11-15", until: "2026-11-17", days: 3 });
    for (const bad of [{ from: today, until: "2026-11-12" }, { from: "2026-11-15", until: "2026-11-14" }, { from: "2026-11-15", until: "2026-12-20" }, { from: "2026-12-10", until: "2026-12-11" }]) {
      assert.throws(() => rules.pauseBody(bad, today, sub), ValidationError, JSON.stringify(bad));
    }
    assert.deepEqual(rules.skipBody({ day: "2026-11-12" }, today, sub), { day: "2026-11-12" });
    assert.throws(() => rules.skipBody({ day: today }, today, sub), ValidationError);
    assert.throws(() => rules.skipBody({ day: "2026-12-09" }, today, sub), ValidationError);
  });

  it("rotates meals and knows the delivery days", () => {
    const ids = ["a", "b", "c", "d"];
    assert.deepEqual([0, 1, 2].map((i) => rules.mealFor(ids, "2026-11-11", i, "2026-11-11")), ["a", "b", "c"]);
    assert.deepEqual([0, 1, 2].map((i) => rules.mealFor(ids, "2026-11-12", i, "2026-11-11")), ["d", "a", "b"]);
    assert.equal(rules.mealFor([], "2026-11-12", 0, "2026-11-11"), null);
    const sub = { status: "active", startsOn: "2026-11-11", endsOn: "2026-11-20", pausedFrom: "2026-11-14", pausedUntil: "2026-11-15" };
    assert.equal(rules.deliversOn(sub, "2026-11-13"), true);
    assert.equal(rules.deliversOn(sub, "2026-11-14"), false, "paused");
    assert.equal(rules.deliversOn(sub, "2026-11-21"), false, "after the end");
    assert.equal(rules.deliversOn({ ...sub, status: "cancelled" }, "2026-11-13"), false);
  });

  it("reads a plan for the admin", () => {
    const got = rules.planBody(plan());
    assert.deepEqual(got.lengths, [{ days: 7, pricePaise: 189900 }, { days: 28, pricePaise: 699900 }]);
    assert.equal(rules.slugFor("Fat Loss Plan"), "fat-loss-plan");
    for (const bad of [plan({ goal: "bulk" }), plan({ mealsPerDay: 4 }), plan({ lengths: [] }), plan({ lengths: [{ days: 7, price: 1 }, { days: 7, price: 2 }] }), plan({ mealIds: ["x' OR 1=1"] }), plan({ waterL: 20 }), plan({ price: 1 })]) {
      assert.throws(() => rules.planBody(bad), ValidationError, JSON.stringify(bad).slice(0, 60));
    }
  });
});
