import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import type { PickedPlace } from "@/lib/addressRules";

// The place picked on Select Delivery Location, handed to the Add / Edit Address form. Held for
// this session only (the saved address lives on the server); cleared when the next add or edit starts.
type AddressDraftState = {
  place: PickedPlace | null;
  setPlace: (place: PickedPlace) => void;
  clear: () => void;
};

export const useAddressDraft = create<AddressDraftState>((set) => ({
  place: null,
  setPlace: (place) => set({ place }),
  clear: () => set({ place: null }),
}));

// Another account never inherits the picked place
onAccountCleared(() => useAddressDraft.getState().clear());
