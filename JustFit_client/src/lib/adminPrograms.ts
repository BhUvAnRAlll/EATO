import * as ImagePicker from "expo-image-picker";

import { apiFetch, type ApiResult } from "@/lib/api";
import type { FitnessSection, ProgramIcon, ProgramKit, ProgramLevel, ProgramPalette, ProgramPlace, SectionLayout } from "@/lib/fitness/catalog";
import { withVideoSessions, type ProgramCardData, type ProgramDetail } from "@/lib/fitnessApi";

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
// A new program: its fields only (its video sessions are added once it exists)
export type NewProgram = ProgramFields;

// A session the admin adds or edits (fitness/rules.js sessionBody on the server)
export type SessionFields = { title: string; minutes: number; youtube: string };

// A cover photo ready to upload: base64 and its type (the server checks both from the bytes)
export type CoverPhoto = { data: string; mediaType: string };
export const COVER_MAX_BYTES = 2 * 1024 * 1024;
const COVER_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * The photo's real type from its first bytes (the server checks the same way): JPEG starts
 * FF D8 FF, PNG 89 "PNG", WebP "RIFF" then "WEBP" at byte 8. The picker's mimeType can't be
 * trusted: on iOS it names the original file even after the picker re-encoded it as JPEG.
 */
export function photoTypeOf(data: string): string | null {
  let head: string;
  try {
    head = atob(data.slice(0, 16)); // 12 bytes
  } catch {
    return null;
  }
  const byte = (i: number) => head.charCodeAt(i);
  if (byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff) return "image/jpeg";
  if (byte(0) === 0x89 && head.slice(1, 4) === "PNG") return "image/png";
  if (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

// Bytes in a base64 string (without decoding it)
const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

/**
 * Opens the photo library for a program cover. The whole photo is kept, with no crop step: the
 * same cover fills tall posters, square tiles and wide cards, and each card centres it itself.
 * quality < 1 re-encodes to JPEG on the phone (so HEIC works, and the photo's location data is
 * left out). On the web the chosen file is sent as it is.
 */
export async function pickCover(): Promise<{ ok: true; photo: CoverPhoto } | { ok: false; error: string } | { ok: false; cancelled: true }> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 0.6, base64: true, exif: false });
  if (result.canceled) return { ok: false, cancelled: true };
  const asset = result.assets[0];
  // The web picker may give a data: URL instead of base64
  const dataUrl = /^data:([^;]+);base64,(.+)$/.exec(asset.uri ?? "");
  const data = asset.base64 ?? dataUrl?.[2] ?? null;
  if (!data) return { ok: false, error: "That photo couldn't be read. Please try another." };
  const mediaType = photoTypeOf(data);
  if (!mediaType || !COVER_TYPES.includes(mediaType)) return { ok: false, error: "Choose a JPEG, PNG or WebP photo." };
  if (base64Bytes(data) > COVER_MAX_BYTES) return { ok: false, error: "That photo is too large (max 2 MB). Try a smaller one." };
  return { ok: true, photo: { data, mediaType } };
}

// A category of the Fitness tab as the admin sees it (Admin › Programs › Categories)
export type AdminSection = { id: string; title: string; note: string; layout: SectionLayout; position: number; published: boolean; builtIn: boolean; programCount: number };
export type SectionFields = { title: string; note: string; layout: SectionLayout; published: boolean };
export const LAYOUT_TEXT: Record<SectionLayout, string> = { poster: "Posters", tile: "Tiles", wide: "Wide cards" };

export const PLACE_TEXT: Record<ProgramPlace, string> = { home: "At home", center: "At center", both: "Both" };
export const KIT_TEXT: Record<ProgramKit, string> = { none: "No equipment", some: "Light equipment", full_gym: "Full gym" };

const signedOut = <T>(): Promise<ApiResult<T>> => Promise.resolve({ ok: false, error: "Please sign in again." });
const unwrap = (result: ApiResult<{ program: ProgramDetail }>): ApiResult<ProgramDetail> => (result.ok ? { ok: true, data: withVideoSessions(result.data.program) } : result);

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
  // The categories in order, each with how many programs it has
  sections(token: string | null): Promise<ApiResult<{ sections: AdminSection[] }>> {
    if (!token) return signedOut();
    return apiFetch("/api/admin/portal/sections", { token });
  },
  async createSection(token: string | null, fields: SectionFields): Promise<ApiResult<AdminSection>> {
    if (!token) return signedOut();
    const result = await apiFetch<{ section: AdminSection }>("/api/admin/portal/sections", { method: "POST", body: fields, token });
    return result.ok ? { ok: true, data: result.data.section } : result;
  },
  async updateSection(token: string | null, id: string, fields: Partial<SectionFields>): Promise<ApiResult<AdminSection>> {
    if (!token) return signedOut();
    const result = await apiFetch<{ section: AdminSection }>(`/api/admin/portal/sections/${encodeURIComponent(id)}`, { method: "PATCH", body: fields, token });
    return result.ok ? { ok: true, data: result.data.section } : result;
  },
  // One place up or down; answers every category in the new order
  moveSection(token: string | null, id: string, direction: "up" | "down"): Promise<ApiResult<{ sections: AdminSection[] }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/sections/${encodeURIComponent(id)}/move`, { method: "POST", body: { direction }, token });
  },
  // Only a category the admin made, with no programs in it
  deleteSection(token: string | null, id: string): Promise<ApiResult<{ sections: AdminSection[] }>> {
    if (!token) return signedOut();
    return apiFetch(`/api/admin/portal/sections/${encodeURIComponent(id)}`, { method: "DELETE", token });
  },
  // Adds or replaces the program's cover photo; answers the program with its new coverUrl
  async setCover(token: string | null, id: string, photo: CoverPhoto): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}/cover`, { method: "PUT", body: photo, token }));
  },
  // Takes the cover off: the card shows the colour's gradient again
  async removeCover(token: string | null, id: string): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}/cover`, { method: "DELETE", token }));
  },
  // Adds or replaces the program page's photo (the top of the program's screen, not the card)
  async setHero(token: string | null, id: string, photo: CoverPhoto): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}/hero`, { method: "PUT", body: photo, token }));
  },
  // Takes the page photo off: the program's screen shows the colour's gradient again
  async removeHero(token: string | null, id: string): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}/hero`, { method: "DELETE", token }));
  },
  // A session at the end: its title, minutes and one YouTube video's link (embedded, never uploaded)
  async addSession(token: string | null, id: string, session: SessionFields): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}/sessions`, { method: "POST", body: session, token }));
  },
  // Any of the three; youtube "" takes the video off
  async editSession(token: string | null, id: string, sessionId: string, session: Partial<SessionFields>): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}`, { method: "PATCH", body: session, token }));
  },
  async deleteSession(token: string | null, id: string, sessionId: string): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", token }));
  },
  async moveSession(token: string | null, id: string, sessionId: string, direction: "up" | "down"): Promise<ApiResult<ProgramDetail>> {
    if (!token) return signedOut();
    return unwrap(await apiFetch(`/api/admin/portal/programs/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}/move`, { method: "POST", body: { direction }, token }));
  },
};
