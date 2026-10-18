/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { connectButton, foodsText, macrosRoughlyMatch, parseFoods, scaledTotals, stepServing } from "../trainerRules.ts";

describe("trainer rules", () => {
  it("the connect button follows the connection, another trainer and whether they take clients", () => {
    assert.deepEqual(connectButton("none", false, true), { label: "Connect with Trainer", action: "connect", tone: "primary" });
    assert.equal(connectButton("none", true, true).action, "switch", "switching asks for confirmation");
    assert.equal(connectButton("requested", false, true).action, "cancel");
    assert.equal(connectButton("connected", false, true).action, null);
    assert.deepEqual(connectButton("none", false, false), { label: "Not taking clients", action: null, tone: "soft" });
  });

  it("servings scale the totals, step by half, and stay within 0–10", () => {
    const foods = [
      { name: "Oats", quantity: 60, unit: "g", kcal: 230, proteinG: 8, carbsG: 40, fatG: 4 },
      { name: "Milk", quantity: 200, unit: "ml", kcal: 100, proteinG: 7, carbsG: 10, fatG: 3.5 },
    ];
    assert.deepEqual(scaledTotals(foods, []), { kcal: 330, proteinG: 15, carbsG: 50, fatG: 7.5 });
    assert.deepEqual(scaledTotals(foods, [1.5, 0]), { kcal: 345, proteinG: 12, carbsG: 60, fatG: 6 });
    assert.equal(stepServing(1, 1), 1.5);
    assert.equal(stepServing(0, -1), 0);
    assert.equal(stepServing(10, 1), 10);
  });

  it("the plan editor's food lines round-trip and explain a bad line", () => {
    const { foods, errors } = parseFoods("Oats | 60 g | 230 | 8 | 40 | 4\n\nMilk | 200 ml | 100 | 7 | 10 | 3.5\nbroken line");
    assert.equal(foods.length, 2);
    assert.deepEqual(foods[1], { name: "Milk", quantity: 200, unit: "ml", kcal: 100, proteinG: 7, carbsG: 10, fatG: 3.5 });
    assert.deepEqual(errors, ["Line 3: write name | quantity unit | kcal | protein | carbs | fat"]);
    assert.equal(foodsText(foods), "Oats | 60 g | 230 | 8 | 40 | 4\nMilk | 200 ml | 100 | 7 | 10 | 3.5");
    assert.equal(parseFoods("Egg | two | 70 | 6 | 0 | 5").errors.length, 1, "the quantity must be a number");
  });

  it("macros roughly match the calories within 10% (or 100 kcal)", () => {
    assert.equal(macrosRoughlyMatch(2100, { proteinG: 160, carbsG: 220, fatG: 60 }), true);
    assert.equal(macrosRoughlyMatch(2100, { proteinG: 50, carbsG: 50, fatG: 10 }), false);
  });
});
