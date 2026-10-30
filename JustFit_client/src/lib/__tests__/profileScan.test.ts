// The body scan from Profile: the save it builds from the saved profile and targets
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyUserAdjustment, calculateTargets, createManualRecord, createTargetRecord, type CalculatorInput, type TargetRecord } from "../nutrition/index.ts";
import { bodyFatSave, dobFromSaved, measurementSave, scanFieldsFromSaved } from "../profileScan.ts";
import type { SavedProfile } from "../profile.ts";

const now = new Date("2026-10-25T10:00:00Z");
const saved: SavedProfile = {
  fullName: "Scan Tester", email: "scan@example.com", phone: "9876543210", role: "user", dob: "1996-04-12", gender: "male", goal: "fat_loss",
  heightCm: 173, weightKg: 75, bodyFatPercent: null, activity: "lightly_active", healthFlags: [], diet: "vegetarian", cuisines: ["South Indian"],
  dislikes: "", allergies: "", workoutFrequency: "3-4", workoutType: "gym", workoutTime: "evening", mealsPerDay: "3", profileComplete: true, updatedAt: "2026-10-20",
};
const inputs: CalculatorInput = { age: 30, gender: "male", heightCm: 173, weightKg: 75, activityLevel: "lightly_active", fitnessGoal: "fat_loss", healthFlags: [] };

function calculatedRecord(): TargetRecord {
  const result = calculateTargets(inputs, undefined, now);
  if (result.status !== "ok") throw new Error("fixture should calculate");
  return createTargetRecord(inputs, result, now);
}

describe("body scan from Profile", () => {
  it("turns the saved date of birth back into the app's format", () => {
    assert.equal(dobFromSaved("1996-04-12"), "12/04/1996");
    assert.equal(dobFromSaved("not a date"), "");
  });

  it("gives the scan screens the saved height, weight, age and gender as text", () => {
    const fields = scanFieldsFromSaved(saved);
    assert.deepEqual({ ...fields, age: undefined }, { heightCm: "173", weightKg: "75", age: undefined, gender: "male", dob: "12/04/1996" });
    assert.match(fields.age, /^\d+$/);
    assert.equal(scanFieldsFromSaved({ ...saved, heightCm: null }).heightCm, "");
  });

  it("saves the new body fat % and recalculates a calculated target with fat-free mass", () => {
    const save = bodyFatSave(saved, calculatedRecord(), 23.04, now);
    assert.ok(save.ok);
    assert.equal(save.body.profile.bodyFatPercent, "23");
    assert.equal(save.body.profile.dob, "12/04/1996");
    assert.equal(save.body.nutrition.calculated?.rmrFormula, "katch_mcardle");
    assert.equal(save.body.nutrition.active.source, "calculated");
    assert.equal(save.changes[0], "Your body fat becomes 23%.");
    assert.match(save.changes[1], /Your daily target (moves from \d+ to \d+|stays at \d+) kcal\./);
  });

  it("replaces the user's own adjustment with the new calculation, and says so", () => {
    const adjusted = applyUserAdjustment(calculatedRecord(), 1800, "Adjusted", "user_1", now);
    assert.ok(adjusted.ok);
    const save = bodyFatSave(saved, adjusted.record, 20, now);
    assert.ok(save.ok);
    assert.equal(save.body.nutrition.active.source, "calculated");
    assert.ok(save.changes.includes("Your own adjustment is replaced by the new calculation."));
  });

  it("keeps a target the user entered themselves", () => {
    const manual = createManualRecord(inputs, 1900, "Target from a health professional", "user_1", now);
    assert.ok(manual.ok);
    const save = bodyFatSave(saved, manual.record, 20, now);
    assert.ok(save.ok);
    assert.equal(save.body.nutrition.active.calories, 1900);
    assert.ok(save.changes.includes("Your own target of 1900 kcal stays as it is."));
  });


  it("refuses without a finished profile, height and weight, a date of birth, or a plausible value", () => {
    assert.equal(bodyFatSave(null, calculatedRecord(), 20, now).ok, false);
    assert.equal(bodyFatSave(saved, null, 20, now).ok, false);
    assert.equal(bodyFatSave({ ...saved, weightKg: null }, calculatedRecord(), 20, now).ok, false);
    assert.equal(bodyFatSave({ ...saved, dob: "" }, calculatedRecord(), 20, now).ok, false);
    for (const bad of [2, 71, NaN]) assert.equal(bodyFatSave(saved, calculatedRecord(), bad, now).ok, false);
  });
});

describe("editing height and weight from Profile", () => {
  it("saves a new height and weight, says what changed, and recalculates the target", () => {
    const save = measurementSave(saved, calculatedRecord(), { heightCm: 175, weightKg: 72.46 }, now);
    assert.ok(save.ok);
    assert.equal(save.body.profile.heightCm, "175");
    assert.equal(save.body.profile.weightKg, "72.5");
    assert.equal(save.body.nutrition.inputs.heightCm, 175);
    assert.equal(save.body.nutrition.inputs.weightKg, 72.5);
    assert.deepEqual(save.changes.slice(0, 2), ["Your height becomes 175 cm.", "Your weight becomes 72.5 kg."]);
    assert.match(save.changes[2], /Your daily target (moves from \d+ to \d+|stays at \d+) kcal\./);
  });

  it("only mentions what changed", () => {
    const save = measurementSave(saved, calculatedRecord(), { heightCm: 173, weightKg: 70 }, now);
    assert.ok(save.ok);
    assert.equal(save.changes[0], "Your weight becomes 70 kg.");
    assert.ok(!save.changes.some((line) => line.startsWith("Your height")));
  });

  it("re-reads a saved body fat % against the new weight (fat-free mass changes)", () => {
    const save = measurementSave({ ...saved, bodyFatPercent: 20 }, calculatedRecord(), { weightKg: 80 }, now);
    assert.ok(save.ok);
    assert.equal(save.body.profile.bodyFatPercent, "20");
    assert.equal(save.body.nutrition.inputs.bodyComposition?.weightKg, 80);
    assert.equal(save.body.nutrition.calculated?.rmrFormula, "katch_mcardle");
  });

  it("keeps a target the user entered themselves", () => {
    const manual = createManualRecord(inputs, 1900, "Target from a health professional", "user_1", now);
    assert.ok(manual.ok);
    const save = measurementSave(saved, manual.record, { weightKg: 70 }, now);
    assert.ok(save.ok);
    assert.equal(save.body.nutrition.active.calories, 1900);
  });

  it("refuses no change and values out of range", () => {
    assert.deepEqual(measurementSave(saved, calculatedRecord(), { heightCm: 173, weightKg: 75 }, now), { ok: false, error: "Nothing has changed." });
    for (const change of [{ heightCm: 99 }, { heightCm: 251 }, { weightKg: 29 }, { weightKg: 301 }, { weightKg: NaN }]) {
      assert.equal(measurementSave(saved, calculatedRecord(), change, now).ok, false, JSON.stringify(change));
    }
  });
});
