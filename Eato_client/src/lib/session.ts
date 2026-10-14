import { useCallback, useEffect, useRef } from "react";
import { router } from "expo-router";
import { useAuth } from "@clerk/expo";

import { useSetupStore } from "@/store/setup";

// A stable way to read the Clerk session token. useAuth().getToken is a new function on
// many renders, so an effect that lists it as a dependency can run again after every
// state change (and, on a screen that loads data into state, call the server in a loop).
// This returns the same function for the life of the component; it always calls the
// latest getToken.
export function useSessionToken(): () => Promise<string | null> {
  const { getToken } = useAuth();
  const latest = useRef(getToken);
  useEffect(() => {
    latest.current = getToken;
  }, [getToken]);
  return useCallback(() => latest.current(), []);
}

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
