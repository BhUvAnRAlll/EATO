import { apiFetch, type ApiResult } from "@/lib/api";
import type { Icon } from "@/types/profile";

// The Macro diary: types, the calls to /api/macro on the justFit server, and the date and
// number helpers the macro screens share. Dates are the member's LOCAL day as YYYY-MM-DD.

export type Slot = "breakfast" | "lunch" | "snack" | "dinner";
export type Totals = { kcal: number; proteinG: number; carbsG: number; fatG: number };
export type MealItem = { name: string; quantity: number; unit: string } & Totals;
export type MealSource = "manual" | "favorite" | "repeat";
export type Meal = { id: string; date: string; slot: Slot; title: string; loggedAt: string; source: MealSource; items: MealItem[]; totals: Totals };
export type DayView = { date: string; targets: Totals | null; totals: Totals; burned: number; meals: Meal[] };
export type DayStatus = "none" | "complete" | "partial" | "low";
export type DayProgress = { date: string; kcal: number; target: number | null; ratio: number; status: DayStatus };
export type Period = "today" | "week" | "month";
export type Summary = { period: Period; days: number; avg: Totals; targets: Totals; trend: { date: string; kcal: number }[]; trendAvg: number };
export type TargetStatus =
  | { status: "incomplete" }
  | ({ status: "ready"; source: "calculated" | "user_adjusted"; isManual: boolean; canReset: boolean; calculated: Totals | null; updatedAt: string } & Totals);
export type WaterEntry = { id: string; amountMl: number; loggedAt: string; source: "quick_add" | "custom" | "workout"; label: string | null };
export type WaterPreferences = { remindersEnabled: boolean; intervalHours: number; startHour: number; endHour: number };
export type WaterDay = {
  date: string;
  targetMl: number;
  baseTargetMl: number;
  activityAdjustmentMl: number;
  workoutAdjustmentMl: number;
  workoutMinutes: number | null;
  consumedMl: number;
  remainingMl: number;
  progress: number;
  usedFallbacks: boolean;
  // Set when a health flag means "follow your doctor's advice" (no goal is shown then)
  medicalNote: string | null;
  entries: WaterEntry[];
  preferences: WaterPreferences;
};
// An UNCONFIRMED estimate from a food photo: the member checks it, then logs it with logMeal
export type FoodScan = { title: string; items: MealItem[] };
export type Favorite = { id: string; name: string; sourceKey: string | null; items: MealItem[]; totals: Totals; createdAt: string };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const query = (params: Record<string, string | number>) =>
  "?" + Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join("&");

