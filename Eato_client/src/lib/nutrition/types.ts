// Types for Eato's calorie calculator. Pure TypeScript (no React Native) so the
// logic can be unit-tested with Node's built-in test runner.

export type Gender = "male" | "female" | "other" | "unspecified";

// Mifflin–St Jeor only has male and female versions
export type EquationGender = "male" | "female";

export type ActivityLevel = "sedentary" | "lightly_active" | "moderately_active" | "very_active" | "extra_active";

export type FitnessGoal = "fat_loss" | "maintenance" | "muscle_gain" | "healthy_eating";

// Situations where an automatic target isn't appropriate without professional guidance
export type HealthFlag = "pregnant" | "breastfeeding" | "medical_condition" | "eating_disorder";

export type Climate = "temperate" | "hot";

export type RmrFormula = "mifflin_st_jeor" | "katch_mcardle";

// A body composition analysis (BCA) result, from an uploaded sheet or typed in.
// Values are null when they couldn't be read; nothing is guessed. A report is only
// used for calculation after the user has confirmed every value.
export type BodyCompositionReport = {
  id: string;
  source: "upload" | "manual";
  format?: "inbody"; // layout the values were read from (uploads only)
  testDate: string | null; // YYYY-MM-DD
  heightCm: number | null;
  age: number | null;
  gender: EquationGender | null;
  weightKg: number | null;
  bodyFatMassKg: number | null;
  percentBodyFat: number | null;
  fatFreeMassKg: number | null;
  skeletalMuscleMassKg: number | null;
  // Printed by the device. Kept for comparison only; never used as the target.
  printedBmrKcal: number | null;
  printedRecommendedIntakeKcal: number | null;
  confirmed: boolean;
  confirmedAt?: string;
};

export type CalculatorInput = {
  age: number;
  gender: Gender;
  // Needed when gender is "other"/"unspecified": the user picks which equation to use.
  // Never chosen silently.
  equationGender?: EquationGender;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  fitnessGoal: FitnessGoal;
  healthFlags?: HealthFlag[];
  // Confirmed, recent report: RMR comes from fat-free mass (Katch–McArdle)
  bodyComposition?: BodyCompositionReport;
};

export type ValidationIssue = {
  field: keyof CalculatorInput;
  message: string;
};

export type Macros = {
  proteinG: number;
  carbsG: number;
  fatG: number;
};

// Share of calories from each macro, as whole-number percentages (30 = 30%)
// that add up to exactly 100
export type MacroSplit = {
  protein: number;
  carbs: number;
  fat: number;
};

export type CalculationSuccess = {
  status: "ok";
  // All values are estimates, not measurements
  rmr: number; // resting metabolic rate, kcal/day (unrounded)
  tdee: number; // total daily energy expenditure, kcal/day (unrounded)
  targetCalories: number; // daily target (unrounded, used internally)
  displayCalories: number; // daily target rounded for display
  macros: Macros; // from displayCalories, so they reconcile with what's shown
  split: MacroSplit;
  warnings: string[];
  rmrFormula: RmrFormula;
  // Plain-language reason this formula was used (shown to the user)
  formulaReason: string;
  // Mifflin–St Jeor only
  equationGender?: EquationGender;
  // Katch–McArdle only: the report used
  report?: { id: string; testDate: string; fatFreeMassKg: number };
  // A report exists but is too old; ask for a new upload
  reportExpired?: boolean;
};

export type CalculationResult =
  | CalculationSuccess
  | { status: "invalid"; issues: ValidationIssue[] }
  // gender is other/unspecified and no equation was chosen
  | { status: "needs_equation_choice" }
  // outside the supported adult pathway or a health flag is set
  | { status: "needs_professional_guidance"; reasons: string[] };

export type TargetSource = "calculated" | "user_adjusted" | "trainer_adjusted";
