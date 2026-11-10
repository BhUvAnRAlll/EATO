import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DIET_SLOTS, dietTime, sharedFoodText } from "../dietPlanText.ts";

describe("diet plan words", () => {
  it("offers justFit picks only at the meal times justFit delivers", () => {
    assert.deepEqual(DIET_SLOTS.filter((s) => s.orderable).map((s) => s.id), ["breakfast", "lunch", "dinner"]);
  });

  it("writes times and shared answers plainly", () => {
    assert.equal(dietTime("13:30"), "1:30 PM");
    assert.equal(dietTime("00:05"), "12:05 AM");
    assert.equal(dietTime(null), null);
    assert.equal(dietTime("1pm"), null);
    assert.equal(sharedFoodText({ diet: "vegetarian", allergies: "peanuts", dislikes: "brinjal" }), "Vegetarian · allergic to peanuts · avoids brinjal");
    assert.equal(sharedFoodText({ diet: null, allergies: null, dislikes: null }), "No food answers yet");
    assert.equal(sharedFoodText(null), "No food answers yet");
  });
});
