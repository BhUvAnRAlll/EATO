import { create } from "zustand";

import { endSession, fetchAccount, type AccountUser } from "@/lib/account";
import { clearAccountData } from "@/lib/accountScope";
import { afterSignOut, checkSavedSession, UNCONFIRMED_SIGN_OUT, type SessionStatus } from "@/lib/sessionRules";
import { clearToken, readToken, saveToken } from "@/lib/tokenStorage";

// The signed-in session: the token (kept in secure storage, see lib/tokenStorage.ts) and the
// account as the server last described it. The app shows screens from `status` and `user`;
// the server decides everything that matters on every request.
type AuthState = {
  status: SessionStatus;
  token: string | null;
  user: AccountUser | null;
  // A line for Log in after a sign-out the server couldn't confirm (null otherwise)
  notice: string | null;
  // Reads the saved token and asks the server who it belongs to (once at launch, and on "Try again")
  restore: () => Promise<void>;
  // A code was verified: keep the new session
  signedIn: (token: string, user: AccountUser) => Promise<void>;
  // The server confirmed a change (a saved setup, a new name)
  updateUser: (changes: Partial<AccountUser>) => void;
  // Ends the session here; with everywhere, on every device (only once the server confirms).
  // Signing out here always succeeds on this device; if the server couldn't confirm it,
  // `notice` says so on Log in.
  signOut: (options?: { everywhere?: boolean }) => Promise<{ ok: true } | { ok: false; error: string }>;
  // The server refused the token (401): forget it on this device without asking the server
  forget: () => Promise<void>;
};

// One account check at a time: a second call during a check waits for the same one
let restoring: Promise<void> | null = null;

const signedOutState = { status: "signedOut" as const, token: null, user: null };

// The one way an account's data leaves this device: the saved token, and everything the stores
// hold for the account (they register themselves, see lib/accountScope.ts). Answers to requests
// still on their way are dropped when they arrive.
async function wipeLocalSession() {
  clearAccountData();
  await clearToken().catch(() => {});
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "restoring",
  token: null,
  user: null,
  notice: null,

  restore: () => {
    restoring ??= (async () => {
      set({ status: "restoring" });
      const checked = await checkSavedSession({ readToken, fetchAccount, clearToken });
      // A refused token is gone; so is everything that came with that account
      if (checked.status === "signedOut") clearAccountData();
      set(checked); // unreachable keeps the token: it may still be valid
    })().finally(() => {
      restoring = null;
    });
    return restoring;
  },

  signedIn: async (token, user) => {
    clearAccountData(); // nothing from an earlier account carries over to this one
    await saveToken(token);
    set({ status: "signedIn", token, user, notice: null });
  },

  updateUser: (changes) => {
    const user = get().user;
    if (user) set({ user: { ...user, ...changes } });
  },

  signOut: async ({ everywhere = false } = {}) => {
    const token = get().token;
    let confirmed = true; // no token: there is no session to end
    if (token) {
      const result = await endSession(token, everywhere);
      const outcome = afterSignOut(result, everywhere);
      if (!outcome.signOut && !result.ok) return { ok: false, error: result.error };
      confirmed = outcome.confirmed;
    }
    await wipeLocalSession();
    set({ ...signedOutState, notice: confirmed ? null : UNCONFIRMED_SIGN_OUT });
    return { ok: true };
  },

  forget: async () => {
    await wipeLocalSession();
    set({ ...signedOutState, notice: null });
  },
}));
