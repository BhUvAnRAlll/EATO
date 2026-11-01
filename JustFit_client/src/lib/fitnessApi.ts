import { apiFetch, type ApiResult } from "@/lib/api";
import { PROGRAMS, SECTION_NOTE, SECTION_ORDER, SECTION_TITLE, type FitnessSection, type ProgramLevel, type ProgramPlace } from "@/lib/fitness/catalog";
import type { Place, WorkoutSet } from "@/lib/workoutApi";

// The Fitness tab's programs (JustFit_server/fitness/routes.js, under /api/fitness). Every
// program is free. When the server can't be reached the tab shows the starter catalog
// (src/lib/fitness/catalog.ts) as cards marked `offline`, which can't be opened until it's back.

export type ProgramCardData = {
  id: string;
  title: string;
  subtitle: string;
  section: FitnessSection;
  place: ProgramPlace;
  level: ProgramLevel;
  icon: string;
  palette: string;
  sessionCount: number;
  minutes: { min: number; max: number };
  // Shown on the Fitness tab (members only ever get shown ones; the admin sees both)
  published?: boolean;
  // A card from the app's own catalog while the server is unreachable
  offline?: boolean;
};

export type ProgramSection = { id: FitnessSection; title: string; note: string; programs: ProgramCardData[] };
export type ProgramList = { place: Place; search: string; sections: ProgramSection[]; offline?: boolean };

export type ProgramExercise = {
  name: string;
  muscleGroup: string;
  equipment: string;
  section: "warmup" | "workout" | "cooldown";
  sets: WorkoutSet[];
  restSec: number;
  repsMin: number | null;
  repsMax: number | null;
  note: string | null;
  hasVideo: boolean;
};
export type ProgramSession = { id: string; title: string; minutes: number; exerciseCount: number; exercises: ProgramExercise[] };
export type ProgramDetail = ProgramCardData & { description: string; kit: "none" | "some" | "full_gym"; sessions: ProgramSession[] };

export type HomeKit = "none" | "some" | "home_gym";
export type CenterKit = "free_weights" | "basic_gym" | "full_gym";
export type Equipment = { home: HomeKit; center: CenterKit; options: { home: HomeKit[]; center: CenterKit[] } };

export const HOME_KIT_LABEL: Record<HomeKit, string> = { none: "Nothing, just me", some: "Dumbbells, bands or a kettlebell", home_gym: "A home gym with a barbell" };
export const CENTER_KIT_LABEL: Record<CenterKit, string> = { free_weights: "Free weights only", basic_gym: "A basic gym", full_gym: "A full gym with machines" };
export const LEVEL_TEXT: Record<ProgramLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });

/** The starter catalog as the server would answer it, for when it can't be reached */
export function offlineList(place: Place, search = ""): ProgramList {
  const q = search.trim().toLowerCase();
  const cards: ProgramCardData[] = PROGRAMS.filter((p) => p.place === place || p.place === "both")
    .filter((p) => !q || [p.title, p.subtitle, p.description, SECTION_TITLE[p.section]].some((t) => t.toLowerCase().includes(q)))
    .map((p) => ({
      id: `offline:${p.slug}`, title: p.title, subtitle: p.subtitle, section: p.section, place: p.place, level: p.level, icon: p.icon, palette: p.palette,
      sessionCount: p.sessions.length, minutes: { min: Math.min(...p.sessions.map((s) => s.minutes)), max: Math.max(...p.sessions.map((s) => s.minutes)) }, offline: true,
    }));
  return {
    place, search, offline: true,
    sections: SECTION_ORDER.map((id) => ({ id, title: SECTION_TITLE[id], note: SECTION_NOTE[id], programs: cards.filter((c) => c.section === id) })).filter((s) => s.programs.length > 0),
  };
}

/** "3 sessions · 20–25 min" */
export function programMeta(p: Pick<ProgramCardData, "sessionCount" | "minutes">) {
  const time = p.minutes.min === p.minutes.max ? `${p.minutes.min} min` : `${p.minutes.min}–${p.minutes.max} min`;
  return `${p.sessionCount} ${p.sessionCount === 1 ? "session" : "sessions"} · ${time}`;
}

export const fitnessApi = {
  // The six sections for the place; the starter catalog when the server can't be reached
  async programs(token: string | null, place: Place, search = ""): Promise<ApiResult<ProgramList>> {
    if (!token) return signedOut();
    const params = `place=${place}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
    const result = await apiFetch<ProgramList>(`/api/fitness/programs?${params}`, { token });
    if (result.ok) return result;
    // Signed out or refused: say so; anything else (offline, server down) shows the catalog
    if (result.status === 401 || result.status === 403 || result.status === 400) return result;
    return { ok: true, data: offlineList(place, search) };
  },
  async program(token: string | null, id: string): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    if (id.startsWith("offline:")) return { ok: false, error: "Programs need a connection to open. Check your internet and try again." };
    const result = await apiFetch<{ program: ProgramDetail }>(`/api/fitness/programs/${encodeURIComponent(id)}`, { token });
    return result.ok ? { ok: true, data: result.data.program } : result;
  },
  // Do this session today: it becomes today's workout (the day screen and player run it)
  startToday(token: string | null, programId: string, sessionId: string, today: string): Promise<ApiResult<{ date: string; dayId: string }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/fitness/programs/${encodeURIComponent(programId)}/sessions/${encodeURIComponent(sessionId)}/today`, { method: "POST", body: { today }, token });
  },
  equipment(token: string | null): Promise<ApiResult<Equipment>> {
    if (!token) return signedOut();
    return apiFetch("/api/fitness/equipment", { token });
  },
  saveEquipment(token: string | null, home: HomeKit, center: CenterKit): Promise<ApiResult<Equipment>> {
    if (!token) return signedOut();
    return apiFetch("/api/fitness/equipment", { method: "PUT", body: { home, center }, token });
  },
};
