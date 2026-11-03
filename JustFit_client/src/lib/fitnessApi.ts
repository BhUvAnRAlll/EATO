import { apiFetch, type ApiResult } from "@/lib/api";
import { PROGRAMS, SECTION_LAYOUT, SECTION_NOTE, SECTION_ORDER, SECTION_TITLE, type FitnessSection, type SectionLayout, type ProgramLevel, type ProgramPlace } from "@/lib/fitness/catalog";
import type { Place } from "@/lib/workoutApi";

// The Fitness tab's programs (JustFit_server/fitness/routes.js, under /api/fitness). Every
// program is free. When the server can't be reached the tab shows the starter catalog
// (src/lib/fitness/catalog.ts) as cards marked `offline`, which can't be opened until it's back.

export type ProgramCardData = {
  id: string;
  title: string;
  subtitle: string;
  section: FitnessSection;
  // The category's name as the admin has it (the server's; the built-in name offline)
  sectionTitle?: string;
  place: ProgramPlace;
  level: ProgramLevel;
  icon: string;
  palette: string;
  // The cover photo's path on the server (read with the session token), or null for the gradient
  coverUrl?: string | null;
  sessionCount: number;
  minutes: { min: number; max: number };
  // Shown on the Fitness tab (members only ever get shown ones; the admin sees both)
  published?: boolean;
  // A card from the app's own catalog while the server is unreachable
  offline?: boolean;
};

// One category of the Fitness tab, with how its cards look (the admin chooses)
export type ProgramSection = { id: FitnessSection; title: string; note: string; layout?: SectionLayout; programs: ProgramCardData[] };
export type ProgramList = { place: Place; search: string; sections: ProgramSection[]; offline?: boolean };

// A session: one YouTube video played on the program's page (embedded in YouTube's own player),
// with its creator for the credit (null while YouTube hasn't been asked)
export type ProgramSession = { id: string; title: string; minutes: number; video: { id: string; channel: string | null } };
export type ProgramDetail = ProgramCardData & {
  // The photo at the top of the program's screen (the admin's page photo, not the card's cover),
  // read with the session token; null: the colour's gradient
  heroUrl?: string | null;
  description: string;
  kit: "none" | "some" | "full_gym";
  // Admin only: why a session video's creator couldn't be read from YouTube just now
  videoError?: string;
  sessions: ProgramSession[];
};

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
      id: `offline:${p.slug}`, title: p.title, subtitle: p.subtitle, section: p.section, sectionTitle: SECTION_TITLE[p.section], place: p.place, level: p.level, icon: p.icon, palette: p.palette,
      sessionCount: p.sessions.length, minutes: { min: Math.min(...p.sessions.map((s) => s.minutes)), max: Math.max(...p.sessions.map((s) => s.minutes)) }, offline: true,
    }));
  return {
    place, search, offline: true,
    sections: SECTION_ORDER.map((id) => ({ id, title: SECTION_TITLE[id], note: SECTION_NOTE[id], layout: SECTION_LAYOUT[id], programs: cards.filter((c) => c.section === id) })).filter((s) => s.programs.length > 0),
  };
}

/** "20–25 min" (each session's length; "–" without sessions) */
export function sessionMinutes(p: Pick<ProgramCardData, "minutes">) {
  if (p.minutes.max <= 0) return "–";
  return p.minutes.min === p.minutes.max ? `${p.minutes.min} min` : `${p.minutes.min}–${p.minutes.max} min`;
}

/** "3 sessions · 20–25 min", or "Coming soon" before the admin adds any */
export function programMeta(p: Pick<ProgramCardData, "sessionCount" | "minutes">) {
  if (p.sessionCount === 0) return "Coming soon";
  return `${p.sessionCount} ${p.sessionCount === 1 ? "session" : "sessions"} · ${sessionMinutes(p)}`;
}

/**
 * The program with only its video sessions. A server from before 2026-11-03 (or one whose
 * migrations haven't run) still sends exercise sessions without a video: they're left out, so
 * the screens never meet a session without one.
 */
export function withVideoSessions(program: ProgramDetail): ProgramDetail {
  const sessions = (program.sessions ?? []).filter((s): s is ProgramSession => Boolean(s?.video?.id));
  return sessions.length === program.sessions?.length ? program : { ...program, sessions };
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
    return result.ok ? { ok: true, data: withVideoSessions(result.data.program) } : result;
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
