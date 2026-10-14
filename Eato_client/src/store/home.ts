import { create } from "zustand";

import { defaultHomeContent, defaultPromotions, sampleNutrition, type HomeContent, type NutritionToday, type Promotion } from "@/data/home";
import { fetchActivePromotions, fetchHomeContent } from "@/lib/home";
import { fetchProfile } from "@/lib/profile";

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
};

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
    const [promotions, content, profile] = await Promise.all([fetchActivePromotions(token), fetchHomeContent(token), fetchProfile(token)]);

    // Targets: the member's saved ones (the diary isn't built yet, so nothing is eaten
    // against them), or the sample numbers when they can't be loaded
    let nutrition: NutritionToday = sampleNutrition;
    if (profile.ok && profile.data.nutrition) {
      const { calories, macros } = profile.data.nutrition.active;
      nutrition = {
        consumed: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        targets: { calories, proteinG: macros.proteinG, carbsG: macros.carbsG, fatG: macros.fatG },
        source: "targets",
      };
    }

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
}));