export const macro = {
  day(token: string | null, date: string): Promise<ApiResult<DayView>> {
    if (!token) return signedOut();
    return apiFetch(`/api/macro/day${query({ date })}`, { token });
  },
  progress(token: string | null, dates: string[]): Promise<ApiResult<{ days: DayProgress[] }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/macro/progress${query({ dates: dates.join(",") })}`, { token });
  },
  recent(token: string | null, today: string, limit = 12): Promise<ApiResult<{ meals: Meal[] }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/macro/recent${query({ today, limit })}`, { token });
  },
  logMeal(
    token: string | null,
    meal: { date: string; slot: Slot; title: string; loggedAt: number; source?: "manual" | "repeat"; items: MealItem[] },
  ): Promise<ApiResult<{ mealId: string }>> {
    if (!token) return signedOut();
    return apiFetch("/api/macro/meals", { method: "POST", body: meal, token });
  },
  // Sends one food photo (base64) for an AI estimate. Nothing is saved.
  scanFood(token: string | null, photo: { data: string; hint?: string }): Promise<ApiResult<{ scan: FoodScan }>> {
    if (!token) return signedOut();
    // The picker re-encodes to JPEG on phones; on the web the file keeps its own type
    const mediaType = photo.data.startsWith("iVBOR") ? "image/png" : photo.data.startsWith("UklGR") ? "image/webp" : "image/jpeg";
    return apiFetch("/api/macro/scan", { method: "POST", body: { data: photo.data, mediaType, hint: photo.hint ?? "" }, token });
  },
  deleteMeal(token: string | null, mealId: string): Promise<ApiResult<{ deleted: true }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/macro/meals/${mealId}`, { method: "DELETE", token });
  },
  // Averages per day over today, the last 7 or the last 30 days, and the 7-day trend.
  // `summary` is null when the member has no target yet.
  summary(token: string | null, period: Period, today: string): Promise<ApiResult<{ summary: Summary | null }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/macro/summary${query({ period, today })}`, { token });
  },
  targets(token: string | null): Promise<ApiResult<TargetStatus>> {
    if (!token) return signedOut();
    return apiFetch("/api/macro/targets", { token });
  },
  // A macro left out is split from the calories for the member's goal
  setTargets(token: string | null, targets: { kcal: number; proteinG?: number; carbsG?: number; fatG?: number }): Promise<ApiResult<TargetStatus>> {
    if (!token) return signedOut();
    return apiFetch("/api/macro/targets", { method: "PUT", body: targets, token });
  },
  resetTargets(token: string | null): Promise<ApiResult<TargetStatus>> {
    if (!token) return signedOut();
    return apiFetch("/api/macro/targets/reset", { method: "POST", token });
  },
  water(token: string | null, date: string): Promise<ApiResult<WaterDay>> {
    if (!token) return signedOut();
    return apiFetch(`/api/macro/water${query({ date })}`, { token });
  },
  logWater(token: string | null, entry: { date: string; amountMl: number; source: "quick_add" | "custom"; label?: string }): Promise<ApiResult<{ entryId: string; amountMl: number }>> {
    if (!token) return signedOut();
    return apiFetch("/api/macro/water", { method: "POST", body: entry, token });
  },
  removeWater(token: string | null, entryId: string): Promise<ApiResult<{ removed: true }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/macro/water/${entryId}`, { method: "DELETE", token });
  },
  setReminders(token: string | null, settings: { remindersEnabled: boolean }): Promise<ApiResult<{ preferences: WaterPreferences }>> {
    if (!token) return signedOut();
    return apiFetch("/api/macro/water/reminders", { method: "PUT", body: settings, token });
  },
  favorites(token: string | null): Promise<ApiResult<{ favorites: Favorite[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/macro/favorites", { token });
  },
  removeFavorite(token: string | null, favoriteId: string): Promise<ApiResult<{ removed: true }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/macro/favorites/${favoriteId}`, { method: "DELETE", token });
  },
  // Copies the member's own favourite into a new meal (the server checks it is theirs)
  logFavorite(token: string | null, favoriteId: string, meal: { date: string; slot: Slot; loggedAt: number }): Promise<ApiResult<{ mealId: string }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/macro/favorites/${favoriteId}/log`, { method: "POST", body: meal, token });
  },
  // With `sourceKey` ("meal:<id>") a second call removes the favourite again
  toggleFavorite(token: string | null, favorite: { name: string; items: MealItem[]; sourceKey?: string }): Promise<ApiResult<{ favorited: boolean; favoriteId?: string }>> {
    if (!token) return signedOut();
    return apiFetch("/api/macro/favorites/toggle", { method: "POST", body: favorite, token });
  },
};

// ---- dates ----------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// Local noon avoids daylight-saving edges when stepping days
export const dateOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
export const todayIso = () => isoOf(new Date());
export const addDays = (iso: string, days: number) => {
  const date = dateOf(iso);
  date.setDate(date.getDate() + days);
  return isoOf(date);
};
// Seven days, oldest first, ending on `anchor`
export const weekEnding = (anchor: string) => Array.from({ length: 7 }, (_, i) => addDays(anchor, i - 6));
export const isValidIso = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && isoOf(dateOf(value)) === value;

// "Monday 14 October"
export const longDate = (iso: string) => dateOf(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
export const weekdayInitial = (iso: string) => dateOf(iso).toLocaleDateString("en-GB", { weekday: "narrow" });
// "7:30 AM"
export const clockTime = (isoTimestamp: string) => new Date(isoTimestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
export const timeLabel = (hour: number, minute: number) => {
  const date = new Date(2000, 0, 1, hour, minute);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
// Today / Yesterday / MM/DD
export const dayLabel = (iso: string, today: string) => {
  if (iso === today) return "Today";
  if (iso === addDays(today, -1)) return "Yesterday";
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
};

// ---- slots ----------------------------------------------------------------------

export const slots: Slot[] = ["breakfast", "lunch", "snack", "dinner"];
export const slotInfo: Record<Slot, { label: string; window: string; icon: Icon; tint: string; start: [number, number]; end: [number, number]; defaultTime: [number, number] }> = {
  breakfast: { label: "Breakfast", window: "6:00 – 10:00", icon: { ios: "sunrise.fill", android: "wb_twilight", web: "wb_twilight" }, tint: "#F5A524", start: [6, 0], end: [10, 0], defaultTime: [7, 30] },
  lunch: { label: "Lunch", window: "12:00 – 14:00", icon: { ios: "sun.max.fill", android: "light_mode", web: "light_mode" }, tint: "#3A6B27", start: [12, 0], end: [14, 0], defaultTime: [12, 30] },
  snack: { label: "Snack", window: "Anytime", icon: { ios: "carrot.fill", android: "cookie", web: "cookie" }, tint: "#7C6CF0", start: [6, 0], end: [22, 0], defaultTime: [15, 30] },
  dinner: { label: "Dinner", window: "18:00 – 21:00", icon: { ios: "moon.stars.fill", android: "dark_mode", web: "dark_mode" }, tint: "#5B9CF8", start: [18, 0], end: [21, 0], defaultTime: [19, 0] },
};
// The slot that fits the clock (used when a screen is opened without one)
export const slotForNow = (date = new Date()): Slot => {
  const h = date.getHours();
  return h < 10 ? "breakfast" : h < 14 ? "lunch" : h < 17 ? "snack" : "dinner";
};
// Half-hour times across a slot's window
export const slotTimes = (slot: Slot) => {
  const { start, end } = slotInfo[slot];
  const times: [number, number][] = [];
  for (let minutes = start[0] * 60 + start[1]; minutes <= end[0] * 60 + end[1]; minutes += 30) times.push([Math.floor(minutes / 60), minutes % 60]);
  return times;
};

// When a logged meal happened: the chosen hour and minute (from Add meal) on the selected day,
// or now when the screen was opened without them
export function loggedAtFor(date: string, hour?: string, minute?: string) {
  const at = dateOf(date);
  const now = new Date();
  const h = hour !== undefined && hour !== "" && Number.isInteger(Number(hour)) ? Number(hour) : now.getHours();
  const m = minute !== undefined && minute !== "" && Number.isInteger(Number(minute)) ? Number(minute) : now.getMinutes();
  at.setHours(h, m, 0, 0);
  return at.getTime();
}

export const sourceLabel: Record<MealSource, string> = { manual: "Logged", favorite: "From favourites", repeat: "Repeated" };

// ---- numbers --------------------------------------------------------------------

// 2140 → "2.1"
export const litres = (ml: number) => (Math.round(ml / 100) / 10).toFixed(1);
// "8 AM", "8 PM"
export const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;

export const kcalOf = (macros: { proteinG: number; carbsG: number; fatG: number }) => macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
// Each macro's share of the calories, in whole percentages that add up to 100 (protein and
// carbs 4 kcal/g, fat 9). With nothing eaten it falls back to an even third each.
export function calorieSplit(m: { proteinG: number; carbsG: number; fatG: number }) {
  const p = m.proteinG * 4, c = m.carbsG * 4, f = m.fatG * 9;
  const total = p + c + f;
  if (total <= 0) return { protein: 34, carbs: 33, fat: 33, empty: true };
  const protein = Math.round((p / total) * 100);
  const carbs = Math.round((c / total) * 100);
  return { protein, carbs, fat: Math.max(0, 100 - protein - carbs), empty: false };
}
// Macros "close enough" to the typed calories: within 15% (a nudge, never a block)
export const macrosAgree = (kcal: number, macroKcal: number) => Math.abs(macroKcal - kcal) <= kcal * 0.15;
export const whole = (n: number) => Math.round(n);
