import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import { mealsApi, type Storefront } from "@/lib/mealsApi";

// The Meals tab's storefront (meals, categories, banners, coupons), read once and shared with the
// browse screens. A read within FRESH_MS reuses it; a pull or the tab coming back after that reads
// again. A heart changes it in place.
const FRESH_MS = 60_000;

type StorefrontLoad = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: Storefront; at: number };

type StorefrontState = {
  load: StorefrontLoad;
  read: (token: string | null, options?: { force?: boolean }) => Promise<void>;
  setFavorite: (mealId: string, favorite: boolean) => void;
};

let running: Promise<void> | null = null;

export const useStorefront = create<StorefrontState>((set, get) => ({
  load: { state: "loading" },
  read: async (token, { force = false } = {}) => {
    const current = get().load;
    if (!force && current.state === "ready" && Date.now() - current.at < FRESH_MS) return;
    if (running) return running;
    running = (async () => {
      const answer = await mealsApi.storefront(token);
      const before = get().load;
      if (answer.ok) set({ load: { state: "ready", data: answer.data, at: Date.now() } });
      else if (before.state !== "ready") set({ load: { state: "failed", error: answer.error } });
    })().finally(() => {
      running = null;
    });
    return running;
  },
  setFavorite: (mealId, favorite) =>
    set((state) =>
      state.load.state === "ready"
        ? { load: { ...state.load, data: { ...state.load.data, meals: state.load.data.meals.map((m) => (m.id === mealId ? { ...m, favorite } : m)) } } }
        : state,
    ),
}));

// Another account never sees this one's hearts or coupons
onAccountCleared(() => useStorefront.setState({ load: { state: "loading" } }));
