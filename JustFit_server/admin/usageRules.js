// Pure rules for Super Admin › App Usage (no database, no network), unit-tested directly:
// which features are counted and from which rows, the date ranges the screen filters by, and
// the comparison with the period before. The AI Usage module is separate (admin/aiUsage.js):
// here the AI features are counted as uses, never as tokens or cost.
const { ValidationError } = require("../profile");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- the features ----------------------------------------------------------------------
//
// Each feature counts rows an existing table already writes when a member does the thing, so
// nothing is tracked in the app yet. `at` is the row's time column, `member` the member column,
// `where` an extra SQL condition (table and column names come from here, never from a request).
// A failed or refused call never counts as a use. `at` is a TIMESTAMP or (weigh-ins) a DATE: both
// compare correctly against the range's dates with "at >= from AND at < to + 1 day".
const FEATURES = [
  { id: "meal_log", module: "nutrition", label: "Meals logged", table: "macro_meal_logs", member: "user_id", at: "created_at" },
  { id: "water_log", module: "nutrition", label: "Water logged", table: "macro_water_logs", member: "user_id", at: "logged_at" },
  { id: "food_scan", module: "nutrition", label: "Food photo scans", table: "ai_usage", member: "user_id", at: "created_at", where: "feature = 'food_scan' AND status = 'ok'" },
  { id: "workout_started", module: "workout", label: "Workouts started", table: "workout_logs", member: "user_id", at: "started_at" },
  { id: "workout_completed", module: "workout", label: "Workouts completed", table: "workout_logs", member: "user_id", at: "completed_at", where: "status = 'completed'" },
  { id: "coach_plan", module: "coach", label: "Coach plans made", table: "coach_plans", member: "user_id", at: "created_at" },
  { id: "coach_chat", module: "coach", label: "Coach chat messages", table: "ai_usage", member: "user_id", at: "created_at", where: "feature = 'coach_chat' AND status = 'ok'" },
  { id: "weigh_in", module: "progress", label: "Weight updates", table: "weigh_ins", member: "user_id", at: "logged_on" },
  { id: "body_scan", module: "progress", label: "Body scans", table: "ai_usage", member: "user_id", at: "created_at", where: "feature = 'body_scan' AND status = 'ok'" },
];

const MODULES = [
  { id: "nutrition", label: "Meals & Macro" },
  { id: "workout", label: "Workout" },
  { id: "coach", label: "AI Coach" },
  { id: "progress", label: "Progress" },
];

// Asked for by the brief, but the app has nothing that writes them yet. Reported as "not
// tracked" so a zero is never mistaken for "nobody uses it".
const NOT_TRACKED = [
  { id: "screen_visits", label: "Screen visits and sessions", reason: "needs the app's event tracking (migrations/2026-11-04-analytics.sql) on this server" },
  { id: "share", label: "Shares", reason: "the app has no share action" },
  { id: "progress_photo", label: "Progress photos and measurements", reason: "not in the app" },
];

// ---- date ranges -----------------------------------------------------------------------

const RANGES = ["today", "yesterday", "7d", "30d", "90d", "this_month", "last_month", "custom"];
const MAX_CUSTOM_DAYS = 366;

const addDays = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;

const isoDate = (value, what) => {
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new ValidationError(`${what} must be a date like 2026-10-30.`);
  return value;
};

/**
 * The query's range as two inclusive dates, plus the period of the same length just before it
 * (for "vs the period before"). `today` is the database's date, passed in so the rule stays pure.
 */
function usageQuery(query, today) {
  const range = query.range === undefined || query.range === "" ? "7d" : query.range;
  if (!RANGES.includes(range)) throw new ValidationError("Pick a range: today, yesterday, 7d, 30d, 90d, this_month, last_month or custom.");
  let from;
  let to;
  if (range === "today") { from = today; to = today; }
  else if (range === "yesterday") { from = addDays(today, -1); to = from; }
  else if (range === "7d" || range === "30d" || range === "90d") { to = today; from = addDays(today, 1 - Number.parseInt(range, 10)); }
  else if (range === "this_month") { from = monthStart(today); to = today; }
  else if (range === "last_month") { to = addDays(monthStart(today), -1); from = monthStart(to); }
  else {
    from = isoDate(query.from, "from");
    to = isoDate(query.to, "to");
    if (from > to) throw new ValidationError("The range's start must not be after its end.");
    if (to > today) throw new ValidationError("The range can't end in the future.");
    if (daysBetween(from, to) > MAX_CUSTOM_DAYS) throw new ValidationError(`A custom range can cover at most ${MAX_CUSTOM_DAYS} days.`);
  }
  const days = daysBetween(from, to);
  return { range, from, to, days, previousFrom: addDays(from, -days), previousTo: addDays(from, -1) };
}

// ---- comparison and ranking --------------------------------------------------------------

// Percent change from the period before, or null when there was nothing to compare with
function changePercent(current, previous) {
  if (!(Number(previous) > 0)) return null;
  return Math.round(((Number(current) - Number(previous)) / Number(previous)) * 100);
}

/**
 * The features ranked by distinct members (then uses), with the share of active members who
 * used each one. `active` is the number of members active in the period; a feature nobody used
 * stays in the list at zero. A feature is "declining" when its members fell by at least a
 * quarter from the period before, and "unused" when nobody used it in either period.
 */
function rankFeatures(rows, previousRows, active) {
  const prev = new Map(previousRows.map((r) => [r.id, r]));
  return rows
    .map((r) => {
      const p = prev.get(r.id) ?? { uses: 0, members: 0 };
      const members = Number(r.members);
      return {
        ...r,
        uses: Number(r.uses),
        members,
        previousUses: Number(p.uses),
        previousMembers: Number(p.members),
        sharePercent: active > 0 ? Math.round((members / active) * 100) : 0,
        usesPerMember: members > 0 ? Math.round((Number(r.uses) / members) * 10) / 10 : 0,
        changePercent: changePercent(members, p.members),
        declining: Number(p.members) > 0 && members <= Number(p.members) * 0.75,
        unused: members === 0 && Number(p.members) === 0,
      };
    })
    .sort((a, b) => b.members - a.members || b.uses - a.uses || a.label.localeCompare(b.label));
}

module.exports = { FEATURES, MODULES, NOT_TRACKED, RANGES, MAX_CUSTOM_DAYS, usageQuery, changePercent, rankFeatures, addDays, daysBetween };
