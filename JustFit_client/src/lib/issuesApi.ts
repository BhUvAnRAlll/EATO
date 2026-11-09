import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { apiFetch, getApiUrl, reportRefusal, type ApiResult } from "@/lib/api";
import { TIMED_OUT, timeoutFor } from "@/lib/apiRules";

// Members' meal problems, customers and reports (Meal Operations phase 6, 2026-11-10;
// JustFit_server/issues/ and reports/)
export type IssueCategory = "cancellation" | "refund" | "missing_meal" | "wrong_meal" | "damaged_food" | "late_delivery" | "failed_delivery" | "subscription" | "other";
export type IssueStatus = "open" | "in_progress" | "resolved" | "rejected";
export type Issue = {
  id: number;
  code: string;
  orderId: string | null;
  orderCode: string | null;
  subscriptionId: string | null;
  category: IssueCategory;
  description: string;
  status: IssueStatus;
  resolutionNote: string | null;
  refund: number | null;
  createdAt: string;
  resolvedAt: string | null;
  // The admin's view only
  photoUrl?: string | null;
  member?: { id: string; name: string | null; phone: string | null };
  assignedTo?: string | null;
  orderTotal?: number | null;
  events?: { action: string; note: string | null; by: string | null; at: string }[];
};
export type IssueAction = "assign" | "progress" | "note" | "resolve" | "reject" | "reopen";
export type Customer = {
  id: string;
  name: string | null;
  phone: string | null;
  joinedAt: string | null;
  preferences: { diet: string | null; cuisines: string[]; dislikes: string | null; allergies: string | null } | null;
  addresses: { id: number; kind: string; line: string; selected: boolean }[];
  orders: { id: string; code: string; date: string; slot: string; status: string; total: number }[];
  subscriptions: { id: string; planName: string; days: number; status: string; startsOn: string; endsOn: string }[];
  issues: Issue[];
};
export type MealReport = {
  from: string;
  to: string;
  business: { revenue: number; subscriptionRevenue: number | null; orders: number; individualOrders: number; subscriptionOrders: number; averageOrder: number | null; days: { day: string; orders: number; revenue: number }[] };
  kitchens: { id: number; name: string; orders: number; delivered: number; prepMinutes: number | null; waste: number; used: number; utilization: number }[] | null;
  delivery: { total: number; delivered: number; failed: number; averageMinutes: number | null; partners: { name: string; delivered: number; failed: number; averageMinutes: number | null }[] } | null;
  subscriptions: { started: number; cancelled: number; completed: number; active: number; paused: number; mealsMade: number; mealsDelivered: number; utilization: number | null } | null;
};

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
const call = <T,>(token: string | null, path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { ...options, token }) : signedOut<T>();

export const issuesApi = {
  mine: (token: string | null) => call<{ issues: Issue[] }>(token, "/api/meal-issues"),
  send: (token: string | null, body: { orderId?: string; subscriptionId?: string; category: IssueCategory; description: string; photo?: { data: string; mediaType: string } }) =>
    call<{ issue: Issue }>(token, "/api/meal-issues", { method: "POST", body }),
  list: (token: string | null, status: IssueStatus | null, search: string) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    const qs = params.toString();
    return call<{ issues: Issue[]; counts: Record<IssueStatus, number> }>(token, `/api/admin/kitchen/issues${qs ? `?${qs}` : ""}`);
  },
  one: (token: string | null, id: number) => call<{ issue: Issue }>(token, `/api/admin/kitchen/issues/${id}`),
  act: (token: string | null, id: number, action: IssueAction, body: { note?: string; refund?: number } = {}) =>
    call<{ issue: Issue }>(token, `/api/admin/kitchen/issues/${id}/${action}`, { method: "POST", body }),
  customer: (token: string | null, userId: string) => call<{ customer: Customer }>(token, `/api/admin/kitchen/customers/${encodeURIComponent(userId)}`),
  report: (token: string | null, from: string, to: string) => call<MealReport>(token, `/api/admin/kitchen/reports?from=${from}&to=${to}`),
};

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The report as an Excel file: shared on a phone, downloaded on the web */
export async function exportMealReport(token: string | null, from: string, to: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: "Please sign in again." };
  const path = "/api/admin/kitchen/reports";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(path));
  let body: ArrayBuffer;
  try {
    const response = await fetch(`${getApiUrl()}${path}?from=${from}&to=${to}&format=xlsx`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!response.ok) {
      reportRefusal(response.status, token, path);
      const answer = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: answer?.error ?? "We couldn't make the report. Please try again." };
    }
    body = await response.arrayBuffer();
  } catch {
    if (controller.signal.aborted) return { ok: false, error: TIMED_OUT };
    return { ok: false, error: "We couldn't reach the server. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
  }
  const name = `meal-report-${from}-to-${to}.xlsx`;
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([body], { type: XLSX_TYPE }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  }
  try {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    await file.write(new Uint8Array(body));
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: "Sharing isn't available on this phone." };
    await Sharing.shareAsync(file.uri, { mimeType: XLSX_TYPE, UTI: "org.openxmlformats.spreadsheetml.sheet", dialogTitle: "Meal operations report" });
    return { ok: true };
  } catch {
    return { ok: false, error: "We couldn't save the report on this phone. Please try again." };
  }
}
