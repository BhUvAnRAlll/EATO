import { calculatorConfig, type CalculatorConfig } from "./config.ts";
import type { FitnessGoal, MacroSplit, Macros } from "./types.ts";

// Throws unless each percentage is a whole number 0–100 and they total exactly 100
export function validateMacroSplit(split: MacroSplit) {
  const parts = [split.protein, split.carbs, split.fat];
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 100)) {
    throw new Error("Macro percentages must be whole numbers from 0 to 100.");
  }
  const total = parts.reduce((sum, part) => sum + part, 0);
  if (total !== 100) throw new Error(`Macro percentages must add up to 100 (got ${total}).`);
}

/**
 * Grams of each macro from a calorie target and a whole-number percentage split.
 *   proteinG = (calories × protein / 100) / 4
 *   carbsG   = (calories × carbs   / 100) / 4
 *   fatG     = (calories × fat     / 100) / 9
 * Protein and fat are rounded to whole grams first and carbs take the remainder, so
 * the displayed grams add back up to the target (within a few kcal).
 */
export function macrosFromSplit(
  calories: number,
  split: MacroSplit,
  config: CalculatorConfig = calculatorConfig,
): Macros {
  validateMacroSplit(split);
  const { kcalPerGram } = config;
  const proteinG = Math.round((calories * split.protein) / 100 / kcalPerGram.protein);
  const fatG = Math.round((calories * split.fat) / 100 / kcalPerGram.fat);
  const carbsG = Math.max(
    0,
    Math.round((calories - proteinG * kcalPerGram.protein - fatG * kcalPerGram.fat) / kcalPerGram.carbs),
  );
  return { proteinG, carbsG, fatG };
}

// Calories supplied by a set of macros
export function macroCalories(macros: Macros, config: CalculatorConfig = calculatorConfig) {
  const { kcalPerGram } = config;
  return macros.proteinG * kcalPerGram.protein + macros.carbsG * kcalPerGram.carbs + macros.fatG * kcalPerGram.fat;
}

// Goal-appropriate split in whole-number percentages: protein from body weight
// (capped), fat from the goal rule, carbs for the rest (always totals 100).
export function goalMacroSplit(
  calories: number,
  weightKg: number,
  goal: FitnessGoal,
  config: CalculatorConfig = calculatorConfig,
): MacroSplit {
  const rule = config.macroRules[goal];
  const proteinFromWeight = Math.round(((weightKg * rule.proteinGPerKg * config.kcalPerGram.protein) / calories) * 100);
  const protein = Math.min(proteinFromWeight, rule.maxProteinPercent);
  const fat = rule.fatPercent;
  return { protein, fat, carbs: 100 - protein - fat };
}
