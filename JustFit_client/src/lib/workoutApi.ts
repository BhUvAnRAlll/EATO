import { apiFetch, type ApiResult } from "@/lib/api";
import { addDays, dateOf } from "@/lib/macro";
import type { Answers, Pace } from "@/lib/recreateRules";
import type { Icon } from "@/types/profile";

// The workout hub and day screen: types, the calls to /api/workout on the justFit server, and
// the labels and formatters those screens share (copy taken from the workout spec and its
// source app). Dates are the member's LOCAL day (YYYY-MM-DD); weekdays are Sunday-first
// (0 = Sunday), like Date.getDay().

export type Level = "beginner" | "intermediate" | "advanced";
export type Goal = "lose_weight" | "build_muscle" | "get_fitter" | "stay_healthy";
export type Section = "warmup" | "workout" | "cooldown";
export type DayStatus = "completed" | "in_progress" | "missed" | "planned" | "rest";
export type WorkoutSet = { reps?: number; durationSec?: number; weightKg?: number };

export type Plan = {
  id: string;
  name: string;
  goal: Goal;
  level: Level;
  daysPerWeek: number;
  split: "auto" | "full_body" | "upper_lower" | "push_pull_legs";
  source: "engine" | "member";
  requiresProfessionalReview: boolean;
  weekdays: number[];
};

export type DayExercise = {
  id: string;
  name: string;
  muscleGroup: string;
  pattern: string;
  equipment: string | null;
  section: Section;
  role: string | null;
  sets: WorkoutSet[];
  restSec: number;
  repsMin: number | null;
  repsMax: number | null;
  note: string | null;
  instructions: string[];
};

export type TrainingDay = {
  id: string;
  weekday: number;
  title: string;
  sessionType: string | null;
  minutes: number;
  sectionMinutes: Record<Section, number>;
  exerciseCount: number;
  setCount: number;
  totalSets: number;
  kcal: number | null;
  exercises: DayExercise[];
};

export type WorkoutHome =
  | { plan: null }
  | { plan: Plan; date: string; status: DayStatus; day: TrainingDay | null; week: { date: string; status: DayStatus }[] };

export type HistoryDay = { date: string; status: Exclude<DayStatus, "rest" | "planned">; title: string | null; sessionType: string | null; totalMinutes: number; exerciseCount: number };

// One attempt at a day (the plan is the intention, the log is what happened)
export type SessionLog = { id: string; date: string; dayId: string; status: "in_progress" | "completed" | "abandoned"; startedAt: string; completedAt: string | null };
export type LoggedSet = { dayExerciseId: string; setIndex: number; reps: number | null; weightKg: number | null; durationSec: number | null };
export type SetEntry = { logId: string; dayExerciseId: string; setIndex: number; reps?: number; weightKg?: number; durationSec?: number };

// The four settings of the active plan
export type Preferences = { goal: Goal; level: Level; weekdays: number[]; split: Plan["split"] };
export type NewPlan = { planId: string; level: Level; goal: Goal; daysPerWeek: number; requiresProfessionalReview: boolean };
// What "Rebuild my plan" starts from: the saved answers (null where never asked)
export type RecreateInputs = { answers: Partial<Record<keyof Answers, unknown>>; units: { weight: "kg"; height: "cm" }; hasPlan: boolean };
// What the reveal shows, read back from the saved plan
export type PlanOverview = {
  goal: Goal;
  level: Level;
  daysPerWeek: number;
  pace: Pace | null;
  split: Plan["split"];
  requiresProfessionalReview: boolean;
  sessions: { dayId: string; weekday: number; title: string; sessionType: string | null; minutes: number; exerciseCount: number }[];
  firstSession: { weekday: number; title: string; exercises: { id: string; name: string; sets: WorkoutSet[]; repsMin: number | null; repsMax: number | null; restSec: number }[] } | null;
};

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const query = (params: Record<string, string>) => "?" + Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");

