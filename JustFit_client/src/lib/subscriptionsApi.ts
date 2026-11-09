import { apiFetch, type ApiResult } from "@/lib/api";
import type { MealSlot } from "@/lib/mealRules";
import type { CheckoutOptions, PaymentSuccess } from "@/lib/mealsApi";

// Meal plans and subscriptions (Meal Operations phase 5, 2026-11-10; JustFit_server/subscriptions/)
export type PlanLength = { days: number; price: number; perDay: number; savePercent: number };
export type MealPlan = {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  goal: "fat_loss" | "muscle_gain" | "maintain" | "custom";
  mealsPerDay: number;
  slots: MealSlot[];
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterL: number;
  included: string[];
  active: boolean;
  sortOrder: number;
  lengths: PlanLength[];
  mealIds: string[];
};
export type DaySlotStatus = "scheduled" | "skipped" | "paused" | "unfilled" | string;
export type Subscription = {
  id: string;
  code: string;
  planId: number | null;
  planName: string;
  days: number;
  mealsPerDay: number;
  slots: MealSlot[];
  calories: number;
  price: number;
  status: "awaiting_payment" | "active" | "paused" | "cancelled" | "completed";
  startsOn: string;
  endsOn: string;
  pausedFrom: string | null;
  pausedUntil: string | null;
  pausedNow: boolean;
  mealsTotal: number;
  mealsUsed: number;
  mealsComing: number;
  mealsLeft: number;
  address: { receiverName: string | null; line: string | null; pincode: string };
  payment: { method: string; ref: string | null } | null;
  cancelReason: string | null;
  member?: { name: string | null; phone: string | null };
  upcoming?: { day: string; slots: { slot: MealSlot; status: DaySlotStatus; orderId: string | null; meals: string | null }[] }[];
};
export type Mine = { current: Subscription | null; past: Subscription[] };
export type PlanInput = {
  name: string; tagline: string; description: string; goal: MealPlan["goal"]; mealsPerDay: number; calories: number; proteinG: number; carbsG: number;
  fatG: number; waterL: number; included: string[]; lengths: { days: number; price: number }[]; mealIds: string[]; active: boolean; sortOrder: number;
};

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
const call = <T,>(token: string | null, path: string, options: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { ...options, token }) : signedOut<T>();
const id = (value: string) => encodeURIComponent(value);

export const subscriptionsApi = {
  plans: (token: string | null) => call<{ plans: MealPlan[] }>(token, "/api/subscriptions/plans"),
  plan: (token: string | null, slug: string) => call<{ plan: MealPlan }>(token, `/api/subscriptions/plans/${id(slug)}`),
  mine: (token: string | null) => call<Mine>(token, "/api/subscriptions/mine"),
  subscribe: (token: string | null, body: { clientId: string; planId: number; days: number; startsOn: string; addressId: number }) =>
    call<{ subscription: Subscription; checkout: CheckoutOptions | null; repeated: boolean }>(token, "/api/subscriptions", { method: "POST", body }),
  verifyPayment: (token: string | null, subId: string, paid: PaymentSuccess) =>
    call<{ subscription: Subscription; alreadyPaid: boolean }>(token, `/api/subscriptions/${id(subId)}/verify-payment`, { method: "POST", body: paid }),
  paymentFailed: (token: string | null, subId: string, providerOrderId: string, reason: string) =>
    call<{ recorded: boolean }>(token, `/api/subscriptions/${id(subId)}/payment-failed`, { method: "POST", body: { razorpay_order_id: providerOrderId, reason } }),
  pause: (token: string | null, subId: string, from: string, until: string) => call<Mine>(token, `/api/subscriptions/${id(subId)}/pause`, { method: "POST", body: { from, until } }),
  resume: (token: string | null, subId: string) => call<Mine>(token, `/api/subscriptions/${id(subId)}/resume`, { method: "POST", body: {} }),
  skip: (token: string | null, subId: string, day: string, undo = false) => call<Mine>(token, `/api/subscriptions/${id(subId)}/${undo ? "unskip" : "skip"}`, { method: "POST", body: { day } }),
  cancel: (token: string | null, subId: string, reason?: string) => call<Mine>(token, `/api/subscriptions/${id(subId)}/cancel`, { method: "POST", body: reason ? { reason } : {} }),

  // The Super Admin
  adminPlans: (token: string | null) => call<{ plans: MealPlan[] }>(token, "/api/admin/kitchen/subscription-plans"),
  addPlan: (token: string | null, input: PlanInput) => call<{ plan: MealPlan }>(token, "/api/admin/kitchen/subscription-plans", { method: "POST", body: input }),
  editPlan: (token: string | null, planId: number, input: PlanInput) => call<{ plan: MealPlan }>(token, `/api/admin/kitchen/subscription-plans/${planId}`, { method: "PUT", body: input }),
  adminList: (token: string | null, status: string | null, search: string) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    const qs = params.toString();
    return call<{ subscriptions: Subscription[] }>(token, `/api/admin/kitchen/subscriptions${qs ? `?${qs}` : ""}`);
  },
  adminOne: (token: string | null, subId: string) => call<{ subscription: Subscription }>(token, `/api/admin/kitchen/subscriptions/${id(subId)}`),
  adminAction: (token: string | null, subId: string, action: "activate" | "pause" | "resume" | "cancel" | "extend" | "plan", body: Record<string, unknown> = {}) =>
    call<{ subscription: Subscription }>(token, `/api/admin/kitchen/subscriptions/${id(subId)}/${action}`, { method: "POST", body }),
  generate: (token: string | null, day: string) => call<{ date: string; made: number; unfilled: number }>(token, "/api/admin/kitchen/subscriptions/generate", { method: "POST", body: { day } }),
};
