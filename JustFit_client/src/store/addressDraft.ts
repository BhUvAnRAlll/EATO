import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";
import type { PickedPlace } from "@/lib/addressRules";

// The place picked on Select Delivery Location, handed to the Add / Edit Address form. Held for
// this session only (the saved address lives on the server); cleared when the next add or edit starts.
// `locationAsked`: the Meals tab's Access Location screen was answered this session, so it isn't shown again.
type AddressDraftState = {
  place: PickedPlace | null;
  locationAsked: boolean;
  setPlace: (place: PickedPlace) => void;
  setLocationAsked: () => void;
  clear: () => void;
};

export const useAddressDraft = create<AddressDraftState>((set) => ({
  place: null,
  locationAsked: false,
  setPlace: (place) => set({ place }),
  setLocationAsked: () => set({ locationAsked: true }),
  clear: () => set({ place: null }),
}));

// Another account never inherits the picked place
onAccountCleared(() => useAddressDraft.setState({ place: null, locationAsked: false }));
