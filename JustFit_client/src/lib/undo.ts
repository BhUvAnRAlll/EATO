import { AccessibilityInfo, AppState } from "react-native";

import { onAccountCleared } from "@/lib/accountScope";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { UNDO_MS } from "@/lib/undoRules";
import { useUndoStore } from "@/store/undo";

// Undo (2026-11-09, step 5 of the native interactions plan). A reversible removal disappears at
// once and an Undo bar shows for UNDO_MS (components/UndoBar.tsx); shaking the phone does the
// same as its Undo button. The removal itself is sent only when the bar ends, when another undo
// is offered, or when the app goes to the background, so undoing never has to re-create anything
// on the server. A failed send shows the row again with a HUD line. Usage:
//
//   offerUndo({ text: "250 ml removed", keys: [`water:${id}`], commit: () => api.remove(token, id), onDone: reload });
//
// Screens leave out the rows whose key is in useUndoStore's `hidden` (useHiddenKeys).

type Offer = {
  text: string;
  keys: string[];
  // Sends the removal; resolves true once the server has it
  commit: () => Promise<boolean>;
  // After the send (true) or a failed send (false), e.g. to read the list again
  onDone?: (sent: boolean) => void;
};

let current: (Offer & { id: number; timer: ReturnType<typeof setTimeout> }) | null = null;
let nextId = 1;

export function offerUndo(offer: Offer) {
  // One undo at a time: the one on offer is sent now
  void sendPending();
  const id = nextId++;
  const timer = setTimeout(() => void sendPending(id), UNDO_MS);
  current = { ...offer, id, timer };
  const store = useUndoStore.getState();
  store.hide(offer.keys);
  store.set({ id, text: offer.text, keys: offer.keys });
  AccessibilityInfo.announceForAccessibility(`${offer.text}. Undo is available.`);
}

// Undo: show the rows again and send nothing
export function undoPending() {
  if (!current) return;
  const done = current;
  current = null;
  clearTimeout(done.timer);
  const store = useUndoStore.getState();
  store.show(done.keys);
  store.set(null);
  haptic.success();
  AccessibilityInfo.announceForAccessibility("Undone");
}

// Sends the removal on offer (only that one, when `id` is given)
async function sendPending(id?: number) {
  if (!current || (id !== undefined && current.id !== id)) return;
  const done = current;
  current = null;
  clearTimeout(done.timer);
  const store = useUndoStore.getState();
  if (store.pending?.id === done.id) store.set(null);
  let sent = false;
  try {
    sent = await done.commit();
  } catch {
    sent = false;
  }
  if (sent) {
    // Gone on the server: the list reads again, and the keys are let go once it has
    done.onDone?.(true);
    setTimeout(() => useUndoStore.getState().show(done.keys), 3000);
    return;
  }
  useUndoStore.getState().show(done.keys);
  hud.error("Couldn't remove it, so it's back");
  done.onDone?.(false);
}

// Leaving the app sends what is on offer, so a closed app never keeps a half-removed row
AppState.addEventListener("change", (next) => {
  if (next !== "active") void sendPending();
});

// Signing out drops what is on offer: it belonged to the account that left (nothing is sent)
onAccountCleared(() => {
  if (current) clearTimeout(current.timer);
  current = null;
});
