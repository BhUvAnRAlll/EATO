// The AI writes the member's training week (asked for by the user on 2026-11-01): which library
// exercises go on each training day, in what order, with sets, reps or seconds, rest and a short
// cue. One structured call (feature coach_workout, ai/models.js).
//
// What the server still decides, whatever the AI answers:
//   - only exercises from the member's library (so every one has its steps, and its video once the
//     admin adds it), each at most once a day; one entry per training day the member chose
//   - a reported serious injury drops high-risk exercises, and a heavier body type drops ones that
//     aren't low-impact (the same two rules the engine follows)
//   - every number inside fixed bounds (sets, reps, seconds, rest) and the text cleaned
// Everything else (the split, the choice and order of exercises, the volume) is the AI's.
//
// The rule engine stays as the fallback: when the AI isn't configured, is over a limit, fails, or
// answers a week that can't be used, the engine's plan is stored instead and the member never
// sees an error. In tests (AI_PROVIDER=fake) the "AI" answers the engine's own week.
const { askStructured } = require("../ai/structured");
const models = require("../ai/models");
const aiUsage = require("../ai/usage");
const aiLimits = require("../ai/limits");
const dedupe = require("../ai/dedupe");
const { exerciseKey } = require("../admin/exerciseRules");

const SECTIONS = ["warmup", "workout", "cooldown"];
const WORKOUT_ROLES = ["main", "secondary", "isolation", "conditioning"];
const SESSION_TYPES = ["full_body", "upper", "lower", "push", "pull", "legs"];
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const limits = {
  planName: 60,
  title: 60,
  note: 160,
  exercisesPerDay: 14,
  setsWorkout: 6,
  setsOther: 2,
  reps: 50,
  secondsMin: 10,
  secondsMax: 600,
  restWorkout: 300,
  restOther: 60,
};

const clamp = (n, min, max, fallback) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback);
const cleanText = (value, max) =>
  typeof value === "string" ? value.replace(/[^\p{L}\p{N} ,.'()/&+%:;!?-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

// ---- the prompt -------------------------------------------------------------------------

const INSTRUCTIONS = [
  "You are an experienced Indian personal trainer writing one member's training week for justFit. Members train in typical Indian gyms or at home; keep heat, hydration and realistic time in mind.",
  "Use only exercises from the library list, with their names exactly as written. Write one session for each training day given, no more and no fewer.",
  "Each session: a warmup section first (1-2 warm-up items), then the workout section, then a cooldown section (1-2 stretches). Order the workout section with the main compound lifts first, then accessories, then any conditioning finisher.",
  "Choose the split, exercises, sets, reps, seconds and rest that best fit the member's goal, level, age, body, time and limitations. Keep the difficulty at or below the member's ceilings, avoid high-risk lifts for beginners, and give sore joints a rest on back-to-back days.",
  "For a timed exercise (a hold, a stretch, cardio) give durationSec and leave reps null; otherwise give reps (the target) with repsMin and repsMax, and durationSec null.",
  "Session titles are short (for example \"Upper body strength\"). A note is one short coaching cue, or null.",
].join(" ");

const exerciseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "section", "role", "sets", "reps", "repsMin", "repsMax", "durationSec", "restSec", "note"],
  properties: {
    name: { type: "string" },
    section: { type: "string", enum: SECTIONS },
    role: { type: "string", enum: [...WORKOUT_ROLES, "warmup", "stretch"] },
    sets: { type: "integer" },
    reps: { type: ["integer", "null"] },
    repsMin: { type: ["integer", "null"] },
    repsMax: { type: ["integer", "null"] },
    durationSec: { type: ["integer", "null"] },
    restSec: { type: "integer" },
    note: { type: ["string", "null"] },
  },
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "days"],
  properties: {
    name: { type: "string" },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["weekday", "title", "sessionType", "exercises"],
        properties: {
          weekday: { type: "integer", enum: [0, 1, 2, 3, 4, 5, 6] },
          title: { type: "string" },
          sessionType: { type: "string", enum: SESSION_TYPES },
          exercises: { type: "array", items: exerciseSchema },
        },
      },
    },
  },
};

