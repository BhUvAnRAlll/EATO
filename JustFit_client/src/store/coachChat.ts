import { create } from "zustand";

import type { CoachId } from "@/data/coach";
import { onAccountCleared, sameAccount } from "@/lib/accountScope";
import { CHAT_MAX_TEXT, coachApi, type ChatLine, type ChatMessage, type ChatProposals } from "@/lib/coach";
import { isoOf, todayIso } from "@/lib/macro";
import { syncMealReminders } from "@/lib/mealReminders";
import { newId, track } from "@/lib/analytics";

// One line on screen: a saved message, a coach reply (with any plan changes it recommends), or a
// failed send (shown, never saved; tapping it sends it again). `clientId` names the send.
export type ChatTurn = ChatLine & { id: string; clientId?: string; failed?: boolean; proposals?: ChatProposals; createdAt?: string };

// Where one proposal stands: being applied, applied (a meal keeps its undo option), or failed
export type ProposalState = { status: "busy" | "applied" | "failed"; undoId?: string; error?: string };

// The saved conversation: not asked yet, being read, shown, or it couldn't be read
export type ChatLoadStatus = "idle" | "loading" | "ready" | "error";

type CoachChatState = {
  turns: ChatTurn[];
  status: ChatLoadStatus;
  // Whose conversation is shown (from the server)
  coach: CoachId | null;
  loadError: string | null;
  sending: boolean;
  // Keyed by proposalKey
  proposals: Record<string, ProposalState>;
  load: (getToken: () => Promise<string | null>) => Promise<void>;
  send: (getToken: () => Promise<string | null>, text: string, clientId?: string) => Promise<void>;
  retry: (getToken: () => Promise<string | null>, turnId: string) => Promise<void>;
  applyMeal: (getToken: () => Promise<string | null>, turnId: string, mealId: string, optionId: string) => Promise<void>;
  undoMeal: (getToken: () => Promise<string | null>, turnId: string, mealId: string) => Promise<void>;
  applyWorkout: (getToken: () => Promise<string | null>, turnId: string, weekdays: number[], sessionMinutes: number) => Promise<void>;
  clear: () => void;
};

export const proposalKey = (turnId: string, what: string) => `${turnId}:${what}`;

let nextId = 1;
const unreachable = "Could not reach justFit. Check your connection and try again.";

// A saved message on screen (the screen decides, as it draws, whether its Apply cards still apply)
const toTurn = (message: ChatMessage): ChatTurn => ({
  id: message.id,
  role: message.role,
  text: message.text,
  createdAt: message.createdAt,
  ...(message.proposals ? { proposals: message.proposals } : {}),
});

// A reply's Apply cards are only offered on the day it was written: they change today's plan, and
// an older one may name a meal that isn't in it any more. Checked at render time (against `today`
// as the screen has it), so a card from yesterday goes once midnight has passed.
export const proposalsFor = (turn: ChatTurn, today: string): ChatProposals | undefined =>
  turn.proposals && turn.createdAt && isoOf(new Date(turn.createdAt)) === today ? turn.proposals : undefined;

