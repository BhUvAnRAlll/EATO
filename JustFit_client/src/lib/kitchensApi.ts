import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { apiFetch, getApiUrl, reportRefusal, type ApiResult } from "@/lib/api";
import { TIMED_OUT, timeoutFor } from "@/lib/apiRules";
import type { OpeningHours } from "@/lib/gymProfile";

// Kitchens and the meal-operations dashboard (Meal Operations phase 1, 2026-11-10): Super Admin
// only (JustFit_server/kitchens/, under /api/admin/kitchen; the server checks the role every time).
export type KitchenStatus = "active" | "inactive" | "temporarily_closed" | "maintenance";
export type StaffRole = "manager" | "chef" | "prep";
export type KitchenStaff = { id: number; name: string; phone: string; role: StaffRole; available: boolean; note: string | null };
export type Kitchen = {
  id: number;
  code: string;
  name: string;
  contactName: string;
  phone: string;
  email: string | null;
  address: string;
  area: string | null;
  city: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  hours: OpeningHours;
  openNow: boolean;
  maxDailyOrders: number;
  prepCapacity: number;
  radiusKm: number;
  status: KitchenStatus;
  statusNote: string | null;
  statusChangedAt: string | null;
  photoUrl: string | null;
  pincodeCount?: number;
  staffCount?: number;
  pincodes?: string[];
  staff?: KitchenStaff[];
};
export type KitchenCounts = Record<"all" | KitchenStatus, number>;
export type KitchenInput = {
  name: string;
  contactName: string;
  phone: string;
  email: string | null;
  address: string;
  area: string | null;
  city: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  hours: OpeningHours;
  pincodes: string[];
  maxDailyOrders: number;
  prepCapacity: number;
  radiusKm: number;
  photo?: { data: string; mediaType: string };
  removePhoto?: true;
};
export type StaffInput = { name: string; phone: string; role: StaffRole; available: boolean; note: string | null };
export type MealOpsDashboard = {
  day: string;
  today: string;
  orders: {
    total: number;
    individual: number;
    subscription: number | null;
    steps: Record<"placed" | "preparing" | "out_for_delivery" | "delivered" | "cancelled", number>;
    open: number;
    delayed: number;
    bySlot: Record<"breakfast" | "lunch" | "dinner", number>;
  };
  revenue: { orders: number; amount: number };
  upcoming: { date: string; orders: number }[];
  kitchens: { counts: KitchenCounts; activeCapacity: number; load: number | null };
  delivery: null;
  subscriptions: null;
  stock: null;
};

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
const call = <T,>(token: string | null, path: string, options: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { ...options, token }) : signedOut<T>();
const base = "/api/admin/kitchen";

export const kitchensApi = {
  dashboard: (token: string | null, day: string) => call<MealOpsDashboard>(token, `${base}/dashboard?day=${encodeURIComponent(day)}`),
  list: (token: string | null, query: { status?: KitchenStatus | null; search?: string }) => {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.search?.trim()) params.set("search", query.search.trim());
    const qs = params.toString();
    return call<{ kitchens: Kitchen[]; counts: KitchenCounts }>(token, `${base}/kitchens${qs ? `?${qs}` : ""}`);
  },
  get: (token: string | null, id: number) => call<{ kitchen: Kitchen }>(token, `${base}/kitchens/${id}`),
  create: (token: string | null, input: KitchenInput) => call<{ kitchen: Kitchen }>(token, `${base}/kitchens`, { method: "POST", body: input }),
  update: (token: string | null, id: number, input: KitchenInput) => call<{ kitchen: Kitchen }>(token, `${base}/kitchens/${id}`, { method: "PUT", body: input }),
  setStatus: (token: string | null, id: number, status: KitchenStatus, note: string | null) =>
    call<{ kitchen: Kitchen }>(token, `${base}/kitchens/${id}/status`, { method: "POST", body: note ? { status, note } : { status } }),
  addStaff: (token: string | null, id: number, input: StaffInput) => call<{ kitchen: Kitchen }>(token, `${base}/kitchens/${id}/staff`, { method: "POST", body: input }),
  editStaff: (token: string | null, id: number, staffId: number, input: StaffInput) =>
    call<{ kitchen: Kitchen }>(token, `${base}/kitchens/${id}/staff/${staffId}`, { method: "PUT", body: input }),
  removeStaff: (token: string | null, id: number, staffId: number) => call<{ kitchen: Kitchen }>(token, `${base}/kitchens/${id}/staff/${staffId}`, { method: "DELETE" }),
};

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The day's orders as an Excel file: shared on a phone (Save to Files, Drive, email…), downloaded on the web */
export async function exportOrdersReport(token: string | null, day: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: "Please sign in again." };
  const path = `${base}/report`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(path));
  let report: ArrayBuffer;
  try {
    const response = await fetch(`${getApiUrl()}${path}?day=${encodeURIComponent(day)}&format=xlsx`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!response.ok) {
      reportRefusal(response.status, token, path);
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? "We couldn't make the report. Please try again." };
    }
    report = await response.arrayBuffer();
  } catch {
    if (controller.signal.aborted) return { ok: false, error: TIMED_OUT };
    return { ok: false, error: "We couldn't reach the server. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
  }
  const name = `meal-orders-${day}.xlsx`;
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([report], { type: XLSX_TYPE }));
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
    await file.write(new Uint8Array(report));
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: "Sharing isn't available on this phone." };
    await Sharing.shareAsync(file.uri, { mimeType: XLSX_TYPE, UTI: "org.openxmlformats.spreadsheetml.sheet", dialogTitle: "Meal orders report" });
    return { ok: true };
  } catch {
    return { ok: false, error: "We couldn't save the report on this phone. Please try again." };
  }
}