const lowImpactOnly = (inputs) => inputs.bodyType === "overweight" || inputs.bodyType === "obese";

// One library line: "Goblet Squat | legs | squat | Dumbbell | difficulty 2 | low-impact, timed 30s"
function libraryLine(e) {
  const flags = [e.highRisk && "high-risk", e.lowImpact && "low-impact", e.machine && "machine", e.timedSec !== undefined && `timed ${e.timedSec}s`].filter(Boolean);
  return `${e.name} | ${e.muscleGroup} | ${e.pattern} | ${e.equipment || "Bodyweight"} | difficulty ${e.difficulty}${flags.length ? ` | ${flags.join(", ")}` : ""}`;
}

/** The library the AI may use: the member's (already narrowed by the coach), minus what the safety rules drop */
function allowedLibrary(library, inputs, calibration) {
  return library.filter((e) => !(calibration.safetyMode && e.highRisk) && !(lowImpactOnly(inputs) && !e.lowImpact));
}

/**
 * The member's facts for the prompt: goal, level and the difficulty ceilings, body, age, pace,
 * training days, the coach's notes (time, place, joints, conditions) and the library.
 */
function brief({ inputs, calibration, library, extra }) {
  const c = calibration.ceilings;
  return [
    `Goal: ${inputs.goal.replace(/_/g, " ")}. Level: ${calibration.level}. Highest difficulty: lower body ${c.lower}, pushing ${c.push}, pulling ${c.pull}, other ${c.other}.`,
    `Member: ${inputs.gender}, ${inputs.ageYears} years, ${inputs.heightCm} cm, ${inputs.weightKg} kg, ${inputs.bodyType} build, prefers a ${inputs.pace} pace.${calibration.safetyMode ? " Reported a serious injury: keep everything gentle and beginner level." : ""}`,
    `Training days (weekday numbers, 0 = Sunday): ${inputs.weekdays.map((d) => `${d} (${WEEKDAY[d]})`).join(", ")}.`,
    extra ? extra : "Session length: about 45 minutes.",
    `Library (name | muscle group | movement | equipment | difficulty | notes):\n${library.map(libraryLine).join("\n")}`,
  ].join("\n");
}

/** The engine's week in the AI's answer shape: the test answer, and proof the two shapes agree */
function asAnswer(plan) {
  return {
    name: plan.name,
    days: plan.days.map((d) => ({
      weekday: d.weekday,
      title: d.title,
      sessionType: d.sessionType,
      exercises: d.exercises.map((e) => {
        const timed = e.sets[0]?.durationSec !== undefined;
        return {
          name: e.name, section: e.section, role: e.role, sets: e.sets.length,
          reps: timed ? null : e.sets[0]?.reps ?? e.repsMax ?? null, repsMin: e.repsMin ?? null, repsMax: e.repsMax ?? null,
          durationSec: timed ? e.sets[0].durationSec : null, restSec: e.restSec, note: e.note ?? null,
        };
      }),
    })),
  };
}

// ---- checking the answer ----------------------------------------------------------------

function normalizeExercise(raw, lib) {
  const section = SECTIONS.includes(raw.section) ? raw.section : "workout";
  const role = section === "warmup" ? "warmup" : section === "cooldown" ? "stretch" : WORKOUT_ROLES.includes(raw.role) ? raw.role : "secondary";
  const main = section === "workout";
  const count = clamp(raw.sets, 1, main ? limits.setsWorkout : limits.setsOther, 1);
  const restSec = clamp(raw.restSec, 0, main ? limits.restWorkout : limits.restOther, main ? 60 : 0);
  const note = cleanText(raw.note, limits.note) || undefined;
  const timed = lib.timedSec !== undefined || (raw.reps === null && Number.isFinite(raw.durationSec));
  if (timed) {
    const seconds = clamp(raw.durationSec, limits.secondsMin, limits.secondsMax, lib.timedSec ?? 30);
    return { name: lib.name, section, role, sets: Array.from({ length: count }, () => ({ durationSec: seconds })), restSec, ...(note ? { note } : {}) };
  }
  const repsMax = clamp(raw.repsMax ?? raw.reps, 1, limits.reps, 10);
  const repsMin = clamp(raw.repsMin ?? repsMax, 1, repsMax, repsMax);
  const reps = clamp(raw.reps ?? repsMax, repsMin, repsMax, repsMax);
  return { name: lib.name, section, role, sets: Array.from({ length: count }, () => ({ reps })), restSec, repsMin, repsMax, ...(note ? { note } : {}) };
}

