import { calculatorConfig, type CalculatorConfig } from "./config.ts";
import type { ActivityLevel, EquationGender, FitnessGoal } from "./types.ts";

/**
 * Resting metabolic rate (kcal/day) with the Mifflin–St Jeor equation.
 *
 *   male:   10 × weightKg + 6.25 × heightCm − 5 × age + 5
 *   female: 10 × weightKg + 6.25 × heightCm − 5 × age − 161
 *
 * This is an ESTIMATE from a population equation, not a measurement. Individual
 * resting energy can differ noticeably.
 */
export function mifflinStJeorRmr(params: {
  weightKg: number;
  heightCm: number;
  age: number;
  gender: EquationGender;
}): number {
  const base = 10 * params.weightKg + 6.25 * params.heightCm - 5 * params.age;
  return params.gender === "male" ? base + 5 : base - 161;
}

/**
 * Resting metabolic rate (kcal/day) from fat-free mass, with the Katch–McArdle equation:
 *
 *   RMR = 370 + 21.6 × fatFreeMassKg
 *
 * Used when a confirmed body composition report is available. Works for any brand's
 * report (InBody prints this value as its BMR). Still an ESTIMATE: bioimpedance
 * results vary with hydration, meals and time of day.
 */
export function katchMcArdleRmr(fatFreeMassKg: number, config: CalculatorConfig = calculatorConfig): number {
  const { intercept, perKgFatFreeMass } = config.bodyComposition.katchMcArdle;
  return intercept + perKgFatFreeMass * fatFreeMassKg;
}

// Total daily energy expenditure: RMR × activity factor. The factor already covers
// exercise for that level, so don't add workout calories on top.
export function totalDailyEnergy(
  rmr: number,
  activityLevel: ActivityLevel,
  config: CalculatorConfig = calculatorConfig,
): number {
  return rmr * config.activityFactors[activityLevel];
}

// Daily target for the goal, with the deficit/surplus capped to a safe share of TDEE.
// Any cap is reported in `warnings` rather than applied silently.
export function goalTarget(
  tdee: number,
  goal: FitnessGoal,
  config: CalculatorConfig = calculatorConfig,
): { targetCalories: number; warnings: string[] } {
  const warnings: string[] = [];
  let adjustment: number = config.goalAdjustments[goal];

  const maxDeficit = tdee * config.safety.maxDeficitFraction;
  const maxSurplus = tdee * config.safety.maxSurplusFraction;

  if (adjustment < 0 && -adjustment > maxDeficit) {
    adjustment = -maxDeficit;
    warnings.push(
      `Your deficit was reduced to ${Math.round(maxDeficit)} kcal (${config.safety.maxDeficitFraction * 100}% of your estimated needs) to keep it safe.`,
    );
  }
  if (adjustment > 0 && adjustment > maxSurplus) {
    adjustment = maxSurplus;
    warnings.push(
      `Your surplus was reduced to ${Math.round(maxSurplus)} kcal (${config.safety.maxSurplusFraction * 100}% of your estimated needs).`,
    );
  }

  return { targetCalories: tdee + adjustment, warnings };
}

export function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}
