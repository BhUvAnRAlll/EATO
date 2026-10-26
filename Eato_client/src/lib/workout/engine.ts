// The workout plan engine (ported unchanged in its rules from FORMA's convex/lib/workout.ts,
// engine version 2). Pure: no React Native or "@/" imports, no clock, no randomness, so the
// Express server can load it directly (like src/lib/nutrition) and tests can pin every rule.

import type { BodyRegion, LibraryExercise, MovementPattern } from './library.ts';

/**
 * The FORMA workout engine. Pure: no database, no clock, no randomness. The
 * same inputs and the same library snapshot always produce the same plan,
 * and every tie is broken by exercise name so results are reproducible.
 */

/** Bump when a rule changes so old plans can be told apart from new ones. */
export const ENGINE_VERSION = 2;

/** One prescribed set. The engine never sets `weightKg`; it is only echoed back from logs. */
export type WorkoutSet = { reps?: number; durationSec?: number; weightKg?: number };
export type WorkoutSection = 'warmup' | 'workout' | 'cooldown';
export type FitnessGoal = 'lose_weight' | 'build_muscle' | 'get_fitter' | 'stay_healthy';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type PlanSplit = 'auto' | 'full_body' | 'upper_lower' | 'push_pull_legs';
export type Gender = 'female' | 'male' | 'other';
export type BodyType = 'lean' | 'athletic' | 'average' | 'overweight' | 'obese';
export type Pace = 'slow' | 'standard' | 'brisk';
/** A 1-4 answer to a capability question. */
export type Score = 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Time estimate
// ---------------------------------------------------------------------------

/** A rep at a controlled tempo. Timed sets carry their own seconds. */
export const SECONDS_PER_REP = 3;
/** Walking to the station, loading it, and getting set. */
export const SETUP_SECONDS_PER_EXERCISE = 45;

export function setSeconds(set: WorkoutSet) {
  if (set.durationSec !== undefined) return set.durationSec;
  return (set.reps ?? 0) * SECONDS_PER_REP;
}

/** Work plus the rests between sets plus setup. Exercises with no sets cost nothing. */
export function exerciseSeconds(entry: { sets: WorkoutSet[]; restSec: number }) {
  if (entry.sets.length === 0) return 0;
  const work = entry.sets.reduce((sum, set) => sum + setSeconds(set), 0);
  const rest = entry.restSec * (entry.sets.length - 1);
  return work + rest + SETUP_SECONDS_PER_EXERCISE;
}

export function toMinutes(seconds: number) {
  return Math.round(seconds / 60);
}

export const SECTION_ORDER: WorkoutSection[] = ['warmup', 'workout', 'cooldown'];

// ---------------------------------------------------------------------------
// Energy estimate
// ---------------------------------------------------------------------------

/**
 * METs for resistance training, from the 2011 Compendium of Physical
 * Activities (Ainsworth et al.): 3.5 for light-to-moderate lifting, 5.0 for
 * vigorous multi-joint work, 6.0 for circuit-style whole-body training. A
 * session is placed on that scale by how much muscle it moves at once, so a
 * full-body day costs more than an isolation-heavy push or pull day.
 */
export const SESSION_MET: Record<SessionType, number> = {
  full_body: 6,
  legs: 5,
  lower: 5,
  upper: 4,
  push: 3.5,
  pull: 3.5,
};

/** Plain moderate resistance training: what a session with no type is worth. */
export const DEFAULT_MET = 3.5;

/** `sessionType` is a free string in the schema, so unknown labels fall back. */
export function metFor(sessionType: string | null | undefined) {
  if (sessionType && sessionType in SESSION_MET) return SESSION_MET[sessionType as SessionType];
  return DEFAULT_MET;
}

/**
 * The standard MET energy equation, `kcal = MET x weightKg x hours`, rounded
 * to whole kcal. Nonsense inputs (no weight, no time) burn nothing rather
 * than inventing a number.
 */
export function estimateKcal(met: number, weightKg: number, minutes: number) {
  if (met <= 0 || weightKg <= 0 || minutes <= 0) return 0;
  return Math.round((met * weightKg * minutes) / 60);
}