export const workoutApi = {
  home(token: string | null, date: string, dates: string[], today: string): Promise<ApiResult<WorkoutHome>> {
    if (!token) return signedOut();
    return apiFetch(`/api/workout/home${query({ date, dates: dates.join(","), today })}`, { token });
  },
  history(token: string | null, from: string, to: string, today: string): Promise<ApiResult<{ days: HistoryDay[] }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/workout/history${query({ from, to, today })}`, { token });
  },
  // The active plan, built from the member's profile the first time (idempotent)
  ensurePlan(token: string | null, today: string): Promise<ApiResult<{ planId: string; created: boolean }>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/plan/ensure", { method: "POST", body: { today }, token });
  },
  // "Do it today instead?": today runs the session missed on `from`
  moveToToday(token: string | null, from: string, today: string): Promise<ApiResult<{ date: string; dayId: string }>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/reschedule/move", { method: "POST", body: { from, today }, token });
  },
  // The session for a date: the completed log, else the running one, with its logged sets
  session(token: string | null, date: string, today: string): Promise<ApiResult<{ log: SessionLog | null; sets: LoggedSet[] }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/workout/session${query({ date, today })}`, { token });
  },
  // Start (or pick up) today's session
  startSession(token: string | null, date: string, today: string): Promise<ApiResult<{ log: SessionLog; created: boolean }>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/session/start", { method: "POST", body: { date, today }, token });
  },
  // One finished set, written at once (doing it again replaces it)
  logSet(token: string | null, entry: SetEntry): Promise<ApiResult<{ logged: LoggedSet }>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/session/sets", { method: "POST", body: entry, token });
  },
  completeSession(token: string | null, logId: string): Promise<ApiResult<{ log: SessionLog }>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/session/complete", { method: "POST", body: { logId }, token });
  },
  // End early: today goes back to planned; the sets already logged are kept
  abandonSession(token: string | null, logId: string): Promise<ApiResult<{ log: SessionLog }>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/session/abandon", { method: "POST", body: { logId }, token });
  },
  preferences(token: string | null): Promise<ApiResult<Preferences>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/preferences", { token });
  },
  // Builds a new plan from these settings; the old one is kept with its history
  updatePreferences(token: string | null, today: string, prefs: Preferences): Promise<ApiResult<NewPlan>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/preferences", { method: "PUT", body: { today, ...prefs }, token });
  },
  recreateInputs(token: string | null, today: string): Promise<ApiResult<RecreateInputs>> {
    if (!token) return signedOut();
    return apiFetch(`/api/workout/recreate${query({ today })}`, { token });
  },
  // Saves the thirteen answers and builds the plan from them (the old one is kept)
  recreatePlan(token: string | null, today: string, answers: Answers): Promise<ApiResult<NewPlan>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/recreate", { method: "POST", body: { today, ...answers }, token });
  },
  planOverview(token: string | null): Promise<ApiResult<PlanOverview>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/plan/overview", { token });
  },
  // "Swap with today?": today and `other` trade sessions
  swapWithToday(token: string | null, other: string, today: string): Promise<ApiResult<{ swapped: string[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/workout/reschedule/swap", { method: "POST", body: { a: today, b: other, today }, token });
  },
};

// ---- labels ------------------------------------------------------------------------

export const GOAL_LABEL: Record<Goal, string> = { lose_weight: "Lose weight", build_muscle: "Gain muscle", get_fitter: "Get fitter", stay_healthy: "Stay healthy" };
// How each split shapes the week (the engine's rules, in a member's words)
export const SPLIT_LABEL: Record<Plan["split"], string> = { auto: "Automatic", full_body: "Full body", upper_lower: "Upper / lower", push_pull_legs: "Push / pull / legs" };
export const SPLIT_NOTE: Record<Plan["split"], string> = {
  auto: "Chosen from how many days you train",
  full_body: "Every session trains the whole body",
  upper_lower: "Upper-body and lower-body days take turns",
  push_pull_legs: "Pushing, pulling and leg days in rotation",
};
export const LEVEL_LABEL: Record<Level, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
// The training emphasis a goal gives every session, shown after its name: "Pull · Strength"
export const GOAL_FOCUS: Record<Goal, string> = { build_muscle: "Strength", lose_weight: "Fat Burn", get_fitter: "Conditioning", stay_healthy: "Wellness" };
export const SECTION_LABEL: Record<Section, string> = { warmup: "Warm Up", workout: "Workout", cooldown: "Stretch" };
// A short line under a section heading that says how to run it
export const SECTION_HINT: Partial<Record<Section, string>> = { cooldown: "Circuit: follow the sequence" };
export const STATUS_LABEL: Record<DayStatus, string> = { completed: "Completed", in_progress: "In progress", missed: "Missed", planned: "Planned", rest: "Rest day" };
export const MUSCLE_LABEL: Record<string, string> = {
  legs: "Legs", chest: "Chest", back: "Back", shoulders: "Shoulders", arms: "Arms", core: "Core", full_body: "Full body", cardio: "Cardio",
};
// What a movement pattern mostly trains, in gym-floor words: a row's subtitle ("Back · Lats")
export const PATTERN_FOCUS: Record<string, string> = {
  warmup: "Activation", stretch: "Mobility", conditioning: "Conditioning",
  squat: "Quads", lunge: "Glutes", hinge: "Glutes", knee_flexion: "Hamstrings", knee_extension: "Quads", calf: "Calves",
  horizontal_push: "Chest", vertical_push: "Shoulders", shoulder_abduction: "Side Delts",
  horizontal_pull: "Mid Back", vertical_pull: "Lats", rear_delt: "Rear Delts",
  elbow_flexion: "Biceps", elbow_extension: "Triceps", core: "Core",
};

