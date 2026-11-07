import { apiFetch, type ApiResult } from "@/lib/api";

// The member's gym memberships (JustFit_server/gym/membershipRoutes.js, /api/membership): every
// gym_members row on the account's verified phone. The server matches the membership itself;
// the app only sends the membership id it was given and the pause it asks for.
export type PauseStatus = "pending" | "approved" | "rejected" | "cancelled";
// by: who asked (the member from the app, or the gym's staff); note: the gym's reply on a decision
export type MembershipPause = {
  id: number;
  status: PauseStatus;
  by: "member" | "staff";
  from: string;
  until: string;
  days: number;
  reason: string;
  note: string | null;
  extendedDays: number | null;
  requestedAt: string;
  decidedAt: string | null;
};
export type MembershipStatus = "active" | "expiring" | "expired";
// pause: the open one (waiting for the gym, or approved and not over); pausedNow: paused today;
// canPause: whether a new request may be made, with pauseProblem saying why not
export type Membership = {
  id: number;
  gym: { name: string; branch: string; area: string; city: string };
  code: string;
  name: string;
  planLength: { duration: number; unit: "months" | "days" };
  joinedOn: string;
  expiresOn: string;
  daysLeft: number;
  status: MembershipStatus;
  due: number;
  dueBy: string | null;
  pt: { label: string; from: string; until: string; active: boolean } | null;
  pause: MembershipPause | null;
  pausedNow: boolean;
  history: MembershipPause[];
  canPause: boolean;
  pauseProblem: string | null;
  limits: { maxDays: number; maxStartAheadDays: number };
};
export type Memberships = { today: string; memberships: Membership[] };
export type PauseFields = { from: string; until: string; reason: string };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

export const membershipApi = {
  mine: (token: string | null) => (token ? apiFetch<Memberships>("/api/membership", { token }) : signedOut<Memberships>()),
  requestPause: (token: string | null, id: number, fields: PauseFields) =>
    token ? apiFetch<Membership>(`/api/membership/${id}/pause`, { token, method: "POST", body: fields }) : signedOut<Membership>(),
  cancelPause: (token: string | null, id: number, pauseId: number) =>
    token ? apiFetch<Membership>(`/api/membership/${id}/pause/${pauseId}`, { token, method: "DELETE" }) : signedOut<Membership>(),
};
