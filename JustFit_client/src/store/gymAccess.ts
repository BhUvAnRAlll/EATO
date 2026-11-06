import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import type { StaffArea } from "@/lib/gymApi";

// Role & Permission, on the phone: the areas the signed-in login may use at the open branch, as
// the dashboard last said (GET /api/gym/dashboard → gym.areas). Screens hide what isn't included;
// the server refuses it regardless, so this is only to keep the portal tidy. Until Home has
// loaded, nothing is known and nothing is hidden.
type GymAccessState = {
  areas: StaffArea[] | null;
  setAreas: (areas: StaffArea[]) => void;
  clear: () => void;
};

export const useGymAccess = create<GymAccessState>((set) => ({
  areas: null,
  setAreas: (areas) => set((state) => (state.areas && state.areas.join() === areas.join() ? state : { areas })),
  clear: () => set({ areas: null }),
}));

// can("sms"): whether the signed-in login may use an area (true while nothing is known yet)
export function useCan(): (area: StaffArea) => boolean {
  const areas = useGymAccess((state) => state.areas);
  return (area) => areas === null || areas.includes(area);
}

onAccountCleared(() => useGymAccess.getState().clear());
