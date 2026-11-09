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
  stock: { items: number; low: number; out: number; expiring: number } | null;
};

// ---- Phase 2: ingredients, stock, menus, recipes ----
export type IngredientCategory = "vegetables" | "fruits" | "grains" | "pulses" | "dairy" | "meat" | "seafood" | "eggs" | "oils" | "spices" | "packaging" | "other";
export type IngredientUnit = "g" | "kg" | "ml" | "l" | "pcs";
export type Ingredient = { id: number; name: string; category: IngredientCategory; unit: IngredientUnit };
export type StockItem = {
  ingredientId: number;
  name: string;
  category: IngredientCategory;
  unit: IngredientUnit;
  quantity: number;
  minQuantity: number;
  unitPrice: number | null;
  supplier: string | null;
  expiresOn: string | null;
  storage: string | null;
  out: boolean;
  low: boolean;
  expiring: boolean;
  expired: boolean;
};
export type StockFilter = "all" | "low" | "out" | "expiring";
export type Inventory = {
  items: StockItem[];
  counts: Record<StockFilter, number>;
  value: number;
  today: { used: { moves: number; value: number }; wasted: { moves: number; value: number } };
};
export type StockMoveKind = "purchase" | "use" | "waste" | "adjust" | "transfer_in" | "transfer_out";
export type StockMove = { id: number; kind: StockMoveKind; quantity: number; balanceAfter: number; unitPrice: number | null; note: string | null; overridden: boolean; otherKitchen: string | null; at: string };
export type StockDetails = { minQuantity: number; unitPrice: number | null; supplier: string | null; expiresOn: string | null; storage: string | null };
export type MoveInput = { kind: "purchase" | "use" | "waste" | "adjust"; quantity: number; unitPrice?: number; note?: string; override?: boolean };
export type KitchenMenuMeal = { id: string; name: string; diet: string; onMenu: boolean; cooks: boolean; available: boolean; prepMinutes: number | null; recipeItems: number };
export type Recipe = { mealId: string; mealName: string; prepMinutes: number | null; items: { ingredientId: number; name: string; unit: IngredientUnit; category: IngredientCategory; quantity: number }[] };

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

  ingredients: (token: string | null, search: string) => call<{ ingredients: Ingredient[] }>(token, `${base}/ingredients${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`),
  addIngredient: (token: string | null, input: Omit<Ingredient, "id">) => call<{ ingredient: Ingredient }>(token, `${base}/ingredients`, { method: "POST", body: input }),
  inventory: (token: string | null, id: number, filter: StockFilter, search: string) =>
    call<Inventory>(token, `${base}/kitchens/${id}/inventory?filter=${filter}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`),
  stockItem: (token: string | null, id: number, ingredientId: number) => call<{ item: StockItem; moves: StockMove[] }>(token, `${base}/kitchens/${id}/inventory/${ingredientId}`),
  saveStock: (token: string | null, id: number, ingredientId: number, details: StockDetails) =>
    call<{ item: StockItem; moves: StockMove[] }>(token, `${base}/kitchens/${id}/inventory/${ingredientId}`, { method: "PUT", body: details }),
  removeStock: (token: string | null, id: number, ingredientId: number) => call<{ removed: boolean }>(token, `${base}/kitchens/${id}/inventory/${ingredientId}`, { method: "DELETE" }),
  move: (token: string | null, id: number, ingredientId: number, input: MoveInput) =>
    call<{ item: StockItem; moves: StockMove[] }>(token, `${base}/kitchens/${id}/inventory/${ingredientId}/moves`, { method: "POST", body: input }),
  transfer: (token: string | null, id: number, ingredientId: number, toKitchenId: number, quantity: number, note?: string) =>
    call<{ item: StockItem; moves: StockMove[] }>(token, `${base}/kitchens/${id}/inventory/${ingredientId}/transfer`, { method: "POST", body: note ? { toKitchenId, quantity, note } : { toKitchenId, quantity } }),
  menu: (token: string | null, id: number) => call<{ meals: KitchenMenuMeal[]; counts: { cooks: number; available: number; all: number } }>(token, `${base}/kitchens/${id}/menu`),
  setMenu: (token: string | null, id: number, mealId: string, cooks: boolean, available: boolean) =>
    call<{ meal: KitchenMenuMeal }>(token, `${base}/kitchens/${id}/menu/${encodeURIComponent(mealId)}`, { method: "PUT", body: { cooks, available } }),
  recipe: (token: string | null, mealId: string) => call<{ recipe: Recipe }>(token, `${base}/meals/${encodeURIComponent(mealId)}/recipe`),
  saveRecipe: (token: string | null, mealId: string, prepMinutes: number | null, items: { ingredientId: number; quantity: number }[]) =>
    call<{ recipe: Recipe }>(token, `${base}/meals/${encodeURIComponent(mealId)}/recipe`, { method: "PUT", body: { prepMinutes, items } }),
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
