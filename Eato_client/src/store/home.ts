import { create } from "zustand";

import { defaultHomeContent, defaultPromotions, sampleNutrition, type HomeContent, type NutritionToday, type Promotion } from "@/data/home";
import { fetchActivePromotions, fetchHomeContent } from "@/lib/home";
import { macro, todayIso, type Totals } from "@/lib/macro";

// Everything the home screen loads: promotions, labels, quick actions, popular meals and
// the member's nutrition targets. Starts with the bundled defaults so the screen never
// flashes empty, then keeps the last successful server answer for the rest of the session:
// a failed refresh leaves the previous content in place. The freshness window also means a
// screen that mounts or re-renders often never floods the server (every authenticated route
// is rate limited per user). Nothing is written to device storage (see AGENTS.md).

// Don't ask the server again within this long of a successful load
const FRESH_FOR_MS = 60 * 1000;

type HomeState = {
  promotions: Promotion[];
  content: HomeContent;
  // The member's targets with today's intake (null until the first load finishes)
  nutrition: NutritionToday | null;
  // "default" until the first successful load, then "server"
  source: "default" | "server";
  loading: boolean;
  // Why the last load failed (the previous content is still shown)
  error: string | null;
  loadedAt: number | null;
  // Loads both parts; `force` ignores the freshness window (pull to refresh, app resumed)
  load: (token: string | null, options?: { force?: boolean }) => Promise<void>;
  // Re-reads today's Macro diary (Home coming back into view)
  refreshIntake: (token: string | null) => Promise<void>;
};

// Today's targets and what was eaten, from the same /api/macro/day call the Macro tab uses,
// so both screens always show the same numbers (null when the day or its targets can't be read)
async function nutritionToday(token: string | null): Promise<NutritionToday | null> {
  const day = await macro.day(token, todayIso());
  if (!day.ok || !day.data.targets) return null;
  const amounts = ({ kcal, proteinG, carbsG, fatG }: Totals) => ({
    calories: Math.round(kcal),
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbsG),
    fatG: Math.round(fatG),
  });
  return { consumed: amounts(day.data.totals), targets: amounts(day.data.targets), source: "targets" };
}

export const useHomeStore = create<HomeState>((set, get) => ({
  promotions: defaultPromotions,
  content: defaultHomeContent,
  nutrition: null,
  source: "default",
  loading: false,
  error: null,
  loadedAt: null,

  load: async (token, { force = false } = {}) => {
    const { loading, loadedAt } = get();
    if (loading) return;
    if (!force && loadedAt !== null && Date.now() - loadedAt < FRESH_FOR_MS) return;
    set({ loading: true });
    const [promotions, content, today] = await Promise.all([fetchActivePromotions(token), fetchHomeContent(token), nutritionToday(token)]);
    // A failed refresh keeps the last real numbers; the bundled sample only until the first real load
    const nutrition = today ?? get().nutrition ?? sampleNutrition;

    const failed = !promotions.ok ? promotions : !content.ok ? content : null;
    if (failed || !promotions.ok || !content.ok) {
      // Keep the previous content; the timestamp still moves so a failing server isn't hammered
      set({ loading: false, error: failed?.error ?? "Something went wrong. Please try again.", nutrition, loadedAt: Date.now() });
      return;
    }
    set({
      promotions: promotions.data.promotions,
      content: content.data.content,
      nutrition,
      source: "server",
      loading: false,
      error: null,
      loadedAt: Date.now(),
    });
  },

  refreshIntake: async (token) => {
    const today = await nutritionToday(token);
    if (today) set({ nutrition: today });
  },
}));
