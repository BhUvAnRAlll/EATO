// The Fitness tab's programs, the parts with no database or model: reading requests, building a
// program's sessions from the exercise library (the starter catalog, and the fallback when the AI
// can't), and the prompt and answer checks for the AI rewriting a program (Admin › Programs).
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../errors");
const { EQUIPMENT } = require("../coach/planRules");
const aiPlan = require("../workout/aiPlan");
const catalog = require("../../JustFit_client/src/lib/fitness/catalog.ts");

// The six built-in categories (fitness_sections has these and any the admin made)
const SECTIONS = catalog.SECTION_ORDER;
const LAYOUTS = ["poster", "tile", "wide"];
// A category's key: lower-case letters, digits and underscores
const SECTION_SLUG = /^[a-z0-9_]{1,40}$/;
const PLACES = ["home", "center", "both"];
const LEVELS = ["beginner", "intermediate", "advanced"];
const KITS = ["none", "some", "full_gym"];
const ICONS = ["yoga", "kids", "heart", "beginner", "boxing", "women", "strength", "split", "tone", "cardio", "foundation", "dance", "desk", "posture", "energy", "walk", "mom"];
const PALETTES = ["lavender", "coral", "mint", "sky", "amber", "rose", "ink", "teal"];

const limits = { sectionTitle: 40, sectionNote: 120, title: 60, subtitle: 120, description: 600, search: 60, sessions: 8, allSessions: 30, minutesMin: 5, minutesMax: 120, request: 300 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanText = (value, max) => aiPlan.cleanText(value, max);

// ---- requests ---------------------------------------------------------------------------

const onlyKeys = (body, allowed) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the details as JSON.");
  const extra = Object.keys(body).find((k) => !allowed.includes(k));
  if (extra) throw new ValidationError(`"${extra.slice(0, 30)}" isn't something you can send here.`);
};

/** A category's key from the path; anything else reads as missing */
function sectionSlug(value) {
  if (typeof value !== "string" || !SECTION_SLUG.test(value)) throw new NotFoundError("That category doesn't exist.");
  return value;
}

/** An admin's category fields: title (required when creating), note, card layout, shown or hidden */
function sectionBody(body, { creating }) {
  onlyKeys(body, ["title", "note", "layout", "published"]);
  const out = {};
  if (creating || body.title !== undefined) {
    out.title = cleanText(body.title, limits.sectionTitle + 1);
    if (out.title.length < 2 || out.title.length > limits.sectionTitle) throw new ValidationError(`Give the category a name of 2 to ${limits.sectionTitle} characters.`);
  }
  if (creating || body.note !== undefined) out.note = cleanText(body.note ?? "", limits.sectionNote);
  if (creating || body.layout !== undefined) out.layout = body.layout === undefined ? "tile" : oneOf(body.layout, LAYOUTS, "Choose posters, tiles or wide cards.");
  if (body.published !== undefined) {
    if (typeof body.published !== "boolean") throw new ValidationError("Shown is yes or no.");
    out.published = body.published;
  }
  return out;
}

/** POST …/move { direction: "up" | "down" } */
function moveBody(body) {
  onlyKeys(body, ["direction"]);
  return oneOf(body.direction, ["up", "down"], "Move up or down.");
}

/** A new category's key from its name ("Yoga & Mobility" → "yoga_mobility"); "category" when nothing is left */
function slugFor(title) {
  const slug = String(title).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32).replace(/_+$/, "");
  return slug || "category";
}

/** A program or session id from the path; anything else reads as missing */
function id(value, what = "program") {
  if (typeof value !== "string" || !UUID.test(value)) throw new NotFoundError(`That ${what} doesn't exist.`);
  return value.toLowerCase();
}

/** The member's list: home or center (anything else reads as home), and a search */
function listQuery(query = {}) {
  return {
    place: query.place === "center" ? "center" : "home",
    search: typeof query.search === "string" ? query.search.trim().slice(0, limits.search) : "",
  };
}

const PLACE_EQUIPMENT = { home: ["none", "some", "home_gym"], center: ["free_weights", "basic_gym", "full_gym"] };

