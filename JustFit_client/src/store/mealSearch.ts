import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import { addRecentSearch } from "@/lib/mealRules";

// The Meals tab's recent searches. Kept for this app session only (nothing is stored on the
// device beyond the session token) and emptied on sign-out.
type MealSearchState = {
  recent: string[];
  remember: (query: string) => void;
  forget: (query: string) => void;
  clear: () => void;
};

export const useMealSearchStore = create<MealSearchState>((set) => ({
  recent: [],
  remember: (query) => set((s) => ({ recent: addRecentSearch(s.recent, query) })),
  forget: (query) => set((s) => ({ recent: s.recent.filter((r) => r !== query) })),
  clear: () => set({ recent: [] }),
}));

onAccountCleared(() => useMealSearchStore.getState().clear());
