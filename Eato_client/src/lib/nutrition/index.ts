// Eato calorie calculator. All targets in the app come from here.
export { calculatorConfig } from "./config.ts";
export { calculateTargets, manualTargetMacros } from "./calculate.ts";
export { goalTarget, katchMcArdleRmr, mifflinStJeorRmr, roundToStep, totalDailyEnergy } from "./energy.ts";
export {
  fatFreeMassFromPbf,
  manualBodyFatReport,
  reportCompletenessIssues,
  reportConsistencyIssues,
  reportStatus,
  resolveFatFreeMass,
  bodySegments,
  hasSegmentalData,
} from "./bodyComposition.ts";
export { goalMacroSplit, macroCalories, macrosFromSplit, validateMacroSplit } from "./macros.ts";
export { professionalGuidanceReasons, validateInput } from "./validation.ts";
export { waterRecommendation } from "./water.ts";
export { dailyNutrition, mealNutrition, remainingNutrition } from "./meals.ts";
export {
  applyTrainerOverride,
  applyUserAdjustment,
  createManualRecord,
  createTargetRecord,
  recalculateRecord,
  recalibrationSuggestion,
  resetToCalculated,
  restorePersonalTargets,
  verifyStoredRecord,
  weeklyAverages,
} from "./record.ts";
export type * from "./types.ts";
export type { Ingredient, Meal, NutritionTotals, NutritionValues } from "./meals.ts";
export type { TargetRecord, WeighIn } from "./record.ts";
export type { WaterRecommendation } from "./water.ts";
export type { ReportIssue, ReportStatus } from "./bodyComposition.ts";
