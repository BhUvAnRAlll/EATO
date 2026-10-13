import { calculatorConfig, type CalculatorConfig } from "./config.ts";
import type { CalculatorInput, ValidationIssue } from "./types.ts";

const activityLevels = ["sedentary", "lightly_active", "moderately_active", "very_active", "extra_active"];
const fitnessGoals = ["fat_loss", "maintenance", "muscle_gain", "healthy_eating"];
const genders = ["male", "female", "other", "unspecified"];
const healthFlags = ["pregnant", "breastfeeding", "medical_condition", "eating_disorder"];

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

// Checks required fields, types and bounds. Age outside the adult range is NOT an
// error here: it routes to professional guidance in calculateTargets.
export function validateInput(
  input: Partial<CalculatorInput>,
  config: CalculatorConfig = calculatorConfig,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { bounds } = config;

  if (!isPositiveNumber(input.age) || !Number.isInteger(input.age) || input.age > 120) {
    issues.push({ field: "age", message: "Age must be a whole number of years." });
  }

  if (!isPositiveNumber(input.heightCm)) {
    issues.push({ field: "heightCm", message: "Height is required." });
  } else if (input.heightCm < bounds.heightCm.min || input.heightCm > bounds.heightCm.max) {
    issues.push({
      field: "heightCm",
      message: `Height must be between ${bounds.heightCm.min} and ${bounds.heightCm.max} cm.`,
    });
  }

  if (!isPositiveNumber(input.weightKg)) {
    issues.push({ field: "weightKg", message: "Weight is required." });
  } else if (input.weightKg < bounds.weightKg.min || input.weightKg > bounds.weightKg.max) {
    issues.push({
      field: "weightKg",
      message: `Weight must be between ${bounds.weightKg.min} and ${bounds.weightKg.max} kg.`,
    });
  }

  if (!input.gender || !genders.includes(input.gender)) {
    issues.push({ field: "gender", message: "Gender is required." });
  }
  if (input.equationGender !== undefined && !["male", "female"].includes(input.equationGender)) {
    issues.push({ field: "equationGender", message: "Choose the male or female estimate." });
  }
  if (!input.activityLevel || !activityLevels.includes(input.activityLevel)) {
    issues.push({ field: "activityLevel", message: "Activity level is required." });
  }
  if (!input.fitnessGoal || !fitnessGoals.includes(input.fitnessGoal)) {
    issues.push({ field: "fitnessGoal", message: "Goal is required." });
  }
  if (
    input.healthFlags !== undefined &&
    (!Array.isArray(input.healthFlags) || input.healthFlags.some((flag) => !healthFlags.includes(flag)))
  ) {
    issues.push({ field: "healthFlags", message: "Unknown health consideration." });
  }

  return issues;
}

// Reasons the standard adult calculation shouldn't be applied automatically
export function professionalGuidanceReasons(
  input: CalculatorInput,
  config: CalculatorConfig = calculatorConfig,
): string[] {
  const reasons: string[] = [];
  const { min, max } = config.bounds.age;

  if (input.age < min) {
    reasons.push(`Targets for people under ${min} need guidance from a doctor or dietitian, as growing bodies have different needs.`);
  } else if (input.age > max) {
    reasons.push(`The standard estimate isn't validated above age ${max}. Please get a target from a doctor or dietitian.`);
  }

  const flags = input.healthFlags ?? [];
  if (flags.includes("pregnant")) reasons.push("During pregnancy, calorie needs should be set with your doctor or midwife.");
  if (flags.includes("breastfeeding")) reasons.push("While breastfeeding, calorie needs should be set with your doctor or dietitian.");
  if (flags.includes("medical_condition")) reasons.push("With a medical condition that affects diet, please follow your doctor's or dietitian's targets.");
  if (flags.includes("eating_disorder")) reasons.push("Because of an eating disorder history, we won't set a calorie target automatically. A professional can help you set one safely.");

  return reasons;
}
