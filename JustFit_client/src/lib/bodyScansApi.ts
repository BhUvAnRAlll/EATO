// Kept body scans (2026-11-10): every scan's two photos and report are saved on the server, for a
// justFit admin only (/api/admin/portal/body-scans); members never see them in the app.
// Photos load with the session token, never cached.
import { apiFetch, getApiUrl, type ApiResult } from "@/lib/api";
import type { BodyScanReport, ScanSex } from "@/lib/bodyScanRules";

export type ScanSummary = { id: string; at: string; bodyFatPercent: number; sex: ScanSex; age: number; heightCm: number; weightKg: number };
export type AdminScanSummary = ScanSummary & { member: { id: string; name: string } };
export type ScanDetail = AdminScanSummary & { report: BodyScanReport };
export type ScanView = "front" | "side";

const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const id = (value: string) => encodeURIComponent(value);

export const adminScans = {
  list(token: string | null, search: string, page: number): Promise<ApiResult<{ scans: AdminScanSummary[]; total: number; page: number; nextPage: number | null }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/body-scans?search=${encodeURIComponent(search)}&page=${page}`, { token });
  },
  one(token: string | null, scanId: string): Promise<ApiResult<{ scan: ScanDetail }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/body-scans/${id(scanId)}`, { token });
  },
};

/** An expo-image source for a scan photo (admin only) */
export function scanPhoto(scanId: string, view: ScanView, token: string | null) {
  if (!token) return null;
  return { uri: `${getApiUrl()}/api/admin/portal/body-scans/${id(scanId)}/photo/${view}`, headers: { Authorization: `Bearer ${token}` } };
}
