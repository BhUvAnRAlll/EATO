import { apiFetch, type ApiResult } from "@/lib/api";
import type { MealSlot } from "@/lib/mealRules";
import type { CheckoutOptions, PaymentSuccess } from "@/lib/mealsApi";

// Meal subscriptions (Meal Operations phase 5, 2026-11-10; per meal since 2027-01-10, the user's meal
// page design; JustFit_server/subscriptions/). A member subscribes to one meal: how many a day, a meal
// time, and one of the Super Admin's lengths at its % off.
export type SubscriptionLength = { id: number; label: string; days: number; percentOff: number; active: boolean };
export type DaySlotStatus = "scheduled" | "skipped" | "paused" | "unfilled" | string;
export type Subscription = {
  id: string;
  code: string;
  planId: number | null;
  planName: string;
  // A meal subscription (null for a whole-plan one still running from before 2027-01-10)
  meal: { id: string | null; name: string; slot: MealSlot; quantity: number; unitPrice: number; percentOff: number; imageUrl: string | null } | null;
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
export type Mine = { active: Subscription[]; past: Subscription[] };
export type SubscribeInput = { clientId: string; mealId: string; lengthId: number; quantity: number; slot: MealSlot; startsOn: string; addressId: number };
export type LengthInput = { label: string; days: number; percentOff: number; active: boolean };

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
const call = <T,>(token: string | null, path: string, options: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { ...options, token }) : signedOut<T>();
const id = (value: string) => encodeURIComponent(value);

export const subscriptionsApi = {
  lengths: (token: string | null) => call<{ lengths: SubscriptionLength[] }>(token, "/api/subscriptions/lengths"),
  mine: (token: string | null) => call<Mine>(token, "/api/subscriptions/mine"),
  subscribe: (token: string | null, body: SubscribeInput) =>
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
  adminLengths: (token: string | null) => call<{ lengths: SubscriptionLength[] }>(token, "/api/admin/kitchen/subscription-lengths"),
  saveLengths: (token: string | null, lengths: LengthInput[]) => call<{ lengths: SubscriptionLength[] }>(token, "/api/admin/kitchen/subscription-lengths", { method: "PUT", body: { lengths } }),
  adminList: (token: string | null, status: string | null, search: string) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    const qs = params.toString();
    return call<{ subscriptions: Subscription[] }>(token, `/api/admin/kitchen/subscriptions${qs ? `?${qs}` : ""}`);
  },
  adminOne: (token: string | null, subId: string) => call<{ subscription: Subscription }>(token, `/api/admin/kitchen/subscriptions/${id(subId)}`),
  adminAction: (token: string | null, subId: string, action: "activate" | "pause" | "resume" | "cancel" | "extend", body: Record<string, unknown> = {}) =>
    call<{ subscription: Subscription }>(token, `/api/admin/kitchen/subscriptions/${id(subId)}/${action}`, { method: "POST", body }),
  generate: (token: string | null, day: string) => call<{ date: string; made: number; unfilled: number }>(token, "/api/admin/kitchen/subscriptions/generate", { method: "POST", body: { day } }),
};

