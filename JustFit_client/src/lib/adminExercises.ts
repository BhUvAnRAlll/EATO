import { apiFetch, type ApiResult } from "@/lib/api";

// Super Admin › Exercises (JustFit_server/admin/exercises.js, under /api/admin/portal/exercises):
// every exercise a member can be given, with whether it has a demo video yet; the AI adds new
// ones. The server checks the admin role on every request; nothing here decides who may see what.

export type MuscleGroup = "legs" | "chest" | "back" | "shoulders" | "arms" | "core" | "full_body" | "cardio";
export type VideoFilter = "all" | "missing" | "ready";

export type AdminExercise = {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: string;
  pattern: string;
  difficulty: 1 | 2 | 3;
  highRisk: boolean;
  lowImpact: boolean;
  machine: boolean;
  region: "lower" | "upper" | "any";
  timedSec: number | null;
  instructions: string[];
  // built_in: shipped with the app; ai: the AI added it; admin: an admin wrote it
  source: "built_in" | "ai" | "admin";
  hasVideo: boolean;
  videoUploadedAt: string | null;
  archived: boolean;
  // How many members have it in their current workout plan
  inUse: number;
  createdAt: string | null;
};

export type ExerciseList = {
  exercises: AdminExercise[];
  counts: { total: number; withVideo: number; ai: number; archived: number };
};

export type ExerciseFilters = { search: string; group: MuscleGroup | null; video: VideoFilter; show: "active" | "archived" };
export type DraftResult = { added: AdminExercise[]; skipped: { name: string; reason: string }[] };

export const MUSCLE_GROUPS: MuscleGroup[] = ["legs", "chest", "back", "shoulders", "arms", "core", "full_body", "cardio"];
export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  legs: "Legs", chest: "Chest", back: "Back", shoulders: "Shoulders", arms: "Arms", core: "Core", full_body: "Full body", cardio: "Cardio",
};
export const DIFFICULTY_LABEL = { 1: "Easy", 2: "Medium", 3: "Hard" } as const;
export const MAX_DRAFTS = 20;

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const query = (params: Record<string, string | null>) =>
  Object.entries(params)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");

export const adminExercises = {
  list(token: string | null, filters: ExerciseFilters): Promise<ApiResult<ExerciseList>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/exercises?${query(filters)}`, { token });
  },
  async detail(token: string | null, id: string): Promise<ApiResult<AdminExercise>> {
    if (!token) return signedOut();
    const result = await apiFetch<{ exercise: AdminExercise }>(`/api/admin/portal/exercises/${encodeURIComponent(id)}`, { token });
    return result.ok ? { ok: true, data: result.data.exercise } : result;
  },
  draft(token: string | null, request: string, count: number): Promise<ApiResult<DraftResult>> {
    if (!token) return signedOut();
    return apiFetch("/api/admin/portal/exercises/ai-draft", { method: "POST", body: { request, count }, token });
  },
  async setArchived(token: string | null, id: string, archived: boolean): Promise<ApiResult<AdminExercise>> {
    if (!token) return signedOut();
    const result = await apiFetch<{ exercise: AdminExercise }>(`/api/admin/portal/exercises/${encodeURIComponent(id)}/${archived ? "archive" : "restore"}`, { method: "POST", token });
    return result.ok ? { ok: true, data: result.data.exercise } : result;
  },
};
