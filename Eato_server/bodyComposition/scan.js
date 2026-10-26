// Estimates body fat % from a front and a side photo through the Forma scan server, a
// separate process reached at FORMA_SCAN_URL (server config, never the request). The checks
// are pure and unit-tested; the one network call takes an injectable fetch so a fake Forma
// can stand in for it. Photos pass through in memory and are never stored or logged.
const { decodeBase64, sniffMediaType } = require("./upload");

const scanLimits = {
  maxImageBytes: 5 * 1024 * 1024, // per photo; Forma downsizes anyway
  timeoutMs: 90 * 1000, // a scan takes ~3 s; Forma serves one at a time
};
// The largest body a legitimate scan needs: two photos as base64 plus the JSON around them
const MAX_SCAN_BODY_BYTES = 2 * Math.ceil(scanLimits.maxImageBytes * (4 / 3)) + 2048;

// The same ranges forma_scan.py enforces (INPUT_RANGES), so a bad value is refused here first
const inputRanges = { heightCm: [100, 250, "cm"], weightKg: [20, 300, "kg"], age: [5, 120, "years"] };
const FIELDS = new Set(["front", "side", "heightCm", "weightKg", "age", "sex", "flipSide"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);

// A failure the user can act on: `status` is the HTTP status to answer with
class ScanError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ScanError";
    this.status = status;
  }
}

const bad = (status, error) => ({ ok: false, status, error });
const label = { heightCm: "Height", weightKg: "Weight", age: "Age" };

