// Admin › Exercises, the parts with no database: reading the admin's requests, the name key that
// catches duplicates ("Push Ups" = "push-up"), the prompt and answer shape for asking the AI for
// new exercises, and cleaning what it answers before anything is stored. Every value from a
// request or from the model passes through here; the database's ENUM and CHECK constraints are
// the second line.
const { ValidationError } = require("../profile");
const { NotFoundError } = require("../errors");

const MUSCLE_GROUPS = ["legs", "chest", "back", "shoulders", "arms", "core", "full_body", "cardio"];
const PATTERNS = [
  "squat", "hinge", "lunge", "knee_flexion", "knee_extension", "calf",
  "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull",
  "elbow_flexion", "elbow_extension", "shoulder_abduction", "rear_delt",
  "core", "conditioning", "warmup", "stretch",
];
const REGIONS = ["lower", "upper", "any"];
const VIDEO_FILTERS = ["all", "missing", "ready"];
const SHOW = ["active", "archived"];

const limits = {
  name: 80,
  equipment: 60,
  instructionLines: 10,
  instructionLine: 200,
  request: 200,
  search: 60,
  maxDrafts: 20,
  // Every library name goes in the prompt (so the AI doesn't repeat one); more than this and the
  // oldest ones are left out, and the duplicate check below still catches a repeat
  promptNames: 400,
};

// ---- names ------------------------------------------------------------------------------

/**
 * The key two names share when they are the same exercise: lower case, words only, each word
 * singular. "Push Ups", "push-up" and "Pushup" → "pushup"; "Bench Presses" = "Bench Press".
 */
