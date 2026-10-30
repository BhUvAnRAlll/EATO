import type { ActivityLevel, FitnessGoal } from "./types.ts";

// Every number the calculator uses lives here, so it can be tuned in one place.
// Bump `version` whenever a value changes; saved targets record which version made them.
export const calculatorConfig = {
  version: "2026-10-11.1",
  formula: "mifflin-st-jeor",

  // Inputs outside these bounds are rejected (adult pathway only)
  bounds: {
    age: { min: 18, max: 80 },
    heightCm: { min: 120, max: 230 },
    weightKg: { min: 35, max: 250 },
  },

  // Multipliers on resting energy. Each already includes typical exercise for that
  // level, so workouts must not be added on top (that would double-count).
  activityFactors: {
    sedentary: 1.2,
    lightly_active: 1.375,
    moderately_active: 1.55,
    very_active: 1.725,
    extra_active: 1.9,
  } satisfies Record<ActivityLevel, number>,

  // Daily kcal added to TDEE for each goal
  goalAdjustments: {
    fat_loss: -400,
    maintenance: 0,
    muscle_gain: 200,
    healthy_eating: 0,
  } satisfies Record<FitnessGoal, number>,

  safety: {
    // A deficit larger than this share of TDEE is reduced (with a warning)
    maxDeficitFraction: 0.2,
    // A surplus larger than this share of TDEE is reduced (with a warning)
    maxSurplusFraction: 0.15,
    // Manual and user targets outside this range need confirming
    manualTarget: { min: 1000, max: 5000 },
  },

  // Displayed targets are rounded to this; unrounded values are kept internally
  displayRoundingKcal: 50,

  // Goal-specific macro rules: protein by body weight, fat as a percentage of calories,
  // carbs make up the rest. Percentages are whole numbers (30 = 30%). Protein is
  // capped so it never crowds out carbs and fat.
  macroRules: {
    fat_loss: { proteinGPerKg: 2.0, fatPercent: 25, maxProteinPercent: 35 },
    maintenance: { proteinGPerKg: 1.6, fatPercent: 30, maxProteinPercent: 30 },
    muscle_gain: { proteinGPerKg: 1.8, fatPercent: 25, maxProteinPercent: 30 },
    healthy_eating: { proteinGPerKg: 1.4, fatPercent: 30, maxProteinPercent: 30 },
  } satisfies Record<FitnessGoal, { proteinGPerKg: number; fatPercent: number; maxProteinPercent: number }>,

  kcalPerGram: { protein: 4, carbs: 4, fat: 9 },

  // Drinking water (plain water + other drinks). Food supplies extra water on top.
  water: {
    mlPerKg: 30,
    extraMlByActivity: {
      sedentary: 0,
      lightly_active: 250,
      moderately_active: 500,
      very_active: 750,
      extra_active: 1000,
    } satisfies Record<ActivityLevel, number>,
    extraMlHotClimate: 500,
    roundingL: 0.1,
  },

  // Body composition reports (Katch–McArdle)
  bodyComposition: {
    // RMR = intercept + perKgFatFreeMass × fat-free mass (kg)
    katchMcArdle: { intercept: 370, perKgFatFreeMass: 21.6 },
    // Reports older than this fall back to Mifflin–St Jeor
    maxReportAgeDays: 90,
    bounds: { percentBodyFat: { min: 3, max: 70 } },
    // How closely the confirmed values must agree with each other
    tolerances: {
      fatFreeMassKg: 0.5, // weight − fat mass vs fat-free mass
      percentBodyFatPoints: 1, // fat mass ÷ weight × 100 vs PBF
      printedBmrKcal: 20, // printed BMR vs Katch–McArdle
    },
  },

  // Weekly trend needed before suggesting a recalibration
  recalibration: {
    minWeeks: 2,
    minWeighInsPerWeek: 3,
  },
} as const;

export type CalculatorConfig = typeof calculatorConfig;
