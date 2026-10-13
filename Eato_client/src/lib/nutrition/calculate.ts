import { reportStatus } from "./bodyComposition.ts";
import { calculatorConfig, type CalculatorConfig } from "./config.ts";
import { goalTarget, katchMcArdleRmr, mifflinStJeorRmr, roundToStep, totalDailyEnergy } from "./energy.ts";
import { goalMacroSplit, macrosFromSplit } from "./macros.ts";
import { professionalGuidanceReasons, validateInput } from "./validation.ts";
import type {
  CalculationResult,
  CalculationSuccess,
  CalculatorInput,
  EquationGender,
  FitnessGoal,
  MacroSplit,
  Macros,
} from "./types.ts";

type RmrChoice = Pick<CalculationSuccess, "rmr" | "rmrFormula" | "formulaReason" | "equationGender" | "report" | "reportExpired">;

// Picks the RMR formula: Katch–McArdle from a confirmed, recent report; otherwise
// Mifflin–St Jeor. Returns null when Mifflin–St Jeor needs an equation choice first.
function chooseRmr(input: CalculatorInput, asOf: Date, config: CalculatorConfig): RmrChoice | null {
  let fallbackReason = "Estimated with the Mifflin–St Jeor formula from your age, height and weight.";
  let reportExpired = false;

  if (input.bodyComposition) {
    const report = input.bodyComposition;
    const status = reportStatus(report, asOf, config);
    if (status.status === "usable") {
      const fromSheet = report.source === "upload" ? "body composition report" : "body fat %";
      return {
        rmr: katchMcArdleRmr(status.fatFreeMassKg, config),
        rmrFormula: "katch_mcardle",
        formulaReason: `Estimated with the Katch–McArdle formula from the fat-free mass in your ${fromSheet} (${report.testDate}). Body composition readings vary with hydration, meals and time of day.`,
        report: { id: report.id, testDate: report.testDate as string, fatFreeMassKg: status.fatFreeMassKg },
      };
    }
    if (status.status === "expired") {
      reportExpired = true;
      fallbackReason = `Your body composition report is ${status.ageDays} days old (over ${config.bodyComposition.maxReportAgeDays}), so we used the Mifflin–St Jeor formula with your latest weight. Upload a new report to use your body composition again.`;
    } else {
      fallbackReason = "Your body composition report isn't confirmed yet, so we used the Mifflin–St Jeor formula.";
    }
  }

  const equationGender: EquationGender | undefined =
    input.gender === "male" || input.gender === "female" ? input.gender : input.equationGender;
  if (!equationGender) return null;

  return {
    rmr: mifflinStJeorRmr({ ...input, gender: equationGender }),
    rmrFormula: "mifflin_st_jeor",
    formulaReason: fallbackReason,
    equationGender,
    reportExpired: reportExpired || undefined,
  };
}

// The one place targets are calculated. Screens must call this, never their own maths.
// `asOf` decides whether a body composition report is still recent enough.
export function calculateTargets(
  input: Partial<CalculatorInput>,
  config: CalculatorConfig = calculatorConfig,
  asOf: Date = new Date(),
): CalculationResult {
  const issues = validateInput(input, config);
  if (issues.length > 0) return { status: "invalid", issues };
  const valid = input as CalculatorInput;

  const reasons = professionalGuidanceReasons(valid, config);
  if (reasons.length > 0) return { status: "needs_professional_guidance", reasons };

  const choice = chooseRmr(valid, asOf, config);
  if (!choice) return { status: "needs_equation_choice" };

  const tdee = totalDailyEnergy(choice.rmr, valid.activityLevel, config);
  const { targetCalories, warnings } = goalTarget(tdee, valid.fitnessGoal, config);
  const displayCalories = roundToStep(targetCalories, config.displayRoundingKcal);
  const split = goalMacroSplit(displayCalories, valid.weightKg, valid.fitnessGoal, config);
  const macros = macrosFromSplit(displayCalories, split, config);

  return { status: "ok", ...choice, tdee, targetCalories, displayCalories, macros, split, warnings };
}

// Macros for a target the user or a professional set by hand (no equation involved)
export function manualTargetMacros(
  calories: number,
  weightKg: number,
  goal: FitnessGoal,
  config: CalculatorConfig = calculatorConfig,
): { ok: true; macros: Macros; split: MacroSplit } | { ok: false; error: string } {
  const { min, max } = config.safety.manualTarget;
  if (!Number.isFinite(calories) || calories < min || calories > max) {
    return { ok: false, error: `Enter a daily target between ${min} and ${max} kcal.` };
  }
  const split = goalMacroSplit(calories, weightKg, goal, config);
  return { ok: true, split, macros: macrosFromSplit(calories, split, config) };
}
