// Trainer diet plans: what a plan may hold, the member's sharing switch, and the trainer's view of a
// menu meal for a client who shares their food answers (the check is the app's lib/mealMatch.ts).
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { ValidationError } = require("../profile");
const r = require("../gym/dietPlanRules");

const meal = (over = {}) => ({ slot: "lunch", time: "13:30", food: "2 roti, dal, sabzi, curd", kcal: 550, proteinG: 25, picks: ["paneer-tikka-bowl"], ...over });

describe("trainer diet plan rules", () => {
  it("takes a day of meals in the day's order", () => {
    const plan = r.planBody({
      note: "  Drink 3 L water,   no sugar in tea ",
      meals: [meal(), { slot: "breakfast", time: "08:00", food: "3 idli + sambar", picks: [] }, { slot: "evening", food: "Sprouts chaat" }],
    });
    assert.equal(plan.note, "Drink 3 L water, no sugar in tea");
    assert.deepEqual(plan.meals.map((m) => m.slot), ["breakfast", "lunch", "evening"], "by time, then by meal time");
    assert.deepEqual(plan.meals[2], { slot: "evening", time: null, food: "Sprouts chaat", kcal: null, proteinG: null, picks: [] });
    assert.equal(r.planBody({ meals: [meal()] }).note, null);
  });

  it("refuses what a plan can't hold", () => {
    for (const bad of [
      null,
      [],
      { meals: [] },
      { meals: [meal()], extra: 1 },
      { meals: Array.from({ length: 9 }, () => meal()) },
      { meals: [meal({ slot: "brunch" })] },
      { meals: [meal({ time: "25:00" })] },
      { meals: [meal({ time: "1:30 pm" })] },
      { meals: [meal({ food: "x" })] },
      { meals: [meal({ food: "a".repeat(161) })] },
      { meals: [meal({ food: "line\u0000break" })] },
      { meals: [meal({ kcal: -1 })] },
      { meals: [meal({ kcal: 3001 })] },
      { meals: [meal({ proteinG: 12.5 })] },
      { meals: [meal({ picks: ["a", "a"] })] },
      { meals: [meal({ picks: ["a", "b", "c", "d"] })] },
      { meals: [meal({ picks: ["x'; DROP TABLE meals; --"] })] },
      { meals: [meal({ slot: "evening", picks: ["paneer-tikka-bowl"] })] },
      { meals: [{ ...meal(), userId: "someone" }] },
      { note: "n".repeat(301), meals: [meal()] },
    ]) assert.throws(() => r.planBody(bad), ValidationError, JSON.stringify(bad));
  });

  it("reads stored meals defensively and the sharing switch strictly", () => {
    assert.deepEqual(r.readMeals('[{"slot":"lunch","food":"Dal rice","picks":[]}]').length, 1);
    assert.deepEqual(r.readMeals("not json"), []);
    assert.deepEqual(r.readMeals([{ slot: "brunch", food: "x" }, null]), []);
    assert.equal(r.sharingBody({ shared: true }), true);
    for (const bad of [{}, { shared: "yes" }, { shared: true, userId: "x" }, null]) assert.throws(() => r.sharingBody(bad), ValidationError);
  });

  it("tells the trainer which menu meals suit a client who shares", () => {
    const veg = { diet: "vegetarian", allergies: "peanuts", dislikes: "brinjal" };
    assert.deepEqual(r.pickCheck({ name: "Chicken Biryani", diet: "non-vegetarian" }, veg), { problem: "Not vegetarian", warning: null });
    assert.deepEqual(r.pickCheck({ name: "Peanut Poha", ingredients: "poha, peanuts", diet: "vegetarian" }, veg), { problem: "Has peanuts (allergy)", warning: null });
    assert.deepEqual(r.pickCheck({ name: "Brinjal Curry", diet: "vegan" }, veg), { problem: null, warning: "Has brinjal, which they don't like" });
    assert.deepEqual(r.pickCheck({ name: "Paneer Bowl", diet: "vegetarian" }, veg), { problem: null, warning: null });
  });
});
