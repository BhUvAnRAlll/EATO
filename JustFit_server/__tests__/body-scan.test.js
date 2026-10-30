// Photo scan checks and result mapping (bodyComposition/scan.js): pure functions, with a
// fake fetch standing in for the Forma server. No network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { MAX_SCAN_BODY_BYTES, ScanError, checkScanRequest, healthyRanges, normalizeScan, requestScan, scanLimits, scanUrl } = require("../bodyComposition/scan.js");

const toBase64 = (bytes, padTo = 0) => {
  const all = new Uint8Array(Math.max(bytes.length, padTo));
  all.set(bytes);
  return Buffer.from(all).toString("base64");
};
const JPEG = toBase64([0xff, 0xd8, 0xff, 0xe0], 64);
const PNG = toBase64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 64);
const PDF = toBase64([0x25, 0x50, 0x44, 0x46, 0x2d], 64);
const WEBP = toBase64([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 64);

const valid = { front: JPEG, side: PNG, heightCm: 173, weightKg: 75.3, age: 18, sex: "male" };
const status = (body) => {
  const result = checkScanRequest(body);
  return result.ok ? 200 : result.status;
};

describe("Scan request checks (server)", () => {
  it("accepts two photos with plausible inputs", () => {
    const result = checkScanRequest({ ...valid, flipSide: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.inputs, { heightCm: 173, weightKg: 75.3, age: 18, sex: "male", flipSide: true });
    assert.equal(result.images.front.mediaType, "image/jpeg");
    assert.equal(result.images.side.mediaType, "image/png");
    assert.equal(checkScanRequest(valid).inputs.flipSide, false);
  });

  it("strips whitespace from the base64 it forwards", () => {
    const spaced = JPEG.replace(/(.{10})/g, "$1\n");
    assert.equal(checkScanRequest({ ...valid, front: spaced }).images.front.base64, JPEG);
  });

  it("rejects a missing, unreadable or non-image photo", () => {
    assert.equal(status({ ...valid, side: undefined }), 400);
    assert.equal(status({ ...valid, front: 12 }), 400);
    assert.equal(status({ ...valid, front: "not base64!!" }), 400);
    assert.equal(status({ ...valid, front: PDF }), 415);
    assert.equal(status({ ...valid, side: WEBP }), 415); // Forma takes JPEG and PNG only
    assert.equal(status({ ...valid, side: toBase64([0x4d, 0x5a, 0x90, 0x00], 64) }), 415);
  });

  it("rejects an oversized photo", () => {
    const big = toBase64([0xff, 0xd8, 0xff, 0xe0], scanLimits.maxImageBytes + 1);
    assert.equal(status({ ...valid, front: big }), 413);
    assert.equal(MAX_SCAN_BODY_BYTES, 2 * Math.ceil(scanLimits.maxImageBytes * (4 / 3)) + 2048);
  });

  it("rejects inputs outside Forma's ranges or of the wrong type", () => {
    assert.equal(status({ ...valid, heightCm: 99 }), 400);
    assert.equal(status({ ...valid, heightCm: 251 }), 400);
    assert.equal(status({ ...valid, weightKg: "75" }), 400);
    assert.equal(status({ ...valid, weightKg: Infinity }), 400);
    assert.equal(status({ ...valid, age: 18.5 }), 400);
    assert.equal(status({ ...valid, age: 4 }), 400);
    assert.equal(status({ ...valid, sex: "other" }), 400);
    assert.equal(status({ ...valid, sex: "MALE" }), 400);
    assert.equal(status({ ...valid, flipSide: "yes" }), 400);
  });

  it("rejects malformed requests and unexpected fields", () => {
    for (const body of [null, [], "x", {}, { ...valid, userId: "someone-else" }, { ...valid, include_report: true }]) {
      assert.equal(status(body), 400, JSON.stringify(body)?.slice(0, 40));
    }
  });
});

describe("Scan server address", () => {
  it("reads FORMA_SCAN_URL and refuses anything that isn't http(s)", () => {
    assert.equal(scanUrl({}), null);
    assert.equal(scanUrl({ FORMA_SCAN_URL: "  " }), null);
    assert.equal(scanUrl({ FORMA_SCAN_URL: "127.0.0.1:8765" }), null);
    assert.equal(scanUrl({ FORMA_SCAN_URL: "file:///etc/passwd" }), null);
    assert.equal(scanUrl({ FORMA_SCAN_URL: "http://127.0.0.1:8765/" }), "http://127.0.0.1:8765");
    assert.equal(scanUrl({ FORMA_SCAN_URL: " https://forma.internal " }), "https://forma.internal");
  });
});

const inputs = { heightCm: 173, weightKg: 75, age: 30, sex: "male" };
// Report fields about the person (from the request), present even when Forma's answer is bare
const PERSON_KEYS = new Set(["healthy", "sex", "heightCm", "weightKg", "age"]);
const formaResult = {
  model_version: "1.1.0",
  body_fat: { pct: 23.04, uncertainty_pct_points: 3.94, calibrated: false, basis: "model estimate from silhouettes", reference_standard: "DXA (NHANES)" },
  derived: { fat: 17.34, lean: 58.06, smm: 32.18, water: 42.5, protein: 11.1, minerals: 3.94, bmi: 24.66, waist: 89.14, whtr: 0.5153, bmr: 1612.4, tdee: 1983.56, intake: 1586.85, target_weight: 66.28, weight_change: -9.02, fat_change: -9.02, muscle_change: 0 },
  score: { value: 84, basis: "heuristic" },
  derived_basis: "population formulas",
  visceral_level: { value: 8, scale: "1-20", basis: "heuristic" },
  segments: { right_arm: { kg: 3.16, status: "Estimated" }, left_arm: { kg: 3.16, status: "Normal" }, trunk: { kg: 26.22, status: "Over" }, right_leg: { kg: 8.78, status: "Normal" }, left_leg: { kg: 8.87, status: "Under" } },
  segments_fat: { right_arm: { kg: 1.03, status: "Over" }, left_arm: { kg: 1.03, status: "Over" }, trunk: { kg: 9.7, status: "Over" }, right_leg: { kg: 3.21, status: "Over" }, left_leg: { kg: 3.24, status: "Over" } },
  disclaimer: "Photo-based estimates are not a medical measurement.",
};

describe("Scan result mapping (server)", () => {
  it("returns the body fat % and a report of plain values, rounded", () => {
    const { percentBodyFat, report } = normalizeScan(formaResult, inputs);
    assert.equal(percentBodyFat, 23);
    assert.deepEqual(
      { ...report, leanByRegion: undefined, fatByRegion: undefined, healthy: undefined, sex: undefined, heightCm: undefined, weightKg: undefined, age: undefined },
      {
        score: 84, fatMassKg: 17.3, leanMassKg: 58.1, skeletalMuscleKg: 32.2, bodyWaterKg: 42.5, proteinKg: 11.1, mineralsKg: 3.9,
        bmi: 24.7, waistCm: 89.1, waistToHeight: 0.52, visceralFatLevel: 8, bmrKcal: 1612, dailyEnergyKcal: 1984, suggestedIntakeKcal: 1587,
        targetWeightKg: 66.3, weightChangeKg: -9, fatChangeKg: -9, muscleChangeKg: 0, leanByRegion: undefined, fatByRegion: undefined,
        healthy: undefined, sex: undefined, heightCm: undefined, weightKg: undefined, age: undefined,
      },
    );
    assert.deepEqual(report.leanByRegion.trunk, { kg: 26.2, status: "over" });
    assert.deepEqual(report.leanByRegion.rightArm, { kg: 3.2, status: null }, "a status other than under/normal/over is left out");
    assert.deepEqual(report.fatByRegion.leftLeg, { kg: 3.2, status: "over" });
  });

  it("works out Forma's healthy ranges for the person (the ones on its own report)", () => {
    assert.deepEqual(healthyRanges({ heightCm: 173, weightKg: 75, sex: "male" }), {
      weightKg: [55.4, 74.5], skeletalMuscleKg: [27.8, 33.8], fatMassKg: [7.5, 15], bodyFatPercent: [10, 20], bmi: [18.5, 24.9], waistToHeight: [0.4, 0.5],
    });
    assert.deepEqual(healthyRanges({ heightCm: 160, weightKg: 60, sex: "female" }).bodyFatPercent, [18, 28]);
    assert.deepEqual(healthyRanges({ heightCm: 160, weightKg: 60, sex: "female" }).skeletalMuscleKg, [18, 22.8]);
    assert.deepEqual(normalizeScan(formaResult, inputs).report.healthy, healthyRanges(inputs));
  });

  it("sends back nothing technical: no model, version, uncertainty, basis or reference", () => {
    const sent = JSON.stringify(normalizeScan(formaResult, inputs));
    for (const word of ["model", "Forma", "1.1.0", "uncertain", "basis", "DXA", "DEXA", "NHANES", "heuristic", "formula", "±", "calibrat"]) {
      assert.ok(!sent.toLowerCase().includes(word.toLowerCase()), `the response must not mention "${word}"`);
    }
  });

  it("copes with a bare result: the report values are null", () => {
    const { percentBodyFat, report } = normalizeScan({ body_fat: { pct: 31.4 } }, inputs);
    assert.equal(percentBodyFat, 31.4);
    assert.ok(Object.entries(report).filter(([key]) => !PERSON_KEYS.has(key)).every(([, value]) => value === null));
  });

  it("drops implausible or wrongly typed report values instead of showing them", () => {
    const { report } = normalizeScan({
      body_fat: { pct: 20 },
      derived: { fat: -4, lean: "58", smm: Infinity, water: 900, protein: -1, minerals: 99, bmi: 2, waist: 5, whtr: 9, bmr: 99999, tdee: "2000", target_weight: 5, weight_change: 999, fat_change: NaN, muscle_change: "0" },
      visceral_level: { value: 25 },
      score: { value: 101 },
      segments: { trunk: { kg: "<script>", status: "<b>over</b>" } },
    }, inputs);
    assert.ok(Object.entries(report).filter(([key]) => !PERSON_KEYS.has(key)).every(([, value]) => value === null));
  });

  it("refuses an implausible or missing estimate instead of showing it", () => {
    for (const result of [{}, { body_fat: {} }, { body_fat: { pct: "23" } }, { body_fat: { pct: 1.9 } }, { body_fat: { pct: 80 } }, { body_fat: { pct: NaN } }]) {
      assert.throws(() => normalizeScan(result, inputs), (error) => error instanceof ScanError && error.status === 422);
    }
  });
});

const checked = checkScanRequest(valid);
const reply = (status, json) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => json });

