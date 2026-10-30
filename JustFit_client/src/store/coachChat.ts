import { create } from "zustand";

import { onAccountCleared, sameAccount } from "@/lib/accountScope";
import { CHAT_MAX_TEXT, coachApi, type ChatLine } from "@/lib/coach";
import { todayIso } from "@/lib/macro";
import { track } from "@/lib/analytics";

// One line on screen: a sent message, a coach reply, or a failed send (shown, never sent back)
export type ChatTurn = ChatLine & { id: number; failed?: boolean };

type CoachChatState = {
  turns: ChatTurn[];
  sending: boolean;
  send: (getToken: () => Promise<string | null>, text: string) => Promise<void>;
  clear: () => void;
};

let nextId = 1;

// The coach chat for this app session. Nothing is saved on the server or the device, so the
// conversation lasts until the app closes or the member signs out.
export const useCoachChatStore = create<CoachChatState>((set, get) => ({
  turns: [],
  sending: false,
  send: async (getToken, text) => {
    const clean = text.trim().slice(0, CHAT_MAX_TEXT);
    if (!clean || get().sending) return;
    const stillCurrent = sameAccount();
    const turns = [...get().turns, { id: nextId++, role: "member" as const, text: clean }];
    set({ turns, sending: true });
    const history = turns.filter((t) => !t.failed).map(({ role, text: line }) => ({ role, text: line }));
    const result = await coachApi.chat(await getToken().catch(() => null), history, todayIso());
    if (!stillCurrent()) return;
    if (result.ok) track("ai_chat_sent");
    const reply: ChatTurn = result.ok
      ? { id: nextId++, role: "coach", text: result.data.reply }
      : { id: nextId++, role: "coach", text: result.status ? result.error : "Could not reach justFit. Check your connection and try again.", failed: true };
    set({ turns: [...get().turns, reply], sending: false });
  },
  clear: () => set({ turns: [], sending: false }),
}));

onAccountCleared(() => useCoachChatStore.getState().clear());
