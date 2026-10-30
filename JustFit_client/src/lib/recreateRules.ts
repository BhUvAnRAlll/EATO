// "Rebuild my plan": the draft of thirteen answers and the checks each step runs before
// Continue. Pure (no React Native imports), unit-tested in __tests__/recreateRules.test.ts.
// The messages are the workout spec's, word for word; the server checks everything again.

export type Gender = "female" | "male" | "other";
export type BodyType = "lean" | "athletic" | "average" | "overweight" | "obese";
export type RecreateGoal = "lose_weight" | "build_muscle" | "get_fitter" | "stay_healthy";
export type Pace = "slow" | "standard" | "brisk";
export type Score = 1 | 2 | 3 | 4;

export type Answers = {
  gender: Gender;
  ageYears: number;
  weightKg: number;
  heightCm: number;
  bodyType: BodyType;
  goal: RecreateGoal;
  weekdays: number[];
  pace: Pace;
  fitnessBase: Score;
  squatScore: Score;
  pushScore: Score;
  pullScore: Score;
  seriousInjury: boolean;
};

// While someone fills the form every answer may still be empty; numbers are typed text
export type Draft = {
  gender: Gender | null;
  age: string;
  weight: string;
  height: string;
  bodyType: BodyType | null;
  goal: RecreateGoal | null;
  daysPerWeek: number | null;
  weekdays: number[];
  pace: Pace | null;
  fitnessBase: Score | null;
  squatScore: Score | null;
  pushScore: Score | null;
  pullScore: Score | null;
  seriousInjury: boolean | null;
};

export type Errors = Partial<Record<keyof Draft, string>>;

export const LIMITS = { age: [13, 100], weight: [25, 300], height: [100, 250] } as const;
export const DAY_CHOICES = [3, 4, 5, 6, 7];
export const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

// Typed numbers: a comma counts as a decimal point; anything else that isn't a number is null
export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "" || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

const between = (n: number | null, [low, high]: readonly [number, number]) => n !== null && n >= low && n <= high;

export function basicsErrors(d: Draft): Errors {
  const errors: Errors = {};
  if (!d.gender) errors.gender = "Pick your gender";
  const age = parseNumber(d.age);
  if (!between(age, LIMITS.age) || !Number.isInteger(age)) errors.age = "Enter an age between 13 and 100";
  if (!between(parseNumber(d.weight), LIMITS.weight)) errors.weight = "Enter a weight between 25 and 300 kg";
  const height = parseNumber(d.height);
  if (!between(height, LIMITS.height)) errors.height = "Enter a height between 100 and 250 cm";
  if (!d.bodyType) errors.bodyType = "Pick the closest body type";
  return errors;
}

export function goalsErrors(d: Draft): Errors {
  const errors: Errors = {};
  if (!d.goal) errors.goal = "Pick a goal";
  if (!d.daysPerWeek) errors.daysPerWeek = "Pick how many days you train";
  const n = d.weekdays.length;
  if (n < 3) errors.weekdays = `Select at least 3 days (${n} chosen)`;
  else if (d.daysPerWeek && n !== d.daysPerWeek) errors.weekdays = `Select ${d.daysPerWeek} days (${n} chosen)`;
  if (!d.pace) errors.pace = "Pick a pace";
  if (!d.fitnessBase) errors.fitnessBase = "Pick the statement that fits you";
  return errors;
}

export function performanceErrors(d: Draft): Errors {
  const errors: Errors = {};
  if (!d.squatScore) errors.squatScore = "Pick a range";
  if (!d.pushScore) errors.pushScore = "Pick a range";
  if (!d.pullScore) errors.pullScore = "Pick a range";
  if (d.seriousInjury === null) errors.seriousInjury = "Answer yes or no";
  return errors;
}

// Lowering the day count keeps the first chosen weekdays (Monday first) that still fit
export function withDayCount(d: Draft, daysPerWeek: number): Draft {
  const kept = MONDAY_FIRST.filter((day) => d.weekdays.includes(day)).slice(0, daysPerWeek);
  return { ...d, daysPerWeek, weekdays: kept };
}

// Adding a weekday beyond the day count does nothing; tapping a chosen one removes it
export function toggleWeekday(d: Draft, day: number): Draft {
  if (d.weekdays.includes(day)) return { ...d, weekdays: d.weekdays.filter((x) => x !== day) };
  if (d.daysPerWeek !== null && d.weekdays.length >= d.daysPerWeek) return d;
  return { ...d, weekdays: [...d.weekdays, day] };
}

/** The draft as the server's thirteen answers, or null while any step still has an error. */
export function toAnswers(d: Draft): Answers | null {
  if (Object.keys({ ...basicsErrors(d), ...goalsErrors(d), ...performanceErrors(d) }).length > 0) return null;
  return {
    gender: d.gender as Gender,
    ageYears: parseNumber(d.age) as number,
    weightKg: Math.round((parseNumber(d.weight) as number) * 10) / 10,
    heightCm: Math.round(parseNumber(d.height) as number),
    bodyType: d.bodyType as BodyType,
    goal: d.goal as RecreateGoal,
    weekdays: MONDAY_FIRST.filter((day) => d.weekdays.includes(day)),
    pace: d.pace as Pace,
    fitnessBase: d.fitnessBase as Score,
    squatScore: d.squatScore as Score,
    pushScore: d.pushScore as Score,
    pullScore: d.pullScore as Score,
    seriousInjury: d.seriousInjury as boolean,
  };
}

// The saved answers (null where never asked) as a draft
export function draftFrom(saved: Partial<Record<keyof Answers, unknown>>): Draft {
  const weekdays = Array.isArray(saved.weekdays) ? (saved.weekdays as number[]) : [];
  const str = (v: unknown) => (typeof v === "number" ? String(v) : "");
  // The flow offers three body types; the engine's two extra ones read as the nearest card
  const body = saved.bodyType === "athletic" ? "lean" : saved.bodyType === "obese" ? "overweight" : (saved.bodyType as BodyType | null | undefined);
  return {
    gender: (saved.gender as Gender | null | undefined) ?? null,
    age: str(saved.ageYears),
    weight: str(saved.weightKg),
    height: str(saved.heightCm),
    bodyType: body ?? null,
    goal: saved.goal === "stay_healthy" ? "get_fitter" : ((saved.goal as RecreateGoal | null | undefined) ?? null),
    daysPerWeek: weekdays.length >= 3 ? weekdays.length : null,
    weekdays,
    pace: (saved.pace as Pace | null | undefined) ?? null,
    fitnessBase: (saved.fitnessBase as Score | null | undefined) ?? null,
    squatScore: (saved.squatScore as Score | null | undefined) ?? null,
    pushScore: (saved.pushScore as Score | null | undefined) ?? null,
    pullScore: (saved.pullScore as Score | null | undefined) ?? null,
    seriousInjury: typeof saved.seriousInjury === "boolean" ? saved.seriousInjury : null,
  };
}
