import { apiFetch, type ApiResult } from "@/lib/api";
import type { Role } from "@/lib/roles";

// The justFit server's phone sign-in routes (JustFit_server/auth/routes.js). The shapes below are
// the server's own answers; the role always comes from the server, never from the app.

// The signed-in account (GET /api/auth/me). Email is null for phone accounts.
export type AccountUser = {
  id: string;
  phone: string | null; // +91XXXXXXXXXX
  email: string | null;
  fullName: string | null;
  role: Role;
  profileComplete: boolean;
};

export type CodeSent = { sent: true; retryAfterSeconds: number; expiresInSeconds: number };
export type SignedIn = { token: string; expiresAt: string; user: AccountUser & { isNew: boolean } };

// Sends a sign-in code by SMS. `phone` is the 10 digits.
export function requestCode(phone: string): Promise<ApiResult<CodeSent>> {
  return apiFetch<CodeSent>("/api/auth/request-otp", { method: "POST", body: { phone } });
}

// Checks the code; on success the account is signed in on this device
export function verifyCode(phone: string, code: string): Promise<ApiResult<SignedIn>> {
  return apiFetch<SignedIn>("/api/auth/verify-otp", { method: "POST", body: { phone, code } });
}

export function fetchAccount(token: string): Promise<ApiResult<{ user: AccountUser }>> {
  return apiFetch<{ user: AccountUser }>("/api/auth/me", { token });
}

// Ends this device's session, or (everywhere) every session of the account
export function endSession(token: string, everywhere = false): Promise<ApiResult<{ signedOut: true }>> {
  return apiFetch<{ signedOut: true }>(everywhere ? "/api/auth/logout-all" : "/api/auth/logout", { method: "POST", token });
}
