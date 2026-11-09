// Orders through kitchens: the pure rules (kitchens/assignRules.js)
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../kitchens/assignRules");
const { ValidationError } = require("../profile");

const week = (sessions) => Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, sessions]));
const kitchen = (over = {}) => ({
  id: 1, name: "K1", status: "active", hours: week([["06:00", "22:00"]]), pincodes: new Set(["560095"]), menu: new Map([["paneer-bowl", true]]),
  stock: new Map([[7, 2]]), dayOrders: 0, maxDailyOrders: 100, slotMeals: 0, prepCapacity: 50, latitude: null, longitude: null, radiusKm: 6, ...over,
});
const order = (over = {}) => ({ pincode: "560095", date: "2026-11-11", startsAt: "12:30", items: [{ mealId: "paneer-bowl", quantity: 2 }], need: new Map([[7, 0.3]]), lat: null, lng: null, ...over });

describe("kitchen assignment rules", () => {
  it("steps one at a time; changes allowed before cooking only", () => {
    assert.equal(rules.nextStep("placed"), "accepted");
    assert.equal(rules.nextStep("quality_check"), "ready");
    assert.equal(rules.nextStep("delivered"), null);
    assert.equal(rules.nextStep("cancelled"), null);
    assert.equal(rules.beforeCooking("accepted"), true);
    assert.equal(rules.beforeCooking("preparing"), false);
  });

  it("says why a kitchen can't take an order", () => {
    assert.equal(rules.problem(kitchen(), order()), null);
    assert.equal(rules.problem(kitchen({ status: "maintenance" }), order()), "not active");
    assert.equal(rules.problem(kitchen(), order({ pincode: "560001" })), "doesn't deliver to this pincode");
    assert.equal(rules.problem(kitchen({ hours: { ...week([["06:00", "22:00"]]), wed: [] } }), order()), "closed at this meal time", "2026-11-11 is a Wednesday");
    assert.equal(rules.problem(kitchen({ menu: new Map() }), order()), "doesn't cook a meal in it");
    assert.equal(rules.problem(kitchen({ menu: new Map([["paneer-bowl", false]]) }), order()), "a meal in it is off today");
    assert.equal(rules.problem(kitchen({ stock: new Map([[7, 0.2]]) }), order()), "short of an ingredient");
    assert.equal(rules.problem(kitchen({ dayOrders: 100 }), order()), "full for the day");
    assert.equal(rules.problem(kitchen({ slotMeals: 49 }), order()), "full for this meal time");
    assert.equal(rules.problem(kitchen({ latitude: 12.93, longitude: 77.62, radiusKm: 2 }), order({ lat: 13.03, lng: 77.62 })), "too far");
  });

  it("picks the nearest, then the least busy", () => {
    const a = kitchen({ id: 1, latitude: 12.93, longitude: 77.62, radiusKm: 20 });
    const b = kitchen({ id: 2, latitude: 12.97, longitude: 77.64, radiusKm: 20 });
    assert.equal(rules.choose([a, b], order({ lat: 12.975, lng: 77.64 })).id, 2);
    assert.equal(rules.choose([kitchen({ id: 1, dayOrders: 50 }), kitchen({ id: 2, dayOrders: 10 })], order()).id, 2);
    assert.equal(rules.choose([kitchen({ status: "inactive" })], order()), null);
    assert.ok(Math.abs(rules.distanceKm({ lat: 12.9716, lng: 77.5946 }, { lat: 13.0827, lng: 80.2707 }) - 290) < 5, "Bengaluru to Chennai is about 290 km");
  });

  it("adds up what recipes need", () => {
    const recipes = new Map([["a", [{ ingredientId: 1, quantity: 0.15 }, { ingredientId: 2, quantity: 1 }]], ["b", [{ ingredientId: 1, quantity: 0.1 }]]]);
    assert.deepEqual([...rules.needs([{ mealId: "a", quantity: 2 }, { mealId: "b", quantity: 1 }, { mealId: "c", quantity: 3 }], recipes)], [[1, 0.4], [2, 2]]);
  });

  it("reads steps, kitchen moves and holidays", () => {
    assert.deepEqual(rules.advanceBody({ from: "accepted" }), { from: "accepted", to: "preparing", override: false, note: null });
    assert.throws(() => rules.advanceBody({ from: "accepted", override: true }), ValidationError, "an override needs a reason");
    assert.equal(rules.advanceBody({ from: "accepted", override: true, note: "Paneer arriving at 11" }).override, true);
    assert.throws(() => rules.advanceBody({ from: "delivered" }), ValidationError);
    assert.throws(() => rules.advanceBody({ from: "cancelled" }), ValidationError);
    assert.throws(() => rules.advanceBody({ from: "placed", to: "delivered" }), ValidationError);
    assert.deepEqual(rules.kitchenBody({ kitchenId: 3 }), { kitchenId: 3 });
    assert.throws(() => rules.kitchenBody({ kitchenId: "3" }), ValidationError);
    assert.deepEqual(rules.holidayBody({ day: "2026-11-14", note: "Diwali" }, "2026-11-10"), { day: "2026-11-14", note: "Diwali" });
    assert.throws(() => rules.holidayBody({ day: "2026-11-09", note: "Late" }, "2026-11-10"), ValidationError);
    assert.throws(() => rules.holidayBody({ day: "2026-11-14", note: "x" }, "2026-11-10"), ValidationError);
  });
});
