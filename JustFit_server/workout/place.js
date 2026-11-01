// Workout › At home / At center (asked for by the user on 2026-11-02): the member says where
// they train today, and today's session becomes a version for that place. The plan is written for
// the member's main spot (the coach intake: a gym is "center", anywhere else is "home"); the other
// place gets an adapted day: the same structure, sets and reps, with each exercise the place's
// equipment can't do swapped for the closest library exercise (the AI, feature workout_place, or
// the same-movement swap below when the AI can't). An adapted day is kept and reused the next
// time; a date runs it through workout_day_overrides, like a moved session. Switching back
// points the date at the plan's own day again.
//
// Every query is scoped to the verified member id passed in by the route.
const plans = require("./plans");
const aiPlan = require("./aiPlan");
const workout = require("../../JustFit_client/src/lib/workout/index.ts");
const { EQUIPMENT } = require("../coach/planRules");
const { ValidationError } = require("../profile");
const { askStructured } = require("../ai/structured");
const aiUsage = require("../ai/usage");
const aiLimits = require("../ai/limits");
const dedupe = require("../ai/dedupe");

const PLACES = ["home", "center"];
const PLACE_LABEL = { home: "home", center: "the center" };
const json = (value) => (typeof value === "string" ? JSON.parse(value) : value);
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

// ---- where the member trains ---------------------------------------------------------------

/**
 * The member's places from the coach intake: which one the plan is written for, the equipment at
 * each, and whether joints or conditions rule out high-risk moves. Without an intake the plan is
 * for the center (the full library) and home means no equipment.
 */
async function placesOf(pool, userId) {
  const [[row]] = await pool.query("SELECT main_spot, main_equipment, backup_spot, backup_equipment, joints, conditions FROM coach_profiles WHERE user_id = ?", [userId]);
  const saved = await savedEquipment(pool, userId);
  const atGym = (spot) => spot === "gym";
  const fromIntake = row
    ? {
        plan: atGym(row.main_spot) ? "center" : "home",
        home: !atGym(row.main_spot) ? row.main_equipment : row.backup_spot && !atGym(row.backup_spot) ? row.backup_equipment : "none",
        center: atGym(row.main_spot) ? row.main_equipment : atGym(row.backup_spot) ? row.backup_equipment : "full_gym",
      }
    : { plan: "center", home: "none", center: "full_gym" };
  return {
    plan: fromIntake.plan,
    // What the member set on the Fitness tab's location sheet comes first
    equipment: { home: saved.home ?? fromIntake.home, center: saved.center ?? fromIntake.center },
    careful: row ? (json(row.joints) ?? []).length > 0 || (json(row.conditions) ?? []).length > 0 : false,
  };
}

// The location sheet's answers (workout_profiles), or nulls before the 2026-11-09 migration
async function savedEquipment(pool, userId) {
  try {
    const [[row]] = await pool.query("SELECT home_equipment, center_equipment FROM workout_profiles WHERE user_id = ?", [userId]);
    return { home: row?.home_equipment ?? null, center: row?.center_equipment ?? null };
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") return { home: null, center: null };
    throw error;
  }
}

const HOME_KITS = ["none", "some", "home_gym"];
const CENTER_KITS = ["free_weights", "basic_gym", "full_gym"];

/** The location sheet: what the member has at home and at their center, and the choices */
async function equipment(pool, userId) {
  const places = await placesOf(pool, userId);
  return { home: places.equipment.home, center: places.equipment.center, options: { home: HOME_KITS, center: CENTER_KITS } };
}

/**
 * Saves the location sheet (a workout_profiles row is made when there is none). When the
 * equipment changed, the adapted days made for the old equipment and never trained are removed
 * (with the overrides pointing at them), so the next switch adapts to what the member has now.
 */
