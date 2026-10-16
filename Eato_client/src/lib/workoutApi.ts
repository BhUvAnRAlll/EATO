import { apiFetch, type ApiResult } from "@/lib/api";
import { addDays, dateOf } from "@/lib/macro";
import type { Icon } from "@/types/profile";

// The workout hub and day screen: types, the calls to /api/workout on the EATO server, and
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
  source: "engine" | "member" | "trainer";
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

export type HistoryDay = { date: string; status: Exclude<DayStatus, "rest">; title: string | null; sessionType: string | null; totalMinutes: number; exerciseCount: number };

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
};

// ---- labels ------------------------------------------------------------------------

export const GOAL_LABEL: Record<Goal, string> = { lose_weight: "Lose weight", build_muscle: "Gain muscle", get_fitter: "Get fitter", stay_healthy: "Stay healthy" };
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

// "Thu 15 Oct"
export const historyDate = (iso: string) => dateOf(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
