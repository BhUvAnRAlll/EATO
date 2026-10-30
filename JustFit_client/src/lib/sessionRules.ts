// The pure rules behind the signed-in session (store/auth.ts uses them): what an account check
// means for the saved token, where a signed-in account lands, and the resend countdown.
// No React Native imports, so they are unit-tested on their own.
import type { Role } from "./roles.ts";

export type SessionStatus = "restoring" | "signedOut" | "signedIn" | "unreachable";

// What the answer to GET /api/auth/me means for the token saved on this device:
//   signedIn     the server accepted it
//   signedOut    the server refused it (401: expired, revoked, logged out elsewhere): forget it
//   unreachable  no answer, or a server error or rate limit: keep it and offer to try again,
//                because the session may well still be valid
export function afterAccountCheck(result: { ok: boolean; status?: number }): Exclude<SessionStatus, "restoring"> {
  if (result.ok) return "signedIn";
  if (result.status === 401) return "signedOut";
  return "unreachable";
}

// The launch check of the token saved on this device, with its dependencies passed in (the
// store passes the real ones; the tests pass fakes). A refused token is cleared; any other
// failure keeps it. Never throws: a storage error counts as "no saved session".
export async function checkSavedSession<User>(deps: {
  readToken: () => Promise<string | null>;
  fetchAccount: (token: string) => Promise<{ ok: true; data: { user: User } } | { ok: false; status?: number }>;
  clearToken: () => Promise<void>;
}): Promise<{ status: Exclude<SessionStatus, "restoring">; token: string | null; user: User | null }> {
  const token = await deps.readToken().catch(() => null);
  if (!token) return { status: "signedOut", token: null, user: null };
  const result = await deps.fetchAccount(token);
  const status = afterAccountCheck(result);
  if (status === "signedIn" && result.ok) return { status, token, user: result.data.user };
  if (status === "signedOut") {
    await deps.clearToken().catch(() => {});
    return { status, token: null, user: null };
  }
  return { status: "unreachable", token, user: null };
}

// What the answer to a logout request means:
//   everywhere  only a confirmed answer signs out: if the server can't be reached, the other
//               devices stay signed in, so this one stays too and the member is told
//   this device always signs out here; `confirmed` says whether the server ended the session
//               as well (a 401 means it had already ended)
export function afterSignOut(result: { ok: boolean; status?: number }, everywhere: boolean): { signOut: boolean; confirmed: boolean } {
  const confirmed = result.ok || result.status === 401;
  return { signOut: confirmed || !everywhere, confirmed };
}

// Shown on Log in after a sign-out the server couldn't confirm
export const UNCONFIRMED_SIGN_OUT =
  "You're signed out on this device, but we couldn't reach justFit to end the session on our side. It ends by itself within 30 days; to end it now, log in and use Sign out of all devices.";

// Where a signed-in account opens: admins their dashboard; members finish
// profile setup first, then home. Role and setup state come from the server's answer only.
export function homeRouteFor(user: { role: Role; profileComplete: boolean }): "/admin" | "/home" | "/setup/personal" {
  if (user.role === "admin") return "/admin";
  return user.profileComplete ? "/home" : "/setup/personal";
}

// Whole seconds left until a resend is allowed (never negative)
export function secondsLeft(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}
