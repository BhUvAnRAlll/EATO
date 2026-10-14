// Turns what the vision model returns (matching extractionSchema) into an UNCONFIRMED
// body composition report for the app's confirmation screen. Values are as printed;
// units are converted here, in code, not by the model.

const nullable = (type) => ({ anyOf: [{ type }, { type: "null" }] });

// The five regions of a segmental analysis, as printed on the sheet's body diagram
const SEGMENTS = ["leftArm", "rightArm", "trunk", "leftLeg", "rightLeg"];
const RATINGS = ["under", "normal", "over"];

// One segment: the printed mass and its printed rating (Under / Normal / Over)
const segmentReading = {
  type: "object",
  additionalProperties: false,
  required: ["mass", "rating"],
  properties: {
    mass: nullable("number"),
    rating: { anyOf: [{ type: "string", enum: RATINGS }, { type: "null" }] },
  },
};
const segmental = {
  type: "object",
  additionalProperties: false,
  required: SEGMENTS,
  properties: Object.fromEntries(SEGMENTS.map((segment) => [segment, segmentReading])),
};

// JSON schema for structured output: every value is required but may be null
const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "isBodyCompositionReport",
    "massUnit",
    "heightUnit",
    "testDate",
    "height",
    "age",
    "gender",
    "weight",
    "bodyFatMass",
    "percentBodyFat",
    "fatFreeMass",
    "skeletalMuscleMass",
    "basalMetabolicRateKcal",
    "recommendedCalorieIntakeKcal",
    "segmentalLeanMass",
    "segmentalFatMass",
  ],
  properties: {
    isBodyCompositionReport: { type: "boolean" },
    massUnit: { anyOf: [{ type: "string", enum: ["kg", "lb"] }, { type: "null" }] },
    heightUnit: { anyOf: [{ type: "string", enum: ["cm", "in"] }, { type: "null" }] },
    testDate: nullable("string"), // YYYY-MM-DD; checked in normalizeExtraction
    height: nullable("number"),
    age: nullable("integer"),
    gender: { anyOf: [{ type: "string", enum: ["male", "female"] }, { type: "null" }] },
    weight: nullable("number"),
    bodyFatMass: nullable("number"),
    percentBodyFat: nullable("number"),
    fatFreeMass: nullable("number"),
    skeletalMuscleMass: nullable("number"),
    basalMetabolicRateKcal: nullable("number"),
    recommendedCalorieIntakeKcal: nullable("number"),
    segmentalLeanMass: segmental,
    segmentalFatMass: segmental,
  },
};

// Plausible printed masses per segment (kg): [min, max] for lean mass and for fat
const segmentBounds = {
  lean: { leftArm: [0.5, 15], rightArm: [0.5, 15], trunk: [5, 60], leftLeg: [2, 30], rightLeg: [2, 30] },
  fat: { leftArm: [0.1, 20], rightArm: [0.1, 20], trunk: [0.5, 80], leftLeg: [0.2, 30], rightLeg: [0.2, 30] },
};

const LB_TO_KG = 0.45359237;
const IN_TO_CM = 2.54;

const round1 = (n) => Math.round(n * 10) / 10;

// Keeps a value only if it's a finite number in a plausible range; otherwise null
// (the user is asked to type it). Out-of-range usually means a misread digit.
function plausible(value, min, max) {
  if (value == null || !Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function validDate(value, today) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time) || time > today.getTime()) return null;
  return value;
}

// The model's reading → an UNCONFIRMED report (shape: BodyCompositionReport in the app)
function normalizeExtraction(raw, id, today = new Date()) {
  // Mass values can't be converted without knowing the unit, so they stay empty
  const mass = (value) => (value == null || raw.massUnit == null ? null : round1(raw.massUnit === "lb" ? value * LB_TO_KG : value));
  const height =
    raw.height == null || raw.heightUnit == null ? null : round1(raw.heightUnit === "in" ? raw.height * IN_TO_CM : raw.height);

  // Segmental analysis: each region's mass (unit-converted like every other mass) and
  // printed rating. Absent entirely when the sheet has no readable segment at all.
  const readSegments = (group, bounds) =>
    Object.fromEntries(
      SEGMENTS.map((segment) => {
        const reading = group && typeof group === "object" ? group[segment] : null;
        const [min, max] = bounds[segment];
        return [segment, { kg: plausible(mass(reading?.mass), min, max), rating: RATINGS.includes(reading?.rating) ? reading.rating : null }];
      }),
    );
  const leanMass = readSegments(raw.segmentalLeanMass, segmentBounds.lean);
  const fatMass = readSegments(raw.segmentalFatMass, segmentBounds.fat);
  const anySegment = [...Object.values(leanMass), ...Object.values(fatMass)].some((reading) => reading.kg != null);

  return {
    id,
    source: "upload",
    format: "inbody",
    testDate: validDate(raw.testDate, today),
    heightCm: plausible(height, 100, 250),
    age: raw.age != null && Number.isInteger(raw.age) ? plausible(raw.age, 5, 120) : null,
    gender: raw.gender,
    weightKg: plausible(mass(raw.weight), 20, 350),
    bodyFatMassKg: plausible(mass(raw.bodyFatMass), 0.5, 250),
    percentBodyFat: plausible(raw.percentBodyFat, 1, 80),
    fatFreeMassKg: plausible(mass(raw.fatFreeMass), 10, 200),
    skeletalMuscleMassKg: plausible(mass(raw.skeletalMuscleMass), 5, 120),
    printedBmrKcal: plausible(raw.basalMetabolicRateKcal, 500, 4000),
    printedRecommendedIntakeKcal: plausible(raw.recommendedCalorieIntakeKcal, 500, 6000),
    segmental: anySegment ? { leanMass, fatMass } : null,
    confirmed: false,
  };
}

module.exports = { extractionSchema, normalizeExtraction, SEGMENTS };