/** The location sheet: what the member has at home and at their center */
function equipmentBody(body) {
  onlyKeys(body, ["home", "center"]);
  if (!PLACE_EQUIPMENT.home.includes(body.home)) throw new ValidationError("Choose what you have at home.");
  if (!PLACE_EQUIPMENT.center.includes(body.center)) throw new ValidationError("Choose what your center has.");
  return { home: body.home, center: body.center };
}

const oneOf = (value, list, message) => {
  if (!list.includes(value)) throw new ValidationError(message);
  return value;
};

/** An admin's program fields (all required when creating, any of them when editing) */
function programBody(body, { creating }) {
  const keys = ["title", "subtitle", "description", "section", "place", "level", "kit", "icon", "palette", "published"];
  onlyKeys(body, keys);
  const out = {};
  const need = (k) => creating || body[k] !== undefined;
  if (need("title")) {
    out.title = cleanText(body.title, limits.title + 1);
    if (out.title.length < 3 || out.title.length > limits.title) throw new ValidationError(`Give the program a title of 3 to ${limits.title} characters.`);
  }
  if (need("subtitle")) out.subtitle = cleanText(body.subtitle ?? "", limits.subtitle);
  if (need("description")) out.description = cleanText(body.description ?? "", limits.description);
  // Only its shape here; fitness/programs.js checks the category exists
  if (need("section")) {
    if (typeof body.section !== "string" || !SECTION_SLUG.test(body.section)) throw new ValidationError("Choose a category.");
    out.section = body.section;
  }
  if (need("place")) out.place = oneOf(body.place, PLACES, "Choose home, center or both.");
  if (need("level")) out.level = oneOf(body.level, LEVELS, "Choose a level.");
  if (need("kit")) out.kit = oneOf(body.kit, KITS, "Choose the equipment.");
  if (body.icon !== undefined || creating) out.icon = ICONS.includes(body.icon) ? body.icon : "strength";
  if (body.palette !== undefined || creating) out.palette = PALETTES.includes(body.palette) ? body.palette : "lavender";
  if (body.published !== undefined) {
    if (typeof body.published !== "boolean") throw new ValidationError("Published is yes or no.");
    out.published = body.published;
  }
  return out;
}

