import { apiFetch, type ApiResult } from "@/lib/api";
import type { FitnessSection, ProgramIcon, ProgramKit, ProgramLevel, ProgramPalette, ProgramPlace } from "@/lib/fitness/catalog";
import type { ProgramCardData, ProgramDetail } from "@/lib/fitnessApi";

// Super Admin › Programs (JustFit_server/fitness/programs.js, under /api/admin/portal/programs):
// the Fitness tab's programs, published or hidden, edited, created and rewritten by the AI. The
// server checks the admin role on every request; nothing here decides who may see what.

export type ProgramFields = {
  title: string;
  subtitle: string;
  description: string;
  section: FitnessSection;
  place: ProgramPlace;
  level: ProgramLevel;
  kit: ProgramKit;
  icon: ProgramIcon;
  palette: ProgramPalette;
  published: boolean;
};
export type NewProgram = ProgramFields & { sessions: number; minutes: number };

export const PLACE_TEXT: Record<ProgramPlace, string> = { home: "At home", center: "At center", both: "Both" };
export const KIT_TEXT: Record<ProgramKit, string> = { none: "No equipment", some: "Light equipment", full_gym: "Full gym" };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const unwrap = (result: ApiResult<{ program: ProgramDetail }>): ApiResult<ProgramDetail> => (result.ok ? { ok: true, data: result.data.program } : result);

export const adminPrograms = {
  list(token: string | null): Promise<ApiResult<{ programs: ProgramCardData[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/admin/portal/programs", { token });
  },
  async detail(token: string | null, id: string): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}`, { token }));
  },
  async update(token: string | null, id: string, fields: Partial<ProgramFields>): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}`, { method: "PATCH", body: fields, token }));
  },
  async create(token: string | null, program: NewProgram): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch("/api/admin/portal/programs", { method: "POST", body: program, token }));
  },
  // The AI rewrites the program's sessions (an optional note steers it)
  async redraft(token: string | null, id: string, request: string): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}/redraft`, { method: "POST", body: { request }, token }));
  },
};
