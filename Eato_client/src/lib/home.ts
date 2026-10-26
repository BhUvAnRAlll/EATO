import type { ImageSource } from "expo-image";

import { homeImages, type HomeImageKey } from "@/constants/images";
import type { HomeContent, Meal, Promotion, PromotionFields } from "@/data/home";
import { apiFetch, type ApiResult } from "@/lib/api";

// Calls for the home screen content (members) and its management (admins).
// `token` is the Clerk session token from useAuth().getToken().

const signedOut = <T>(): ApiResult<T> => ({ ok: false, error: "Please sign in again." });

// An image reference from the server → something <Image> can show. "asset:<key>" is a
// bundled image; anything else is an https URL (the server allows nothing else). Unknown
// keys fall back to the first hero image rather than a broken picture.
export function resolveImage(imageUrl: string | null | undefined): number | ImageSource {
  if (!imageUrl) return homeImages["hero-bowl"];
  if (imageUrl.startsWith("asset:")) {
    const key = imageUrl.slice("asset:".length);
    return key in homeImages ? homeImages[key as HomeImageKey] : homeImages["hero-bowl"];
  }
  return { uri: imageUrl };
}

// Members ------------------------------------------------------------------

export async function fetchActivePromotions(token: string | null): Promise<ApiResult<{ promotions: Promotion[] }>> {
  if (!token) return signedOut();
  return apiFetch("/api/promotions/active", { token });
}

export async function fetchHomeContent(token: string | null): Promise<ApiResult<{ content: HomeContent }>> {
  if (!token) return signedOut();
  return apiFetch("/api/home-content", { token });
}

// Admins -------------------------------------------------------------------

// What the server accepts when saving the home screen settings (everything but the
// read-only popularMeals and updatedAt)
export type HomeContentInput = Omit<HomeContent, "popularMeals" | "updatedAt">;

export const adminHome = {
  listPromotions(token: string | null): Promise<ApiResult<{ promotions: Promotion[] }>> {
    if (!token) return Promise.resolve(signedOut());
    return apiFetch("/api/admin/promotions", { token });
  },
  getPromotion(token: string | null, id: number): Promise<ApiResult<{ promotion: Promotion }>> {
    if (!token) return Promise.resolve(signedOut());
    return apiFetch(`/api/admin/promotions/${id}`, { token });
  },
  createPromotion(token: string | null, fields: PromotionFields): Promise<ApiResult<{ promotion: Promotion }>> {
    if (!token) return Promise.resolve(signedOut());
    return apiFetch("/api/admin/promotions", { method: "POST", body: fields, token });
  },
  updatePromotion(token: string | null, id: number, changes: Partial<PromotionFields>): Promise<ApiResult<{ promotion: Promotion }>> {
    if (!token) return Promise.resolve(signedOut());
    return apiFetch(`/api/admin/promotions/${id}`, { method: "PATCH", body: changes, token });
  },
  deletePromotion(token: string | null, id: number): Promise<ApiResult<{ deleted: true }>> {
    if (!token) return Promise.resolve(signedOut());
    return apiFetch(`/api/admin/promotions/${id}`, { method: "DELETE", token });
  },
  // "publish" or "disable"
  setPromotionStatus(token: string | null, id: number, action: "publish" | "disable"): Promise<ApiResult<{ promotion: Promotion }>> {
    if (!token) return Promise.resolve(signedOut());
    return apiFetch(`/api/admin/promotions/${id}/${action}`, { method: "POST", token });
  },
  // The complete new order: every promotion id exactly once
  reorderPromotions(token: string | null, ids: number[]): Promise<ApiResult<{ promotions: Promotion[] }>> {
    if (!token) return Promise.resolve(signedOut());
    return apiFetch("/api/admin/promotions/reorder", { method: "POST", body: { ids }, token });
  },
  getHomeContent(token: string | null): Promise<ApiResult<{ content: HomeContent }>> {
    if (!token) return Promise.resolve(signedOut());
    return apiFetch("/api/admin/home-content", { token });
  },
  saveHomeContent(token: string | null, content: HomeContentInput): Promise<ApiResult<{ content: HomeContent }>> {
    if (!token) return Promise.resolve(signedOut());
    return apiFetch("/api/admin/home-content", { method: "PUT", body: content, token });
  },
  listMeals(token: string | null): Promise<ApiResult<{ meals: Meal[] }>> {
    if (!token) return Promise.resolve(signedOut());
    return apiFetch("/api/admin/meals", { token });
  },
};
