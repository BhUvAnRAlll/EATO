import { apiFetch, type ApiResult } from "@/lib/api";
import type { TargetRecord } from "@/lib/nutrition";
import type { Role } from "@/lib/roles";
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
  email: string; // the account's email (empty for phone accounts)
  phone: string;
  role: Role;
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

// Saves the finished setup answers and the target record to the justFit server.
// `token` is the session token (lib/session.ts); the server works out who's saving from it.
// nutrition is left out by setup (personal details only) and while the member has no targets yet
export async function saveProfile(token: string | null, body: { profile: Profile; nutrition?: TargetRecord }): Promise<ApiResult<{ saved: true }>> {
  if (!token) return { ok: false, error: "Please sign in again." };
  return apiFetch<{ saved: true }>("/api/profile", { method: "POST", body, token });
}

export type FoodAnswers = Pick<Profile, "diet" | "cuisines" | "dislikes" | "allergies" | "mealsPerDay">;

// Profile › Food preferences: only the food answers change
export async function saveFood(token: string | null, food: FoodAnswers): Promise<ApiResult<{ food: FoodAnswers }>> {
  if (!token) return { ok: false, error: "Please sign in again." };
  return apiFetch<{ food: FoodAnswers }>("/api/profile/food", { method: "PUT", body: food, token });
}

// The signed-in user's saved profile and targets (both null before setup is finished)
export async function fetchProfile(token: string | null): Promise<ApiResult<SavedData>> {
  if (!token) return { ok: false, error: "Please sign in again." };
  return apiFetch<SavedData>("/api/profile", { token });
}