// The coach chat. The conversation is saved on the server for 7 days, read once when the chat
// first opens in this app session (load), then kept here: each answered send comes back as saved
// and replaces what was shown, so nothing appears twice. A failed send stays only on this screen
// until the app closes. Cleared on sign-out and when the coach changes (the server starts a new
// conversation then); applied changes are saved in the plan.
export const useCoachChatStore = create<CoachChatState>((set, get) => {
  const mark = (key: string, state: ProposalState) => set({ proposals: { ...get().proposals, [key]: state } });
  return {
    turns: [],
    status: "idle",
    coach: null,
    loadError: null,
    sending: false,
    proposals: {},
    load: async (getToken) => {
      if (get().status === "loading" || get().status === "ready") return;
      const stillCurrent = sameAccount();
      set({ status: "loading", loadError: null });
      const result = await coachApi.chatHistory(await getToken().catch(() => null));
      if (!stillCurrent() || get().status !== "loading") return;
      if (result.ok) set({ turns: result.data.messages.map(toTurn), coach: result.data.coach, status: "ready" });
      else set({ status: "error", loadError: result.status ? result.error : unreachable });
    },
    send: async (getToken, text, clientId = newId()) => {
      const clean = text.trim().slice(0, CHAT_MAX_TEXT);
      if (!clean || get().sending || get().status !== "ready") return;
      const stillCurrent = sameAccount();
      const asked: ChatTurn = { id: `local-${nextId++}`, role: "member", text: clean, clientId };
      set({ turns: [...get().turns, asked], sending: true });
      const result = await coachApi.chat(await getToken().catch(() => null), clean, clientId, todayIso());
      if (!stillCurrent() || get().status !== "ready") return;
      if (result.ok) {
        track("ai_chat_sent");
        // The message and the reply as saved take the place of the one shown while sending. The
        // saved message keeps the clientId it was shown under, so the screen keeps it as the
        // same bubble (it doesn't animate in a second time)
        const saved = result.data.messages.map(toTurn).map((turn) => (turn.role === "member" ? { ...turn, clientId } : turn));
        const savedIds = new Set(saved.map((turn) => turn.id));
        const shown = get().turns.filter((turn) => turn.id !== asked.id && !savedIds.has(turn.id));
        set({ turns: [...shown, ...saved], sending: false });
        return;
      }
      const reply: ChatTurn = { id: `local-${nextId++}`, role: "coach", text: result.status ? result.error : unreachable, clientId, failed: true };
      // An unanswered message is marked failed too: it stays on screen but is never sent again,
      // so the coach never sees two member lines in a row and answers the old one
      const shown = get().turns.map((turn) => (turn.id === asked.id ? { ...turn, failed: true } : turn));
      set({ turns: [...shown, reply], sending: false });
    },
    // A failed message is sent again, under the same clientId (so a send the server did answer is
    // never answered twice); it and its error leave the screen and the new attempt goes at the end
    retry: async (getToken, turnId) => {
      const turn = get().turns.find((t) => t.id === turnId);
      // Checked here as well as in send: once the failed bubbles are taken off, a send that bails
      // (the conversation not shown yet) would leave the message gone
      if (!turn?.failed || turn.role !== "member" || !turn.clientId || get().sending || get().status !== "ready") return;
      set({ turns: get().turns.filter((t) => t.clientId !== turn.clientId) });
      await get().send(getToken, turn.text, turn.clientId);
    },
    applyMeal: async (getToken, turnId, mealId, optionId) => {
      const key = proposalKey(turnId, mealId);
      if (get().proposals[key]?.status === "busy") return;
      mark(key, { status: "busy" });
      const date = todayIso();
      const result = await coachApi.replaceMeal(await getToken().catch(() => null), mealId, date, optionId);
      // The meal's reminder follows the new meal (fire and forget: a reminder never fails the change)
      if (result.ok) syncMealReminders(result.data.plan, date).catch(() => {});
      mark(key, result.ok ? { status: "applied", undoId: result.data.undoId } : { status: "failed", error: result.status ? result.error : unreachable });
    },
    undoMeal: async (getToken, turnId, mealId) => {
      const key = proposalKey(turnId, mealId);
      const undoId = get().proposals[key]?.undoId;
      if (!undoId) return;
      mark(key, { status: "busy", undoId });
      const date = todayIso();
      const result = await coachApi.replaceMeal(await getToken().catch(() => null), mealId, date, undoId);
      // Undone: the card offers Apply again (the suggestion is still stored)
      if (result.ok) {
        syncMealReminders(result.data.plan, date).catch(() => {});
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
    clear: () => set({ turns: [], status: "idle", coach: null, loadError: null, sending: false, proposals: {} }),
  };
});

onAccountCleared(() => useCoachChatStore.getState().clear());
