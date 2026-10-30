import { calculatorConfig, type CalculatorConfig } from "./config.ts";
import type { ActivityLevel, Climate, HealthFlag } from "./types.ts";

export type WaterRecommendation =
  | {
      status: "ok";
      // Drinking water: plain water plus other drinks. Food adds more on top.
      drinkingWaterL: number;
      note: string;
    }
  | { status: "follow_medical_advice"; note: string };

// A starting hydration goal. Separate from calories: energy needs don't determine
// exact water needs.
export function waterRecommendation(
  params: { weightKg: number; activityLevel: ActivityLevel; climate?: Climate; healthFlags?: HealthFlag[] },
  config: CalculatorConfig = calculatorConfig,
): WaterRecommendation {
  // Some conditions need fluid limits, and pregnancy/breastfeeding change needs
  if (params.healthFlags && params.healthFlags.length > 0) {
    return {
      status: "follow_medical_advice",
      note: "Follow your doctor's advice on how much to drink. Some conditions need fluid limits.",
    };
  }

  const { water } = config;
  let ml = params.weightKg * water.mlPerKg + water.extraMlByActivity[params.activityLevel];
  if (params.climate === "hot") ml += water.extraMlHotClimate;

  const drinkingWaterL = Math.round(ml / 1000 / water.roundingL) * water.roundingL;
  return {
    status: "ok",
    drinkingWaterL: Number(drinkingWaterL.toFixed(1)),
    note: "From water and other drinks. Food adds more. Drink more in hot weather or on hard training days.",
  };
}
