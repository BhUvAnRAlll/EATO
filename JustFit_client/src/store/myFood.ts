import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import type { MemberFood } from "@/lib/mealMatch";
import { fetchProfile } from "@/lib/profile";

// The member's own food answers (diet, allergies, dislikes) for the meal recommendations: read once
// an app session from GET /api/profile, replaced when Food preferences is saved, emptied on sign-out.
// Kept in memory only. `food` is null until read, or when the member has no profile yet (then every
// meal is offered, as the Meals tab does).
type MyFoodState = {
  food: MemberFood | null;
  read: boolean;
  load: (token: string | null) => Promise<void>;
  set: (food: MemberFood) => void;
};

let running: Promise<void> | null = null;

export const useMyFood = create<MyFoodState>((set, get) => ({
  food: null,
  read: false,
  load: async (token) => {
    if (get().read) return;
    if (running) return running;
    running = (async () => {
      const answer = await fetchProfile(token);
      if (!answer.ok) return; // tried again next time a screen asks
      const p = answer.data.profile;
      set({ read: true, food: p ? { diet: p.diet, allergies: p.allergies || null, dislikes: p.dislikes || null } : null });
    })().finally(() => {
      running = null;
    });
    return running;
  },
  set: (food) => set({ food, read: true }),
}));

onAccountCleared(() => useMyFood.setState({ food: null, read: false }));
