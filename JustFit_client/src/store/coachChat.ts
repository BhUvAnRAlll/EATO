import { create } from "zustand";

import { onAccountCleared, sameAccount } from "@/lib/accountScope";
import { CHAT_MAX_TEXT, coachApi, type ChatLine, type ChatProposals } from "@/lib/coach";
import { todayIso } from "@/lib/macro";
import { track } from "@/lib/analytics";

// One line on screen: a sent message, a coach reply (with any plan changes it recommends), or a
// failed send (shown, never sent back)
export type ChatTurn = ChatLine & { id: number; failed?: boolean; proposals?: ChatProposals };

// Where one proposal stands: being applied, applied (a meal keeps its undo option), or failed
export type ProposalState = { status: "busy" | "applied" | "failed"; undoId?: string; error?: string };

type CoachChatState = {
  turns: ChatTurn[];
  sending: boolean;
  // Keyed by proposalKey
  proposals: Record<string, ProposalState>;
  send: (getToken: () => Promise<string | null>, text: string) => Promise<void>;
  applyMeal: (getToken: () => Promise<string | null>, turnId: number, mealId: string, optionId: string) => Promise<void>;
  undoMeal: (getToken: () => Promise<string | null>, turnId: number, mealId: string) => Promise<void>;
  applyWorkout: (getToken: () => Promise<string | null>, turnId: number, weekdays: number[], sessionMinutes: number) => Promise<void>;
  clear: () => void;
};

export const proposalKey = (turnId: number, what: string) => `${turnId}:${what}`;

let nextId = 1;
const unreachable = "Could not reach justFit. Check your connection and try again.";

// The coach chat for this app session. The conversation isn't saved on the server or the device,
// so it lasts until the app closes or the member signs out; applied changes are saved in the plan.
export const useCoachChatStore = create<CoachChatState>((set, get) => {
  const mark = (key: string, state: ProposalState) => set({ proposals: { ...get().proposals, [key]: state } });
  return {
    turns: [],
    sending: false,
    proposals: {},
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
        ? { id: nextId++, role: "coach", text: result.data.reply, proposals: result.data.proposals }
        : { id: nextId++, role: "coach", text: result.status ? result.error : unreachable, failed: true };
      set({ turns: [...get().turns, reply], sending: false });
    },
    applyMeal: async (getToken, turnId, mealId, optionId) => {
      const key = proposalKey(turnId, mealId);
      if (get().proposals[key]?.status === "busy") return;
      mark(key, { status: "busy" });
      const result = await coachApi.replaceMeal(await getToken().catch(() => null), mealId, todayIso(), optionId);
      mark(key, result.ok ? { status: "applied", undoId: result.data.undoId } : { status: "failed", error: result.status ? result.error : unreachable });
    },
    undoMeal: async (getToken, turnId, mealId) => {
      const key = proposalKey(turnId, mealId);
      const undoId = get().proposals[key]?.undoId;
      if (!undoId) return;
      mark(key, { status: "busy", undoId });
      const result = await coachApi.replaceMeal(await getToken().catch(() => null), mealId, todayIso(), undoId);
      // Undone: the card offers Apply again (the suggestion is still stored)
      if (result.ok) {
        const { [key]: _, ...rest } = get().proposals;
        set({ proposals: rest });
      } else mark(key, { status: "applied", undoId, error: result.status ? result.error : unreachable });
    },
    applyWorkout: async (getToken, turnId, weekdays, sessionMinutes) => {
      const key = proposalKey(turnId, "workout");
      if (get().proposals[key]?.status === "busy") return;
      mark(key, { status: "busy" });
      const result = await coachApi.changeWorkout(await getToken().catch(() => null), todayIso(), weekdays, sessionMinutes);
      mark(key, result.ok ? { status: "applied" } : { status: "failed", error: result.status ? result.error : unreachable });
    },
    clear: () => set({ turns: [], sending: false, proposals: {} }),
  };
});

onAccountCleared(() => useCoachChatStore.getState().clear());
