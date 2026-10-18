import { calculateTargets, manualTargetMacros } from "./calculate.ts";
import { calculatorConfig, type CalculatorConfig } from "./config.ts";
import { validateInput } from "./validation.ts";
import type { CalculationSuccess, CalculatorInput, Macros, RmrFormula, TargetSource } from "./types.ts";

// What gets saved for a user: the inputs and calculation, plus the target that's
// actually in use. A trainer's target is stored separately from the calculation and
// is never overwritten by recalculating.
export type TargetRecord = {
  formula: string;
  configVersion: string;
  calculatedAt: string; // ISO timestamp
  inputs: CalculatorInput;
  // The equation's result. null when the target came from a professional/manual pathway.
  calculated: {
    rmrFormula: RmrFormula;
    // Body composition report used (Katch–McArdle only)
    report: { id: string; testDate: string } | null;
    rmr: number;
    tdee: number;
    targetCalories: number; // unrounded
    displayCalories: number;
    macros: Macros;
  } | null;
  active: {
    calories: number;
    macros: Macros;
    source: TargetSource;
    reason?: string; // why it differs from the calculation
    actor?: string; // who set it (user id or trainer id)
    updatedAt: string;
  };
};

type RecordUpdate = { ok: true; record: TargetRecord } | { ok: false; error: string };

export function createTargetRecord(
  inputs: CalculatorInput,
  result: CalculationSuccess,
  now: Date = new Date(),
  config: CalculatorConfig = calculatorConfig,
): TargetRecord {
  const at = now.toISOString();
  return {
    formula: config.formula,
    configVersion: config.version,
    calculatedAt: at,
    inputs,
    calculated: {
      rmrFormula: result.rmrFormula,
      report: result.report ? { id: result.report.id, testDate: result.report.testDate } : null,
      rmr: result.rmr,
      tdee: result.tdee,
      targetCalories: result.targetCalories,
      displayCalories: result.displayCalories,
      macros: result.macros,
    },
    active: { calories: result.displayCalories, macros: result.macros, source: "calculated", updatedAt: at },
  };
}

// Professional-guidance pathway: the user enters the target their doctor/dietitian gave
export function createManualRecord(
  inputs: CalculatorInput,
  calories: number,
  reason: string,
  actor: string,
  now: Date = new Date(),
  config: CalculatorConfig = calculatorConfig,
): RecordUpdate {
  const manual = manualTargetMacros(calories, inputs.weightKg, inputs.fitnessGoal, config);
  if (!manual.ok) return manual;
  const at = now.toISOString();
  return {
    ok: true,
    record: {
      formula: "manual",
      configVersion: config.version,
      calculatedAt: at,
      inputs,
      calculated: null,
      active: { calories, macros: manual.macros, source: "user_adjusted", reason, actor, updatedAt: at },
    },
  };
}

// The user nudges their own target. Not allowed while a trainer's target is active.
export function applyUserAdjustment(
  record: TargetRecord,
  calories: number,
  reason: string,
  actor: string,
  now: Date = new Date(),
  config: CalculatorConfig = calculatorConfig,
): RecordUpdate {
  if (record.active.source === "trainer_adjusted") {
    return { ok: false, error: "Your trainer set this target. Ask them to change it." };
  }
  const manual = manualTargetMacros(calories, record.inputs.weightKg, record.inputs.fitnessGoal, config);
  if (!manual.ok) return manual;
  return {
    ok: true,
    record: {
      ...record,
      active: { calories, macros: manual.macros, source: "user_adjusted", reason, actor, updatedAt: now.toISOString() },
    },
  };
}

// A trainer sets the target. Needs a reason and the trainer's id.
// A trainer's target. With `macros` the trainer's own grams are used as given (a trainer
// recommendation names them); without, the calculator splits the calories for the member's goal.
export function applyTrainerOverride(
  record: TargetRecord,
  calories: number,
  reason: string,
  trainerId: string,
  now: Date = new Date(),
  config: CalculatorConfig = calculatorConfig,
  macros?: Macros,
): RecordUpdate {
  if (!reason.trim()) return { ok: false, error: "A reason is required for a trainer override." };
  if (!trainerId.trim()) return { ok: false, error: "The trainer making the change must be recorded." };
  let chosen: Macros;
  if (macros) {
    const grams = [macros.proteinG, macros.carbsG, macros.fatG];
    if (!grams.every((g) => Number.isFinite(g) && g >= 0)) return { ok: false, error: "The trainer's macros must be zero or more grams." };
    if (!Number.isFinite(calories) || calories < 800 || calories > 6000) return { ok: false, error: "The trainer's calories must be between 800 and 6000." };
    chosen = { proteinG: Math.round(macros.proteinG), carbsG: Math.round(macros.carbsG), fatG: Math.round(macros.fatG) };
  } else {
    const manual = manualTargetMacros(calories, record.inputs.weightKg, record.inputs.fitnessGoal, config);
    if (!manual.ok) return manual;
    chosen = manual.macros;
  }
  return {
    ok: true,
    record: {
      ...record,
      active: {
        calories,
        macros: chosen,
        source: "trainer_adjusted",
        reason,
        actor: trainerId,
        updatedAt: now.toISOString(),
      },
    },
  };
}

