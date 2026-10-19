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
  inGymNow: number;
  newMembers: { month: string; count: number }[];
  coachingTeam: { member: Member; title: string | null; clients: number }[];
  nextEvent: { id: string; title: string; date: string; startTime: string; endTime: string; location: string; attendeeCount: number; maxAttendees: number | null } | null;
};

export type RenewalFlag = "expired" | "this_week" | "this_month" | "active" | "none";
export type MemberPlan = { id: string; name: string; status: "active" | "paused" | "expired" | "cancelled"; endsOn: string | null; daysLeft: number | null };
export type RenewalRow = { member: Member; role: Exclude<GymRole, "owner">; plan: MemberPlan | null; daysLeft: number | null; flag: RenewalFlag };

// ---- QR attendance ----

export type RefusalReason = "invalid" | "expired" | "not_member" | "inactive" | "already_in";
export type Verification = {
  eligible: boolean;
  reason: RefusalReason | null;
  message: string | null;
  gym: { id: string; name: string };
  // null when the code names nobody, or someone who isn't a member here
  member: { member: Member; role: GymRole; status: "active" | "pending" | "suspended"; plan: Omit<MemberPlan, "id"> | null; joinedAt: string | null } | null;
  renewalWarning?: boolean;
};
export type Visit = {
  id: string;
  member: Member;
  checkedInAt: string;
  checkedOutAt: string | null;
  minutes: number;
  checkoutMethod: "qr" | "staff" | null;
  checkedInBy: string | null;
  checkedOutBy: string | null;
};
export type ActivityItem =
  | { kind: "in"; member: Member; at: string; visitId: string }
  | { kind: "out"; member: Member; at: string; minutes: number; visitId: string }
  | { kind: "failed"; reason: RefusalReason; member: Member | null; at: string };
export type AttendanceToday = {
  gym: { id: string; name: string };
  counts: { inNow: number; checkinsToday: number; completedToday: number; failedToday: number };
  inNow: Visit[];
  completedToday: Visit[];
  activity: ActivityItem[];
};
export type CheckoutQr = { gym: { id: string; name: string; logoUrl: string | null }; enabled: boolean; code: string; qrText: string; checkoutsToday: number };
export type MyVisit = { id: string; gym: { id: string; name: string }; checkedInAt: string; minutes: number };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const call = <T>(token: string | null, path: string, init: { method?: "POST" | "PATCH"; body?: unknown } = {}): Promise<ApiResult<T>> =>
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

  // Front desk (the gym's owner and admins)
  verify: (token: string | null, gymId: string, code: string) => call<Verification>(token, `/gyms/${gymId}/attendance/verify`, { method: "POST", body: { code } }),
  checkIn: (token: string | null, gymId: string, code: string) => call<{ visit: Visit }>(token, `/gyms/${gymId}/attendance/checkin`, { method: "POST", body: { code } }),
  today: (token: string | null, gymId: string) => call<AttendanceToday>(token, `/gyms/${gymId}/attendance/today`),
  visits: (token: string | null, gymId: string, filter: "all" | "in" | "out", search: string) =>
    call<{ visits: Visit[] }>(token, `/gyms/${gymId}/attendance/visits?filter=${filter}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`),
  visit: (token: string | null, gymId: string, visitId: string) => call<{ visit: Visit }>(token, `/gyms/${gymId}/attendance/visits/${visitId}`),
  endVisit: (token: string | null, gymId: string, visitId: string) => call<{ visit: Visit }>(token, `/gyms/${gymId}/attendance/visits/${visitId}/checkout`, { method: "POST" }),
  checkoutQr: (token: string | null, gymId: string) => call<CheckoutQr>(token, `/gyms/${gymId}/checkout-qr`),
  setCheckoutQr: (token: string | null, gymId: string, enabled: boolean) => call<CheckoutQr>(token, `/gyms/${gymId}/checkout-qr`, { method: "PATCH", body: { enabled } }),
  rotateCheckoutQr: (token: string | null, gymId: string) => call<CheckoutQr>(token, `/gyms/${gymId}/checkout-qr/rotate`, { method: "POST" }),

  // The member's side
  myPass: (token: string | null) => call<{ pass: string; expiresAt: string }>(token, "/me/pass"),
  myVisit: (token: string | null) => call<{ visit: MyVisit | null }>(token, "/me/visit"),
  checkOut: (token: string | null, code: string) => call<{ gym: { id: string; name: string }; checkedOutAt: string; minutes: number }>(token, "/me/checkout", { method: "POST", body: { code } }),
};

// "1 h 25 min", "45 min"
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// "9:46 AM" in the phone's time
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export const refusalTitles: Record<RefusalReason, string> = {
  invalid: "Invalid QR code",
  expired: "Code expired",
  not_member: "Not a member here",
  inactive: "Membership not active",
  already_in: "Already checked in",
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