// ---------------------------------------------------------------------------
// Weekdays
// ---------------------------------------------------------------------------

/** Sunday-first weekday numbers, matching `Date.prototype.getDay`. */
const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;

export const MIN_DAYS_PER_WEEK = 1;
export const MAX_DAYS_PER_WEEK = 6;
/** Fewest days a member may choose by hand; the automatic spread may go lower for legacy profiles. */
export const MIN_CHOSEN_DAYS = 3;

/** Whole numbers 0-6, no repeats, at least one. Seven is allowed when chosen by hand. */
export function isValidWeekdays(weekdays: number[]) {
  if (weekdays.length < 1 || weekdays.length > 7) return false;
  if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return false;
  return new Set(weekdays).size === weekdays.length;
}

/** Monday first, Sunday last, so the week reads the way the strip shows it. */
export function sortWeekdays(weekdays: number[]) {
  return [...weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

export function clampDays(daysPerWeek: number) {
  if (!Number.isFinite(daysPerWeek)) return 3;
  return Math.min(MAX_DAYS_PER_WEEK, Math.max(MIN_DAYS_PER_WEEK, Math.round(daysPerWeek)));
}

/** Weekdays spread across the week for a frequency, with recovery days between sessions. */
export function trainingWeekdays(daysPerWeek: number): number[] {
  switch (clampDays(daysPerWeek)) {
    case 1:
      return [WED];
    case 2:
      return [TUE, THU];
    case 3:
      return [MON, WED, FRI];
    case 4:
      return [MON, TUE, THU, FRI];
    case 5:
      return [MON, TUE, WED, THU, FRI];
    default:
      return [MON, TUE, WED, THU, FRI, SAT];
  }
}

/** True when `b` is the calendar day after `a` (Sunday follows Saturday). */
export function isNextDay(a: number, b: number) {
  return (a + 1) % 7 === b;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The thirteen answers the engine reads, plus the optional split preference. */
export type PlanInputs = {
  gender: Gender;
  ageYears: number;
  weightKg: number;
  heightCm: number;
  bodyType: BodyType;
  goal: FitnessGoal;
  weekdays: number[];
  pace: Pace;
  fitnessBase: Score;
  squatScore: Score;
  pushScore: Score;
  pullScore: Score;
  seriousInjury: boolean;
  split?: PlanSplit;
};

export class PlanInputError extends Error {
  readonly field: keyof PlanInputs;

  constructor(field: keyof PlanInputs, message: string) {
    super(message);
    this.name = 'PlanInputError';
    this.field = field;
  }
}

const isScore = (n: unknown): n is Score => n === 1 || n === 2 || n === 3 || n === 4;

/** Validates and canonicalises the answers. Unknown or out-of-range values throw. */
export function normalizeInputs(raw: PlanInputs): PlanInputs {
  if (!['male', 'female', 'other'].includes(raw.gender)) throw new PlanInputError('gender', 'Pick a gender');
  if (!Number.isFinite(raw.ageYears) || raw.ageYears < 13 || raw.ageYears > 100) throw new PlanInputError('ageYears', 'Age must be between 13 and 100');
  if (!Number.isFinite(raw.weightKg) || raw.weightKg < 25 || raw.weightKg > 300) throw new PlanInputError('weightKg', 'Weight must be between 25 and 300 kg');
  if (!Number.isFinite(raw.heightCm) || raw.heightCm < 100 || raw.heightCm > 250) throw new PlanInputError('heightCm', 'Height must be between 100 and 250 cm');
  if (!['lean', 'athletic', 'average', 'overweight', 'obese'].includes(raw.bodyType)) throw new PlanInputError('bodyType', 'Pick a body type');
  if (!['lose_weight', 'build_muscle', 'get_fitter', 'stay_healthy'].includes(raw.goal)) throw new PlanInputError('goal', 'Pick a goal');
  if (!isValidWeekdays(raw.weekdays)) throw new PlanInputError('weekdays', 'Pick between one and seven different days');
  if (!['slow', 'standard', 'brisk'].includes(raw.pace)) throw new PlanInputError('pace', 'Pick a pace');
  if (!isScore(raw.fitnessBase)) throw new PlanInputError('fitnessBase', 'Pick your current fitness level');
  if (!isScore(raw.squatScore)) throw new PlanInputError('squatScore', 'Pick how many squats you can do');
  if (!isScore(raw.pushScore)) throw new PlanInputError('pushScore', 'Pick how many push-ups you can do');
  if (!isScore(raw.pullScore)) throw new PlanInputError('pullScore', 'Pick how many pull-ups you can do');
  if (typeof raw.seriousInjury !== 'boolean') throw new PlanInputError('seriousInjury', 'Answer the injury question');
  return {
    gender: raw.gender,
    ageYears: Math.round(raw.ageYears),
    weightKg: Math.round(raw.weightKg * 10) / 10,
    heightCm: Math.round(raw.heightCm),
    bodyType: raw.bodyType,
    goal: raw.goal,
    weekdays: sortWeekdays(raw.weekdays),
    pace: raw.pace,
    fitnessBase: raw.fitnessBase,
    squatScore: raw.squatScore,
    pushScore: raw.pushScore,
    pullScore: raw.pullScore,
    seriousInjury: raw.seriousInjury,
    split: raw.split ?? 'auto',
  };
}

/** Whole years between a YYYY-MM-DD birthday and a YYYY-MM-DD day. */
export function ageOn(dateOfBirth: string, today: string) {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

/** Experience answered on the old three-level onboarding, as a 1-4 fitness statement. */
export function fitnessBaseFromExperience(level: ExperienceLevel | undefined): Score {
  if (level === 'advanced') return 4;
  if (level === 'intermediate') return 3;
  if (level === 'beginner') return 1;
  return 2;
}

/**
 * The engine inputs a profile implies. Fields the member never answered fall
 * back to cautious middles, so a plan can always be built; the recreate flow
 * is where they get asked.
 */
/** The profile fields the engine reads (FORMA's names). See profile.ts for JustFit's mapping. */
export type EngineProfile = {
  gender?: Gender;
  dateOfBirth?: string;
  weightKg?: number;
  heightCm?: number;
  bodyType?: BodyType;
  goal?: FitnessGoal;
  experience?: ExperienceLevel;
  trainingWeekdays?: number[];
  daysPerWeek?: number;
  pace?: Pace;
  fitnessBase?: Score;
  squatScore?: Score;
  pushScore?: Score;
  pullScore?: Score;
  seriousInjury?: boolean;
};

export function inputsFromProfile(profile: EngineProfile, today: string, overrides: Partial<PlanInputs> = {}): PlanInputs {
  const base = profile.fitnessBase ?? fitnessBaseFromExperience(profile.experience);
  const fallbackScore: Score = base === 1 ? 2 : base === 4 ? 4 : 3;
  const raw: PlanInputs = {
    gender: profile.gender ?? 'other',
    ageYears: profile.dateOfBirth ? ageOn(profile.dateOfBirth, today) : 30,
    weightKg: profile.weightKg ?? 70,
    heightCm: profile.heightCm ?? 170,
    bodyType: profile.bodyType ?? 'average',
    goal: profile.goal ?? 'get_fitter',
    weekdays: profile.trainingWeekdays?.length ? profile.trainingWeekdays : trainingWeekdays(profile.daysPerWeek ?? 3),
    pace: profile.pace ?? 'standard',
    fitnessBase: isScore(base) ? base : 2,
    squatScore: isScore(profile.squatScore) ? profile.squatScore : fallbackScore,
    pushScore: isScore(profile.pushScore) ? profile.pushScore : fallbackScore,
    pullScore: isScore(profile.pullScore) ? profile.pullScore : fallbackScore,
    seriousInjury: profile.seriousInjury ?? false,
    split: 'auto',
    ...overrides,
  };
  return normalizeInputs(raw);
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export type PatternGroup = 'lower' | 'push' | 'pull' | 'other';
export type AgeBand = 'under18' | 'adult' | 'mid' | 'senior';

export type Calibration = {
  score: number;
  level: ExperienceLevel;
  lowerTier: 1 | 2 | 3;
  pushTier: 1 | 2 | 3;
  pullTier: 1 | 2 | 3;
  /** Highest exercise difficulty allowed per pattern group. */
  ceilings: Record<PatternGroup, 1 | 2 | 3>;
  ageBand: AgeBand;
  /** A reported serious injury: everything beginner, nothing high-risk. */
  safetyMode: boolean;
};

const LEVEL_NUMBER: Record<ExperienceLevel, 1 | 2 | 3> = { beginner: 1, intermediate: 2, advanced: 3 };

const clampLevel = (n: number): 1 | 2 | 3 => (n <= 1 ? 1 : n >= 3 ? 3 : 2);
const tierOf = (score: Score): 1 | 2 | 3 => (score <= 2 ? 1 : score === 3 ? 2 : 3);

export function ageBandOf(age: number): AgeBand {
  if (age < 18) return 'under18';
  if (age >= 60) return 'senior';
  if (age >= 45) return 'mid';
  return 'adult';
}

export const PATTERN_GROUP: Record<MovementPattern, PatternGroup> = {
  squat: 'lower',
  hinge: 'lower',
  lunge: 'lower',
  knee_flexion: 'lower',
  knee_extension: 'lower',
  calf: 'lower',
  horizontal_push: 'push',
  vertical_push: 'push',
  elbow_extension: 'push',
  shoulder_abduction: 'push',
  horizontal_pull: 'pull',
  vertical_pull: 'pull',
  elbow_flexion: 'pull',
  rear_delt: 'pull',
  core: 'other',
  conditioning: 'other',
  warmup: 'other',
  stretch: 'other',
};

/**
 * Overall level from the four capability answers, then a per-group ceiling
 * that can sit at most one step above or below it. Strong legs do not make a
 * beginner advanced; a serious injury pins everything to beginner.
 */
export function calibrate(inputs: PlanInputs): Calibration {
  const score = (inputs.fitnessBase + inputs.squatScore + inputs.pushScore + inputs.pullScore) / 4;
  const level: ExperienceLevel =
    inputs.fitnessBase === 1 || score < 2.5 ? 'beginner' : score < 3.5 ? 'intermediate' : 'advanced';
  const L = LEVEL_NUMBER[level];
  const lowerTier = tierOf(inputs.squatScore);
  const pushTier = tierOf(inputs.pushScore);
  const pullTier = tierOf(inputs.pullScore);
  const ceiling = (tier: 1 | 2 | 3) => clampLevel(L + Math.sign(tier - L));

  const ageBand = ageBandOf(inputs.ageYears);
  const safetyMode = inputs.seriousInjury;
  const cap = safetyMode ? 1 : ageBand === 'under18' || ageBand === 'senior' ? 2 : 3;
  const capped = (n: 1 | 2 | 3): 1 | 2 | 3 => (n > cap ? (cap as 1 | 2 | 3) : n);

  return {
    score,
    level: safetyMode ? 'beginner' : level,
    lowerTier,
    pushTier,
    pullTier,
    ceilings: { lower: capped(ceiling(lowerTier)), push: capped(ceiling(pushTier)), pull: capped(ceiling(pullTier)), other: capped(L) },
    ageBand,
    safetyMode,
  };
}

// ---------------------------------------------------------------------------
// Sessions and slots
// ---------------------------------------------------------------------------

export type SessionType = 'full_body' | 'upper' | 'lower' | 'push' | 'pull' | 'legs';
export type SlotRole = 'main' | 'secondary' | 'isolation' | 'conditioning';

type Slot = { patterns: MovementPattern[]; role: SlotRole; rotate?: boolean };

export const SESSION_TITLE: Record<SessionType, string> = {
  full_body: 'Full body',
  upper: 'Upper body',
  lower: 'Lower body',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
};

const TEMPLATES: Record<SessionType, Slot[]> = {
  full_body: [
    { patterns: ['squat', 'lunge'], role: 'main' },
    { patterns: ['horizontal_push'], role: 'main' },
    { patterns: ['horizontal_pull', 'vertical_pull'], role: 'main' },
    { patterns: ['hinge'], role: 'secondary' },
    { patterns: ['shoulder_abduction', 'elbow_flexion', 'elbow_extension'], role: 'isolation', rotate: true },
    { patterns: ['core'], role: 'isolation' },
  ],
  upper: [
    { patterns: ['horizontal_push'], role: 'main' },
    { patterns: ['horizontal_pull'], role: 'main' },
    { patterns: ['vertical_push'], role: 'secondary' },
    { patterns: ['vertical_pull'], role: 'secondary' },
    { patterns: ['elbow_flexion'], role: 'isolation' },
    { patterns: ['elbow_extension'], role: 'isolation' },
  ],
  lower: [
    { patterns: ['squat'], role: 'main' },
    { patterns: ['hinge'], role: 'main' },
    { patterns: ['lunge'], role: 'secondary' },
    { patterns: ['knee_flexion'], role: 'isolation' },
    { patterns: ['calf'], role: 'isolation' },
    { patterns: ['core'], role: 'isolation' },
  ],
  legs: [
    { patterns: ['squat'], role: 'main' },
    { patterns: ['hinge'], role: 'main' },
    { patterns: ['lunge'], role: 'secondary' },
    { patterns: ['knee_flexion'], role: 'isolation' },
    { patterns: ['calf'], role: 'isolation' },
    { patterns: ['core'], role: 'isolation' },
  ],
  push: [
    { patterns: ['horizontal_push'], role: 'main' },
    { patterns: ['vertical_push'], role: 'secondary' },
    { patterns: ['horizontal_push'], role: 'secondary' },
    { patterns: ['shoulder_abduction'], role: 'isolation' },
    { patterns: ['elbow_extension'], role: 'isolation' },
  ],
  pull: [
    { patterns: ['vertical_pull'], role: 'main' },
    { patterns: ['horizontal_pull'], role: 'main' },
    { patterns: ['horizontal_pull'], role: 'secondary' },
    { patterns: ['rear_delt'], role: 'isolation' },
    { patterns: ['elbow_flexion'], role: 'isolation' },
  ],
};

function cycle<T>(rotation: T[], n: number): T[] {
  return Array.from({ length: n }, (_, i) => rotation[i % rotation.length]);
}

/** The session sequence for a split. `auto` picks by frequency. */
export function sessionTypesFor(split: PlanSplit, days: number): SessionType[] {
  const n = Math.max(1, Math.min(7, days));
  switch (split) {
    case 'full_body':
      return cycle(['full_body'], n);
    case 'upper_lower':
      return cycle(['upper', 'lower'], n);
    case 'push_pull_legs':
      return cycle(['push', 'pull', 'legs'], n);
    default:
      if (n <= 3) return cycle(['full_body'], n);
      if (n === 4) return ['upper', 'lower', 'upper', 'lower'];
      if (n === 5) return ['upper', 'lower', 'push', 'pull', 'legs'];
      if (n === 6) return ['push', 'pull', 'legs', 'push', 'pull', 'legs'];
      return ['push', 'pull', 'legs', 'push', 'pull', 'legs', 'full_body'];
  }
}

/** Beginners drop the last isolation; advanced lifters add a second main-pattern movement. */
function slotsFor(type: SessionType, level: ExperienceLevel): Slot[] {
  const base = TEMPLATES[type];
  if (level === 'beginner') {
    const lastIso = base.map((s) => s.role).lastIndexOf('isolation');
    return base.filter((_, i) => i !== lastIso);
  }
  if (level === 'advanced') {
    const mains = base.filter((s) => s.role === 'main');
    const extra: Slot = { patterns: base[0].patterns, role: 'secondary' };
    const insertAt = base.lastIndexOf(mains[mains.length - 1]) + 1;
    return [...base.slice(0, insertAt), extra, ...base.slice(insertAt)];
  }
  return base;
}

// ---------------------------------------------------------------------------
// Prescription
// ---------------------------------------------------------------------------

const SET_RANGE: Record<ExperienceLevel, Record<Exclude<SlotRole, 'conditioning'>, [number, number]>> = {
  beginner: { main: [2, 3], secondary: [2, 2], isolation: [2, 2] },
  intermediate: { main: [3, 4], secondary: [3, 3], isolation: [2, 3] },
  advanced: { main: [3, 5], secondary: [3, 4], isolation: [3, 4] },
};

const PACE_FACTOR: Record<Pace, number> = { slow: 0, standard: 0.25, brisk: 0.5 };

type EngineGoal = 'gain_muscle' | 'lose_weight' | 'stay_fit';

/** The four onboarding goals collapse onto the three training strategies. */
export function engineGoal(goal: FitnessGoal): EngineGoal {
  if (goal === 'build_muscle') return 'gain_muscle';
  if (goal === 'lose_weight') return 'lose_weight';
  return 'stay_fit';
}

const REP_RANGE: Record<EngineGoal, Record<Exclude<SlotRole, 'conditioning'>, [number, number]>> = {
  gain_muscle: { main: [6, 12], secondary: [8, 12], isolation: [10, 15] },
  lose_weight: { main: [8, 12], secondary: [8, 12], isolation: [10, 15] },
  stay_fit: { main: [8, 12], secondary: [8, 12], isolation: [10, 15] },
};

/** Slow sits at the bottom of the range; standard and brisk step up from it. */
export function setsFor(level: ExperienceLevel, role: Exclude<SlotRole, 'conditioning'>, pace: Pace) {
  const [min, max] = SET_RANGE[level][role];
  return Math.ceil(min + (max - min) * PACE_FACTOR[pace]);
}

export function restFor(level: ExperienceLevel, role: SlotRole, ageBand: AgeBand) {
  if (role === 'conditioning') return 0;
  let rest = role === 'main' ? (level === 'beginner' ? 90 : level === 'advanced' ? 150 : 120) : role === 'secondary' ? 90 : 60;
  if (role === 'main' && ageBand === 'mid') rest += 15;
  if ((role === 'main' || role === 'secondary') && ageBand === 'senior') rest += 30;
  return rest;
}

/** Conditioning finishers per session index, and how long each runs. */
function conditioningPlan(goal: EngineGoal, pace: Pace, sessions: number): { indexes: Set<number>; seconds: number } {
  if (goal === 'lose_weight') {
    const seconds = pace === 'slow' ? 600 : pace === 'standard' ? 720 : 900;
    return { indexes: new Set(Array.from({ length: sessions }, (_, i) => i)), seconds };
  }
  if (goal === 'stay_fit') {
    const indexes = new Set<number>([0]);
    if (sessions >= 2) indexes.add(Math.floor(sessions / 2));
    return { indexes, seconds: 600 };
  }
  return { indexes: new Set(), seconds: 0 };
}

const HOLD_FACTOR: Record<ExperienceLevel, number> = { beginner: 1, intermediate: 1.5, advanced: 2 };

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

type Context = {
  calibration: Calibration;
  level: ExperienceLevel;
  lowImpactOnly: boolean;
  weeklyUse: Map<string, number>;
};

const MAX_USES_PER_WEEK = 2;

function allowed(e: LibraryExercise, ctx: Context, ceilingBonus = 0) {
  const ceiling = Math.min(3, ctx.calibration.ceilings[PATTERN_GROUP[e.pattern]] + ceilingBonus);
  if (e.difficulty > ceiling) return false;
  if (e.highRisk && (ctx.calibration.safetyMode || ctx.calibration.ageBand !== 'adult' && ctx.calibration.ageBand !== 'mid')) return false;
  if (ctx.lowImpactOnly && !e.lowImpact) return false;
  if ((ctx.weeklyUse.get(e.name) ?? 0) >= MAX_USES_PER_WEEK) return false;
  return true;
}

function scoreOf(e: LibraryExercise, patterns: MovementPattern[], region: BodyRegion | null, ctx: Context) {
  const ceiling = ctx.calibration.ceilings[PATTERN_GROUP[e.pattern]];
  let score = 0;
  if (e.difficulty === ceiling) score += 3;
  // The slot's first pattern is what it is for; later ones are fallbacks.
  if (e.pattern === patterns[0]) score += 3;
  if (ctx.level === 'beginner' && e.machine) score += 1;
  if (ctx.level === 'advanced' && !e.machine) score += 1;
  if (ctx.calibration.ageBand === 'senior' && e.machine) score += 1;
  if (region && e.region === region) score += 2;
  // Repeats cost more than a perfect difficulty match earns, so weeks vary.
  score -= 4 * (ctx.weeklyUse.get(e.name) ?? 0);
  return score;
}

function pick(
  library: LibraryExercise[],
  patterns: MovementPattern[],
  ctx: Context,
  used: Set<string>,
  region: BodyRegion | null = null
): { exercise: LibraryExercise; note?: string } | null {
  const attempt = (ps: MovementPattern[], bonus: number) =>
    library
      .filter((e) => ps.includes(e.pattern) && !used.has(e.name) && allowed(e, ctx, bonus))
      .map((e) => ({ e, s: scoreOf(e, patterns, region, ctx) }))
      .sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))[0]?.e ?? null;

  const exact = attempt(patterns, 0);
  if (exact) return { exercise: exact };
  const easier = attempt(patterns, 1);
  if (easier) return { exercise: easier, note: 'No exercise at your level for this movement; used the next step up.' };
  const group = PATTERN_GROUP[patterns[0]];
  const family = (Object.keys(PATTERN_GROUP) as MovementPattern[]).filter((p) => PATTERN_GROUP[p] === group && p !== 'warmup' && p !== 'stretch' && p !== 'conditioning');
  const nearby = attempt(family, 0);
  if (nearby) return { exercise: nearby, note: 'Swapped to a related movement in the same family.' };
  return null;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type PlanExercise = {
  name: string;
  section: WorkoutSection;
  role: SlotRole | 'warmup' | 'stretch';
  order: number;
  sets: WorkoutSet[];
  restSec: number;
  repsMin?: number;
  repsMax?: number;
  note?: string;
};

export type PlanDay = { weekday: number; title: string; sessionType: SessionType; exercises: PlanExercise[] };

export type GeneratedPlan = {
  name: string;
  goal: FitnessGoal;
  level: ExperienceLevel;
  daysPerWeek: number;
  split: PlanSplit;
  days: PlanDay[];
  calibration: Calibration;
  safetyMode: boolean;
  requiresProfessionalReview: boolean;
  engineVersion: number;
  inputHash: string;
};

/** Stable content hash (djb2) of the normalised inputs and engine version. */
export function inputHashOf(inputs: PlanInputs, engineVersion: number) {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries({ ...inputs, engineVersion }).sort(([a], [b]) => a.localeCompare(b)))
  );
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) hash = ((hash << 5) + hash + canonical.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function regionOf(pattern: MovementPattern): BodyRegion {
  const group = PATTERN_GROUP[pattern];
  return group === 'lower' ? 'lower' : group === 'other' ? 'any' : 'upper';
}

/**
 * Builds a full week from the thirteen answers and a library snapshot.
 * Deterministic: no clock, no randomness, ties broken by exercise name.
 */
export function generatePlan(rawInputs: PlanInputs, library: LibraryExercise[], engineVersion = ENGINE_VERSION): GeneratedPlan {
  const inputs = normalizeInputs(rawInputs);
  const calibration = calibrate(inputs);
  const level = calibration.level;
  const goal = engineGoal(inputs.goal);
  const split = inputs.split ?? 'auto';
  const weekdays = inputs.weekdays;
  const types = sessionTypesFor(split, weekdays.length);
  const conditioning = conditioningPlan(goal, inputs.pace, weekdays.length);
  const ctx: Context = {
    calibration,
    level,
    lowImpactOnly: inputs.bodyType === 'overweight' || inputs.bodyType === 'obese',
    weeklyUse: new Map(),
  };
  const sorted = [...library].sort((a, b) => a.name.localeCompare(b.name));
  const typeOrdinal = new Map<SessionType, number>();

  let previousHadHeavyLower = false;
  const days: PlanDay[] = weekdays.map((weekday, index) => {
    const type = types[index];
    const ordinal = typeOrdinal.get(type) ?? 0;
    typeOrdinal.set(type, ordinal + 1);
    const used = new Set<string>();
    const exercises: PlanExercise[] = [];
    const consecutive = index > 0 && isNextDay(weekdays[index - 1], weekday);
    let hadHeavyLower = false;

    const add = (exercise: LibraryExercise, section: WorkoutSection, role: PlanExercise['role'], sets: WorkoutSet[], restSec: number, extra: Partial<PlanExercise> = {}) => {
      used.add(exercise.name);
      ctx.weeklyUse.set(exercise.name, (ctx.weeklyUse.get(exercise.name) ?? 0) + 1);
      exercises.push({ name: exercise.name, section, role, order: exercises.length, sets, restSec, ...extra });
    };

    const slots = slotsFor(type, level);
    const firstMain = slots.find((s) => s.role === 'main');
    const region = firstMain ? regionOf(firstMain.patterns[0]) : 'any';

    // Warm-up: one item matched to the session's first main pattern.
    const warm = pick(sorted, ['warmup'], ctx, used, region);
    if (warm) add(warm.exercise, 'warmup', 'warmup', [{ durationSec: warm.exercise.timedSec ?? 60 }], 0);

    for (const slot of slots) {
      let patterns = slot.rotate ? [slot.patterns[ordinal % slot.patterns.length]] : slot.patterns;
      let role: Exclude<SlotRole, 'conditioning'> = slot.role as Exclude<SlotRole, 'conditioning'>;
      const heavyLower = role === 'main' && (patterns.includes('squat') || patterns.includes('hinge'));
      // Recovery: back-to-back days never both open with a heavy squat or hinge.
      if (heavyLower && consecutive && previousHadHeavyLower) {
        patterns = ['lunge'];
        role = 'secondary';
      }
      const choice = pick(sorted, patterns, ctx, used);
      if (!choice) continue;
      if (role === 'main' && (choice.exercise.pattern === 'squat' || choice.exercise.pattern === 'hinge')) hadHeavyLower = true;
      const setCount = setsFor(level, role, inputs.pace);
      const [repsMin, repsMax] = REP_RANGE[goal][role];
      const timed = choice.exercise.timedSec;
      const sets: WorkoutSet[] = Array.from({ length: setCount }, () =>
        timed !== undefined ? { durationSec: Math.round(timed * HOLD_FACTOR[level]) } : { reps: repsMax }
      );
      add(choice.exercise, 'workout', role, sets, restFor(level, role, calibration.ageBand), timed !== undefined ? { note: choice.note } : { repsMin, repsMax, note: choice.note });
    }

    if (conditioning.indexes.has(index)) {
      const finisher = pick(sorted, ['conditioning'], ctx, used);
      if (finisher) add(finisher.exercise, 'workout', 'conditioning', [{ durationSec: conditioning.seconds }], 0, { note: finisher.note });
    }

    for (let i = 0; i < 2; i++) {
      const stretch = pick(sorted, ['stretch'], ctx, used, region);
      if (stretch) add(stretch.exercise, 'cooldown', 'stretch', [{ durationSec: stretch.exercise.timedSec ?? 40 }], 0);
    }

    previousHadHeavyLower = hadHeavyLower;
    return { weekday, title: SESSION_TITLE[type], sessionType: type, exercises };
  });

  return {
    name: 'My workout plan',
    goal: inputs.goal,
    level,
    daysPerWeek: weekdays.length,
    split,
    days,
    calibration,
    safetyMode: calibration.safetyMode,
    requiresProfessionalReview: calibration.safetyMode,
    engineVersion,
    inputHash: inputHashOf(inputs, engineVersion),
  };
}