// ---- icons (stand-ins until exercises and sessions have photos) ----------------------

const strength: Icon = { ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" };
const dumbbell: Icon = { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" };
const rower: Icon = { ios: "figure.rower", android: "rowing", web: "rowing" };
const core: Icon = { ios: "figure.core.training", android: "self_improvement", web: "self_improvement" };
const run: Icon = { ios: "figure.run", android: "directions_run", web: "directions_run" };
const flexibility: Icon = { ios: "figure.flexibility", android: "sports_gymnastics", web: "sports_gymnastics" };

export const MUSCLE_ICON: Record<string, Icon> = { legs: strength, chest: strength, back: rower, shoulders: strength, arms: dumbbell, core, full_body: flexibility, cardio: run };
const SESSION_ICON: Record<string, Icon> = { legs: strength, push: dumbbell, pull: rower, upper: core, lower: run, full_body: flexibility };
export const sessionIcon = (sessionType: string | null): Icon => (sessionType && SESSION_ICON[sessionType]) || dumbbell;

// ---- prescriptions -----------------------------------------------------------------

// "45 secs" under a minute, "10 min" or "12:30 min" above it
export function formatSeconds(seconds: number) {
  if (seconds < 60) return `${seconds} secs`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, "0")} min`;
}

export const isTimed = (e: DayExercise) => e.sets.length > 0 && e.sets[0].durationSec !== undefined;

// The prescription on one line: "3 sets × 8–12 reps", "2 × 30 secs", or each set listed
export function formatSets(e: DayExercise) {
  const { sets } = e;
  if (e.repsMin !== null && e.repsMax !== null && sets.length > 0 && !isTimed(e)) {
    return `${sets.length} ${sets.length === 1 ? "set" : "sets"} × ${e.repsMin}–${e.repsMax} reps`;
  }
  if (sets.length > 1 && sets.every((s) => s.durationSec !== undefined && s.durationSec === sets[0].durationSec)) {
    return `${sets.length} × ${formatSeconds(sets[0].durationSec ?? 0)}`;
  }
  return sets.map((s) => (s.durationSec !== undefined ? formatSeconds(s.durationSec) : `${s.reps ?? 0} reps`)).join("  •  ");
}

// ---- dates -------------------------------------------------------------------------

// Monday to Sunday of the week holding `iso`: a plan is weekly, so the strip is too
export const weekOf = (iso: string) => {
  const offset = (dateOf(iso).getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(iso, i - offset));
};

// "Wednesday": how the reschedule prompts name a day (always within a week or two of today)
export const weekdayName = (iso: string) => dateOf(iso).toLocaleDateString("en-GB", { weekday: "long" });

// Monday first: the order the week strip and the day pickers use
export const WEEKDAYS_MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const shortDay = (weekday: number) => SHORT_DAY[weekday] ?? "";
// "Mon, Wed, Fri"
export const formatWeekdays = (weekdays: number[]) => WEEKDAYS_MONDAY_FIRST.filter((d) => weekdays.includes(d)).map(shortDay).join(", ");

// "Thu 15 Oct"
export const historyDate = (iso: string) => dateOf(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