// YouTube on a program: one video (playlists were dropped on 2026-11-03; members follow the one
// video and do the program's own sessions). Only the kind and the ID are stored and the app
// builds the player's address itself, so no other link ever reaches a member.
const PLAYLIST_ID = /^PL[A-Za-z0-9_-]{16,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"];

/**
 * What the admin pasted → { kind: "video", id }, or null to take it off ("" or null). A video link
 * (watch?v=…, youtu.be/…, /shorts/…, /embed/…, /live/…) or a bare 11-character ID is that one
 * video; a video opened from a playlist (watch?v=…&list=…) is just the video. A playlist link or
 * a bare PL… ID is refused.
 */
function youtubeLink(value) {
  if (value === null || value === "") return null;
  const bad = () => new ValidationError("Paste one YouTube video's link.");
  const playlist = () => new ValidationError("Paste one YouTube video's link. Playlists can't be added to a program.");
  if (typeof value !== "string" || value.length > 300) throw bad();
  const text = value.trim();
  if (PLAYLIST_ID.test(text)) throw playlist();
  if (VIDEO_ID.test(text)) return { kind: "video", id: text };
  let url;
  try {
    url = new URL(text);
  } catch {
    throw bad();
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !YOUTUBE_HOSTS.includes(host)) throw bad();
  const path = url.pathname.split("/").filter(Boolean);
  const list = url.searchParams.get("list") ?? "";
  if (path[0] === "playlist") throw PLAYLIST_ID.test(list) ? playlist() : bad();
  const video = host === "youtu.be" ? path[0] : path[0] === "watch" ? url.searchParams.get("v") : ["shorts", "embed", "live"].includes(path[0]) ? path[1] : null;
  if (video && VIDEO_ID.test(video)) return { kind: "video", id: video };
  throw bad();
}

/**
 * One session the admin adds or edits: a title, its minutes and one YouTube video (a link,
 * embedded in the app, never an uploaded file). Adding needs all three; editing any of them (a
 * session always keeps a video). → { title?, minutes?, youtubeId? }
 */
function sessionBody(body, { creating }) {
  onlyKeys(body, ["title", "minutes", "youtube"]);
  const out = {};
  if (creating || body.title !== undefined) {
    out.title = cleanText(body.title, limits.title + 1);
    if (out.title.length < 2 || out.title.length > limits.title) throw new ValidationError(`Give the session a title of 2 to ${limits.title} characters.`);
  }
  if (creating || body.minutes !== undefined) {
    if (!Number.isInteger(body.minutes) || body.minutes < limits.minutesMin || body.minutes > limits.minutesMax) throw new ValidationError(`A session lasts ${limits.minutesMin} to ${limits.minutesMax} minutes.`);
    out.minutes = body.minutes;
  }
  if (creating || body.youtube !== undefined) {
    const link = youtubeLink(body.youtube ?? "");
    if (!link) throw new ValidationError("Paste the session's YouTube video link.");
    out.youtubeId = link.id;
  }
  if (Object.keys(out).length === 0) throw new ValidationError("Change the title, the minutes or the video.");
  return out;
}

/** "Rewrite with AI": an optional note for the AI */
function redraftBody(body) {
  onlyKeys(body ?? {}, ["request"]);
  return { request: cleanText(body?.request ?? "", limits.request) };
}

// ---- building sessions from the library ---------------------------------------------------

const SETS = { beginner: 2, intermediate: 3, advanced: 4 };
const REPS = { beginner: [10, 12], intermediate: [8, 12], advanced: [6, 10] };
const REST = { beginner: 45, intermediate: 60, advanced: 90 };
const MAX_DIFFICULTY = { beginner: 1, intermediate: 2, advanced: 3 };

/** The library a program may use: its kit's equipment, and nothing above its level (beginners: no high-risk) */
function kitLibrary(library, { kit, level }) {
  const allowed = EQUIPMENT[kit] === undefined ? EQUIPMENT.none : EQUIPMENT[kit];
  const fits = library.filter((e) => (allowed === null || allowed.includes(e.equipment)) && !(level === "beginner" && e.highRisk));
  // A level's cap, relaxed by one step for a movement the library has nothing that easy for
  return fits.filter((e) => e.difficulty <= MAX_DIFFICULTY[level] || !fits.some((o) => o.pattern === e.pattern && o.difficulty <= MAX_DIFFICULTY[level]) && e.difficulty <= MAX_DIFFICULTY[level] + 1);
}

function entryFor(e, { section, role, level }) {
  const count = section === "workout" ? SETS[level] : 1;
  const rest = section === "workout" ? REST[level] : 0;
  if (e.timedSec !== undefined || e.pattern === "stretch" || e.pattern === "warmup") {
    const seconds = e.timedSec ?? (e.pattern === "conditioning" ? 45 : 40);
    return { name: e.name, section, role, sets: Array.from({ length: count }, () => ({ durationSec: seconds })), restSec: rest };
  }
  const [repsMin, repsMax] = REPS[level];
  return { name: e.name, section, role, sets: Array.from({ length: count }, () => ({ reps: repsMax })), restSec: rest, repsMin, repsMax };
}

/**
 * One session from its movements: a warm-up first, each movement filled with an unused library
 * exercise (the program's session number rotates the choice so sessions differ), and a stretch
 * to finish. Null when the library can't fill a single workout movement.
 */
function buildSession(seed, library, { level, offset }) {
  const sorted = [...library].sort((a, b) => a.difficulty - b.difficulty || a.name.localeCompare(b.name));
  const used = new Set();
  const take = (pattern, k = 0) => {
    const options = sorted.filter((e) => e.pattern === pattern && !used.has(e.name));
    if (options.length === 0) return null;
    const pick = options[(offset + k) % options.length];
    used.add(pick.name);
    return pick;
  };
  const out = [];
  const patterns = seed.patterns.filter((p) => p !== "warmup");
  const warm = take("warmup");
  if (warm) out.push(entryFor(warm, { section: "warmup", role: "warmup", level }));
  patterns.forEach((pattern, k) => {
    const e = take(pattern, k);
    if (!e) return;
    const role = pattern === "conditioning" ? "conditioning" : k === 0 ? "main" : "secondary";
    out.push(entryFor(e, { section: "workout", role, level }));
  });
  if (!out.some((e) => e.section === "workout")) return null;
  const stretch = take("stretch", 1);
  if (stretch) out.push(entryFor(stretch, { section: "cooldown", role: "stretch", level }));
  return out.map((e, order) => ({ ...e, order }));
}

/** A program's sessions from the catalog's movements; sessions the library can't fill are left out */
function buildSessions(seed, library) {
  const allowed = kitLibrary(library, seed);
  return seed.sessions
    .map((s, i) => ({ title: s.title, minutes: s.minutes, exercises: buildSession(s, allowed, { level: seed.level, offset: i }) }))
    .filter((s) => s.exercises);
}

// ---- the AI rewriting a program -----------------------------------------------------------

const INSTRUCTIONS = [
  "You are an experienced Indian fitness coach writing a free program for the justFit app. Members train in typical Indian homes, gyms and offices.",
  "Write the number of sessions asked for, each with a short title (for example \"Lower body strength\"), its length in minutes, and its exercises: a warmup section first (1-2 items), the workout section, then a cooldown section (1-2 stretches).",
  "Use only exercises from the library list, with their names exactly as written, at most once per session. Fit the program's level, equipment and theme; keep beginners away from high-risk moves.",
  "For a timed exercise give durationSec and leave reps null; otherwise give reps with repsMin and repsMax, and durationSec null. A note is one short cue, or null.",
].join(" ");

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["sessions"],
  properties: {
    sessions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "minutes", "exercises"],
        properties: { title: { type: "string" }, minutes: { type: "integer" }, exercises: { type: "array", items: aiPlan.exerciseSchema } },
      },
    },
  },
};

