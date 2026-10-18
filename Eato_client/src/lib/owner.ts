import { apiFetch, type ApiResult } from "@/lib/api";
import type { Member } from "@/lib/community";
import type { Gym } from "@/lib/gyms";
import type { GymRole } from "@/lib/gymRules";

// The gym owner portal's calls (Eato_server/owner). The server decides who may open a gym's
// portal: its active owner or admins, or an EATO platform admin ("platform").

export type OwnerAccess = "owner" | "admin" | "platform";
export type ManagedGym = { id: string; name: string; logoUrl: string | null; plan: Gym["plan"]; as: OwnerAccess };

export type OwnerSummary = {
  gym: ManagedGym;
  stats: { members: number; joinRequests: number; upcomingEvents: number; trainers: number; postsThisWeek: number; plan: Gym["plan"] };
  attention: {
    joinRequests: number;
    postsToReview: number;
    reportedPosts: number;
    membershipsExpired: number;
    membershipsEndingThisWeek: number;
    invitationsPending: number;
  };
  newMembers: { month: string; count: number }[];
  coachingTeam: { member: Member; title: string | null; clients: number }[];
  nextEvent: { id: string; title: string; date: string; startTime: string; endTime: string; location: string; attendeeCount: number; maxAttendees: number | null } | null;
};

export type RenewalFlag = "expired" | "this_week" | "this_month" | "active" | "none";
export type MemberPlan = { id: string; name: string; status: "active" | "paused" | "expired" | "cancelled"; endsOn: string | null; daysLeft: number | null };
export type RenewalRow = { member: Member; role: Exclude<GymRole, "owner">; plan: MemberPlan | null; daysLeft: number | null; flag: RenewalFlag };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const call = <T>(token: string | null, path: string, init: { method?: "POST"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch(`/api/owner${path}`, { ...init, token }) : signedOut();

export const owner = {
  // The gyms the caller runs (empty for everyone else)
  gyms: (token: string | null) => call<{ gyms: ManagedGym[] }>(token, "/gyms"),
  summary: (token: string | null, gymId: string) => call<OwnerSummary>(token, `/gyms/${gymId}/summary`),
  renewals: (token: string | null, gymId: string) => call<{ members: RenewalRow[] }>(token, `/gyms/${gymId}/renewals`),
  renew: (token: string | null, gymId: string, userId: string, months: 1 | 3) =>
    call<{ plan: MemberPlan; flag: RenewalFlag }>(token, `/gyms/${gymId}/renewals/${encodeURIComponent(userId)}`, { method: "POST", body: { months } }),
  // The caller's own package in a gym (the member's side)
  myPlan: (token: string | null, gymId: string) => call<{ plan: MemberPlan | null; flag: RenewalFlag }>(token, `/my-plan/${gymId}`),
};

// "Expired 3 days ago", "Ends today", "12 days left", "No package yet"
export function daysLeftLabel(daysLeft: number | null): string {
  if (daysLeft === null) return "No package yet";
  if (daysLeft < -1) return `Expired ${-daysLeft} days ago`;
  if (daysLeft === -1) return "Expired yesterday";
  if (daysLeft === 0) return "Ends today";
  if (daysLeft === 1) return "1 day left";
  return `${daysLeft} days left`;
}

export const flagLabel: Record<RenewalFlag, string> = {
  expired: "Expired",
  this_week: "This week",
  this_month: "This month",
  active: "Active",
  none: "No package",
};

// "2026-10" → "Oct"
export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
}
