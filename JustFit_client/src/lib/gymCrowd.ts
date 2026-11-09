import { apiFetch, type ApiResult } from "@/lib/api";
import type { CrowdSettings, GymCrowd, MemberCrowd } from "@/lib/gymCrowdRules";

export * from "@/lib/gymCrowdRules";

// Live gym crowd and best time to visit: the member's own gym (/api/membership/:id/crowd) and the
// gym portal's open branch with its settings (/api/gym/attendance/crowd, …/crowd-settings)
const signedOut = <T,>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again.", status: 401 });

export const crowdApi = {
  member: (token: string | null, membershipId: number) => (token ? apiFetch<MemberCrowd>(`/api/membership/${membershipId}/crowd`, { token }) : signedOut<MemberCrowd>()),
  gym: (token: string | null) => (token ? apiFetch<GymCrowd>("/api/gym/attendance/crowd", { token }) : signedOut<GymCrowd>()),
  saveSettings: (token: string | null, fields: Partial<Pick<CrowdSettings, "capacity" | "avgStayMin">> & { thresholds?: CrowdSettings["thresholds"] | null }) =>
    token ? apiFetch<GymCrowd>("/api/gym/attendance/crowd-settings", { token, method: "PUT", body: fields }) : signedOut<GymCrowd>(),
};
