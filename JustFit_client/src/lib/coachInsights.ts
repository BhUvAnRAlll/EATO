import { apiFetch, type ApiResult } from "@/lib/api";
import type { Totals } from "@/lib/coach";

// The AI Coach's Insights tab (GET /api/coach/insights, POST /api/coach/insights/review). Every
// number comes from the member's own logs; a section with no data is null and isn't shown.

export type InsightsWeek = "this" | "last";
export type MacroKey = keyof Totals;
export type MacroVerdict = "low" | "ok" | "high";
export type MacroStat = { avg: number; target: number; percent: number | null; verdict: MacroVerdict | null };

export type NutritionInsights = {
  targets: Totals;
  daysLogged: number;
  daysCounted: number;
  totalKcal: number;
  targetKcal: number;
  avg: Totals;
  macros: Record<MacroKey, MacroStat>;
  onTargetDays: number;
  proteinHitDays: number;
  days: { date: string; logged: boolean; kcal: number; proteinG: number }[];
};

export type WorkoutDayStatus = "completed" | "in_progress" | "missed" | "planned" | "rest";
export type WorkoutInsights = {
  hasPlan: boolean;
  planned: number;
  done: number;
  missed: number;
  upcoming: number;
  completionRate: number | null;
  totalMinutes: number;
  activeDays: number;
  days: { date: string; status: WorkoutDayStatus; minutes: number }[];
  muscleGroups: { group: string; sets: number; share: number }[];
};

export type WeightPoint = { date: string; kg: number };
export type WeightInsights = {
  current: WeightPoint;
  previous: WeightPoint | null;
  change: number | null;
  first: WeightPoint | null;
  changeSinceFirst: number | null;
  direction: "lose" | "gain" | "maintain" | null;
  points: WeightPoint[];
};

export type ReviewArea = "nutrition" | "protein" | "workout" | "recovery" | "next_week";
export type CoachReview = {
  summary: string;
  tips: { area: ReviewArea; text: string }[];
  createdAt: string;
  // The week's numbers changed after it was written
  stale: boolean;
  canRefresh: boolean;
};

export type Insights = {
  week: { week: InsightsWeek; start: string; end: string; elapsed: number; today: string };
  nutrition: NutritionInsights | null;
  workouts: WorkoutInsights | null;
  weight: WeightInsights | null;
  review: CoachReview | null;
  canReview: boolean;
};

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

export const insightsApi = {
  // The week's numbers and its saved review: no AI call
  get(token: string | null, today: string, week: InsightsWeek): Promise<ApiResult<Insights>> {
    if (!token) return signedOut();
    return apiFetch(`/api/coach/insights?today=${encodeURIComponent(today)}&week=${week}`, { token });
  },
  // The coach's review of the week: written the first time, then served saved; refresh at most once a day
  review(token: string | null, today: string, week: InsightsWeek, refresh = false): Promise<ApiResult<Insights>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/insights/review", { method: "POST", body: { today, week, ...(refresh ? { refresh } : {}) }, token });
  },
};
