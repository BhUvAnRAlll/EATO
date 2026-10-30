import { useCallback } from "react";
import { router } from "expo-router";

import { useAuthStore } from "@/store/auth";

// The session token for API calls (store/auth.ts holds it). The same function for the life of
// the component, so an effect that lists it as a dependency runs only when it means to; it
// always returns the current token (null when signed out).
export function useSessionToken(): () => Promise<string | null> {
  return useCallback(async () => useAuthStore.getState().token, []);
}

// Shown when the server rejects the session token (HTTP 401): the saved session is no
// longer valid, so the only way forward is to sign in again.
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

// True for an API failure caused by an invalid session, never for network or server errors
export function isSessionExpired(result: { ok: boolean; status?: number }): boolean {
  return !result.ok && result.status === 401;
}

let returning = false;

// The server refused the session: forget it on this device (and the setup answers with it) and
// open sign-in. Repeated taps while this is running are ignored.
export async function returnToSignIn() {
  if (returning) return;
  returning = true;
  try {
    await useAuthStore.getState().forget();
  } finally {
    router.replace("/sign-in");
    returning = false;
  }
}