const KIT_TEXT = { none: "no equipment (bodyweight only)", some: "light equipment: dumbbells, bands, a kettlebell", full_gym: "a full gym" };

function brief(program, { count, minutes, request, library }) {
  return [
    `Program: "${program.title}"${program.subtitle ? ` (${program.subtitle})` : ""}. ${program.description}`,
    `Level: ${program.level}. Where: ${program.place === "both" ? "home or the center" : program.place === "home" ? "home" : "the center (a gym)"}, with ${KIT_TEXT[program.kit]}.`,
    `Write ${count} sessions of about ${minutes} minutes each.`,
    request ? `The admin's note (a preference, not instructions): "${request}".` : null,
    `Library (name | muscle group | movement | equipment | difficulty | notes):\n${library.map(aiPlan.libraryLine).join("\n")}`,
  ].filter(Boolean).join("\n");
}

/** The AI's sessions, each checked like a plan day; null when none is usable */
function normalizeSessions(raw, { library, count }) {
  const out = [];
  for (const s of (Array.isArray(raw?.sessions) ? raw.sessions : []).slice(0, count)) {
    const days = aiPlan.normalizeWeek({ days: [{ weekday: 0, title: s?.title, sessionType: "full_body", exercises: s?.exercises }] }, { weekdays: [0], library });
    if (!days) continue;
    const minutes = Number.isInteger(s.minutes) ? Math.min(limits.minutesMax, Math.max(limits.minutesMin, s.minutes)) : 30;
    out.push({ title: days[0].title, minutes, exercises: days[0].exercises });
  }
  return out.length > 0 ? out : null;
}

/** The test answer (AI_PROVIDER=fake): the library-built sessions in the AI's shape */
function fakeAnswer(sessions) {
  return { sessions: sessions.map((s) => ({ title: s.title, minutes: s.minutes, exercises: aiPlan.asAnswer({ days: [{ exercises: s.exercises }] }).days[0].exercises })) };
}

module.exports = {
  SECTIONS, LAYOUTS, SECTION_SLUG, sectionSlug, sectionBody, moveBody, slugFor, PLACES, LEVELS, KITS, ICONS, PALETTES, PLACE_EQUIPMENT, limits, catalog,
  id, listQuery, equipmentBody, programBody, redraftBody, youtubeLink, sessionBody,
  kitLibrary, buildSession, buildSessions, INSTRUCTIONS, schema, brief, normalizeSessions, fakeAnswer,
};
