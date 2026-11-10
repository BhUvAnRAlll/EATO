// Meal subscriptions: the pure rules (subscriptions/rules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../subscriptions/rules");
const { ValidationError } = require("../profile");

const today = "2026-11-10";

describe("subscription rules", () => {
  it("meal times: a meal subscription's own, a plan's by meals a day", () => {
    assert.deepEqual(rules.slotsFor(1), ["lunch"]);
    assert.deepEqual(rules.slotsFor(2), ["lunch", "dinner"]);
    assert.deepEqual(rules.slotsFor(3), ["breakfast", "lunch", "dinner"]);
    assert.deepEqual(rules.slotsOf({ slot: "dinner", mealsPerDay: 1 }), ["dinner"]);
    assert.deepEqual(rules.slotsOf({ slot: null, mealsPerDay: 2 }), ["lunch", "dinner"]);
  });

  it("reads a meal subscription: the meal, a length, 1 to 3 a day, a meal time, a start from tomorrow to 14 days ahead", () => {
    const body = { clientId: "6f1c2a0e-1111-4222-8333-944455556666", mealId: "grilled-chicken-bowl", lengthId: 4, quantity: 2, slot: "lunch", startsOn: "2026-11-11", addressId: 3 };
    assert.deepEqual(rules.subscribeMealBody(body, today), body);
    for (const bad of [
      { ...body, startsOn: today }, { ...body, startsOn: "2026-11-30" }, { ...body, startsOn: "2026-02-30" }, { ...body, quantity: 0 }, { ...body, quantity: 4 },
      { ...body, quantity: 1.5 }, { ...body, slot: "snack" }, { ...body, mealId: "x' OR 1=1" }, { ...body, lengthId: "4" }, { ...body, clientId: "x" },
      { ...body, price: 1 }, { ...body, planId: 1 },
    ]) {
      assert.throws(() => rules.subscribeMealBody(bad, today), ValidationError, JSON.stringify(bad));
    }
  });

  it("prices a meal subscription from the menu price, rounded to the rupee", () => {
    assert.deepEqual(rules.mealSubscriptionPrice(29900, 1, 26, 10), { fullPaise: 777400, totalPaise: 699700 });
    assert.deepEqual(rules.mealSubscriptionPrice(29900, 1, 3, 3), { fullPaise: 89700, totalPaise: 87000 });
    assert.equal(rules.mealSubscriptionPrice(29900, 2, 7, 0).totalPaise, 418600);
  });

  it("reads the admin's lengths: 1 to 6, each number of days once, at most 50% off, one on", () => {
    const good = { lengths: [{ label: "1 Month", days: 26, percentOff: 10, active: true }, { label: "3 Days", days: 3, percentOff: 3, active: false }] };
    assert.deepEqual(rules.lengthsBody(good).lengths.map((l) => l.days), [3, 26]);
    const one = good.lengths[0];
    for (const bad of [
      { lengths: [] }, { lengths: [one, { ...one, label: "Again" }] }, { lengths: [{ ...one, percentOff: 60 }] }, { lengths: [{ ...one, days: 0 }] },
      { lengths: [{ ...one, active: false }] }, { lengths: [{ ...one, label: "x" }] }, { lengths: [{ ...one, price: 1 }] }, { lengths: [one], extra: 1 },
    ]) {
      assert.throws(() => rules.lengthsBody(bad), ValidationError, JSON.stringify(bad));
    }
  });

  it("reads pauses and skips inside the subscription", () => {
    const sub = { startsOn: "2026-11-11", endsOn: "2026-12-08" };
    assert.deepEqual(rules.pauseBody({ from: "2026-11-15", until: "2026-11-17" }, today, sub), { from: "2026-11-15", until: "2026-11-17", days: 3 });
    for (const bad of [{ from: today, until: "2026-11-12" }, { from: "2026-11-15", until: "2026-11-14" }, { from: "2026-11-15", until: "2026-12-20" }, { from: "2026-12-10", until: "2026-12-11" }]) {
      assert.throws(() => rules.pauseBody(bad, today, sub), ValidationError, JSON.stringify(bad));
    }
    assert.deepEqual(rules.skipBody({ day: "2026-11-12" }, today, sub), { day: "2026-11-12" });
    assert.throws(() => rules.skipBody({ day: today }, today, sub), ValidationError);
    assert.throws(() => rules.skipBody({ day: "2026-12-09" }, today, sub), ValidationError);
  });

  it("rotates a running plan's meals and knows the delivery days", () => {
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
});
