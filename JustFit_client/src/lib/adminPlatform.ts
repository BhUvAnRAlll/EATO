import { apiFetch, type ApiResult } from "@/lib/api";
import type { AdminGymDetail } from "@/lib/gymApi";

// Super Admin › the gym platform (JustFit_server/admin/platform.js, the brief's section 7): numbers
// across every gym, every gym's team, an account's gyms and suspension, and moving a gym's owner.

export type Point = { date: string; value: number };
export type GymAnalytics = {
  today: string;
  days: number;
  gyms: { branches: number; brands: number; draft: number; submitted: number; pending_review: number; approved: number; rejected: number; suspended: number; pendingApproval: number };
  members: number;
  staff: number;
  memberships: { total: number; active: number; expired: number };
  attendance: { total: number; today: number; insideNow: number };
  series: { newGyms: Point[]; newMemberships: Point[]; visits: Point[] };
  cities: { city: string; gyms: number; memberships: number }[];
};
export type StaffRole = "all" | "owner" | "staff" | "trainer";
export type PlatformStaff = {
  userId: string;
  name: string | null;
  phone: string | null;
  kind: "owner" | "staff" | "trainer";
  role: string;
  roleLabel: string;
  gym: { id: number; name: string; branch: string; city: string };
  addedOn: string | null;
  suspended: boolean;
};
export type StaffDirectory = { page: number; nextPage: number | null; staff: PlatformStaff[] };
export type Suspension = { reason: string; at: string } | null;
export type AccountGyms = {
  memberships: { id: number; code: string; gym: string; expiresOn: string; active: boolean }[];
  teams: { gymId: number; gym: string; role: string; roleLabel: string }[];
  suspension: Suspension;
};

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });
const call = <T,>(token: string | null, path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<ApiResult<T>> =>
  token ? apiFetch<T>(path, { ...options, token }) : signedOut<T>();

export const adminPlatform = {
  analytics: (token: string | null, days: number) => call<GymAnalytics>(token, `/api/admin/portal/gym-analytics?days=${days}`),
  staff: (token: string | null, q: { role: StaffRole; search: string; page?: number }) => {
    const params = new URLSearchParams({ role: q.role });
    if (q.search.trim()) params.set("search", q.search.trim());
    if (q.page && q.page > 1) params.set("page", String(q.page));
    return call<StaffDirectory>(token, `/api/admin/portal/gym-staff?${params.toString()}`);
  },
  accountGyms: (token: string | null, userId: string) => call<AccountGyms>(token, `/api/admin/portal/users/${encodeURIComponent(userId)}/gyms`),
  suspend: (token: string | null, userId: string, reason: string) => call<{ suspension: Suspension }>(token, `/api/admin/portal/users/${encodeURIComponent(userId)}/suspend`, { method: "POST", body: { reason } }),
  reactivate: (token: string | null, userId: string) => call<{ suspension: Suspension }>(token, `/api/admin/portal/users/${encodeURIComponent(userId)}/reactivate`, { method: "POST" }),
  transfer: (token: string | null, gymId: number, phone: string, reason: string) => call<AdminGymDetail>(token, `/api/admin/portal/gyms/${gymId}/transfer`, { method: "POST", body: { phone, reason } }),
};

// "12 Nov" for a chart label; every nth on a dense chart
export function dayLabel(date: string, index: number, count: number): string {
  const every = count > 31 ? 15 : count > 14 ? 5 : 1;
  if (index % every !== 0 && index !== count - 1) return "";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}
