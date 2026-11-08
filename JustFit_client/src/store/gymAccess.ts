import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import type { StaffArea, StaffOption } from "@/lib/gymApi";

// Role & Permission, on the phone: the areas and the options inside them the signed-in login may
// use at the open branch, as the dashboard last said (GET /api/gym/dashboard → gym.areas,
// gym.options). Screens hide what isn't included; the server refuses it regardless, so this is
// only to keep the portal tidy. Until Home has loaded, nothing is known and nothing is hidden.
type GymAccessState = {
  areas: StaffArea[] | null;
  options: StaffOption[] | null;
  setAreas: (areas: StaffArea[], options?: StaffOption[]) => void;
  clear: () => void;
};

export const useGymAccess = create<GymAccessState>((set) => ({
  areas: null,
  options: null,
  setAreas: (areas, options) =>
    set((state) => (state.areas && state.areas.join() === areas.join() && (state.options ?? []).join() === (options ?? []).join() ? state : { areas, options: options ?? null })),
  clear: () => set({ areas: null, options: null }),
}));

// can("sms") or can("members.add"): whether the signed-in login may use an area, or one option
// inside it (true while nothing is known yet; an option is read from its area until the options
// are known)
export function useCan(): (key: StaffArea | StaffOption) => boolean {
  const areas = useGymAccess((state) => state.areas);
  const options = useGymAccess((state) => state.options);
  return (key) => {
    if (areas === null) return true;
    if (!key.includes(".")) return areas.includes(key as StaffArea);
    return options === null ? areas.includes(key.split(".")[0] as StaffArea) : options.includes(key as StaffOption);
  };
}

onAccountCleared(() => useGymAccess.getState().clear());