function exerciseKey(name) {
  const words = String(name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words
    .map((w) => (w.endsWith("sses") ? w.slice(0, -2) : w.length >= 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join("");
}

// Letters, digits, spaces and the punctuation real exercise names use; nothing else is kept
const cleanText = (value, max) =>
  typeof value === "string"
    ? value.replace(/[^\p{L}\p{N} ,.'()/&+%:;!?-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";

// "barbell back squat" → "Barbell Back Squat" (short words like "to" stay lower case)
const titleCase = (name) =>
  name
    .split(" ")
    .map((w, i) => (i > 0 && ["a", "an", "and", "of", "on", "to", "with", "the", "in"].includes(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

// ---- the admin's requests ---------------------------------------------------------------

const onlyKeys = (body, allowed) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the details as JSON.");
  const extra = Object.keys(body).find((k) => !allowed.includes(k));
  if (extra) throw new ValidationError(`"${extra.slice(0, 30)}" isn't something you can send here.`);
};

/** The list's filters from the query string; anything unknown reads as the default */
function listQuery(query = {}) {
  const search = typeof query.search === "string" ? query.search.trim().slice(0, limits.search) : "";
  const group = MUSCLE_GROUPS.includes(query.group) ? query.group : null;
  const video = VIDEO_FILTERS.includes(query.video) ? query.video : "all";
  const show = SHOW.includes(query.show) ? query.show : "active";
  return { search, group, video, show };
}

/** An exercise id from the path: a UUID, or the exercise reads as missing */
function exerciseId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new NotFoundError("That exercise doesn't exist.");
  }
  return value.toLowerCase();
}

/** "Ask AI to add exercises": what to add (a short description) and how many (1-20) */
function draftBody(body) {
  onlyKeys(body, ["request", "count"]);
  const request = cleanText(body.request, limits.request + 1);
  if (request.length < 3) throw new ValidationError("Describe the exercises to add, for example \"10 home yoga stretches\".");
  if (request.length > limits.request) throw new ValidationError(`Keep the description under ${limits.request} characters.`);
  const count = body.count === undefined ? 10 : body.count;
  if (!Number.isInteger(count) || count < 1 || count > limits.maxDrafts) throw new ValidationError(`Ask for 1 to ${limits.maxDrafts} exercises at a time.`);
  return { request, count };
}

// ---- asking the AI ------------------------------------------------------------------------

const INSTRUCTIONS = [
  "You add exercises to the exercise library of justFit, an Indian fitness app. Members train in typical Indian gyms or at home.",
  "Answer only with real, well-known, safe exercises a qualified trainer would teach. Never invent a movement, never add a brand name, a person's name or anything that isn't an exercise.",
  "Name each one the way Indian gyms and trainers commonly say it in English, in Title Case, at most 60 characters (for example \"Dumbbell Goblet Squat\", \"Surya Namaskar\", \"Cat-Cow Stretch\").",
  "Skip every exercise already in the library list, including the same exercise under a slightly different name.",
  "For each one give: muscleGroup; pattern (how it moves: warmup and stretch for warm-ups and cool-down stretches, conditioning for cardio finishers); equipment (\"Bodyweight\" when none, else the main kit, at most 40 characters); difficulty 1-3 (1 simple and stable, 2 needs some skill or load, 3 complex, unstable or heavy: not how tiring it is); region (lower or upper for warm-ups and stretches that prepare one half, else any); highRisk (true only for heavy spinal loading or jumping/plyometrics); lowImpact (true when safe for heavier bodies and sore knees: no jumping or running); machine (true for machines and cables); timedSec (the seconds for a held or timed exercise like a plank or a stretch, else null); instructions (2 to 5 short steps, one sentence each, at most 150 characters).",
  "If the request is not about exercises, answer with an empty list.",
].join(" ");

const exerciseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "muscleGroup", "pattern", "equipment", "difficulty", "region", "highRisk", "lowImpact", "machine", "timedSec", "instructions"],
  properties: {
    name: { type: "string" },
    muscleGroup: { type: "string", enum: MUSCLE_GROUPS },
    pattern: { type: "string", enum: PATTERNS },
    equipment: { type: "string" },
    difficulty: { type: "integer", enum: [1, 2, 3] },
    region: { type: "string", enum: REGIONS },
    highRisk: { type: "boolean" },
    lowImpact: { type: "boolean" },
    machine: { type: "boolean" },
    timedSec: { type: ["integer", "null"] },
    instructions: { type: "array", items: { type: "string" } },
  },
};

const draftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["exercises"],
  properties: { exercises: { type: "array", items: exerciseSchema } },
};

/** The prompt's text: the admin's request, how many, and the names already in the library */
function draftBrief({ request, count }, existingNames) {
  const names = existingNames.slice(0, limits.promptNames).join("; ");
  return `Add up to ${count} exercises for this request: "${request}".\nAlready in the library (skip these): ${names || "nothing yet"}.`;
}

// The test answer (AI_PROVIDER=fake): one new exercise, one duplicate of a built-in, one broken row
const FAKE_DRAFT = {
  exercises: [
    { name: "Surya Namaskar", muscleGroup: "full_body", pattern: "warmup", equipment: "Bodyweight", difficulty: 1, region: "any", highRisk: false, lowImpact: true, machine: false, timedSec: 60, instructions: ["Stand tall with palms together.", "Flow through the twelve poses with your breath.", "Return to standing and repeat."] },
    { name: "Bodyweight Squats", muscleGroup: "legs", pattern: "squat", equipment: "Bodyweight", difficulty: 1, region: "lower", highRisk: false, lowImpact: true, machine: false, timedSec: null, instructions: ["Feet shoulder-width apart.", "Sit back and down, then stand."] },
    { name: "", muscleGroup: "legs", pattern: "squat", equipment: "", difficulty: 1, region: "any", highRisk: false, lowImpact: true, machine: false, timedSec: null, instructions: [] },
  ],
};

/**
 * The AI's answer → the rows to add and the ones left out (each with why). A row is left out when
 * a field is missing or out of range, or its name matches one already in the library (`taken`, a
 * Set of exerciseKey values) or one earlier in the same answer. At most `count` rows are added.
 */
function normalizeDrafts(raw, { count, taken }) {
  const seen = new Set(taken);
  const added = [];
  const skipped = [];
  const list = Array.isArray(raw?.exercises) ? raw.exercises : [];
  for (const e of list) {
    const name = titleCase(cleanText(e?.name, limits.name));
    const key = exerciseKey(name);
    const skip = (reason) => skipped.push({ name: name || "(no name)", reason });
    if (name.length < 3 || key.length < 3) { skip("It had no usable name."); continue; }
    if (seen.has(key)) { skip("It's already in the library."); continue; }
    if (!MUSCLE_GROUPS.includes(e.muscleGroup) || !PATTERNS.includes(e.pattern) || !REGIONS.includes(e.region) || ![1, 2, 3].includes(e.difficulty)) {
      skip("Some of its details were missing.");
      continue;
    }
    const instructions = (Array.isArray(e.instructions) ? e.instructions : [])
      .map((line) => cleanText(line, limits.instructionLine))
      .filter((line) => line.length >= 3)
      .slice(0, limits.instructionLines);
    if (instructions.length < 2) { skip("It came without steps."); continue; }
    if (added.length >= count) { skip("You asked for fewer."); continue; }
    const timed = Number.isInteger(e.timedSec) && e.timedSec >= 5 && e.timedSec <= 600 ? e.timedSec : null;
    seen.add(key);
    added.push({
      name,
      muscleGroup: e.muscleGroup,
      pattern: e.pattern,
      equipment: cleanText(e.equipment, limits.equipment) || "Bodyweight",
      difficulty: e.difficulty,
      region: e.region,
      highRisk: e.highRisk === true,
      lowImpact: e.lowImpact === true,
      machine: e.machine === true,
      timedSec: timed,
      instructions,
    });
  }
  return { added, skipped };
}

module.exports = {
  MUSCLE_GROUPS, PATTERNS, REGIONS, limits,
  exerciseKey, listQuery, exerciseId, draftBody,
  INSTRUCTIONS, draftSchema, draftBrief, FAKE_DRAFT, normalizeDrafts,
};