// Back to the calculated target (not while a trainer's target is active)
// The way back from a trainer's target: the target the member had when they applied it
// (`saved`, kept by the server), or the calculation when there is nothing saved. A saved
// target that was itself a trainer's falls through to the calculation. resetToCalculated
// refuses while a trainer's target is active, so this is the one path out of it.
export function restorePersonalTargets(record: TargetRecord, saved: TargetRecord["active"] | null, now: Date = new Date()): RecordUpdate {
  if (record.active.source !== "trainer_adjusted") return { ok: false, error: "Your own target is already active." };
  if (saved && saved.source !== "trainer_adjusted") {
    return { ok: true, record: { ...record, active: { ...saved, updatedAt: now.toISOString() } } };
  }
  if (!record.calculated) return { ok: false, error: "There's no earlier target to go back to." };
  return {
    ok: true,
    record: {
      ...record,
      active: {
        calories: record.calculated.displayCalories,
        macros: record.calculated.macros,
        source: "calculated",
        updatedAt: now.toISOString(),
      },
    },
  };
}

export function resetToCalculated(record: TargetRecord, now: Date = new Date()): RecordUpdate {
  if (record.active.source === "trainer_adjusted") {
    return { ok: false, error: "Your trainer set this target. Ask them to change it." };
  }
  if (!record.calculated) return { ok: false, error: "This target wasn't calculated, so there's nothing to reset to." };
  return {
    ok: true,
    record: {
      ...record,
      active: {
        calories: record.calculated.displayCalories,
        macros: record.calculated.macros,
        source: "calculated",
        updatedAt: now.toISOString(),
      },
    },
  };
}

const inputLabels: Record<keyof CalculatorInput, string> = {
  age: "age",
  gender: "gender",
  equationGender: "chosen estimate",
  heightCm: "height",
  weightKg: "weight",
  activityLevel: "activity level",
  fitnessGoal: "goal",
  healthFlags: "health considerations",
  bodyComposition: "body composition report",
};

// Recalculate after profile changes and explain what changed. A trainer's target
// stays active; a user's own adjustment is replaced by the new calculation.
export function recalculateRecord(
  record: TargetRecord,
  inputs: CalculatorInput,
  now: Date = new Date(),
  config: CalculatorConfig = calculatorConfig,
):
  | { ok: true; record: TargetRecord; explanation: string[] }
  | { ok: false; result: Exclude<ReturnType<typeof calculateTargets>, CalculationSuccess> } {
  const result = calculateTargets(inputs, config, now);
  if (result.status !== "ok") return { ok: false, result };

  const changed = (Object.keys(inputLabels) as (keyof CalculatorInput)[]).filter(
    (key) => JSON.stringify(record.inputs[key]) !== JSON.stringify(inputs[key]),
  );
  const fresh = createTargetRecord(inputs, result, now, config);
  const explanation: string[] = [];
  if (changed.length > 0) {
    explanation.push(`Your ${changed.map((key) => inputLabels[key]).join(", ")} changed.`);
  }
  const before = record.calculated?.displayCalories;
  if (before !== undefined && before !== fresh.active.calories) {
    explanation.push(`Your calculated target moved from ${before} to ${fresh.active.calories} kcal.`);
  }
  if (record.calculated && record.calculated.rmrFormula !== result.rmrFormula) {
    explanation.push(result.formulaReason);
  }

  if (record.active.source === "trainer_adjusted") {
    explanation.push("Your trainer's target is still in use. They'll review the new estimate.");
    return { ok: true, record: { ...fresh, active: record.active }, explanation };
  }
  return { ok: true, record: fresh, explanation };
}

