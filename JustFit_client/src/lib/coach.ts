import { apiFetch, type ApiResult } from "@/lib/api";
import type {
  CoachGoal, CoachId, CoachStyle, Condition, CookingTime, Equipment, Experience, FoodBudget, Joint, Sleep, Spot, Stress,
} from "@/data/coach";
import type { ActivityLevel, DietId, Gender, HealthFlag, MealsPerDay } from "@/types/profile";

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

// The intake's profile answers (2026-11-10), saved to the member's profile with the targets
// worked out from them: the activity level, the health check and the food answers
export type IntakeProfile = {
  activity: ActivityLevel;
  healthFlags: HealthFlag[];
  diet: DietId;
  cuisines: string[];
  dislikes: string;
  allergies: string;
  mealsPerDay: MealsPerDay;
};
// What the server answers about the targets after a save
export type IntakeTargets = "set" | "kept" | "needs_choice" | "needs_professional" | "needs_details" | null;

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
// Swap Meal: one dish the coach offers in a meal's place (POST /plan/meals/:id/options), or the
// "previous" snapshot a replacement left behind, which is what Undo puts back
export type MealOption = { id: string; kind: "suggestion" | "previous"; name: string; description: string | null; note: string | null; items: PlanItem[]; totals: Totals };
// How the member can steer the options (the chips on the Swap Meal screen)
export type MealPreference = "lighter" | "more_protein" | "different_cuisine" | "quick";
// `remaining`: what the diary says is left of the day; `targetKcal`: what each option aims for
export type MealOptions = { mealId: string; remaining: Totals; targetKcal: number; preference: MealPreference | null; options: MealOption[] };
export type MealReplaced = PlanState & { mealId: string; undoId: string; replaced: { name: string; totals: Totals }; name: string; totals: Totals };
export type PlanWorkout = { level: string; daysPerWeek: number; sessions: { weekday: number; title: string; minutes: number; exerciseCount: number }[] };
export type PlanState = { state: "none" | "ready"; plan: CoachPlan | null; workout: PlanWorkout | null };

// One line of the coach chat. The server saves the conversation for 7 days (GET /api/coach/chat
// reads it back) and gives the coach its own saved copy as context: the app sends only the new message.
export type ChatLine = { role: "member" | "coach"; text: string };
// A saved line: the server's id, a reply's plan changes, and when it was written (ISO)
export type ChatMessage = ChatLine & { id: string; proposals?: ChatProposals; createdAt: string };
// A change to the plan the coach recommended in a reply, which the member can apply from the chat.
// A meal's `option` is stored on the server like a Swap Meal option, so applying it is replaceMeal.
export type MealProposal = { mealId: string; slot: PlanSlot; time: string; current: { name: string; totals: Totals }; option: MealOption };
export type WorkoutProposal = { weekdays: number[]; sessionMinutes: number; current: { weekdays: number[]; sessionMinutes: number } };
export type ChatProposals = { meals: MealProposal[]; workout: WorkoutProposal | null };
export const CHAT_MAX_TEXT = 1000;

// No session token on the phone: answered like the server's own 401, so a screen shows "Please
// sign in again" instead of its offline line
const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });

export const coachApi = {
  // A spoken question as a short clip (base64), for a phone whose own recogniser lacks the
  // language: the server transcribes it (a small paid call) and answers the words, nothing is stored
  voice(token: string | null, clip: { data: string; mediaType: string; language: string }): Promise<ApiResult<{ text: string }>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/voice", { method: "POST", body: clip, token });
  },
  // profile: the activity, health and food answers already saved (any may be missing); gender
  // decides whether pregnancy and breastfeeding are asked
  intake(token: string | null): Promise<ApiResult<{ intake: Intake | null; prefill: IntakePrefill; profile: Partial<IntakeProfile>; gender: Gender | null }>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/intake", { token });
  },
  // `acceptedDisclaimer`: the member ticked "Fitness guidance, not medical advice" (the server requires it)
  saveIntake(token: string | null, intake: Intake & { acceptedDisclaimer: boolean; profile: IntakeProfile }): Promise<ApiResult<{ intake: Intake; targets: IntakeTargets }>> {
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
  // Swaps one meal for a new dish from the coach (the other meals and the workout stay); answers the plan
  swapMeal(token: string | null, mealId: string, date: string): Promise<ApiResult<PlanState & { mealId: string }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/coach/plan/meals/${encodeURIComponent(mealId)}/swap`, { method: "POST", body: { date }, token });
  },
  // Five dishes the member could have instead of a plan meal, made for them and for what's left of `date`,
  // steered by `preference` when they picked a chip (one small AI call)
  // `reuse` (the screen opening): the server may answer the unused options of the last few hours, with no AI call
  mealOptions(token: string | null, mealId: string, date: string, preference: MealPreference | null = null, reuse = false): Promise<ApiResult<MealOptions>> {
    if (!token) return signedOut();
    return apiFetch(`/api/coach/plan/meals/${encodeURIComponent(mealId)}/options`, { method: "POST", body: { date, ...(preference ? { preference } : {}), ...(reuse ? { reuse } : {}) }, token });
  },
  // Puts one of those options (or an undo snapshot) in the meal's place, with the member's portions when they
  // edited them (one per food, 0 leaves it out); answers the plan with its new totals and an undoId
  replaceMeal(token: string | null, mealId: string, date: string, optionId: string, quantities: number[] | null = null): Promise<ApiResult<MealReplaced>> {
    if (!token) return signedOut();
    return apiFetch(`/api/coach/plan/meals/${encodeURIComponent(mealId)}/replace`, { method: "POST", body: { date, optionId, ...(quantities ? { quantities } : {}) }, token });
  },
  // Logs a plan meal to the Macro diary for today, once (a repeat answers alreadyLogged)
  logMeal(token: string | null, mealId: string, date: string): Promise<ApiResult<{ mealId: string; logId: string; alreadyLogged: boolean }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/coach/plan/meals/${encodeURIComponent(mealId)}/log`, { method: "POST", body: { date }, token });
  },
  // A workout change from the chat: new training days and session length, a new workout from them (the meals stay)
  changeWorkout(token: string | null, today: string, weekdays: number[], sessionMinutes: number): Promise<ApiResult<PlanState>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/plan/workout", { method: "POST", body: { today, weekdays, sessionMinutes }, token });
  },
  // The member's coach and their current conversation with them, oldest first (the last 7 days)
  chatHistory(token: string | null): Promise<ApiResult<{ coach: CoachId | null; messages: ChatMessage[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/chat", { token });
  },
  // The coach's reply to the member's new message, with any plan changes it recommends; `messages` is the
  // message and the reply as saved. `clientId` names this send: sending it again gets the same answer.
  chat(token: string | null, text: string, clientId: string, date: string): Promise<ApiResult<{ reply: string; proposals?: ChatProposals; messages: ChatMessage[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/chat", { method: "POST", body: { date, text, clientId }, token });
  },
  // Today's check-in from the coach (the evening notification opens it): written once a day, saved in the chat
  followup(token: string | null, date: string): Promise<ApiResult<{ message: ChatMessage }>> {
    if (!token) return signedOut();
    return apiFetch("/api/coach/followup", { method: "POST", body: { date }, token });
  },
};