async function saveEquipment(pool, userId, { home, center }) {
  const before = await placesOf(pool, userId);
  await plans.withMemberLock(pool, userId, async (conn) => {
    await conn.query(
      "INSERT INTO workout_profiles (user_id, home_equipment, center_equipment) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE home_equipment = VALUES(home_equipment), center_equipment = VALUES(center_equipment)",
      [userId, home, center],
    );
    if (before.equipment.home === home && before.equipment.center === center) return;
    const [stale] = await conn.query(
      "SELECT d.id FROM workout_days d WHERE d.user_id = ? AND d.place IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workout_logs l WHERE l.user_id = d.user_id AND l.day_id = d.id)",
      [userId],
    );
    const ids = stale.map((d) => d.id);
    if (ids.length === 0) return;
    await conn.query("DELETE FROM workout_day_overrides WHERE user_id = ? AND day_id IN (?)", [userId, ids]);
    await conn.query("DELETE FROM workout_day_exercises WHERE user_id = ? AND day_id IN (?)", [userId, ids]);
    await conn.query("DELETE FROM workout_days WHERE user_id = ? AND id IN (?)", [userId, ids]);
  });
  return equipment(pool, userId);
}

/** The library exercises the place allows: its equipment, the member's joints, and the plan's safety rules */
function libraryFor(library, { equipmentKey, careful, inputs, calibration }) {
  const allowed = equipmentKey in EQUIPMENT ? EQUIPMENT[equipmentKey] : EQUIPMENT.none;
  const fits = library.filter((e) => (allowed === null || allowed.includes(e.equipment)) && !(careful && e.highRisk));
  return inputs && calibration ? aiPlan.allowedLibrary(fits, inputs, calibration) : fits;
}

// ---- adapting a day without the AI -----------------------------------------------------------

// An exercise moved onto another one: same section, role, set count and rest; seconds for a timed
// one, reps otherwise (a held exercise becoming a counted one gets 8-12)
function retarget(e, to) {
  const count = e.sets.length;
  const wasTimed = e.sets[0]?.durationSec !== undefined;
  const base = { name: to.name, section: e.section, role: e.role, restSec: e.restSec, ...(to.name === e.name && e.note ? { note: e.note } : {}) };
  if (to.timedSec !== undefined) {
    const seconds = wasTimed ? e.sets[0].durationSec : to.timedSec;
    return { ...base, sets: Array.from({ length: count }, () => ({ durationSec: seconds })) };
  }
  const repsMax = wasTimed ? 12 : e.repsMax ?? e.sets[0]?.reps ?? 10;
  const repsMin = wasTimed ? 8 : e.repsMin ?? repsMax;
  return { ...base, sets: Array.from({ length: count }, () => ({ reps: repsMax })), repsMin, repsMax };
}

/**
 * The day for the place without the AI: each exercise the place allows stays; any other becomes
 * the unused allowed exercise with the same movement and the nearest difficulty (ties by name),
 * or is left out when there is none. Null when no workout exercise is left.
 */
function swapForPlace(exercises, library) {
  const byName = new Map(library.map((e) => [e.name, e]));
  const used = new Set();
  const out = [];
  for (const e of exercises) {
    let to = byName.has(e.name) && !used.has(e.name) ? byName.get(e.name) : null;
    if (!to) {
      to = library
        .filter((c) => c.pattern === e.pattern && !used.has(c.name))
        .sort((a, b) => Math.abs(a.difficulty - e.difficulty) - Math.abs(b.difficulty - e.difficulty) || a.name.localeCompare(b.name))[0] ?? null;
    }
    if (!to) continue;
    used.add(to.name);
    out.push(retarget(e, to));
  }
  if (!out.some((e) => e.section === "workout")) return null;
  return out.map((e, order) => ({ ...e, order }));
}

// ---- asking the AI -----------------------------------------------------------------------

const INSTRUCTIONS = [
  "You are an experienced Indian personal trainer. Adapt one training session for where the member trains today.",
  "Keep the session's structure: the same sections in the same order, about the same number of exercises, the same sets, reps or seconds and rest.",
  "Keep every exercise the place's equipment allows. Replace each one it doesn't with the closest exercise from the library list (the same movement and muscles, a similar difficulty), names exactly as written.",
  "For a timed exercise give durationSec and leave reps null; otherwise give reps with repsMin and repsMax, and durationSec null. A note is one short cue, or null.",
].join(" ");

const daySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "exercises"],
  properties: { title: { type: "string" }, exercises: { type: "array", items: aiPlan.exerciseSchema } },
};

const sessionLine = (e) => {
  const timed = e.sets[0]?.durationSec !== undefined;
  return `${e.section} | ${e.name} | ${e.sets.length} x ${timed ? `${e.sets[0].durationSec}s` : `${e.repsMin ?? e.sets[0]?.reps}-${e.repsMax ?? e.sets[0]?.reps} reps`} | rest ${e.restSec}s`;
};

