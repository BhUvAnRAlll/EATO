/// <reference types="node" />
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateTargets } from "../calculate.ts";
import { dailyNutrition, mealNutrition, remainingNutrition, type Meal } from "../meals.ts";
import {
  applyUserAdjustment,
  createManualRecord,
  createTargetRecord,
  recalculateRecord,
  recalibrationSuggestion,
  resetToCalculated,
  verifyStoredRecord,
  weeklyAverages,
  type TargetRecord,
  type WeighIn,
} from "../record.ts";
import type { CalculationSuccess, CalculatorInput } from "../types.ts";

const inputs: CalculatorInput = {
  age: 22,
  gender: "male",
  heightCm: 185,
  weightKg: 78,
  activityLevel: "moderately_active",
  fitnessGoal: "fat_loss",
};
const now = new Date("2026-10-11T10:00:00Z");

function newRecord(): TargetRecord {
  return createTargetRecord(inputs, calculateTargets(inputs) as CalculationSuccess, now);
}

function unwrap<T extends { ok: boolean }>(update: T): Extract<T, { ok: true }> {
  assert.equal(update.ok, true, JSON.stringify(update));
  return update as Extract<T, { ok: true }>;
}

describe("7. Saved target and manual overrides", () => {
  it("records formula, config version, inputs, timestamp and the original calculation", () => {
    const record = newRecord();
    assert.equal(record.formula, "mifflin-st-jeor");
    assert.ok(record.configVersion);
    assert.equal(record.calculatedAt, now.toISOString());
    assert.deepEqual(record.inputs, inputs);
    assert.equal(record.calculated?.displayCalories, 2450);
    assert.equal(record.active.source, "calculated");
    assert.equal(record.active.calories, 2450);
  });

  it("user adjustment changes the active target but keeps the calculation", () => {
    const { record } = unwrap(applyUserAdjustment(newRecord(), 2300, "Prefer a slower start", "user_1", now));
    assert.equal(record.active.calories, 2300);
    assert.equal(record.active.source, "user_adjusted");
    assert.equal(record.active.actor, "user_1");
    assert.equal(record.calculated?.displayCalories, 2450);
  });

  it("recalculating replaces a user's own adjustment with the new calculation", () => {
    const { record } = unwrap(applyUserAdjustment(newRecord(), 2300, "slower", "user_1", now));
    const update = recalculateRecord(record, { ...inputs, activityLevel: "very_active" }, now);
    assert.equal(update.ok, true);
    if (!update.ok) return;
    assert.equal(update.record.active.source, "calculated");
    assert.ok(update.explanation.some((line) => line.includes("activity level")));
  });

  it("reset returns to the calculated target", () => {
    const { record } = unwrap(applyUserAdjustment(newRecord(), 2300, "slower", "user_1", now));
    assert.equal(unwrap(resetToCalculated(record, now)).record.active.calories, 2450);
  });

  it("manual (professional) pathway stores no calculation", () => {
    const { record } = unwrap(createManualRecord({ ...inputs, age: 16 }, 2100, "From my dietitian", "user_1", now));
    assert.equal(record.calculated, null);
    assert.equal(record.formula, "manual");
    assert.equal(record.active.calories, 2100);
  });
});

