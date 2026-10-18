import { apiFetch, type ApiResult } from "@/lib/api";
import type { Member } from "@/lib/community";
import type { CoachingMode, ConnectionState, Food, MealSlot, PlanGoal, Specialty, Totals } from "@/lib/trainerRules";

// Calls for trainers (Eato_server/trainers/). `token` is the Clerk session token. The server
// checks every permission: a trainer reaches a member only while they coach them.

export type TrainerProfile = {
  member: Member;
  title: string;
  specialties: Specialty[];
  yearsExperience: number;
  bio: string;
  coachingMode: CoachingMode;
  offersNutrition: boolean;
  acceptingClients: boolean;
  availability: string | null;
  // null until the trainer accepts the viewer (locked)
  approach: string | null;
  qualifications: string[] | null;
  languages: string[] | null;
  photoUrl: string | null;
  locked: boolean;
  updatedAt: string;
};

export type TrainerCard = TrainerProfile & { connection: ConnectionState };
export type TrainerDetail = TrainerCard & { otherTrainer: { id: string; status: ConnectionState } | null; messageLockReason: string | null };
export type TrainerSummary = { member: Member; title: string; offersNutrition: boolean; photoUrl: string | null };

export type MyConnection =
  | { state: "none"; trainer: null }
  | { state: "requested"; trainer: TrainerSummary; requestedAt: string; messageLockReason: string }
  | {
      state: "connected";
      trainer: TrainerSummary;
      connectedAt: string;
      dietPlan: { id: string; name: string; updatedAt: string } | null;
      workout: { id: string; name: string; note: string | null; updatedAt: string } | null;
      recommendation: { id: string; isNew: boolean; createdAt: string } | null;
      messageLockReason: null;
    };

export type PlanMeal = { id: string; slot: MealSlot; name: string; time: string; note: string | null; items: Food[]; totals: Totals; loggedCount?: number; done?: boolean; status?: "pending" | "logged" | "done" };
export type DietPlan = { id: string; trainer: Member; name: string; goal: PlanGoal; startDate: string; endDate: string | null; notes: string | null; updatedAt: string; meals: PlanMeal[] };
// A plan meal with today's state (how often it was logged, done without logging)
export type TodayMeal = Required<PlanMeal>;
export type MyPlan = { plan: (Omit<DietPlan, "meals"> & { meals: TodayMeal[] }) | null; state: ConnectionState; date?: string; progress?: { mealsDone: number; mealsTotal: number; loggedKcal: number; plannedKcal: number } };

export type Recommendation = { id: string; calories: number; proteinG: number; carbsG: number; fatG: number; note: string | null; isNew: boolean; appliedAt: string | null; createdAt: string; trainer?: TrainerSummary };
export type TargetStatus = { status: "incomplete" } | { status: "ready"; kcal: number; proteinG: number; carbsG: number; fatG: number; source: "calculated" | "user_adjusted" | "trainer_adjusted"; lockedByTrainer: boolean };
export type MyRecommendation = { recommendation: Recommendation | null; targets: TargetStatus };

export type ClientRow = { member: Member; since: string; hasDietPlan: boolean; hasWorkout: boolean; hasRecommendation: boolean };
export type ClientDetail = {
  member: Member;
  goal: string | null;
  weightKg: number | null;
  heightCm: number | null;
  activity: string | null;
  diet: string | null;
  allergies: string | null;
  targets: { kcal: number; proteinG: number; carbsG: number; fatG: number; source: string } | null;
  dietPlan: DietPlan | null;
  workout: { id: string; name: string; goal: string; level: string; daysPerWeek: number; note: string | null; startDate: string; updatedAt: string } | null;
  recommendation: Recommendation | null;
};
export type LibraryExercise = { id: string; name: string; muscleGroup: string; pattern: string; equipment: string | null; timedSec: number | null };

