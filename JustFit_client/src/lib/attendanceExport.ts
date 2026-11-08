import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { getApiUrl, reportRefusal } from "@/lib/api";
import { TIMED_OUT, timeoutFor } from "@/lib/apiRules";
import { visitParams, type VisitQuery } from "@/lib/gymApi";

// The attendance report as a CSV file (opens in Excel or Google Sheets): the server writes it for
// the signed-in staff account's branch only. On a phone it is saved to the app's cache and handed
// to the share sheet (Save to Files, Drive, email…); on the web it downloads.
export async function exportAttendance(token: string | null, query: VisitQuery): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: "Please sign in again." };
  // The same guards as apiFetch (QA 2026-11-07): a stalled download gives up instead of spinning for
  // ever, a 401 offers sign-in and a 403 re-checks the account, and the body is read inside the try
  const path = "/api/gym/attendance/export";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutFor(path));
  let csv: string;
  try {
    const response = await fetch(`${getApiUrl()}${path}?${visitParams({ ...query, page: 1 })}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!response.ok) {
      reportRefusal(response.status, token, path);
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? "We couldn't make the report. Please try again." };
    }
    csv = await response.text();
  } catch {
    if (controller.signal.aborted) return { ok: false, error: TIMED_OUT };
    return { ok: false, error: "We couldn't reach the server. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
  }
  const name = `attendance-${query.from}-to-${query.to}.csv`;

  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
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
    await file.write(csv);
    if (!(await Sharing.isAvailableAsync())) return { ok: false, error: "Sharing isn't available on this phone." };
    await Sharing.shareAsync(file.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: "Attendance report" });
    return { ok: true };
  } catch {
    return { ok: false, error: "We couldn't save the report on this phone. Please try again." };
  }
}