describe("Recalibration from weekly trends", () => {
  const week = (start: string, weights: number[]): WeighIn[] =>
    weights.map((weightKg, i) => {
      const date = new Date(`${start}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + i);
      return { date: date.toISOString().slice(0, 10), weightKg };
    });

  it("groups weigh-ins into Monday-start weekly averages", () => {
    const averages = weeklyAverages([...week("2026-10-05", [80, 79.8, 79.6]), ...week("2026-10-12", [79, 79.2])]);
    assert.deepEqual(
      averages.map((w) => [w.weekStart, w.averageKg, w.count]),
      [
        ["2026-10-05", 79.8, 3],
        ["2026-10-12", 79.1, 2],
      ],
    );
  });

  it("a single weigh-in never triggers a change", () => {
    const result = recalibrationSuggestion(newRecord(), [{ date: "2026-10-05", weightKg: 82 }]);
    assert.equal(result.status, "not_enough_data");
  });

  it("uses elapsed weeks when qualifying weigh-in weeks have gaps", () => {
    const result = recalibrationSuggestion(newRecord(), [
      ...week("2026-10-05", [78, 78, 78]),
      ...week("2026-11-02", [76, 76, 76]),
    ]);
    assert.equal(result.status, "on_track");
  });

  it("flat trend on fat loss suggests a review (but doesn't change the target)", () => {
    const record = newRecord();
    const result = recalibrationSuggestion(record, [...week("2026-10-05", [78, 78.1, 78]), ...week("2026-10-12", [78.1, 78, 78])]);
    assert.equal(result.status, "review_suggested");
    assert.equal(record.active.calories, 2450);
  });

  it("steady loss is on track", () => {
    const result = recalibrationSuggestion(newRecord(), [
      ...week("2026-10-05", [78, 77.9, 77.8]),
      ...week("2026-10-12", [77.5, 77.4, 77.3]),
    ]);
    assert.equal(result.status, "on_track");
  });

});

describe("9. Meal and daily nutrition totals", () => {
  const breakfast: Meal = {
    id: "m1",
    name: "Paneer bowl",
    ingredients: [
      { id: "i1", name: "Paneer", quantity: 100, unit: "g", nutrition: { calories: 265, proteinG: 18.3, carbsG: 1.2, fatG: 20.8 }, source: "test data" },
      { id: "i2", name: "Quinoa (cooked)", quantity: 150, unit: "g", nutrition: { calories: 180, proteinG: 6.6, carbsG: 32, fatG: 2.9 }, source: "test data" },
    ],
  };
  const lunch: Meal = {
    id: "m2",
    name: "Chicken salad",
    ingredients: [
      { id: "i3", name: "Chicken breast", quantity: 120, unit: "g", nutrition: { calories: 198, proteinG: 37.2, carbsG: 0, fatG: 4.3 }, source: "test data" },
      { id: "i4", name: "House dressing", quantity: 20, unit: "g", nutrition: null, source: null },
    ],
  };

  it("meal totals are the sum of its ingredients", () => {
    assert.deepEqual(mealNutrition(breakfast), {
      calories: 445,
      proteinG: 24.9,
      carbsG: 33.2,
      fatG: 23.7,
      incomplete: false,
      missing: [],
    });
  });

  it("missing ingredient data marks the estimate incomplete", () => {
    const totals = mealNutrition(lunch);
    assert.equal(totals.incomplete, true);
    assert.deepEqual(totals.missing, ["House dressing"]);
    assert.equal(totals.calories, 198);
  });

  it("daily totals sum the meals and carry the incomplete flag", () => {
    const day = dailyNutrition([breakfast, lunch]);
    assert.equal(day.calories, 643);
    assert.equal(day.proteinG, 62.1);
    assert.equal(day.incomplete, true);
  });

  it("remaining = target − eaten", () => {
    const left = remainingNutrition({ calories: 2200, proteinG: 150, carbsG: 220, fatG: 80 }, dailyNutrition([breakfast]));
    assert.deepEqual([left.calories, left.proteinG, left.carbsG, left.fatG], [1755, 125.1, 186.8, 56.3]);
  });

  it("no meals → zero totals", () => {
    assert.equal(dailyNutrition([]).calories, 0);
  });
});

describe("10. Persistence: saved data is re-checked, never trusted", () => {
  it("round-trips through JSON (as stored in the account)", () => {
    const stored = JSON.parse(JSON.stringify(newRecord()));
    const result = verifyStoredRecord(stored);
    assert.equal(result.ok, true);
  });

  it("rejects a tampered calculated target", () => {
    const stored = JSON.parse(JSON.stringify(newRecord()));
    stored.calculated.displayCalories = 4000;
    assert.equal(verifyStoredRecord(stored).ok, false);
  });

  it("rejects a 'calculated' active target that doesn't match its inputs", () => {
    const stored = JSON.parse(JSON.stringify(newRecord()));
    stored.active.calories = 3500;
    assert.equal(verifyStoredRecord(stored).ok, false);
  });

  it("rejects a calculated active target without a saved calculation", () => {
    const stored = JSON.parse(JSON.stringify(newRecord()));
    stored.calculated = null;
    const result = verifyStoredRecord(stored);
    assert.equal(result.ok, false);
    if (!result.ok && !("stale" in result)) {
      assert.equal(result.error, "The saved target doesn't match its inputs. Please recalculate.");
    }
  });

  it("rejects calculated macros that don't match the inputs", () => {
    const stored = JSON.parse(JSON.stringify(newRecord()));
    stored.calculated.macros.proteinG += 1;
    assert.equal(verifyStoredRecord(stored).ok, false);
  });

  it("rejects active macros that don't match the active target", () => {
    const stored = JSON.parse(JSON.stringify(newRecord()));
    stored.active.macros.carbsG += 1;
    assert.equal(verifyStoredRecord(stored).ok, false);
  });

  it("validates manual record inputs and macros", () => {
    const manual = unwrap(createManualRecord(inputs, 2200, "Dietitian target", "user_1", now)).record;
    const invalidInputs = JSON.parse(JSON.stringify(manual));
    invalidInputs.inputs.age = 0;
    assert.equal(verifyStoredRecord(invalidInputs).ok, false);

    const invalidMacros = JSON.parse(JSON.stringify(manual));
    invalidMacros.active.macros.fatG += 1;
    assert.equal(verifyStoredRecord(invalidMacros).ok, false);
  });

  it("returns old config records for recalculation", () => {
    const stored = JSON.parse(JSON.stringify(newRecord()));
    stored.configVersion = "previous-version";

    const verification = verifyStoredRecord(stored);
    assert.equal(verification.ok, false);
    assert.equal("stale" in verification && verification.stale, true);
    if (verification.ok || !("stale" in verification)) return;

    const recalculated = recalculateRecord(verification.record, { ...inputs, weightKg: 74 }, now);
    assert.equal(recalculated.ok, true);
    if (!recalculated.ok) return;
    assert.equal(recalculated.record.active.source, "calculated");
    assert.equal(recalculated.record.active.calories, recalculated.record.calculated?.displayCalories);
  });

  it("rejects out-of-range targets and missing data", () => {
    const stored = JSON.parse(JSON.stringify(newRecord()));
    stored.active.calories = 200;
    assert.equal(verifyStoredRecord(stored).ok, false);
    assert.equal(verifyStoredRecord(null).ok, false);
    assert.equal(verifyStoredRecord({}).ok, false);
  });
});