// Saved data comes from the client, so never trust its numbers: re-run the
// calculation from the saved inputs and check the stored values match.
export function verifyStoredRecord(
  stored: unknown,
  config: CalculatorConfig = calculatorConfig,
):
  | { ok: true; record: TargetRecord }
  | { ok: false; error: string }
  | { ok: false; stale: true; record: TargetRecord } {
  const record = stored as TargetRecord | null;
  if (
    !record ||
    typeof record !== "object" ||
    !record.inputs || typeof record.inputs !== "object" ||
    !record.active || typeof record.active !== "object"
  ) {
    return { ok: false, error: "No saved target." };
  }
  if (validateInput(record.inputs, config).length > 0) {
    return { ok: false, error: "The saved target has invalid inputs." };
  }
  const { min, max } = config.safety.manualTarget;
  if (!Number.isFinite(record.active.calories) || record.active.calories < min || record.active.calories > max) {
    return { ok: false, error: "The saved target is out of range." };
  }
  if (record.active.source === "calculated" && !record.calculated) {
    return { ok: false, error: "The saved target doesn't match its inputs. Please recalculate." };
  }
  if (record.configVersion !== config.version) return { ok: false, stale: true, record };

  if (record.calculated) {
    // Re-run as of the original calculation, so report expiry is judged the same way
    const result = calculateTargets(record.inputs, config, new Date(record.calculatedAt));
    if (
      result.status !== "ok" ||
      result.displayCalories !== record.calculated.displayCalories ||
      !sameMacros(record.calculated.macros, result.macros)
    ) {
      return { ok: false, error: "The saved target doesn't match its inputs. Please recalculate." };
    }
    if (record.active.source === "calculated") {
      if (record.active.calories !== result.displayCalories || !sameMacros(record.active.macros, result.macros)) {
        return { ok: false, error: "The saved target doesn't match its inputs. Please recalculate." };
      }
    }
  }
  if (record.active.source !== "calculated") {
    const expected = manualTargetMacros(record.active.calories, record.inputs.weightKg, record.inputs.fitnessGoal, config);
    if (!expected.ok || !sameMacros(record.active.macros, expected.macros)) {
      return { ok: false, error: "The saved target doesn't match its inputs. Please recalculate." };
    }
  }
  return { ok: true, record };
}

function sameMacros(stored: unknown, expected: Macros): boolean {
  if (!stored || typeof stored !== "object") return false;
  const macros = stored as Partial<Macros>;
  return (
    macros.proteinG === expected.proteinG &&
    macros.carbsG === expected.carbsG &&
    macros.fatG === expected.fatG
  );
}

export type WeighIn = { date: string; weightKg: number }; // date as YYYY-MM-DD

// Average weight per week (weeks start on Monday)
export function weeklyAverages(weighIns: WeighIn[]): { weekStart: string; averageKg: number; count: number }[] {
  const weeks = new Map<string, number[]>();
  for (const { date, weightKg } of weighIns) {
    const day = new Date(`${date}T00:00:00Z`);
    const monday = new Date(day);
    monday.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    weeks.set(key, [...(weeks.get(key) ?? []), weightKg]);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, weights]) => ({
      weekStart,
      count: weights.length,
      averageKg: Math.round((weights.reduce((sum, w) => sum + w, 0) / weights.length) * 100) / 100,
    }));
}

// Looks at weekly trends (never a single weigh-in) and suggests a review. It never
// changes the target itself.
export function recalibrationSuggestion(
  record: TargetRecord,
  weighIns: WeighIn[],
  config: CalculatorConfig = calculatorConfig,
): { status: "not_enough_data" | "on_track" | "review_suggested" | "trainer_managed"; message: string } {
  if (record.active.source === "trainer_adjusted") {
    return { status: "trainer_managed", message: "Your trainer manages your target and reviews your progress." };
  }
  const { minWeeks, minWeighInsPerWeek } = config.recalibration;
  const weeks = weeklyAverages(weighIns).filter((week) => week.count >= minWeighInsPerWeek);
  if (weeks.length < minWeeks) {
    return {
      status: "not_enough_data",
      message: `Weigh in at least ${minWeighInsPerWeek} times a week for ${minWeeks} weeks so we can see a trend.`,
    };
  }

  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const elapsedWeeks =
    (new Date(`${last.weekStart}T00:00:00Z`).getTime() - new Date(`${first.weekStart}T00:00:00Z`).getTime()) /
    (7 * 24 * 60 * 60 * 1000);
  const perWeek = (last.averageKg - first.averageKg) / elapsedWeeks;
  const goal = record.inputs.fitnessGoal;

  if (goal === "fat_loss" && perWeek > -0.1) {
    return {
      status: "review_suggested",
      message: "Your weekly average weight hasn't dropped. If you've been following your plan, it may be time to review your target.",
    };
  }
  if (goal === "fat_loss" && perWeek < -0.01 * record.inputs.weightKg) {
    return {
      status: "review_suggested",
      message: "You're losing more than 1% of your body weight a week. Consider eating a little more.",
    };
  }
  if (goal === "muscle_gain" && perWeek < 0.05) {
    return {
      status: "review_suggested",
      message: "Your weekly average weight isn't rising. If you've been following your plan, consider reviewing your target.",
    };
  }
  if ((goal === "maintenance" || goal === "healthy_eating") && Math.abs(perWeek) > 0.25) {
    return { status: "review_suggested", message: "Your weekly average weight is changing. It may be time to review your target." };
  }
  return { status: "on_track", message: "Your weekly trend matches your goal." };
}
