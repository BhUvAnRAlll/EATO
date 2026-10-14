// Upload checks and extraction clean-up (bodyComposition/): pure functions, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { normalizeExtraction } = require("../bodyComposition/normalize.js");
const { checkUpload, sniffMediaType, uploadLimits } = require("../bodyComposition/upload.js");

const toBase64 = (bytes, padTo = 0) => {
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
    assert.equal(result.ok ? null : result.status, 415);
  });

  it("rejects unsupported files (e.g. an executable renamed to .jpg)", () => {
    const result = checkUpload({ data: toBase64([0x4d, 0x5a, 0x90, 0x00], 64), mediaType: "image/jpeg" });
    assert.equal(result.ok ? null : result.status, 415);
  });

  it("rejects oversized images and PDFs", () => {
    const bigImage = checkUpload({ data: toBase64(JPEG, uploadLimits.maxImageBytes + 1), mediaType: "image/jpeg" });
    assert.equal(bigImage.ok ? null : bigImage.status, 413);
    const bigPdf = checkUpload({ data: toBase64(PDF, uploadLimits.maxPdfBytes + 1), mediaType: "application/pdf" });
    assert.equal(bigPdf.ok ? null : bigPdf.status, 413);
  });

  it("rejects malformed requests", () => {
    for (const body of [null, {}, { data: 1, mediaType: "image/jpeg" }, { data: "not base64!!", mediaType: "image/jpeg" }]) {
      const result = checkUpload(body);
      assert.equal(result.ok ? null : result.status, 400);
    }
  });
});

// The reference InBody sheet as the model would read it
const reading = {
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
  segmentalLeanMass: {
    leftArm: { mass: 2.87, rating: "normal" }, rightArm: { mass: 3.04, rating: "normal" }, trunk: { mass: 24.4, rating: "normal" },
    leftLeg: { mass: 7.88, rating: "under" }, rightLeg: { mass: 7.81, rating: "under" },
  },
  segmentalFatMass: {
    leftArm: { mass: 1.6, rating: "over" }, rightArm: { mass: 1.5, rating: "over" }, trunk: { mass: 13.1, rating: "over" },
    leftLeg: { mass: 3.1, rating: "over" }, rightLeg: { mass: 3.1, rating: "over" },
  },
};
const today = new Date("2026-10-11T00:00:00Z");
const noSegments = (rating = null) => Object.fromEntries(["leftArm", "rightArm", "trunk", "leftLeg", "rightLeg"].map((s) => [s, { mass: null, rating }]));

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

  it("keeps each segment's mass and printed rating", () => {
    const { segmental } = normalizeExtraction(reading, "r1", today);
    assert.deepEqual(segmental.leanMass.leftArm, { kg: 2.9, rating: "normal" });
    assert.deepEqual(segmental.leanMass.trunk, { kg: 24.4, rating: "normal" });
    assert.deepEqual(segmental.leanMass.rightLeg, { kg: 7.8, rating: "under" });
    assert.deepEqual(segmental.fatMass.trunk, { kg: 13.1, rating: "over" });
    assert.deepEqual(Object.keys(segmental.fatMass), ["leftArm", "rightArm", "trunk", "leftLeg", "rightLeg"]);
  });

  it("segment masses follow the sheet's unit; implausible ones and unknown ratings become empty", () => {
    const lb = normalizeExtraction({ ...reading, massUnit: "lb" }, "r1", today);
    assert.equal(lb.segmental.leanMass.trunk.kg, 11.1); // 24.4 lb
    const odd = normalizeExtraction({ ...reading, segmentalLeanMass: { ...reading.segmentalLeanMass, trunk: { mass: 244, rating: "high" } } }, "r1", today);
    assert.deepEqual(odd.segmental.leanMass.trunk, { kg: null, rating: null });
    assert.equal(normalizeExtraction({ ...reading, massUnit: null }, "r1", today).segmental, null);
  });

  it("partial segmental readings: missing regions, a mass without its rating, a rating without its mass", () => {
    const partial = normalizeExtraction({
      ...reading,
      segmentalLeanMass: { ...reading.segmentalLeanMass, rightArm: { mass: null, rating: "normal" }, leftLeg: { mass: 7.88, rating: null }, rightLeg: { mass: null, rating: null } },
      segmentalFatMass: { ...reading.segmentalFatMass, trunk: { mass: null, rating: null } },
    }, "r1", today);
    assert.deepEqual(partial.segmental.leanMass.rightArm, { kg: null, rating: "normal" }); // rating read, mass not: shown as "—"
    assert.deepEqual(partial.segmental.leanMass.leftLeg, { kg: 7.9, rating: null }); // mass read, rating not: "Not rated"
    assert.deepEqual(partial.segmental.leanMass.rightLeg, { kg: null, rating: null });
    assert.deepEqual(partial.segmental.fatMass.trunk, { kg: null, rating: null });
    assert.deepEqual(partial.segmental.leanMass.leftArm, { kg: 2.9, rating: "normal" }); // the readable ones are kept
  });

  it("ratings are only ever copied, never derived from the masses", () => {
    // A heavy trunk with no printed rating stays unrated; nothing compares masses to a range
    const report = normalizeExtraction({ ...reading, segmentalLeanMass: { ...reading.segmentalLeanMass, trunk: { mass: 40, rating: null } } }, "r1", today);
    assert.deepEqual(report.segmental.leanMass.trunk, { kg: 40, rating: null });
    // Only a rating a sheet can print is accepted
    for (const bad of ["Normal ", "high", "ok", 1, true]) {
      const odd = normalizeExtraction({ ...reading, segmentalFatMass: { ...reading.segmentalFatMass, leftArm: { mass: 1.6, rating: bad } } }, "r1", today);
      assert.equal(odd.segmental.fatMass.leftArm.rating, null, String(bad));
    }
  });

  it("a sheet without any segmental reading has no segmental analysis", () => {
    const report = normalizeExtraction({ ...reading, segmentalLeanMass: noSegments("normal"), segmentalFatMass: noSegments() }, "r1", today);
    assert.equal(report.segmental, null);
    assert.equal(normalizeExtraction({ ...reading, segmentalLeanMass: undefined, segmentalFatMass: undefined }, "r1", today).segmental, null);
    // Ratings alone (no mass anywhere) are not enough to show the step
    assert.equal(normalizeExtraction({ ...reading, segmentalLeanMass: noSegments("over"), segmentalFatMass: noSegments("under") }, "r1", today).segmental, null);
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
