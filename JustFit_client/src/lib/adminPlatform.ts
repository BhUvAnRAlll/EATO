import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { apiFetch, getApiUrl, reportRefusal, type ApiResult } from "@/lib/api";
import { TIMED_OUT, timeoutFor } from "@/lib/apiRules";
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

export type GymReportKind = "gyms" | "staff";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Every branch, or every gym team, as an Excel file: shared on a phone, downloaded on the web */
export async function exportGymReport(token: string | null, kind: GymReportKind): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: "Please sign in again." };
  const path = "/api/admin/portal/gym-report";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(path));
  let report: ArrayBuffer;
  let name = `justfit-${kind}.xlsx`;
  try {
    const response = await fetch(`${getApiUrl()}${path}?kind=${kind}&format=xlsx`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!response.ok) {
      reportRefusal(response.status, token, path);
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? "We couldn't make the report. Please try again." };
    }
    // The server names the file with India's date (justfit-gyms-2026-11-10.xlsx)
    const given = /filename="(justfit-[a-z]+-\d{4}-\d{2}-\d{2}\.xlsx)"/.exec(response.headers.get("content-disposition") ?? "");
    if (given) name = given[1];
    report = await response.arrayBuffer();
  } catch {
    if (controller.signal.aborted) return { ok: false, error: TIMED_OUT };
    return { ok: false, error: "We couldn't reach the server. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
  }
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([report], { type: XLSX_TYPE }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  }
  try {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    await file.write(new Uint8Array(report));
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: "Sharing isn't available on this phone." };
    await Sharing.shareAsync(file.uri, { mimeType: XLSX_TYPE, UTI: "org.openxmlformats.spreadsheetml.sheet", dialogTitle: kind === "staff" ? "Gym staff report" : "Gyms report" });
    return { ok: true };
  } catch {
    return { ok: false, error: "We couldn't save the report on this phone. Please try again." };
  }
}