describe("Scan request to Forma (server, fake fetch)", () => {
  it("answers 503 when no scan server is configured", async () => {
    await assert.rejects(requestScan(checked, { url: null }), (error) => error instanceof ScanError && error.status === 503);
  });

  it("sends Forma exactly the fields it expects, without the report", async () => {
    let sent;
    const fetchImpl = async (url, init) => {
      sent = { url, body: JSON.parse(init.body), method: init.method };
      return { ok: true, status: 200, json: async () => formaResult };
    };
    const estimate = await requestScan(checked, { url: "http://forma.test", fetchImpl });
    assert.equal(sent.url, "http://forma.test/scan");
    assert.equal(sent.method, "POST");
    assert.deepEqual(Object.keys(sent.body).sort(), ["age", "ethnicity", "flip_side", "front", "height_cm", "include_report", "sex", "side", "weight_kg"]);
    assert.equal(sent.body.include_report, false);
    assert.equal(sent.body.ethnicity, "asian", "justFit's users are in India");
    assert.equal(sent.body.front, JPEG);
    assert.equal(estimate.percentBodyFat, 23);
  });

  it("passes Forma's own refusal to the user as 422", async () => {
    const message = "The side photo is too blurred to analyse. Retake it in good light with a steady hand.";
    await assert.rejects(
      requestScan(checked, { url: "http://forma.test", fetchImpl: reply(400, { error: message }) }),
      (error) => error instanceof ScanError && error.status === 422 && error.message === message,
    );
    await assert.rejects(
      requestScan(checked, { url: "http://forma.test", fetchImpl: reply(400, {}) }),
      (error) => error.status === 422 && /retake/i.test(error.message),
    );
  });

  it("hides Forma outages and crashes behind one safe line", async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      await assert.rejects(
        requestScan(checked, { url: "http://forma.test", fetchImpl: async () => { throw new TypeError("fetch failed"); } }),
        (error) => error instanceof ScanError && error.status === 502 && !/fetch failed/.test(error.message),
      );
      await assert.rejects(
        requestScan(checked, { url: "http://forma.test", fetchImpl: reply(500, { error: "Traceback: KeyError" }) }),
        (error) => error.status === 502 && !/Traceback/.test(error.message),
      );
      await assert.rejects(
        requestScan(checked, { url: "http://forma.test", fetchImpl: reply(413, { error: "too large" }) }),
        (error) => error.status === 413,
      );
    } finally {
      console.error = quiet;
    }
  });

  it("gives up when Forma doesn't answer in time", async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      const fetchImpl = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      await assert.rejects(requestScan(checked, { url: "http://forma.test", fetchImpl, timeoutMs: 20 }), (error) => error.status === 502);
    } finally {
      console.error = quiet;
    }
  });
});
