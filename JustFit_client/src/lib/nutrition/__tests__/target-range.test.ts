/// <reference types="node" />
// A calculated target always lands inside the range the server saves (1000–5000 kcal), with a
// warning, so setup can finish for a very small or a very large, very active body.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateTargets } from "../calculate.ts";
import { calculatorConfig } from "../config.ts";
import { createTargetRecord, verifyStoredRecord } from "../record.ts";
import type { CalculationSuccess, CalculatorInput } from "../types.ts";

const small: CalculatorInput = { age: 50, gender: "female", heightCm: 150, weightKg: 45, activityLevel: "sedentary", fitnessGoal: "fat_loss" };
const large: CalculatorInput = { age: 20, gender: "male", heightCm: 205, weightKg: 140, activityLevel: "extra_active", fitnessGoal: "muscle_gain" };

describe("target range", () => {
  for (const [label, input, expected, words] of [
    ["a small, inactive body on fat loss is raised to the floor", small, calculatorConfig.safety.manualTarget.min, /raised to 1000 kcal/],
    ["a very large, very active body on muscle gain is capped", large, calculatorConfig.safety.manualTarget.max, /capped at 5000 kcal/],
  ] as const) {
    it(label, () => {
      const result = calculateTargets(input);
      assert.equal(result.status, "ok", JSON.stringify(result));
      const ok = result as CalculationSuccess;
      assert.equal(ok.displayCalories, expected);
      assert.ok(ok.warnings.some((w) => words.test(w)), JSON.stringify(ok.warnings));
      // The record the app saves passes the server's check (it re-runs this calculator)
      const record = createTargetRecord(input, ok);
      const verified = verifyStoredRecord(JSON.parse(JSON.stringify(record)));
      assert.equal(verified.ok, true, JSON.stringify(verified));
    });
  }
});
