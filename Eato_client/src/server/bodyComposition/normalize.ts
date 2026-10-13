import type { BodyCompositionReport } from "../../lib/nutrition/types.ts";

// What the vision model returns (matches extractionSchema). Values are as printed;
// units are converted here, in code, not by the model.
export type RawExtraction = {
  isBodyCompositionReport: boolean;
  massUnit: "kg" | "lb" | null;
  heightUnit: "cm" | "in" | null;
  testDate: string | null;
  height: number | null;
  age: number | null;
  gender: "male" | "female" | null;
  weight: number | null;
  bodyFatMass: number | null;
  percentBodyFat: number | null;
  fatFreeMass: number | null;
  skeletalMuscleMass: number | null;
  basalMetabolicRateKcal: number | null;
  recommendedCalorieIntakeKcal: number | null;
};

const nullable = (type: "number" | "integer" | "string" | "boolean") => ({ anyOf: [{ type }, { type: "null" }] });

// JSON schema for structured output: every value is required but may be null
export const extractionSchema = {
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
  },
} as const;

const LB_TO_KG = 0.45359237;
const IN_TO_CM = 2.54;

const round1 = (n: number) => Math.round(n * 10) / 10;

// Keeps a value only if it's a finite number in a plausible range; otherwise null
// (the user is asked to type it). Out-of-range usually means a misread digit.
function plausible(value: number | null, min: number, max: number): number | null {
  if (value == null || !Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function validDate(value: string | null, today: Date): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time) || time > today.getTime()) return null;
  return value;
}

// Turns the model's reading into an UNCONFIRMED report for the confirmation screen
export function normalizeExtraction(raw: RawExtraction, id: string, today: Date = new Date()): BodyCompositionReport {
  // Mass values can't be converted without knowing the unit, so they stay empty
  const mass = (value: number | null) =>
    value == null || raw.massUnit == null ? null : round1(raw.massUnit === "lb" ? value * LB_TO_KG : value);
  const height =
    raw.height == null || raw.heightUnit == null ? null : round1(raw.heightUnit === "in" ? raw.height * IN_TO_CM : raw.height);

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
    confirmed: false,
  };
}
