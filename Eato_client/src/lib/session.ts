import { router } from "expo-router";

import { useSetupStore } from "@/store/setup";

// Shown when the server rejects the session token (HTTP 401): the saved session is no
// longer valid, so the only way forward is to sign in again.
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

// True for an API failure caused by an invalid session, never for network or server errors
export function isSessionExpired(result: { ok: boolean; status?: number }): boolean {
  return !result.ok && result.status === 401;
}

let returning = false;

// Ends the stale session and opens the sign-in screen: the same steps as leaving setup
// (see SetupScreen). Repeated taps while this is running are ignored.
export async function returnToSignIn(signOut: (options?: { redirectUrl?: string }) => Promise<unknown>) {
  if (returning) return;
  returning = true;
  try {
    // On web Clerk navigates after signing out (to "/" by default), which would override the
    // replace below, so ask it to land on sign-in; native ignores the URL and uses the replace.
    await signOut({ redirectUrl: "/sign-in" });
  } catch {
    // The session is already invalid on the server; still take the user to sign-in
  }
  useSetupStore.getState().reset();
  router.replace("/sign-in");
  returning = false;
}
