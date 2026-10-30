/// <reference types="node" />
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fatFreeMassFromPbf,
  manualBodyFatReport,
  reportConsistencyIssues,
  reportStatus,
  resolveFatFreeMass,
} from "../bodyComposition.ts";
import { calculateTargets } from "../calculate.ts";
import { katchMcArdleRmr } from "../energy.ts";
import { createTargetRecord, recalculateRecord, verifyStoredRecord } from "../record.ts";
import type { BodyCompositionReport, CalculationSuccess, CalculatorInput } from "../types.ts";

const TOLERANCE = 0.01;
const near = (actual: number, expected: number, label = "") =>
  assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${label} expected ${expected}, got ${actual}`);

// Reference InBody sheet from the spec
const sheet: BodyCompositionReport = {
  id: "report-1",
  source: "upload",
  format: "inbody",
  testDate: "2026-09-01",
  heightCm: 173,
  age: 30,
  gender: null,
  weightKg: 75.3,
  bodyFatMassKg: 23.7,
  percentBodyFat: 31.4,
  fatFreeMassKg: 51.6,
  skeletalMuscleMassKg: 28.4,
  printedBmrKcal: 1485,
  printedRecommendedIntakeKcal: 1800,
  confirmed: true,
  confirmedAt: "2026-09-02T09:00:00Z",
};

// 40 days after the test date
const asOf = new Date("2026-10-11T10:00:00Z");

const input: CalculatorInput = {
  age: 30,
  gender: "unspecified", // Katch–McArdle doesn't need an equation choice
  heightCm: 173,
  weightKg: 75.3,
  activityLevel: "moderately_active",
  fitnessGoal: "fat_loss",
  bodyComposition: sheet,
};

function ok(value: Partial<CalculatorInput>, when = asOf): CalculationSuccess {
  const result = calculateTargets(value, undefined, when);
  assert.equal(result.status, "ok", JSON.stringify(result));
  return result as CalculationSuccess;
}

describe("11a. Katch–McArdle", () => {
  it("RMR = 370 + 21.6 × fat-free mass", () => {
    near(katchMcArdleRmr(51.6), 1484.56);
  });

  it("reference report (unrounded): RMR 1,484.56, TDEE 2,301.07, fat-loss target 1,901.07", () => {
    const result = ok(input);
    assert.equal(result.rmrFormula, "katch_mcardle");
    near(result.rmr, 1484.56, "RMR");
    near(result.tdee, 2301.07, "TDEE");
    near(result.targetCalories, 1901.07, "fat-loss target");
  });

  it("reference report (display): shown as 1,900", () => {
    assert.equal(ok(input).displayCalories, 1900);
  });

  it("matches the printed BMR (1,485) within tolerance", () => {
    assert.ok(Math.abs(katchMcArdleRmr(51.6) - 1485) < 1);
  });

  it("fat-free mass from weight and PBF: weight × (1 − PBF/100)", () => {
    near(fatFreeMassFromPbf(75.3, 31.4), 51.6558);
  });

  it("fat-free mass is taken from the sheet, else weight − fat mass, else weight + PBF", () => {
    assert.equal(resolveFatFreeMass(sheet), 51.6);
    near(resolveFatFreeMass({ ...sheet, fatFreeMassKg: null }) as number, 51.6);
    near(resolveFatFreeMass({ ...sheet, fatFreeMassKg: null, bodyFatMassKg: null }) as number, 51.6558);
    assert.equal(resolveFatFreeMass({ ...sheet, fatFreeMassKg: null, bodyFatMassKg: null, percentBodyFat: null }), null);
  });

  it("RMR is always recomputed from fat-free mass, never taken from the printed BMR", () => {
    // Printed BMR deliberately off by 15 (within tolerance): result still uses 370 + 21.6 × FFM
    near(ok({ ...input, bodyComposition: { ...sheet, printedBmrKcal: 1500 } }).rmr, 1484.56);
  });

  it("the sheet's 'recommended calorie intake' is never used as the target", () => {
    const result = ok({ ...input, bodyComposition: { ...sheet, printedRecommendedIntakeKcal: 3000 } });
    assert.equal(result.displayCalories, 1900);
  });

  it("explains which formula was used and why", () => {
    const result = ok(input);
    assert.match(result.formulaReason, /Katch–McArdle/);
    assert.match(result.formulaReason, /2026-09-01/);
    assert.deepEqual(result.report, { id: "report-1", testDate: "2026-09-01", fatFreeMassKg: 51.6 });
  });
});

describe("11b. Formula selection and report expiry", () => {
  const male: Partial<CalculatorInput> = { ...input, gender: "male" };

  it("no report → Mifflin–St Jeor", () => {
    const result = ok({ ...male, bodyComposition: undefined });
    assert.equal(result.rmrFormula, "mifflin_st_jeor");
    assert.match(result.formulaReason, /Mifflin–St Jeor/);
  });

  it("report exactly 90 days old is still used", () => {
    assert.equal(ok(male, new Date("2026-11-30T12:00:00Z")).rmrFormula, "katch_mcardle");
  });

  it("report older than 90 days → Mifflin–St Jeor with the latest weight, and asks for a new report", () => {
    const result = ok({ ...male, weightKg: 74 }, new Date("2026-12-01T12:00:00Z"));
    assert.equal(result.rmrFormula, "mifflin_st_jeor");
    assert.equal(result.reportExpired, true);
    assert.match(result.formulaReason, /91 days old/);
    // Mifflin–St Jeor with the latest weight (74 kg), not the report's 75.3 kg
    near(result.rmr, 10 * 74 + 6.25 * 173 - 5 * 30 + 5);
  });

  it("expired report + no equation choice → asks for the choice (never assigns one)", () => {
    const result = calculateTargets(input, undefined, new Date("2026-12-31T00:00:00Z"));
    assert.equal(result.status, "needs_equation_choice");
  });

  it("adult/health safeguards still apply with a report", () => {
    assert.equal(calculateTargets({ ...input, age: 16 }, undefined, asOf).status, "needs_professional_guidance");
    assert.equal(calculateTargets({ ...input, healthFlags: ["pregnant"] }, undefined, asOf).status, "needs_professional_guidance");
  });

  it("manual body fat % (no sheet) uses Katch–McArdle", () => {
    const report = manualBodyFatReport(80, 20, asOf); // FFM 64 kg
    const result = ok({ ...male, weightKg: 80, bodyComposition: report });
    assert.equal(result.rmrFormula, "katch_mcardle");
    near(result.rmr, 370 + 21.6 * 64);
    assert.match(result.formulaReason, /body fat %/);
  });
});

describe("11c. Consistency checks", () => {
  it("the reference sheet is consistent", () => {
    assert.deepEqual(reportConsistencyIssues(sheet), []);
    assert.equal(reportStatus(sheet, asOf).status, "usable");
  });

  it("misread fat-free mass (61.6 instead of 51.6) is flagged on the right fields", () => {
    const issues = reportConsistencyIssues({ ...sheet, fatFreeMassKg: 61.6 });
    assert.ok(issues.some((issue) => issue.fields.includes("fatFreeMassKg") && issue.fields.includes("bodyFatMassKg")));
  });

  it("misread PBF (13.4 instead of 31.4) is flagged", () => {
    const issues = reportConsistencyIssues({ ...sheet, percentBodyFat: 13.4 });
    assert.ok(issues.some((issue) => issue.fields.includes("percentBodyFat")));
  });

  it("printed BMR that doesn't match Katch–McArdle is flagged", () => {
    const issues = reportConsistencyIssues({ ...sheet, printedBmrKcal: 1585 });
    assert.ok(issues.some((issue) => issue.fields.includes("printedBmrKcal")));
  });

  it("an inconsistent report isn't used: falls back to Mifflin–St Jeor", () => {
    const report = { ...sheet, percentBodyFat: 13.4 };
    assert.equal(reportStatus(report, asOf).status, "inconsistent");
    assert.equal(ok({ ...input, gender: "male", bodyComposition: report }).rmrFormula, "mifflin_st_jeor");
  });
});

describe("11d. Unreadable and unconfirmed values", () => {
  it("unconfirmed values are never used", () => {
    const report = { ...sheet, confirmed: false };
    assert.equal(reportStatus(report, asOf).status, "unconfirmed");
    const result = ok({ ...input, gender: "male", bodyComposition: report });
    assert.equal(result.rmrFormula, "mifflin_st_jeor");
    assert.match(result.formulaReason, /isn't confirmed/);
  });

  it("unreadable weight → incomplete, asks for it", () => {
    const status = reportStatus({ ...sheet, weightKg: null }, asOf);
    assert.equal(status.status, "incomplete");
    if (status.status === "incomplete") assert.ok(status.issues.some((issue) => issue.fields.includes("weightKg")));
  });

  it("no fat-free mass, fat mass or PBF → incomplete", () => {
    const report = { ...sheet, fatFreeMassKg: null, bodyFatMassKg: null, percentBodyFat: null };
    assert.equal(reportStatus(report, asOf).status, "incomplete");
  });

  it("unreadable test date → incomplete (expiry can't be judged)", () => {
    assert.equal(reportStatus({ ...sheet, testDate: null }, asOf).status, "incomplete");
  });

  it("impossible values (PBF 95%) are rejected", () => {
    const report = { ...sheet, bodyFatMassKg: null, fatFreeMassKg: null, percentBodyFat: 95 };
    assert.equal(reportStatus(report, asOf).status, "incomplete");
  });
});

describe("11e. Saved record for the report pathway", () => {
  const result = ok(input);
  const record = createTargetRecord(input, result, asOf);

  it("records the RMR formula and the report reference + test date", () => {
    assert.equal(record.calculated?.rmrFormula, "katch_mcardle");
    assert.deepEqual(record.calculated?.report, { id: "report-1", testDate: "2026-09-01" });
    assert.equal(record.active.calories, 1900);
  });

  it("a saved record still verifies later (expiry judged as of the calculation)", () => {
    const stored = JSON.parse(JSON.stringify(record));
    assert.equal(verifyStoredRecord(stored).ok, true);
  });

  it("recalculating after the report expires switches formula and explains why", () => {
    const later = new Date("2026-12-15T10:00:00Z");
    const update = recalculateRecord(record, { ...input, gender: "male" }, later);
    assert.equal(update.ok, true);
    if (!update.ok) return;
    assert.equal(update.record.calculated?.rmrFormula, "mifflin_st_jeor");
    assert.ok(update.explanation.some((line) => /days old/.test(line)));
  });
});
