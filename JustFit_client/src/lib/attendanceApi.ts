import { apiFetch, type ApiResult } from "@/lib/api";
import type { GpsReading } from "@/lib/gpsReading";

// The member's QR attendance (JustFit_server/gym/attendanceRoutes.js, /api/attendance). The server
// finds the membership from the account's verified phone at the scanned gym and checks the code,
// the membership and the GPS reading itself; the app only sends what it scanned and read.
// as: "staff" when the scanner is this branch's Staff or Trainer (a day at work, 2026-11-09);
// then member carries their name only (no code or plan) and staff says which
export type ScanPreview = {
  as: "member" | "staff";
  gym: { name: string; branch: string; area: string; city: string };
  member: { name: string; code: string | null; expiresOn: string | null; active: boolean };
  staff?: { kind: "staff" | "trainer"; label: string };
  radiusM: number;
  hasLocation: boolean;
  openVisit: { checkedInAt: string } | null;
  nextAction: "check_in" | "check_out";
};
export type ScanDone = {
  as: ScanPreview["as"];
  action: "check_in" | "check_out";
  gym: ScanPreview["gym"];
  member: { name: string; code: string | null };
  checkedInAt: string;
  checkedOutAt?: string;
  durationMin?: number;
  distanceM: number;
};
// id: "s12" for a day at work (a Staff or Trainer's own visit), else the member visit's number
export type MyVisit = { id: string; as: "member" | "staff"; gym: string; status: "inside" | "completed" | "no_checkout"; checkedInAt: string; checkedOutAt: string | null; durationMin: number | null };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

// A scanned text is ours when it looks like the gym's attendance link (the server checks it fully)
export const looksLikeGymQr = (text: string) => text.startsWith("justfit://attendance?");

export const attendanceApi = {
  mine: (token: string | null) => (token ? apiFetch<{ visits: MyVisit[] }>("/api/attendance", { token }) : signedOut<{ visits: MyVisit[] }>()),
  scan: (token: string | null, qr: string) => (token ? apiFetch<ScanPreview>("/api/attendance/scan", { token, method: "POST", body: { qr } }) : signedOut<ScanPreview>()),
  record: (token: string | null, action: ScanPreview["nextAction"], qr: string, reading: GpsReading) =>
    token
      ? apiFetch<ScanDone>(action === "check_in" ? "/api/attendance/check-in" : "/api/attendance/check-out", { token, method: "POST", body: { qr, ...reading } })
      : signedOut<ScanDone>(),
};