function brief({ place, equipmentKey, day, exercises, library }) {
  const kit = EQUIPMENT[equipmentKey] === null ? "a full gym" : (EQUIPMENT[equipmentKey] ?? EQUIPMENT.none).join(", ");
  return [
    `Today the member trains at ${PLACE_LABEL[place]} with: ${kit}.`,
    `The session "${day.title}" (section | exercise | sets | rest):\n${exercises.map(sessionLine).join("\n")}`,
    `Library (name | muscle group | movement | equipment | difficulty | notes):\n${library.map(aiPlan.libraryLine).join("\n")}`,
  ].join("\n");
}

// The AI's version of the day, checked like a plan day, or null to use swapForPlace
async function askForDay(pool, userId, { place, equipmentKey, day, exercises, library }, env) {
  if (!aiPlan.configured(env)) return null;
  try {
    await aiLimits.check(pool, { feature: "workout_place", userId }, env);
    const raw = await dedupe.shared.run(dedupe.requestKey("workout_place", userId, day.id, place), () =>
      askStructured(
        {
          feature: "workout_place",
          instructions: INSTRUCTIONS,
          brief: brief({ place, equipmentKey, day, exercises, library }),
          schema: daySchema,
          // The test answer: the same-movement swap, in the AI's shape
          fake: { title: day.title, exercises: aiPlan.asAnswer({ days: [{ exercises: swapForPlace(exercises, library) ?? [] }] }).days[0].exercises },
          failure: "The AI couldn't adapt the session.",
        },
        env,
        aiUsage.tracker(pool, { feature: "workout_place", userId }),
      ),
    );
    const days = aiPlan.normalizeWeek({ days: [{ weekday: day.weekday, title: raw?.title, sessionType: day.sessionType ?? "full_body", exercises: raw?.exercises }] }, { weekdays: [day.weekday], library });
    return days ? days[0].exercises : null;
  } catch (error) {
    console.error(`Workout place: ${error?.name ?? "error"}; the same-movement swap was used`);
    return null;
  }
}

// ---- reading and switching ----------------------------------------------------------------

async function dayRow(db, userId, dayId) {
  const [[row]] = await db.query("SELECT * FROM workout_days WHERE id = ? AND user_id = ?", [dayId, userId]);
  return row ?? null;
}

// A day's exercises with what the library knows about each, in section order
async function dayExercises(db, userId, dayId) {
  const [rows] = await db.query(
    `SELECT e.section, e.position, e.sets, e.rest_sec, e.role, e.reps_min, e.reps_max, e.note, l.name, l.pattern, l.difficulty
     FROM workout_day_exercises e JOIN workout_exercise_library l ON l.id = e.exercise_id
     WHERE e.day_id = ? AND e.user_id = ? ORDER BY FIELD(e.section, 'warmup', 'workout', 'cooldown'), e.position`,
    [dayId, userId],
  );
  return rows.map((r) => ({
    name: r.name, pattern: r.pattern, difficulty: r.difficulty, section: r.section, role: r.role, sets: json(r.sets) ?? [], restSec: r.rest_sec,
    ...(r.reps_min !== null ? { repsMin: r.reps_min } : {}), ...(r.reps_max !== null ? { repsMax: r.reps_max } : {}), ...(r.note ? { note: r.note } : {}),
  }));
}

/**
 * Where today's session is set for: { current, plan, canChange }. Null when today has no session.
 * It can change only before the session starts.
 */
async function todayPlace(pool, userId, { dayId, status }) {
  if (!dayId) return null;
  const [day, places] = await Promise.all([dayRow(pool, userId, dayId), placesOf(pool, userId)]);
  if (!day) return null;
  // A Fitness program session is already made for its place
  if (day.program_session_id) return { current: day.place ?? places.plan, plan: places.plan, canChange: false };
  return { current: day.place ?? places.plan, plan: places.plan, canChange: status === "planned" };
}

