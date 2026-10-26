import { apiFetch, type ApiResult } from "@/lib/api";

// The Super Admin portal's calls (Eato_server/admin, mounted at /api/admin/portal). The server
// checks the admin role on every request; nothing here decides who may see what.

export type AdminOverview = {
  counts: { users: number; gyms: number; gymMembers: number; openReports: number; unverifiedTrainers: number; suspended: number };
  todo: {
    reportedPosts: number;
    trainersToVerify: { userId: string; name: string; title: string; qualifications: number }[];
    gymsOnTrial: { id: string; name: string; trialEndsOn: string | null }[];
  };
  activity: { id: string; action: string; targetType: string; targetId: string | null; summary: string; by: string; at: string | null }[];
};

export type UserKind = "member" | "trainer" | "owner" | "admin";
export type UserFilter = "all" | "members" | "trainers" | "owners" | "suspended";
export type AdminUserRow = { id: string; name: string; kind: UserKind; suspended: boolean; unverified: boolean };
export type AdminUser = {
  id: string;
  name: string;
  kind: UserKind;
  suspended: boolean;
  counts: { posts: number; reported: number; removed: number };
  trainer: { title: string; yearsExperience: number; acceptingClients: boolean; activeClients: number; qualifications: string[]; verified: boolean } | null;
  gyms: { id: string; name: string; role: "owner" | "admin" | "trainer" | "member" }[];
};

export type GymPlan = "starter" | "pro" | "elite";
export type GymStatus = "active" | "trial" | "suspended";
export type AdminGymRow = { id: string; name: string; location: string | null; plan: GymPlan; status: GymStatus; trialEndsOn: string | null; memberCount: number; owner: { id: string; name: string } | null };
export type AdminGym = {
  id: string; name: string; location: string | null; address: string | null; inviteCode: string; visibility: "public" | "private" | "hidden";
  memberApproval: boolean; plan: GymPlan; status: GymStatus; trialEndsOn: string | null;
  counts: { members: number; staff: number; posts: number; upcomingEvents: number; openReports: number; joinRequests: number };
  owner: { id: string; name: string } | null;
};
export type NewGym = { name: string; tagline: string | null; location: string; address: string | null; ownerId: string; visibility: AdminGym["visibility"]; memberApproval: boolean; plan: GymPlan };

export type ReportGroup = {
  key: string;
  type: "post" | "comment" | "story";
  id: string;
  author: { id: string; name: string };
  authorSuspended: boolean;
  where: string;
  body: string | null;
  postedAt: string | null;
  deleted: boolean;
  imageUrl: string | null;
  reports: { id: string; reason: string; reporter: string; status: string; at: string | null }[];
  count: number;
  outcome: "removed" | "dismissed" | null;
};

export const PLAN_LABEL: Record<GymPlan, string> = { starter: "Starter", pro: "Pro", elite: "Elite" };

export const KIND_LABEL: Record<UserKind, string> = { member: "Member", trainer: "Trainer", owner: "Gym owner", admin: "Admin" };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

export const adminPortal = {
  overview(token: string | null): Promise<ApiResult<AdminOverview>> {
    if (!token) return signedOut();
    return apiFetch("/api/admin/portal/overview", { token });
  },
  users(token: string | null, filter: UserFilter, search: string): Promise<ApiResult<{ users: AdminUserRow[] }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/users?filter=${filter}&search=${encodeURIComponent(search)}`, { token });
  },
  user(token: string | null, userId: string): Promise<ApiResult<{ user: AdminUser }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/users/${encodeURIComponent(userId)}`, { token });
  },
  // The Verified trainer switch
  setVerified(token: string | null, userId: string, verified: boolean): Promise<ApiResult<{ userId: string; verified: boolean }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/users/${encodeURIComponent(userId)}/verified`, { method: "PUT", body: { verified }, token });
  },
  gyms(token: string | null, search: string): Promise<ApiResult<{ gyms: AdminGymRow[] }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/gyms?search=${encodeURIComponent(search)}`, { token });
  },
  gym(token: string | null, gymId: string): Promise<ApiResult<{ gym: AdminGym }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/gyms/${encodeURIComponent(gymId)}`, { token });
  },
  // A new gym starts a 14-day trial with the chosen owner
  createGym(token: string | null, gym: NewGym): Promise<ApiResult<{ gym: AdminGym }>> {
    if (!token) return signedOut();
    return apiFetch("/api/admin/portal/gyms", { method: "POST", body: gym, token });
  },
  // Plans are labels: nothing is charged
  setGymPlan(token: string | null, gymId: string, plan: GymPlan): Promise<ApiResult<{ gymId: string; plan: GymPlan }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/gyms/${encodeURIComponent(gymId)}/plan`, { method: "PUT", body: { plan }, token });
  },
  reports(token: string | null, status: "open" | "resolved"): Promise<ApiResult<{ groups: ReportGroup[]; counts: Partial<Record<"open" | "resolved", number>> }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/reports?status=${status}`, { token });
  },
  // Remove (delete the content) or dismiss (keep it): closes every open report on it
  resolveReports(token: string | null, type: ReportGroup["type"], id: string, action: "remove" | "dismiss"): Promise<ApiResult<{ resolved: number }>> {
    if (!token) return signedOut();
    return apiFetch("/api/admin/portal/reports/resolve", { method: "POST", body: { type, id, action }, token });
  },
  setGymSuspended(token: string | null, gymId: string, suspended: boolean): Promise<ApiResult<{ gymId: string; status: GymStatus }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/gyms/${encodeURIComponent(gymId)}/suspend`, { method: suspended ? "POST" : "DELETE", token });
  },
};

// "FZ" from "FitZone Fitness": a gym's badge
export const gymInitials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");

// "3d", "5h", "just now": how long ago an admin acted
export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
