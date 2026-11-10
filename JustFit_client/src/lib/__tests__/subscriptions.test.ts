// Meal subscriptions on the phone: the price shown before the server prices it again, and the one-line summary
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { subscriptionLine, subscriptionPrice } from "../subscriptionRules.ts";

describe("meal subscriptions", () => {
  it("prices like the server: menu price × how many × days, less the % off, to the rupee", () => {
    assert.deepEqual(subscriptionPrice(299, 1, 26, 10), { full: 7774, total: 6997 });
    assert.deepEqual(subscriptionPrice(299, 1, 3, 3), { full: 897, total: 870 });
    assert.deepEqual(subscriptionPrice(249, 2, 7, 0), { full: 3486, total: 3486 });
  });

  it("sums a subscription up in one line", () => {
    assert.equal(subscriptionLine({ meal: { slot: "lunch", quantity: 2 }, mealsPerDay: 1 }), "Lunch · 2 a day");
    assert.equal(subscriptionLine({ meal: null, mealsPerDay: 3 }), "3 meals a day");
  });
});
