/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SCAN_MAX_IMAGE_BYTES, barPosition, bodyFatCategory, changeText, estimateFieldText, photoTooLarge, rangeStatus, scanInputs, scanSexFromGender, visceralStatus, isCompleteEstimate, type BodyScanReport } from "../bodyScanRules.ts";

const profile = { heightCm: "173", weightKg: "75.3", age: "18" };

describe("photo scan inputs", () => {
  it("reads the setup answers as numbers", () => {
    assert.deepEqual(scanInputs(profile, "male"), { ok: true, inputs: { heightCm: 173, weightKg: 75.3, age: 18, sex: "male" } });
  });

  it("asks for what's missing or out of range, in the order the user can fix it", () => {
    const error = (p: Partial<typeof profile>, sex: "male" | "female" | null = "female") => {
      const result = scanInputs({ ...profile, ...p }, sex);
      return result.ok ? null : result.error;
    };
    assert.match(error({ heightCm: "" }) ?? "", /height/);
    assert.match(error({ heightCm: "99" }) ?? "", /height/);
    assert.match(error({ weightKg: "abc" }) ?? "", /weight/);
    assert.match(error({ weightKg: "301" }) ?? "", /weight/);
    assert.match(error({ age: "" }) ?? "", /date of birth/);
    assert.match(error({ age: "18.5" }) ?? "", /date of birth/);
    assert.match(error({ age: "4" }) ?? "", /date of birth/);
    assert.match(error({}, null) ?? "", /version of the model/);
  });

  it("maps the profile gender to the model's two versions, or leaves the choice open", () => {
    assert.equal(scanSexFromGender("male"), "male");
    assert.equal(scanSexFromGender("female"), "female");
    assert.equal(scanSexFromGender("other"), null);
    assert.equal(scanSexFromGender("unspecified"), null);
    assert.equal(scanSexFromGender(null), null);
  });

  it("spots a photo over the server's limit from its base64 length", () => {
    assert.equal(photoTooLarge("a".repeat(Math.floor((SCAN_MAX_IMAGE_BYTES * 4) / 3))), false);
    assert.equal(photoTooLarge("a".repeat(Math.ceil((SCAN_MAX_IMAGE_BYTES * 4) / 3) + 8)), true);
  });
});

describe("photo scan estimate text", () => {
  const report: BodyScanReport = {
    score: null, fatMassKg: null, leanMassKg: null, skeletalMuscleKg: null, bodyWaterKg: null, proteinKg: null, mineralsKg: null,
    bmi: null, waistCm: null, waistToHeight: null, visceralFatLevel: null, bmrKcal: null, dailyEnergyKcal: null, suggestedIntakeKcal: null,
    targetWeightKg: null, weightChangeKg: null, fatChangeKg: null, muscleChangeKg: null, leanByRegion: null, fatByRegion: null,
    healthy: { weightKg: [55.4, 74.5], skeletalMuscleKg: [27.8, 33.8], fatMassKg: [7.5, 15], bodyFatPercent: [10, 20], bmi: [18.5, 24.9], waistToHeight: [0.4, 0.5] },
    sex: "male", heightCm: 173, weightKg: 75, age: 30,
  };
  const estimate = { percentBodyFat: 23, report };

  it("shows a change with its sign and one decimal", () => {
    assert.equal(changeText(-10), "-10.0 kg");
    assert.equal(changeText(1.46), "+1.5 kg");
    assert.equal(changeText(0), "0.0 kg");
    assert.equal(changeText(-0.01), "0.0 kg");
  });

  it("accepts only a complete answer: an older server's bare body fat % is refused", () => {
    assert.equal(isCompleteEstimate(estimate), true);
    assert.equal(isCompleteEstimate({ percentBodyFat: 23, uncertaintyPoints: 3.4, modelVersion: "1.2.0", basis: "x" }), false);
    assert.equal(isCompleteEstimate({ percentBodyFat: 23, report: { ...report, healthy: undefined } }), false);
    assert.equal(isCompleteEstimate({ percentBodyFat: 23, report: { ...report, healthy: { ...report.healthy, bmi: [18.5] } } }), false);
    assert.equal(isCompleteEstimate({ percentBodyFat: "23", report }), false);
    assert.equal(isCompleteEstimate(null), false);
  });

  it("fills the body-fat field with one decimal and no unit", () => {
    assert.equal(estimateFieldText(estimate), "23");
    assert.equal(estimateFieldText({ ...estimate, percentBodyFat: 31.44 }), "31.4");
  });
});

describe("report graphs", () => {
  it("reads under, normal and over against a healthy range, both ends normal", () => {
    assert.equal(rangeStatus(18, [18.5, 24.9]), "under");
    assert.equal(rangeStatus(18.5, [18.5, 24.9]), "normal");
    assert.equal(rangeStatus(24.9, [18.5, 24.9]), "normal");
    assert.equal(rangeStatus(25.1, [18.5, 24.9]), "over");
  });

  it("names body fat low, healthy, elevated (up to 5 points over) or high", () => {
    assert.equal(bodyFatCategory(8, [10, 20]), "low");
    assert.equal(bodyFatCategory(20, [10, 20]), "healthy");
    assert.equal(bodyFatCategory(25, [10, 20]), "elevated");
    assert.equal(bodyFatCategory(26.3, [10, 20]), "high");
  });

  it("names the visceral fat level low under 7, high over 13", () => {
    assert.deepEqual([6, 7, 9, 13, 14].map(visceralStatus), ["low", "normal", "normal", "normal", "high"]);
  });

  it("places a value on its bar, clamped to the ends", () => {
    assert.equal(barPosition(85, 40, 130), 0.5);
    assert.equal(barPosition(10, 40, 130), 0);
    assert.equal(barPosition(200, 40, 130), 1);
    assert.equal(barPosition(NaN, 40, 130), 0);
  });
});