// The adapted day for `base` at `place`: the one kept from before, else a new one (the AI call
// happens here, before any lock)
async function variantFor(pool, userId, { plan, base, place, places }, env) {
  const [[kept]] = await pool.query("SELECT id FROM workout_days WHERE variant_of = ? AND place = ? AND user_id = ?", [base.id, place, userId]);
  if (kept) return kept.id;

  await plans.syncLibrary(pool);
  const { library } = await plans.programmableLibrary(pool);
  const [[stamp]] = await pool.query("SELECT inputs_snapshot, calibration FROM workout_plans WHERE id = ? AND user_id = ?", [plan.id, userId]);
  const inputs = json(stamp?.inputs_snapshot) ?? null;
  const calibration = json(stamp?.calibration) ?? null;
  const allowed = libraryFor(library, { equipmentKey: places.equipment[place], careful: places.careful, inputs, calibration });
  const exercises = await dayExercises(pool, userId, base.id);
  const day = { id: base.id, weekday: base.weekday, title: base.title, sessionType: base.session_type };
  const adapted = (await askForDay(pool, userId, { place, equipmentKey: places.equipment[place], day, exercises, library: allowed }, env)) ?? swapForPlace(exercises, allowed);
  if (!adapted) throw new ValidationError(`Today's session can't be done with the equipment at ${PLACE_LABEL[place]}.`);

  return plans.withMemberLock(pool, userId, async (conn) => {
    const [[again]] = await conn.query("SELECT id FROM workout_days WHERE variant_of = ? AND place = ? AND user_id = ?", [base.id, place, userId]);
    if (again) return again.id;
    const { idByName } = await plans.programmableLibrary(conn);
    const [[{ id }]] = await conn.query("SELECT UUID() AS id");
    await conn.query(
      "INSERT INTO workout_days (id, plan_id, user_id, weekday, title, session_type, variant_of, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, base.plan_id, userId, base.weekday, base.title, base.session_type, base.id, place],
    );
    for (const e of adapted) {
      const exerciseId = idByName(e.name);
      if (!exerciseId) throw new ValidationError("An exercise in the adapted session isn't available any more. Please try again.");
      await conn.query(
        `INSERT INTO workout_day_exercises (day_id, plan_id, user_id, exercise_id, section, position, sets, rest_sec, role, reps_min, reps_max, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, base.plan_id, userId, exerciseId, e.section, e.order, JSON.stringify(e.sets), e.restSec, e.role, e.repsMin ?? null, e.repsMax ?? null, e.note ?? null],
      );
    }
    return id;
  });
}

/**
 * Sets today's session for `place`: the plan's own day when it's the plan's place, else the
 * adapted day (made the first time). Only before today's session starts. Answers the place now set.
 */
async function setPlace(pool, userId, { today, place }, env = process.env) {
  const plan = await plans.activePlanRow(pool, userId);
  if (!plan) throw new ValidationError("No active plan");
  const [now] = await plans.resolveDates(pool, userId, plan.id, [today], today, plan.start_date);
  if (!now.dayId) throw new ValidationError("There's no session today.");
  if (now.status !== "planned") throw new ValidationError("Today's session has already started.");
  const current = await dayRow(pool, userId, now.dayId);
  const base = current?.variant_of ? await dayRow(pool, userId, current.variant_of) : current;
  if (!base || base.plan_id !== plan.id) throw new ValidationError("There's no session today.");
  if (base.program_session_id) throw new ValidationError("Today's session is from a program, which is already made for its place.");
  const places = await placesOf(pool, userId);
  const target = place === places.plan ? base.id : await variantFor(pool, userId, { plan, base, place, places }, env);

  await plans.withMemberLock(pool, userId, async (conn) => {
    const [check] = await plans.resolveDates(conn, userId, plan.id, [today], today, plan.start_date);
    if (check.status !== "planned") throw new ValidationError("Today's session has already started.");
    // The plan's own day for today's weekday needs no override; anything else is pointed at
    if (target === base.id && base.weekday === weekdayOf(today)) {
      await conn.query("DELETE FROM workout_day_overrides WHERE user_id = ? AND on_date = ?", [userId, today]);
    } else {
      await plans.pointDate(conn, userId, today, target);
    }
  });
  return { date: today, place, dayId: target };
}

module.exports = { PLACES, HOME_KITS, CENTER_KITS, placesOf, equipment, saveEquipment, libraryFor, swapForPlace, todayPlace, setPlace };