/**
 * The AI's answer → the plan's days in the engine's shape, or null when the week can't be used
 * (a training day missing or with no workout exercise). Exercises outside `library` (the allowed
 * one) and repeats within a day are left out; the rest is bounded and cleaned.
 */
function normalizeWeek(raw, { weekdays, library }) {
  const byKey = new Map(library.map((e) => [exerciseKey(e.name), e]));
  const answered = new Map();
  for (const day of Array.isArray(raw?.days) ? raw.days : []) {
    if (!weekdays.includes(day?.weekday) || answered.has(day.weekday)) continue;
    const seen = new Set();
    const exercises = [];
    for (const e of Array.isArray(day.exercises) ? day.exercises : []) {
      const lib = byKey.get(exerciseKey(e?.name));
      if (!lib || seen.has(lib.name)) continue;
      seen.add(lib.name);
      exercises.push(normalizeExercise(e, lib));
    }
    const ordered = SECTIONS.flatMap((s) => exercises.filter((e) => e.section === s)).slice(0, limits.exercisesPerDay);
    if (!ordered.some((e) => e.section === "workout")) return null;
    const sessionType = SESSION_TYPES.includes(day.sessionType) ? day.sessionType : "full_body";
    answered.set(day.weekday, {
      weekday: day.weekday,
      title: cleanText(day.title, limits.title) || "Workout",
      sessionType,
      exercises: ordered.map((e, order) => ({ ...e, order })),
    });
  }
  if (weekdays.some((d) => !answered.has(d))) return null;
  return weekdays.map((d) => answered.get(d));
}

// ---- asking -----------------------------------------------------------------------------

const configured = (env) => models.isFake(env) || Boolean(env.OPENAI_API_KEY);

/**
 * The AI's week for this member as a full plan (the engine plan's facts: goal, level, calibration,
 * review flag, input hash; the AI's name and days), or null for the engine's plan to be used
 * instead. Never throws for an AI problem: a limit, a failure or an unusable answer is null.
 * `extra` is the coach's line about time, place and limitations.
 */
async function write(pool, userId, { inputs, enginePlan, library, extra = null }, env = process.env) {
  if (!configured(env)) return null;
  const allowed = allowedLibrary(library, inputs, enginePlan.calibration);
  try {
    await aiLimits.check(pool, { feature: "coach_workout", userId }, env);
    const raw = await dedupe.shared.run(dedupe.requestKey("coach_workout", userId, enginePlan.inputHash, extra, allowed.length), () =>
      askStructured(
        {
          feature: "coach_workout",
          instructions: INSTRUCTIONS,
          brief: brief({ inputs, calibration: enginePlan.calibration, library: allowed, extra }),
          schema,
          fake: asAnswer(enginePlan),
          failure: "The AI couldn't write the workout.",
        },
        env,
        aiUsage.tracker(pool, { feature: "coach_workout", userId }),
      ),
    );
    const days = normalizeWeek(raw, { weekdays: inputs.weekdays, library: allowed });
    if (!days) {
      console.error("AI workout: the answer couldn't be used; the engine's plan was kept");
      return null;
    }
    return {
      ...enginePlan,
      name: cleanText(raw.name, limits.planName) || enginePlan.name,
      days,
      // Marks the week as the AI's: engine_version stays empty, and the stored calibration says so
      engineVersion: null,
      calibration: { ...enginePlan.calibration, writtenBy: "ai" },
    };
  } catch (error) {
    // Limits, a busy or failing model: the engine's plan is the answer. Only the kind is logged.
    console.error(`AI workout: ${error?.name ?? "error"}; the engine's plan was kept`);
    return null;
  }
}

module.exports = { INSTRUCTIONS, schema, limits, brief, allowedLibrary, asAnswer, normalizeWeek, write };
