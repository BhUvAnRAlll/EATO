import { apiFetch, type ApiResult } from "@/lib/api";

// The Super Admin portal's calls (JustFit_server/admin, mounted at /api/admin/portal). The server
// checks the admin role on every request; nothing here decides who may see what.

export type AdminOverview = {
  // users: every account; the rest are the last seven days
  counts: { users: number; newUsers: number; workouts: number; meals: number };
  activity: { id: string; action: string; targetType: string; targetId: string | null; summary: string; by: string; at: string | null }[];
};

export type UserKind = "member" | "admin";
export type UserFilter = "all" | "members" | "admins";
export type AdminUserRow = { id: string; name: string; kind: UserKind };
export type AdminUser = {
  id: string;
  name: string;
  kind: UserKind;
  joinedAt: string | null;
  counts: { meals: number; workouts: number; orders: number };
};

export const KIND_LABEL: Record<UserKind, string> = { member: "Member", admin: "Admin" };

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
};

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