export type TrainerProfileDraft = {
  title: string; specialties: Specialty[]; yearsExperience: number; bio: string; coachingMode: CoachingMode; offersNutrition: boolean; acceptingClients: boolean;
  availability: string | null; approach: string | null; qualifications: string[]; languages: string[]; photoMediaId?: string | null;
};
export type DietPlanDraft = { name: string; goal: PlanGoal; startDate: string; endDate?: string | null; notes?: string | null; meals: { slot: MealSlot; name: string; time: string; note?: string | null; items: Food[] }[] };
export type WorkoutSetDraft = { reps: number } | { durationSec: number };
export type WorkoutDraft = {
  today: string; name: string; goal: "lose_weight" | "build_muscle" | "get_fitter" | "stay_healthy"; level: "beginner" | "intermediate" | "advanced"; note?: string | null;
  days: { weekday: number; title: string; exercises: { exerciseId: string; sets: WorkoutSetDraft[]; restSec: number }[] }[];
};

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const q = (params: Record<string, string | null | undefined>) => {
  const parts = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
};
const call = <T>(token: string | null, path: string, init: { method?: "POST" | "PUT" | "DELETE"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch(`/api/trainers${path}`, { ...init, token }) : signedOut();
const user = (id: string) => encodeURIComponent(id);

export const trainers = {
  // ---- members ----
  list: (token: string | null, search: string | null, specialty: Specialty | null) => call<{ trainers: TrainerCard[] }>(token, q({ search, specialty })),
  get: (token: string | null, trainerId: string) => call<{ trainer: TrainerDetail }>(token, `/${user(trainerId)}`),
  connect: (token: string | null, trainerId: string, replace = false) => call<MyConnection>(token, `/${user(trainerId)}/connect`, { method: "POST", body: replace ? { replace: true } : {} }),
  myConnection: (token: string | null) => call<MyConnection>(token, "/me/connection"),
  endConnection: (token: string | null) => call<MyConnection>(token, "/me/connection", { method: "DELETE" }),
  myPlan: (token: string | null, date: string) => call<MyPlan>(token, `/me/plan${q({ date })}`),
  logPlanMeal: (token: string | null, mealId: string, body: { date: string; servings?: number[]; again?: boolean }) =>
    call<{ mealId: string; logId: string; alreadyLogged: boolean; loggedCount: number; totals?: Totals }>(token, `/me/plan/meals/${mealId}/log`, { method: "POST", body }),
  setDone: (token: string | null, mealId: string, date: string, done: boolean) => call<{ mealId: string; date: string; done: boolean }>(token, `/me/plan/meals/${mealId}/done`, { method: done ? "POST" : "DELETE", body: { date } }),
  myRecommendation: (token: string | null) => call<MyRecommendation>(token, "/me/recommendation"),
  applyRecommendation: (token: string | null) => call<MyRecommendation>(token, "/me/recommendation/apply", { method: "POST" }),
  restoreTargets: (token: string | null) => call<MyRecommendation>(token, "/me/targets/restore", { method: "POST" }),

  // ---- trainers ----
  ownProfile: (token: string | null) => call<{ profile: TrainerProfile | null }>(token, "/me/profile"),
  saveOwnProfile: (token: string | null, body: TrainerProfileDraft) => call<{ profile: TrainerProfile }>(token, "/me/profile", { method: "PUT", body }),
  requests: (token: string | null) => call<{ requests: { member: Member; requestedAt: string }[] }>(token, "/me/requests"),
  answer: (token: string | null, clientId: string, accept: boolean) => call<{ clientId: string; accepted: boolean }>(token, `/me/requests/${user(clientId)}/${accept ? "accept" : "decline"}`, { method: "POST" }),
  clients: (token: string | null) => call<{ clients: ClientRow[] }>(token, "/me/clients"),
  client: (token: string | null, clientId: string) => call<{ client: ClientDetail }>(token, `/me/clients/${user(clientId)}`),
  endClient: (token: string | null, clientId: string) => call<{ clientId: string; ended: true }>(token, `/me/clients/${user(clientId)}`, { method: "DELETE" }),
  setRecommendation: (token: string | null, clientId: string, body: { calories: number; proteinG: number; carbsG: number; fatG: number; note?: string | null }) =>
    call<{ recommendation: Recommendation }>(token, `/me/clients/${user(clientId)}/recommendation`, { method: "PUT", body }),
  setDietPlan: (token: string | null, clientId: string, body: DietPlanDraft) => call<{ plan: DietPlan }>(token, `/me/clients/${user(clientId)}/plan`, { method: "PUT", body }),
  setWorkout: (token: string | null, clientId: string, body: WorkoutDraft) => call<{ workout: { id: string; name: string; daysPerWeek: number } }>(token, `/me/clients/${user(clientId)}/workout`, { method: "PUT", body }),
  library: (token: string | null) => call<{ exercises: LibraryExercise[] }>(token, "/library"),
};
