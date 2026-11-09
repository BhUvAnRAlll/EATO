// In-app notifications (Gym Hub ecosystem, the user's brief of 2026-11-09, section 9): pure rules,
// unit-tested. Every notification has a kind (what happened), a category the person can switch off,
// short words, an optional link to an app screen from a fixed list, and a dedupe key: the same event
// never reaches the same person twice.
const { ValidationError } = require("../profile");

const CATEGORIES = ["membership", "pauses", "attendance", "gym", "registration", "platform"];
const CATEGORY_LABEL = {
  membership: "Memberships",
  pauses: "Pause requests",
  attendance: "Attendance and crowd",
  gym: "Gym updates",
  registration: "Gym registration",
  platform: "Complaints and platform alerts",
};
// kind → category
const KINDS = {
  "membership.activated": "membership",
  "membership.expiring": "membership",
  "membership.expired": "membership",
  "membership.suspended": "membership",
  "membership.cancelled": "membership",
  "membership.reactivated": "membership",
  "pause.submitted": "pauses",
  "pause.approved": "pauses",
  "pause.rejected": "pauses",
  "pause.by_gym": "pauses",
  "pause.request": "pauses",
  "gym.new_member": "gym",
  "gym.join_request": "gym",
  "gym.expiring": "gym",
  "gym.capacity": "attendance",
  "registration.submitted": "registration",
  "registration.decided": "registration",
  "platform.complaint": "platform",
  "gym.complaint_update": "gym",
};
// Screens a notification may open (the app routes them only after checking the same list)
const LINKS = [/^\/gym-hub(\/\d+)?$/, /^\/gym-register$/, /^\/gym\/pauses$/, /^\/gym\/members\/\d+$/, /^\/gym\/members$/, /^\/gym\/attendance$/, /^\/gym\/enquiries$/, /^\/admin\/gyms\/\d+$/, /^\/admin\/complaints\/\d+$/, /^\/gym$/];
const safeLink = (link) => (typeof link === "string" && LINKS.some((re) => re.test(link)) ? link : null);
const PAGE = 30;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A notification ready to write, or a thrown error for a programming mistake (unknown kind) */
function build({ kind, title, body, link = null, key }) {
  const category = KINDS[kind];
  if (!category) throw new Error(`Unknown notification kind ${kind}`);
  if (typeof key !== "string" || key.length === 0) throw new Error("A notification needs a dedupe key");
  return { kind, category, title: clip(String(title), 120), body: clip(String(body), 300), link: safeLink(link), key: clip(`${kind}:${key}`, 120) };
}

/** PUT /api/notifications/preferences { muted: [...] } */
function preferencesBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the preferences as JSON.");
  if (Object.keys(body).some((k) => k !== "muted")) throw new ValidationError("That request has fields we don't use.");
  if (!Array.isArray(body.muted) || body.muted.some((c) => !CATEGORIES.includes(c))) throw new ValidationError("Pick categories from the list.");
  return { muted: CATEGORIES.filter((c) => body.muted.includes(c)) };
}

/** POST /api/notifications/read { ids: [...] } or { all: true } */
function readBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the details as JSON.");
  if (Object.keys(body).some((k) => !["ids", "all"].includes(k))) throw new ValidationError("That request has fields we don't use.");
  if (body.all === true) return { all: true };
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 100 || body.ids.some((id) => !Number.isInteger(id) || id < 1)) throw new ValidationError("Pick the notifications to mark as read.");
  return { ids: [...new Set(body.ids)] };
}

/** GET /api/notifications?page= */
function listQuery(query = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1 || page > 200) throw new ValidationError("That page doesn't exist.");
  return { page };
}

/** The muted list as stored (anything odd reads as nothing muted) */
function readMuted(stored) {
  try {
    const list = typeof stored === "string" ? JSON.parse(stored) : stored;
    return Array.isArray(list) ? CATEGORIES.filter((c) => list.includes(c)) : [];
  } catch {
    return [];
  }
}

module.exports = { CATEGORIES, CATEGORY_LABEL, KINDS, PAGE, safeLink, build, preferencesBody, readBody, listQuery, readMuted };
