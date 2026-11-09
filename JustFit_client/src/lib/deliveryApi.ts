import { apiFetch, type ApiResult } from "@/lib/api";

// Delivery partners (Meal Operations phase 4, 2026-11-10): Super Admin only
// (JustFit_server/delivery/, under /api/admin/kitchen; the server checks the role every time).
export type Vehicle = "bike" | "scooter" | "bicycle" | "car" | "on_foot";
export type IdStatus = "pending" | "verified" | "rejected";
export type Partner = {
  id: number;
  name: string;
  phone: string;
  vehicle: Vehicle;
  vehicleNumber: string | null;
  idStatus: IdStatus;
  active: boolean;
  available: boolean;
  maxOrders: number;
  note: string | null;
  carrying: number;
  deliveredToday: number;
  pincodes: string[];
};
export type PartnerInput = Omit<Partner, "id" | "carrying" | "deliveredToday">;
export type DeliveryBoard = {
  partners: Partner[];
  counts: { partners: number; free: number; unassigned: number; assigned: number; ongoing: number; failed: number; delivered: number };
};

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
const call = <T,>(token: string | null, path: string, options: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { ...options, token }) : signedOut<T>();
const base = "/api/admin/kitchen/delivery";

export const deliveryApi = {
  board: (token: string | null) => call<DeliveryBoard>(token, `${base}/board`),
  partner: (token: string | null, id: number) => call<{ partner: Partner }>(token, `${base}/partners/${id}`),
  add: (token: string | null, input: PartnerInput) => call<{ partner: Partner }>(token, `${base}/partners`, { method: "POST", body: input }),
  edit: (token: string | null, id: number, input: PartnerInput) => call<{ partner: Partner }>(token, `${base}/partners/${id}`, { method: "PUT", body: input }),
  setAvailable: (token: string | null, id: number, available: boolean) => call<{ partner: Partner }>(token, `${base}/partners/${id}/availability`, { method: "POST", body: { available } }),
};
