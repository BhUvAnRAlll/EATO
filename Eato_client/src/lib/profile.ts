import { apiFetch, type ApiResult } from "@/lib/api";
import type { TargetRecord } from "@/lib/nutrition";
import type {
  ActivityLevel,
  DietId,
  FitnessGoal,
  Gender,
  HealthFlag,
  MealsPerDay,
  Profile,
  WorkoutFrequency,
  WorkoutTime,
  WorkoutType,
} from "@/types/profile";

// What the server holds for a user once setup is finished (GET /api/profile).
// Numbers are numbers here (the setup form keeps them as strings while typing).
export type SavedProfile = {
  fullName: string;
  email: string; // the account's email, from Clerk
  phone: string;
  role: "user" | "admin" | "trainer";
  dob: string; // YYYY-MM-DD
  gender: Gender | null;
  goal: FitnessGoal | null;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPercent: number | null;
  activity: ActivityLevel | null;
  healthFlags: HealthFlag[];
  diet: DietId | null;
  cuisines: string[];
  dislikes: string;
  allergies: string;
  workoutFrequency: WorkoutFrequency | null;
  workoutType: WorkoutType | null;
  workoutTime: WorkoutTime | null;
  mealsPerDay: MealsPerDay | null;
  profileComplete: boolean;
  updatedAt: string;
};

export type SavedData = { profile: SavedProfile | null; nutrition: TargetRecord | null };

// Saves the finished setup answers and the target record to the EATO server.
// `token` is the Clerk session token; the server works out who's saving from it.
export async function saveProfile(token: string | null, body: { profile: Profile; nutrition: TargetRecord }): Promise<ApiResult<{ saved: true }>> {
  if (!token) return { ok: false, error: "Please sign in again." };
  return apiFetch<{ saved: true }>("/api/profile", { method: "POST", body, token });
}

// The signed-in user's saved profile and targets (both null before setup is finished)
export async function fetchProfile(token: string | null): Promise<ApiResult<SavedData>> {
  if (!token) return { ok: false, error: "Please sign in again." };
  return apiFetch<SavedData>("/api/profile", { token });
}
