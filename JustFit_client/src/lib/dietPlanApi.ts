import { apiFetch, type ApiResult } from "@/lib/api";
import type { DietSlot } from "@/lib/dietPlanText";
import type { MemberFood } from "@/lib/mealMatch";
import type { MenuMeal } from "@/lib/mealsApi";

// Trainer diet plans (2026-11-10, migration 2027-01-27): a trainer's day of meals for a PT client,
// with justFit menu meals recommended for breakfast, lunch and dinner. The trainer edits it from
// My Clients; the member sees it on Coach › Meal Plan and can order the picks.

export type DietMealInput = { slot: DietSlot; time: string | null; food: string; kcal: number | null; proteinG: number | null; picks: string[] };
export type DietPlan = { id: number; note: string | null; meals: DietMealInput[]; version: number; updatedAt: string };
// A menu meal in the trainer's picker: `problem` can't be picked (only when the client shares), `warning` a dislike
export type PickerMeal = MenuMeal & { problem: string | null; warning: string | null };
export type TrainerDietView = { client: { id: number; name: string; branch: string }; plan: DietPlan | null; shared: boolean; food: MemberFood | null; menu: PickerMeal[] };

// The member's view: each plan's picks are the menu meals that suit them; `hidden` counts the rest
export type MemberDietMeal = Omit<DietMealInput, "picks"> & { picks: MenuMeal[] };
export type MemberDietPlan = Omit<DietPlan, "meals"> & { meals: MemberDietMeal[]; hidden: number; trainer: string | null; gym: string; branch: string };
export type MemberDietPlans = { shared: boolean; plans: MemberDietPlan[] };

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
const call = <T,>(token: string | null, path: string, options: { method?: "GET" | "PUT" | "DELETE"; body?: unknown } = {}) =>
  token ? apiFetch<T>(path, { ...options, token }) : signedOut<T>();

export const dietPlanApi = {
  forTrainer: (token: string | null, memberId: number) => call<TrainerDietView>(token, `/api/trainer/clients/${memberId}/diet-plan`),
  save: (token: string | null, memberId: number, body: { note: string | null; meals: DietMealInput[] }) =>
    call<{ plan: DietPlan }>(token, `/api/trainer/clients/${memberId}/diet-plan`, { method: "PUT", body }),
  remove: (token: string | null, memberId: number) => call<{ removed: boolean }>(token, `/api/trainer/clients/${memberId}/diet-plan`, { method: "DELETE" }),
  mine: (token: string | null) => call<MemberDietPlans>(token, "/api/membership/diet-plans"),
  share: (token: string | null, shared: boolean) => call<{ shared: boolean }>(token, "/api/membership/food-sharing", { method: "PUT", body: { shared } }),
};
