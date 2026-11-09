import { create } from "zustand";

import { onAccountCleared } from "@/lib/accountScope";

// The one undo on offer (lib/undo.ts offerUndo): its line, the keys of what is hidden on screen
// meanwhile (a screen leaves those rows out), and a number that changes with every new offer
export type PendingUndo = { id: number; text: string; keys: string[] };

type UndoState = {
  pending: PendingUndo | null;
  // Keys hidden until the removal is sent (or undone); kept apart so a failed send can show them again
  hidden: string[];
  set: (pending: PendingUndo | null) => void;
  hide: (keys: string[]) => void;
  show: (keys: string[]) => void;
  clear: () => void;
};

export const useUndoStore = create<UndoState>((set) => ({
  pending: null,
  hidden: [],
  set: (pending) => set({ pending }),
  hide: (keys) => set((state) => ({ hidden: [...state.hidden, ...keys.filter((k) => !state.hidden.includes(k))] })),
  show: (keys) => set((state) => ({ hidden: state.hidden.filter((k) => !keys.includes(k)) })),
  clear: () => set({ pending: null, hidden: [] }),
}));

onAccountCleared(() => useUndoStore.getState().clear());
