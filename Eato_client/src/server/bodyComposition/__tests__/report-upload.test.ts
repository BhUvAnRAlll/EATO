/// <reference types="node" />
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeExtraction, type RawExtraction } from "../normalize.ts";
import { checkUpload, sniffMediaType, uploadLimits } from "../upload.ts";

const toBase64 = (bytes: number[], padTo = 0) => {
  const all = new Uint8Array(Math.max(bytes.length, padTo));
  all.set(bytes);
  return Buffer.from(all).toString("base64");
};

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

describe("Upload checks (server)", () => {
  it("recognises JPEG, PNG, WebP and PDF from their bytes", () => {
    assert.equal(sniffMediaType(new Uint8Array(JPEG)), "image/jpeg");
    assert.equal(sniffMediaType(new Uint8Array(PNG)), "image/png");
    assert.equal(sniffMediaType(new Uint8Array(WEBP)), "image/webp");
    assert.equal(sniffMediaType(new Uint8Array(PDF)), "application/pdf");
    assert.equal(sniffMediaType(new Uint8Array([0x47, 0x49, 0x46, 0x38])), null); // GIF not accepted
  });

  it("accepts a valid photo", () => {
    const result = checkUpload({ data: toBase64(JPEG, 64), mediaType: "image/jpeg" });
    assert.equal(result.ok, true);
  });

  it("rejects a file whose bytes don't match its declared type", () => {
    const result = checkUpload({ data: toBase64(PDF, 64), mediaType: "image/jpeg" });
    assert.deepEqual(result.ok ? null : result.status, 415);
  });

  it("rejects unsupported files (e.g. an executable renamed to .jpg)", () => {
    const result = checkUpload({ data: toBase64([0x4d, 0x5a, 0x90, 0x00], 64), mediaType: "image/jpeg" });
    assert.deepEqual(result.ok ? null : result.status, 415);
  });

  it("rejects oversized images and PDFs", () => {
    const bigImage = checkUpload({ data: toBase64(JPEG, uploadLimits.maxImageBytes + 1), mediaType: "image/jpeg" });
    assert.deepEqual(bigImage.ok ? null : bigImage.status, 413);
    const bigPdf = checkUpload({ data: toBase64(PDF, uploadLimits.maxPdfBytes + 1), mediaType: "application/pdf" });
    assert.deepEqual(bigPdf.ok ? null : bigPdf.status, 413);
  });

  it("rejects malformed requests", () => {
    for (const body of [null, {}, { data: 1, mediaType: "image/jpeg" }, { data: "not base64!!", mediaType: "image/jpeg" }]) {
      const result = checkUpload(body);
      assert.deepEqual(result.ok ? null : result.status, 400);
    }
  });
});

// The reference InBody sheet as the model would read it
const reading: RawExtraction = {
  isBodyCompositionReport: true,
  massUnit: "kg",
  heightUnit: "cm",
  testDate: "2026-09-01",
  height: 173,
  age: 30,
  gender: "male",
  weight: 75.3,
  bodyFatMass: 23.7,
  percentBodyFat: 31.4,
  fatFreeMass: 51.6,
  skeletalMuscleMass: 28.4,
  basalMetabolicRateKcal: 1485,
  recommendedCalorieIntakeKcal: 1800,
};
const today = new Date("2026-10-11T00:00:00Z");

describe("Extraction clean-up (server)", () => {
  it("maps the reading to an UNCONFIRMED report", () => {
    const report = normalizeExtraction(reading, "r1", today);
    assert.equal(report.confirmed, false);
    assert.equal(report.source, "upload");
    assert.deepEqual(
      [report.testDate, report.heightCm, report.weightKg, report.bodyFatMassKg, report.percentBodyFat, report.fatFreeMassKg],
      ["2026-09-01", 173, 75.3, 23.7, 31.4, 51.6],
    );
    assert.equal(report.printedBmrKcal, 1485);
    assert.equal(report.printedRecommendedIntakeKcal, 1800);
  });

  it("converts pounds and inches in code (not by the model)", () => {
    const report = normalizeExtraction({ ...reading, massUnit: "lb", heightUnit: "in", weight: 166, height: 68 }, "r1", today);
    assert.equal(report.weightKg, 75.3); // 166 lb
    assert.equal(report.heightCm, 172.7); // 68 in
  });

  it("leaves mass values empty when the unit couldn't be read (no guessing)", () => {
    const report = normalizeExtraction({ ...reading, massUnit: null }, "r1", today);
    assert.equal(report.weightKg, null);
    assert.equal(report.fatFreeMassKg, null);
    assert.equal(report.percentBodyFat, 31.4); // a percentage needs no unit
  });

  it("unreadable values stay empty", () => {
    const report = normalizeExtraction({ ...reading, fatFreeMass: null, testDate: null }, "r1", today);
    assert.equal(report.fatFreeMassKg, null);
    assert.equal(report.testDate, null);
  });

  it("impossible readings (likely misread digits) become empty for the user to type", () => {
    const report = normalizeExtraction({ ...reading, weight: 753, percentBodyFat: 314, age: 300 }, "r1", today);
    assert.equal(report.weightKg, null);
    assert.equal(report.percentBodyFat, null);
    assert.equal(report.age, null);
  });

  it("rejects malformed or future test dates", () => {
    assert.equal(normalizeExtraction({ ...reading, testDate: "01/09/2026" }, "r1", today).testDate, null);
    assert.equal(normalizeExtraction({ ...reading, testDate: "2027-01-01" }, "r1", today).testDate, null);
  });
});
