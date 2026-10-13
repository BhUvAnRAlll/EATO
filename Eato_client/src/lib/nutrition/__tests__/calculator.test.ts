/// <reference types="node" />
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateTargets, manualTargetMacros } from "../calculate.ts";
import { calculatorConfig } from "../config.ts";
import { goalTarget, mifflinStJeorRmr, roundToStep, totalDailyEnergy } from "../energy.ts";
import { goalMacroSplit, macroCalories, macrosFromSplit, validateMacroSplit } from "../macros.ts";
import type { ActivityLevel, CalculationSuccess, CalculatorInput, FitnessGoal } from "../types.ts";
import { waterRecommendation } from "../water.ts";

// Unrounded values are compared within 0.01 kcal
const TOLERANCE = 0.01;
const near = (actual: number, expected: number, label = "") =>
  assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${label} expected ${expected}, got ${actual}`);

// Reference user from the spec: 22-year-old male, 185 cm, 78 kg, moderately active
const reference: CalculatorInput = {
  age: 22,
  gender: "male",
  heightCm: 185,
  weightKg: 78,
  activityLevel: "moderately_active",
  fitnessGoal: "fat_loss",
};

function ok(input: Partial<CalculatorInput>): CalculationSuccess {
  const result = calculateTargets(input);
  assert.equal(result.status, "ok", JSON.stringify(result));
  return result as CalculationSuccess;
}

describe("1. Mifflin–St Jeor resting energy", () => {
  it("male: 10w + 6.25h − 5a + 5 = 780 + 1156.25 − 110 + 5", () => {
    near(mifflinStJeorRmr({ weightKg: 78, heightCm: 185, age: 22, gender: "male" }), 1831.25);
  });

  it("female: 10w + 6.25h − 5a − 161", () => {
    near(mifflinStJeorRmr({ weightKg: 78, heightCm: 185, age: 22, gender: "female" }), 1665.25);
  });

  it("reference user (unrounded): RMR 1,831.25, TDEE 2,838.44, fat-loss target 2,438.44", () => {
    const result = ok(reference);
    near(result.rmr, 1831.25, "RMR");
    near(result.tdee, 2838.44, "TDEE");
    near(result.targetCalories, 2438.44, "fat-loss target");
    assert.deepEqual(result.warnings, []);
  });

  it("reference user (display): fat-loss target shown as 2,450", () => {
    assert.equal(ok(reference).displayCalories, 2450);
  });
});

describe("2. Activity factors", () => {
  const factors: [ActivityLevel, number][] = [
    ["sedentary", 1.2],
    ["lightly_active", 1.375],
    ["moderately_active", 1.55],
    ["very_active", 1.725],
    ["extra_active", 1.9],
  ];
  for (const [level, factor] of factors) {
    it(`${level} × ${factor}`, () => {
      near(totalDailyEnergy(1000, level), 1000 * factor);
      near(ok({ ...reference, activityLevel: level, fitnessGoal: "maintenance" }).tdee, 1831.25 * factor);
    });
  }
});

describe("3. Fitness goals", () => {
  const tdee = 2838.4375;
  const cases: [FitnessGoal, number, number][] = [
    // goal, unrounded target, displayed (nearest 50)
    ["fat_loss", tdee - 400, 2450],
    ["maintenance", tdee, 2850],
    ["muscle_gain", tdee + 200, 3050],
    ["healthy_eating", tdee, 2850],
  ];
  for (const [goal, expected, shown] of cases) {
    it(goal, () => {
      const result = ok({ ...reference, fitnessGoal: goal });
      near(result.targetCalories, expected);
      assert.equal(result.displayCalories, shown);
    });
  }
});

describe("4. Invalid, missing and out-of-range inputs", () => {
  const invalid = (input: Partial<CalculatorInput>, field: keyof CalculatorInput) => {
    const result = calculateTargets(input);
    assert.equal(result.status, "invalid");
    if (result.status === "invalid") assert.ok(result.issues.some((issue) => issue.field === field), field);
  };

  it("missing weight", () => invalid({ ...reference, weightKg: undefined }, "weightKg"));
  it("missing height", () => invalid({ ...reference, heightCm: undefined }, "heightCm"));
  it("missing age", () => invalid({ ...reference, age: undefined }, "age"));
  it("missing activity level", () => invalid({ ...reference, activityLevel: undefined }, "activityLevel"));
  it("missing goal", () => invalid({ ...reference, fitnessGoal: undefined }, "fitnessGoal"));
  it("missing gender", () => invalid({ ...reference, gender: undefined }, "gender"));
  it("non-finite height", () => invalid({ ...reference, heightCm: Number.NaN }, "heightCm"));
  it("infinite weight", () => invalid({ ...reference, weightKg: Infinity }, "weightKg"));
  it("negative weight", () => invalid({ ...reference, weightKg: -70 }, "weightKg"));
  it("zero age", () => invalid({ ...reference, age: 0 }, "age"));
  it("fractional age", () => invalid({ ...reference, age: 22.5 }, "age"));
  it("height above bound", () => invalid({ ...reference, heightCm: 300 }, "heightCm"));
  it("weight below bound", () => invalid({ ...reference, weightKg: 20 }, "weightKg"));
  it("unknown activity level", () =>
    invalid({ ...reference, activityLevel: "couch" as ActivityLevel }, "activityLevel"));
});

describe("5. Rounding and macro reconciliation", () => {
  it("spec example: 150 g protein + 220 g carbs + 80 g fat = 600 + 880 + 720 = 2,200 kcal", () => {
    assert.equal(macroCalories({ proteinG: 150, carbsG: 220, fatG: 80 }), 2200);
  });

  it("whole-number split 27/40/33 of 2,200 kcal reconciles within 4 kcal", () => {
    const macros = macrosFromSplit(2200, { protein: 27, carbs: 40, fat: 33 });
    // protein 2200×27/100/4 = 148.5 → 149 g; fat 2200×33/100/9 = 80.7 → 81 g; carbs take the rest
    assert.deepEqual(macros, { proteinG: 149, carbsG: 219, fatG: 81 });
    assert.ok(Math.abs(macroCalories(macros) - 2200) <= 4);
  });

  it("percentages are whole numbers 0–100 totalling exactly 100", () => {
    assert.doesNotThrow(() => validateMacroSplit({ protein: 30, carbs: 40, fat: 30 }));
    assert.throws(() => validateMacroSplit({ protein: 30, carbs: 40, fat: 20 }), /add up to 100/);
    assert.throws(() => validateMacroSplit({ protein: 30, carbs: 40, fat: 31 }), /add up to 100/);
    assert.throws(() => validateMacroSplit({ protein: 27.5, carbs: 40, fat: 32.5 }), /whole numbers/);
    assert.throws(() => validateMacroSplit({ protein: 110, carbs: -20, fat: 10 }), /whole numbers/);
    assert.throws(() => macrosFromSplit(2000, { protein: 0.3, carbs: 0.4, fat: 0.3 }));
  });

  it("display rounding is to the nearest 50; internal target stays unrounded", () => {
    assert.equal(roundToStep(2438.44, 50), 2450);
    assert.equal(roundToStep(2424.99, 50), 2400);
    assert.equal(roundToStep(2425, 50), 2450);
    const result = ok(reference);
    assert.equal(result.displayCalories % 50, 0);
    assert.notEqual(result.targetCalories, result.displayCalories);
  });

  it("every goal: split is whole numbers totalling 100 and grams reconcile within 4 kcal", () => {
    for (const goal of ["fat_loss", "maintenance", "muscle_gain", "healthy_eating"] as FitnessGoal[]) {
      const result = ok({ ...reference, fitnessGoal: goal });
      assert.doesNotThrow(() => validateMacroSplit(result.split), goal);
      assert.ok(Math.abs(macroCalories(result.macros) - result.displayCalories) <= 4, goal);
    }
  });

  it("macro rules differ by goal and scale with body weight (not one ratio for everyone)", () => {
    assert.notDeepEqual(ok({ ...reference, fitnessGoal: "fat_loss" }).split, ok({ ...reference, fitnessGoal: "healthy_eating" }).split);
    assert.ok(goalMacroSplit(2500, 60, "maintenance").protein < goalMacroSplit(2500, 90, "maintenance").protein);
  });

  it("protein is capped so carbs and fat stay adequate", () => {
    // 120 kg at 2 g/kg on 1,800 kcal would be 53% protein; capped at 35%
    assert.equal(goalMacroSplit(1800, 120, "fat_loss").protein, calculatorConfig.macroRules.fat_loss.maxProteinPercent);
  });
});

describe("6. Input changes move the target in the right direction", () => {
  const base = ok({ ...reference, fitnessGoal: "maintenance" });
  it("more weight → higher", () => assert.ok(ok({ ...reference, fitnessGoal: "maintenance", weightKg: 90 }).tdee > base.tdee));
  it("more height → higher", () => assert.ok(ok({ ...reference, fitnessGoal: "maintenance", heightCm: 195 }).tdee > base.tdee));
  it("older → lower", () => assert.ok(ok({ ...reference, fitnessGoal: "maintenance", age: 40 }).tdee < base.tdee));
  it("more active → higher", () =>
    assert.ok(ok({ ...reference, fitnessGoal: "maintenance", activityLevel: "very_active" }).tdee > base.tdee));
  it("goal: fat loss < maintenance < muscle gain", () => {
    const loss = ok({ ...reference, fitnessGoal: "fat_loss" }).targetCalories;
    const gain = ok({ ...reference, fitnessGoal: "muscle_gain" }).targetCalories;
    assert.ok(loss < base.targetCalories && base.targetCalories < gain);
  });
});

describe("8. Unsupported scenarios and safety checks", () => {
  it("never picks an equation silently for other/unspecified gender", () => {
    assert.equal(calculateTargets({ ...reference, gender: "other" }).status, "needs_equation_choice");
    assert.equal(calculateTargets({ ...reference, gender: "unspecified" }).status, "needs_equation_choice");
  });

  it("uses the equation the user chose", () => {
    const chosen = ok({ ...reference, gender: "unspecified", equationGender: "female" });
    near(chosen.rmr, 1665.25);
    assert.equal(chosen.equationGender, "female");
  });

  it("under 18 → professional guidance (no adult formula)", () => {
    assert.equal(calculateTargets({ ...reference, age: 16 }).status, "needs_professional_guidance");
  });

  it("over the validated age range → professional guidance", () => {
    assert.equal(calculateTargets({ ...reference, age: 85 }).status, "needs_professional_guidance");
  });

  for (const flag of ["pregnant", "breastfeeding", "medical_condition", "eating_disorder"] as const) {
    it(`${flag} → professional guidance`, () => {
      const result = calculateTargets({ ...reference, healthFlags: [flag] });
      assert.equal(result.status, "needs_professional_guidance");
      if (result.status === "needs_professional_guidance") assert.equal(result.reasons.length, 1);
    });
  }

  it("caps an aggressive deficit at 20% of TDEE and says so", () => {
    // Small, sedentary user: TDEE ≈ 1,292, so a 400 kcal deficit would be ~31%
    const result = ok({
      age: 30,
      gender: "female",
      heightCm: 150,
      weightKg: 45,
      activityLevel: "sedentary",
      fitnessGoal: "fat_loss",
    });
    near(result.targetCalories, result.tdee * 0.8);
    assert.equal(result.warnings.length, 1);
  });

  it("caps a large surplus and says so", () => {
    const capped = goalTarget(1000, "muscle_gain"); // 15% of 1,000 = 150 < 200
    near(capped.targetCalories, 1150);
    assert.equal(capped.warnings.length, 1);
  });

  it("no universal minimum is imposed (e.g. no fixed 1,200 kcal floor)", () => {
    const result = goalTarget(1100, "maintenance");
    near(result.targetCalories, 1100);
    assert.deepEqual(result.warnings, []);
  });

  it("a deficit within 20% of TDEE is applied as configured", () => {
    const result = goalTarget(2500, "fat_loss"); // 400 = 16%
    near(result.targetCalories, 2100);
    assert.deepEqual(result.warnings, []);
  });

  it("manual targets outside the allowed range are rejected", () => {
    assert.equal(manualTargetMacros(600, 70, "maintenance").ok, false);
    assert.equal(manualTargetMacros(9000, 70, "maintenance").ok, false);
    assert.equal(manualTargetMacros(2000, 70, "maintenance").ok, true);
  });
});

describe("Water recommendation (separate from calories)", () => {
  it("weight-based drinking water plus activity", () => {
    const water = waterRecommendation({ weightKg: 78, activityLevel: "moderately_active" });
    assert.equal(water.status, "ok");
    // 78 × 30 ml + 500 ml = 2,840 ml → 2.8 L
    if (water.status === "ok") assert.equal(water.drinkingWaterL, 2.8);
  });

  it("adds more in a hot climate", () => {
    const water = waterRecommendation({ weightKg: 78, activityLevel: "moderately_active", climate: "hot" });
    if (water.status === "ok") assert.equal(water.drinkingWaterL, 3.3);
  });

  it("defers to medical advice when a health flag is set (e.g. fluid restriction)", () => {
    const water = waterRecommendation({ weightKg: 78, activityLevel: "sedentary", healthFlags: ["medical_condition"] });
    assert.equal(water.status, "follow_medical_advice");
  });

  it("goal adjustments come from the one config module", () => {
    assert.equal(calculatorConfig.goalAdjustments.fat_loss, -400);
    assert.equal(calculatorConfig.goalAdjustments.muscle_gain, 200);
  });
});