// { front, side, heightCm, weightKg, age, sex, flipSide? } → { ok, images, inputs } or { ok: false, status, error }
function checkScanRequest(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return bad(400, "Send the scan as an object.");
  for (const key of Object.keys(body)) if (!FIELDS.has(key)) return bad(400, "The request has a field we don't expect.");

  const images = {};
  for (const view of ["front", "side"]) {
    const data = body[view];
    if (typeof data !== "string") return bad(400, `Add a ${view} photo.`);
    const bytes = decodeBase64(data);
    if (!bytes) return bad(400, `The ${view} photo couldn't be read.`);
    const mediaType = sniffMediaType(bytes);
    if (!mediaType || !IMAGE_TYPES.has(mediaType)) return bad(415, `Use a JPEG or PNG photo for the ${view} view.`);
    if (bytes.length > scanLimits.maxImageBytes) {
      return bad(413, `The ${view} photo is too large (max ${Math.round(scanLimits.maxImageBytes / 1024 / 1024)} MB).`);
    }
    images[view] = { base64: data.replace(/\s/g, ""), mediaType };
  }

  const inputs = {};
  for (const key of ["heightCm", "weightKg", "age"]) {
    const value = body[key];
    const [min, max, unit] = inputRanges[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return bad(400, `${label[key]} must be a number.`);
    if (key === "age" && !Number.isInteger(value)) return bad(400, "Age must be a whole number.");
    if (value < min || value > max) return bad(400, `${label[key]} must be between ${min} and ${max} ${unit}.`);
    inputs[key] = value;
  }
  if (body.sex !== "male" && body.sex !== "female") return bad(400, "Sex must be male or female.");
  inputs.sex = body.sex;
  if (body.flipSide !== undefined && typeof body.flipSide !== "boolean") return bad(400, "flipSide must be true or false.");
  inputs.flipSide = body.flipSide === true;

  return { ok: true, images, inputs };
}

// FORMA_SCAN_URL, cleaned: null when unset or not an http(s) URL (the route then answers 503)
function scanUrl(env = process.env) {
  const value = (env.FORMA_SCAN_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/\S+$/.test(value) ? value : null;
}

const round1 = (n) => Math.round(n * 10) / 10;

// A number from Forma inside a plausible range, rounded to one decimal; anything else is left out
function measure(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? round1(value) : null;
}

const REGIONS = ["right_arm", "left_arm", "trunk", "right_leg", "left_leg"];
const REGION_KEYS = { right_arm: "rightArm", left_arm: "leftArm", trunk: "trunk", right_leg: "rightLeg", left_leg: "leftLeg" };
const STATUSES = { under: "under", normal: "normal", over: "over" };

// Forma's per-region readings → { rightArm: { kg, status }, ... }, or null when none are usable.
// Only Under / Normal / Over are kept as a status; anything else is shown without one.
function regions(source) {
  if (!source || typeof source !== "object") return null;
  const out = {};
  let any = false;
  for (const region of REGIONS) {
    const kg = measure(source[region]?.kg, 0, 150);
    const status = STATUSES[String(source[region]?.status ?? "").toLowerCase()] ?? null;
    out[REGION_KEYS[region]] = { kg, status };
    if (kg !== null) any = true;
  }
  return any ? out : null;
}

// Forma's healthy ranges (forma_common.py), so the app shows the same verdicts as Forma's own report
const HEALTHY_BODY_FAT = { male: [10, 20], female: [18, 28] };
const MUSCLE_SHARE = { male: [0.37, 0.45], female: [0.3, 0.38] }; // skeletal muscle ÷ body weight

// The healthy range of each measure for this person: [low, high]
function healthyRanges({ heightCm, weightKg, sex }) {
  const h2 = (heightCm / 100) ** 2;
  const [fatLow, fatHigh] = HEALTHY_BODY_FAT[sex];
  const [muscleLow, muscleHigh] = MUSCLE_SHARE[sex];
  return {
    weightKg: [round1(18.5 * h2), round1(24.9 * h2)],
    skeletalMuscleKg: [round1(muscleLow * weightKg), round1(muscleHigh * weightKg)],
    fatMassKg: [round1((weightKg * fatLow) / 100), round1((weightKg * fatHigh) / 100)],
    bodyFatPercent: [fatLow, fatHigh],
    bmi: [18.5, 24.9],
    waistToHeight: [0.4, 0.5],
  };
}

// Forma's result → the body composition report the app shows. Only plain values go back:
// no model name, version, uncertainty or explanation of how the numbers were worked out.
// An implausible body fat % is refused rather than shown, since it goes into the profile.
function normalizeScan(result, inputs) {
  const percentBodyFat = measure(result?.body_fat?.pct, 2, 75);
  if (percentBodyFat === null) {
    throw new ScanError("The scan didn't produce a usable result. Please retake the photos or skip this step.", 422);
  }
  const derived = result?.derived ?? {};
  const visceral = result?.visceral_level?.value;
  const score = result?.score?.value;
  const kcal = (value) => (measure(value, 300, 10000) === null ? null : Math.round(value));
  return {
    percentBodyFat,
    report: {
      score: Number.isInteger(score) && score >= 0 && score <= 100 ? score : null,
      // Body composition
      fatMassKg: measure(derived.fat, 0, 300),
      leanMassKg: measure(derived.lean, 0, 300),
      skeletalMuscleKg: measure(derived.smm, 0, 200),
      bodyWaterKg: measure(derived.water, 0, 200),
      proteinKg: measure(derived.protein, 0, 100),
      mineralsKg: measure(derived.minerals, 0, 50),
      // Obesity measures
      bmi: measure(derived.bmi, 5, 100),
      waistCm: measure(derived.waist, 30, 250),
      waistToHeight: measure(derived.whtr, 0.2, 1.5) === null ? null : Math.round(derived.whtr * 100) / 100,
      visceralFatLevel: Number.isInteger(visceral) && visceral >= 1 && visceral <= 20 ? visceral : null,
      // Energy
      bmrKcal: kcal(derived.bmr),
      dailyEnergyKcal: kcal(derived.tdee),
      suggestedIntakeKcal: kcal(derived.intake),
      // Weight control (negative means lose)
      targetWeightKg: measure(derived.target_weight, 20, 300),
      weightChangeKg: measure(derived.weight_change, -200, 200),
      fatChangeKg: measure(derived.fat_change, -200, 200),
      muscleChangeKg: measure(derived.muscle_change, -200, 200),
      // Segmental analysis
      leanByRegion: regions(result?.segments),
      fatByRegion: regions(result?.segments_fat),
      // For this person's sex, height and weight (the same ones the scan used)
      healthy: healthyRanges(inputs),
      sex: inputs.sex,
      heightCm: inputs.heightCm,
      weightKg: inputs.weightKg,
      age: inputs.age,
    },
  };
}

// Sends the checked photos and inputs to Forma and returns the estimate. Every failure
// becomes a ScanError with a safe message; nothing about the photos is ever logged.
async function requestScan({ images, inputs }, { url = scanUrl(), fetchImpl = fetch, timeoutMs = scanLimits.timeoutMs } = {}) {
  if (!url) throw new ScanError("Body scan isn't available right now. Please try again later or skip this step.", 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${url}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        front: images.front.base64,
        side: images.side.base64,
        height_cm: inputs.heightCm,
        weight_kg: inputs.weightKg,
        age: inputs.age,
        sex: inputs.sex,
        // JustFit serves India: Forma's NHANES DXA prior reads Asian men ~1.4 points higher at the same size,
        // which removes its 1.7-point under-reading for them ("asian" includes South Asian)
        ethnicity: "asian",
        flip_side: inputs.flipSide,
        include_report: false,
      }),
    });
  } catch (error) {
    console.error(`Body scan failed: Forma unreachable (${error?.name ?? "error"})`);
    throw new ScanError("We couldn't scan your photos right now. Please try again.", 502);
  } finally {
    clearTimeout(timer);
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (response.status === 400) {
    // Forma's refusals are written for the user ("the side photo is too blurred…")
    const message = typeof result?.error === "string" && result.error.trim() ? result.error.trim().slice(0, 300) : "We couldn't read those photos. Please retake them.";
    throw new ScanError(message, 422);
  }
  if (response.status === 413) throw new ScanError("The photos are too large. Please retake them at a lower size.", 413);
  if (!response.ok || !result) {
    console.error(`Body scan failed: Forma answered ${response.status}`);
    throw new ScanError("We couldn't scan your photos right now. Please try again.", 502);
  }
  return normalizeScan(result, inputs);
}

module.exports = { scanLimits, inputRanges, MAX_SCAN_BODY_BYTES, ScanError, checkScanRequest, scanUrl, healthyRanges, normalizeScan, requestScan };
