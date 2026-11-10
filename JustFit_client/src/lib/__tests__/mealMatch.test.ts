import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { foodWords, matchMeals, refuelMeals, refuelReason, mealConflict, mealTimesLeft, planReason, remainingReason, safeMeals, targetFromRemaining, type MatchMeal } from "../mealMatch.ts";

const meal = (id: string, over: Partial<MatchMeal> = {}): MatchMeal => ({ id, name: id, description: null, ingredients: null, diet: "vegetarian", calories: 450, proteinG: 20, ...over });
const menu = [
  meal("Paneer Tikka Bowl", { calories: 480, proteinG: 32, ingredients: "paneer, rice, capsicum" }),
  meal("Chicken Biryani", { diet: "non-vegetarian", calories: 620, proteinG: 40 }),
  meal("Egg Bhurji Wrap", { diet: "eggetarian", calories: 410, proteinG: 24, ingredients: "eggs, onion, wheat wrap" }),
  meal("Peanut Poha", { calories: 380, proteinG: 10, ingredients: "poha, peanuts, curry leaves" }),
  meal("Dal Rice", { diet: "vegan", calories: 520, proteinG: 18 }),
  meal("Brinjal Curry Thali", { calories: 560, proteinG: 16, ingredients: "brinjal, roti, rice" }),
];

describe("meal recommendations", () => {
  it("reads allergies and dislikes as words", () => {
    assert.deepEqual(foodWords("Peanuts, shellfish and brinjal"), ["peanuts", "shellfish", "brinjal"]);
    assert.deepEqual(foodWords("allergic to peanuts; no mushroom"), ["peanuts", "mushroom"]);
    assert.deepEqual(foodWords(""), []);
    assert.deepEqual(foodWords(null), []);
  });

  it("never offers a meal that breaks the diet or names an allergy", () => {
    const veg = { diet: "vegetarian" as const, allergies: "peanuts", dislikes: null };
    const safe = safeMeals(menu, veg).map((m) => m.id);
    assert.ok(!safe.includes("Chicken Biryani"), "no chicken for a vegetarian");
    assert.ok(!safe.includes("Egg Bhurji Wrap"), "no egg for a vegetarian");
    assert.ok(!safe.includes("Peanut Poha"), "no peanuts with a peanut allergy (peanuts finds peanut)");
    assert.deepEqual(safeMeals(menu, { diet: "vegan", allergies: null, dislikes: null }).map((m) => m.id), ["Dal Rice"]);
    assert.ok(safeMeals(menu, { diet: "eggetarian", allergies: null, dislikes: null }).some((m) => m.id === "Egg Bhurji Wrap"));
    assert.equal(safeMeals(menu, null).length, menu.length, "no answers yet: every meal");
    assert.deepEqual(mealConflict(menu[3], { diet: null, allergies: "Peanut", dislikes: null }), { block: "allergy:peanut" });
  });

  it("ranks by the target, keeps dislikes last and never far over", () => {
    const food = { diet: "vegetarian" as const, allergies: null, dislikes: "brinjal" };
    const lunch = matchMeals(menu, food, { kcal: 500, proteinG: 30 }, { max: 10 });
    assert.equal(matchMeals(menu, food, { kcal: 500, proteinG: 30 }).some((m) => m.disliked), false, "the top 3 skip a disliked meal when others fit");
    assert.equal(lunch[0].meal.id, "Paneer Tikka Bowl");
    assert.equal(lunch.at(-1)?.meal.id, "Brinjal Curry Thali", "a disliked meal goes last");
    assert.equal(lunch.at(-1)?.disliked, true);
    assert.equal(matchMeals(menu, food, { kcal: 300, proteinG: 10 }).some((m) => m.meal.calories > 420), false, "nothing over 1.4× the target");
    assert.deepEqual(matchMeals(menu, food, { kcal: 500, proteinG: 30 }, { exclude: ["Paneer Tikka Bowl"], max: 1 }).map((m) => m.meal.id), ["Dal Rice"]);
    assert.deepEqual(matchMeals(menu, food, { kcal: 0, proteinG: 0 }), []);
  });

  it("explains each pick in plain words", () => {
    assert.equal(planReason({ meal: menu[0], kcalDiff: -30, proteinDiff: 4, disliked: false }, "Lunch"), "30 kcal under your lunch · 4 g more protein");
    assert.equal(planReason({ meal: menu[0], kcalDiff: 10, proteinDiff: -1, disliked: false }, "Dinner"), "About the same kcal as your dinner · same protein");
    assert.equal(remainingReason(menu[0], { kcal: 900, proteinG: 64 }), "32 g of the 64 g protein you still need");
    assert.equal(remainingReason(menu[3], { kcal: 900, proteinG: 5 }), "380 kcal of the 900 kcal left today");
  });

  it("shares what's left over the meal times to come", () => {
    assert.deepEqual(targetFromRemaining({ kcal: 1500, proteinG: 90 }, 2), { kcal: 750, proteinG: 45 });
    assert.deepEqual(targetFromRemaining({ kcal: 2400, proteinG: 120 }, 1), { kcal: 800, proteinG: 120 }, "capped at 800 kcal");
    assert.equal(targetFromRemaining({ kcal: 120, proteinG: 30 }, 1), null, "too little left");
    assert.deepEqual(targetFromRemaining({ kcal: 600, proteinG: 20 }, 0), { kcal: 600, proteinG: 20 }, "never divides by zero");
    assert.deepEqual([7, 12, 18, 23].map(mealTimesLeft), [3, 2, 1, 0]);
  });

  it("refuels after a workout with protein, safely", () => {
    const veg = { diet: "vegetarian" as const, allergies: null, dislikes: null };
    assert.deepEqual(refuelMeals(menu, veg).map((m) => m.meal.id), ["Paneer Tikka Bowl"], "only the 20 g+ veg meal");
    assert.ok(refuelMeals(menu, { diet: "non-vegetarian", allergies: null, dislikes: null }).some((m) => m.meal.id === "Chicken Biryani"));
    const lowProtein = [meal("Upma", { calories: 350, proteinG: 8 })];
    assert.deepEqual(refuelMeals(lowProtein, veg).map((m) => m.meal.id), ["Upma"], "no protein-rich meal: any safe one");
    assert.equal(refuelReason(menu[0]), "32 g protein to help your muscles recover");
    assert.equal(refuelReason(lowProtein[0]), "350 kcal to refuel after your workout");
  });
});
