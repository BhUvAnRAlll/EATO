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
  // Suspended or cancelled by the gym (2027-01-01); absent from an older server
  standing?: "active" | "suspended" | "cancelled";
  standingNote?: string | null;
  // What the gym's pause policy leaves in these 12 months (null: no limit)
  pauseAllowance?: PauseAllowance;
};
export type PauseAllowance = { pausesLeft: number | null; daysLeft: number | null; used: { count: number; days: number }; policy: { maxPerYear: number | null; maxDaysPerYear: number | null; maxDaysEach: number } };
export type Memberships = { today: string; memberships: Membership[] };
export type PauseFields = { from: string; until: string; reason: string };

// Gym Hub's membership page (GET /api/membership/:id?month=YYYY-MM): the membership with every
// pause, its payments and one month of attendance
export type HubPayment = { id: number; kind: string; label: string; detail: string; method: "online" | "cash"; amount: number; paidOn: string };
export type HubVisit = { id: number; date: string; status: "inside" | "completed" | "no_checkout"; checkedInAt: string; checkedOutAt: string | null; durationMin: number | null };
export type HubDay = { date: string; visits: number; minutes: number };
export type MembershipDetail = {
  today: string;
  membership: Membership;
  pauseCounts: { approved: number; requested: number; daysPaused: number };
  payments: HubPayment[];
  attendance: {
    month: string;
    previousMonth: string | null;
    nextMonth: string | null;
    days: HubDay[];
    visits: HubVisit[];
    // streakDays and thisWeek since 2026-11-10; absent from an older server
    stats: { thisMonth: number; last7Days: number; totalDays: number; averageMin: number | null; lastVisit: string | null; streakDays?: number; thisWeek?: number };
  };
};

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

export const membershipApi = {
  mine: (token: string | null) => (token ? apiFetch<Memberships>("/api/membership", { token }) : signedOut<Memberships>()),
  detail: (token: string | null, id: number, month?: string) =>
    token ? apiFetch<MembershipDetail>(`/api/membership/${id}${month ? `?month=${month}` : ""}`, { token }) : signedOut<MembershipDetail>(),
  requestPause: (token: string | null, id: number, fields: PauseFields) =>
    token ? apiFetch<Membership>(`/api/membership/${id}/pause`, { token, method: "POST", body: fields }) : signedOut<Membership>(),
  cancelPause: (token: string | null, id: number, pauseId: number) =>
    token ? apiFetch<Membership>(`/api/membership/${id}/pause/${pauseId}`, { token, method: "DELETE" }) : signedOut<Membership>(),
};
