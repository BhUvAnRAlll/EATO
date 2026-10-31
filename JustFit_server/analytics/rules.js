// Pure rules for app event tracking (no database, no network), unit-tested directly: which
// events the app may send, how a batch is checked and cleaned, and what never gets stored.
//
// The app sends what a member did, never who they are: the member is the session's user on the
// server. Metadata is a small, flat set of plain values the screen already shows (a slot, a
// module, a count), capped in size, and a few keys that would carry personal data are refused
// by name. Event ids come from the app so a retried batch never stores an event twice.
const { ValidationError } = require("../profile");

// Every event the app may send, with its module (the screen area it belongs to)
const EVENTS = {
  app_opened: "app",
  screen_viewed: "app",
  login_completed: "app",
  workout_started: "workout",
  workout_completed: "workout",
  meal_logged: "nutrition",
  food_scanned: "nutrition",
  water_logged: "nutrition",
  macro_updated: "nutrition",
  ai_chat_sent: "coach",
  coach_plan_made: "coach",
  coach_meal_swapped: "coach",
  community_post_created: "community",
  community_post_liked: "community",
  community_comment_sent: "community",
  message_sent: "community",
  story_viewed: "stories",
  story_created: "stories",
  attendance_checked_in: "attendance",
  attendance_checked_out: "attendance",
  weight_logged: "progress",
  body_scanned: "progress",
};
const MODULES = [...new Set(Object.values(EVENTS))];
// Screens worth a screen_viewed event, by the first path segment after the role group
const SCREENS = ["home", "meals", "coach", "macro", "community", "workout", "profile", "my-qr", "messages", "measurements"];
const PLATFORMS = ["ios", "android", "web"];

const limits = {
  batch: 50, // events per request
  metadataKeys: 8,
  metadataValue: 80, // characters per string value
  screen: 60,
  version: 20,
  clockSkewMs: 7 * 24 * 3600 * 1000, // an event older than a week (an offline queue) still counts; older is dropped
  futureMs: 5 * 60 * 1000, // a clock a little ahead is fine; further is clamped to now
};

// Metadata keys that would carry personal data, whatever the value: never stored
const REFUSED_KEYS = /^(email|phone|name|full_name|first_name|last_name|address|token|password|otp|code|dob|birthday|lat|lng|latitude|longitude|ip)$/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isPlain = (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";

// The metadata an event may keep: a few flat, plain values; everything else is dropped silently
// (a bad field is never a reason to lose the event itself)
function cleanMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const kept = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(kept).length >= limits.metadataKeys) break;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,30}$/.test(key) || REFUSED_KEYS.test(key) || !isPlain(value)) continue;
    kept[key] = typeof value === "string" ? value.slice(0, limits.metadataValue) : value;
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

/**
 * One event from the app, checked. Throws ValidationError for anything that can't be an event
 * (the whole batch is refused: the app's queue keeps it and the bug shows up in development).
 */
function cleanEvent(raw, nowMs) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError("Each event must be an object.");
  const { id, name, at, sessionId, screen, metadata } = raw;
  if (typeof id !== "string" || !UUID.test(id)) throw new ValidationError("Each event needs an id.");
  if (typeof name !== "string" || !(name in EVENTS)) throw new ValidationError("That isn't an event the app sends.");
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) throw new ValidationError("Each event needs a session id.");
  const sent = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(sent)) throw new ValidationError("Each event needs a time.");
  if (sent < nowMs - limits.clockSkewMs) return null; // too old to mean anything: dropped, not refused
  const atMs = Math.min(sent, nowMs + limits.futureMs);
  let screenName = null;
  if (screen !== undefined && screen !== null) {
    if (typeof screen !== "string") throw new ValidationError("A screen name must be text.");
    screenName = screen.slice(0, limits.screen);
    if (name === "screen_viewed" && !SCREENS.includes(screenName)) return null; // a screen we don't chart: dropped
  } else if (name === "screen_viewed") {
    throw new ValidationError("A screen view needs the screen's name.");
  }
  return { id: id.toLowerCase(), name, module: EVENTS[name], screen: screenName, sessionId: sessionId.toLowerCase(), atMs, metadata: cleanMetadata(metadata) };
}

/**
 * A batch from the app: { events: [...], platform, appVersion }. Returns the events to store
 * (deduplicated within the batch by id; the database refuses ids seen in earlier batches) and
 * the device line. Unknown top-level fields are refused.
 */
function cleanBatch(body, nowMs = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("The request body must be a JSON object.");
  for (const key of Object.keys(body)) if (!["events", "platform", "appVersion"].includes(key)) throw new ValidationError("The request has a field that isn't allowed.");
  if (!Array.isArray(body.events) || body.events.length === 0) throw new ValidationError("Send at least one event.");
  if (body.events.length > limits.batch) throw new ValidationError(`Send at most ${limits.batch} events at a time.`);
  if (!PLATFORMS.includes(body.platform)) throw new ValidationError("The platform must be ios, android or web.");
  const appVersion = typeof body.appVersion === "string" && /^[0-9A-Za-z.+-]{1,20}$/.test(body.appVersion) ? body.appVersion : null;
  const seen = new Set();
  const events = [];
  for (const raw of body.events) {
    const event = cleanEvent(raw, nowMs);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  return { events, platform: body.platform, appVersion, dropped: body.events.length - events.length };
}

module.exports = { EVENTS, MODULES, SCREENS, PLATFORMS, limits, cleanMetadata, cleanEvent, cleanBatch };
