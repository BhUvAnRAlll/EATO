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

// Answers justFit already has from setup and the workout plan, to start the intake with
export type IntakePrefill = Partial<Pick<Intake, "goal" | "experience" | "weekdays" | "mainSpot">>;

// The coach's plan (GET/POST /api/coach/plan)
export type PlanSlot = "breakfast" | "morning_snack" | "lunch" | "evening_snack" | "dinner";
export type Totals = { kcal: number; proteinG: number; carbsG: number; fatG: number };
export type PlanItem = Totals & { name: string; quantity: number; unit: string };
export type PlanMeal = { id: string; slot: PlanSlot; name: string; time: string; note: string | null; items: PlanItem[]; totals: Totals; logged: boolean };
export type CoachPlan = {
  id: string;
  coach: CoachId;
  message: string;
  createdAt: string;
  targets: { calories: number; proteinG: number; carbsG: number; fatG: number };
  meals: PlanMeal[];
  totals: Totals;
};
export type PlanWorkout = { level: string; daysPerWeek: number; sessions: { weekday: number; title: string; minutes: number; exerciseCount: number }[] };
export type PlanState = { state: "none" | "ready"; plan: CoachPlan | null; workout: PlanWorkout | null };

// One line of the coach chat (POST /api/coach/chat). The server keeps no history: the app sends
// the last CHAT_TURNS lines each time.
export type ChatLine = { role: "member" | "coach"; text: string };
export const CHAT_TURNS = 20;
export const CHAT_MAX_TEXT = 1000;

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
  // Switches coach and coaching style, keeping every other answer
  changeCoach(token: string | null, coach: CoachId, coachStyle: CoachStyle): Promise<ApiResult<{ intake: Intake }>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/intake/coach", { method: "PUT", body: { coach, coachStyle }, token });
  },
  // The plan, with which meals were logged on `date` (the member's today)
  plan(token: string | null, date: string): Promise<ApiResult<PlanState>> {
    if (!token) return signedOut();
    return apiFetch(`/api/coach/plan?date=${encodeURIComponent(date)}`, { token });
  },
  // Makes a new plan (meals and workout) from the saved answers; the old one is kept as history
  makePlan(token: string | null, today: string): Promise<ApiResult<PlanState>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/plan", { method: "POST", body: { today }, token });
  },
  // Logs a plan meal to the Macro diary for today, once (a repeat answers alreadyLogged)
  logMeal(token: string | null, mealId: string, date: string): Promise<ApiResult<{ mealId: string; logId: string; alreadyLogged: boolean }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/coach/plan/meals/${encodeURIComponent(mealId)}/log`, { method: "POST", body: { date }, token });
  },
  // The coach's reply to the conversation so far (ending with the member's new message)
  chat(token: string | null, messages: ChatLine[], date: string): Promise<ApiResult<{ reply: string }>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/chat", { method: "POST", body: { date, messages: messages.slice(-CHAT_TURNS) }, token });
  },
};
