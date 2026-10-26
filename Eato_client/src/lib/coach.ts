import { apiFetch, type ApiResult } from "@/lib/api";
import type {
  CoachGoal, CoachId, CoachStyle, Condition, CookingTime, Equipment, Experience, FoodBudget, Joint, Sleep, Spot, Stress,
} from "@/data/coach";

// The member's saved AI Coach intake (GET/PUT /api/coach/intake)
export type Intake = {
  goal: CoachGoal;
  experience: Experience;
  currentlyTraining: boolean;
  weekdays: number[];
  sessionMinutes: number;
  mainSpot: Spot;
  backupSpot: Spot | null;
  mainEquipment: Equipment;
  backupEquipment: Equipment | null;
  joints: Joint[];
  conditions: Condition[];
  limitationNotes: string | null;
  cookingTime: CookingTime;
  foodBudget: FoodBudget;
  stress: Stress | null;
  sleep: Sleep | null;
  coach: CoachId;
  coachStyle: CoachStyle;
  planNotes: string | null;
};

// Answers JustFit already has from setup and the workout plan, to start the intake with
export type IntakePrefill = Partial<Pick<Intake, "goal" | "experience" | "weekdays" | "mainSpot">>;

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

export const coachApi = {
  intake(token: string | null): Promise<ApiResult<{ intake: Intake | null; prefill: IntakePrefill }>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/intake", { token });
  },
  // `acceptedDisclaimer`: the member ticked "Fitness guidance, not medical advice" (the server requires it)
  saveIntake(token: string | null, intake: Intake & { acceptedDisclaimer: boolean }): Promise<ApiResult<{ intake: Intake }>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/intake", { method: "PUT", body: intake, token });
  },
};
