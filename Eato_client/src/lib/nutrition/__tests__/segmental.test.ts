/// <reference types="node" />
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bodySegments, hasSegmentalData } from "../bodyComposition.ts";
import { calculateTargets } from "../calculate.ts";
import { createTargetRecord, verifyStoredRecord } from "../record.ts";
import type { BodyCompositionReport, CalculatorInput, SegmentReading, SegmentalAnalysis } from "../types.ts";

const empty: SegmentReading = { kg: null, rating: null };
const group = (overrides: Partial<Record<(typeof bodySegments)[number], SegmentReading>> = {}) =>
  Object.fromEntries(bodySegments.map((segment) => [segment, overrides[segment] ?? empty])) as SegmentalAnalysis["leanMass"];

const report = (segmental: BodyCompositionReport["segmental"]): BodyCompositionReport => ({
  id: "r1",
  source: "upload",
  testDate: "2026-10-01",
  heightCm: 172,
  age: 29,
  gender: "female",
  weightKg: 75.3,
  bodyFatMassKg: 23.7,
  percentBodyFat: 31.4,
  fatFreeMassKg: 51.6,
  skeletalMuscleMassKg: 28.7,
  printedBmrKcal: null,
  printedRecommendedIntakeKcal: null,
  segmental,
  confirmed: true,
});

describe("hasSegmentalData: when the segmental step is shown", () => {
  it("is false without a segmental analysis or with no mass in any region", () => {
    assert.equal(hasSegmentalData(report(undefined)), false);
    assert.equal(hasSegmentalData(report(null)), false);
    assert.equal(hasSegmentalData(report({ leanMass: group(), fatMass: group() })), false);
    // Ratings without a single mass don't count
    assert.equal(hasSegmentalData(report({ leanMass: group({ trunk: { kg: null, rating: "normal" } }), fatMass: group() })), false);
  });

  it("is true as soon as one region has a mass, in either analysis", () => {
    assert.equal(hasSegmentalData(report({ leanMass: group({ leftLeg: { kg: 7.9, rating: null } }), fatMass: group() })), true);
    assert.equal(hasSegmentalData(report({ leanMass: group(), fatMass: group({ trunk: { kg: 13.1, rating: "over" } }) })), true);
  });

  it("lists the five regions in display order", () => {
    assert.deepEqual(bodySegments, ["leftArm", "rightArm", "trunk", "leftLeg", "rightLeg"]);
  });
});

describe("segmental data rides inside the saved targets record", () => {
  it("a record whose report carries segmental readings still passes the verifier the server runs before saving", () => {
    const segmental: SegmentalAnalysis = { leanMass: group({ trunk: { kg: 24.4, rating: "normal" } }), fatMass: group({ trunk: { kg: 13.1, rating: "over" } }) };
    const inputs: CalculatorInput = {
      age: 29, gender: "female", heightCm: 172, weightKg: 75.3, activityLevel: "lightly_active", fitnessGoal: "fat_loss", healthFlags: [],
      bodyComposition: { ...report(segmental), confirmedAt: new Date().toISOString() },
    };
    const result = calculateTargets(inputs);
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    const record = createTargetRecord(inputs, result);
    const verified = verifyStoredRecord(JSON.parse(JSON.stringify(record)));
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    // The segmental readings are kept with the report, unchanged, and never used by the calculation
    assert.deepEqual(verified.record.inputs.bodyComposition?.segmental, segmental);
    assert.equal(result.rmrFormula, "katch_mcardle");
  });
});
