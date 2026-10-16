// Workout plans for the hub and the day screen: creating a member's first plan, and turning
// dates into the session that runs on them. The plan itself comes from the engine in
// Eato_client/src/lib/workout (deterministic arithmetic, no AI); this file only reads the
// member's answers, stores what the engine produced, and reads it back.
//
// Every query is scoped to the verified member id passed in by the route, never one taken
// from the request. Structural links (plan_id, day_id) are not foreign keys (see the Workout
// section of schema.sql), so every lookup here also filters on user_id.
const workout = require("../../Eato_client/src/lib/workout/index.ts");

const SECTION_ORDER = "FIELD(e.section, 'warmup', 'workout', 'cooldown')";

// ---- the exercise library ----------------------------------------------------------

// The built-in exercises from the app's library, added once by name. Existing rows are never
// overwritten, so an admin's edit to a built-in row survives (and an admin-made row with the
// same name keeps its place).
async function syncLibrary(conn) {
  const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM workout_exercise_library WHERE built_in = TRUE");
  if (n >= workout.EXERCISE_LIBRARY.length) return;
  for (const e of workout.EXERCISE_LIBRARY) {
    await conn.query(
      `INSERT IGNORE INTO workout_exercise_library
         (name, muscle_group, equipment, pattern, difficulty, high_risk, low_impact, machine, region, timed_sec, instructions, built_in)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [e.name, e.muscleGroup, e.equipment, e.pattern, e.difficulty, e.highRisk, e.lowImpact, e.machine, e.region, e.timedSec ?? null, e.instructions ? JSON.stringify(e.instructions) : null],
    );
  }
}

// What the engine may program: every library row that isn't archived
async function programmableLibrary(conn) {
  const [rows] = await conn.query(
    `SELECT id, name, muscle_group, equipment, pattern, difficulty, high_risk, low_impact, machine, region, timed_sec
     FROM workout_exercise_library WHERE archived_at IS NULL`,
  );
  const ids = new Map(rows.map((row) => [row.name.toLowerCase(), row.id]));
  const library = rows.map((row) => ({
    name: row.name,
    muscleGroup: row.muscle_group,
    equipment: row.equipment ?? "",
    pattern: row.pattern,
    difficulty: row.difficulty,
    highRisk: Boolean(row.high_risk),
    lowImpact: Boolean(row.low_impact),
    machine: Boolean(row.machine),
    region: row.region,
    ...(row.timed_sec !== null ? { timedSec: row.timed_sec } : {}),
  }));
  return { library, idByName: (name) => ids.get(name.toLowerCase()) };
}

// ---- the member's answers ----------------------------------------------------------

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

// The setup profile and the saved workout answers, in the shapes profile.ts expects
async function memberSources(conn, userId) {
  const [[profile]] = await conn.query(
    `SELECT DATE_FORMAT(dob, '%Y-%m-%d') AS dob, gender, goal, height_cm, weight_kg, workout_frequency, health_flags
     FROM profiles WHERE user_id = ?`,
    [userId],
  );
  const [[answers]] = await conn.query("SELECT * FROM workout_profiles WHERE user_id = ?", [userId]);
  const eato = profile
    ? {
        dob: profile.dob,
        gender: profile.gender,
        goal: profile.goal,
        heightCm: toNumber(profile.height_cm),
        weightKg: toNumber(profile.weight_kg),
        workoutFrequency: profile.workout_frequency,
        healthFlags: Array.isArray(profile.health_flags) ? profile.health_flags : null,
      }
    : {};
  const saved = answers
    ? {
        gender: answers.gender,
        ageYears: answers.age_years,
        weightKg: toNumber(answers.weight_kg),
        heightCm: answers.height_cm,
        bodyType: answers.body_type,
        goal: answers.goal,
        experience: answers.experience,
        weekdays: Array.isArray(answers.weekdays) ? answers.weekdays : null,
        pace: answers.pace,
        fitnessBase: answers.fitness_base,
        squatScore: answers.squat_score,
        pushScore: answers.push_score,
        pullScore: answers.pull_score,
        seriousInjury: answers.serious_injury === null || answers.serious_injury === undefined ? null : Boolean(answers.serious_injury),
        split: answers.split,
      }
    : {};
  return { eato, saved };
}

// The member's body weight for calorie estimates, or null: never a guessed number
async function memberWeight(conn, userId) {
  const { eato, saved } = await memberSources(conn, userId);
  return saved.weightKg ?? eato.weightKg ?? null;
}

// ---- plans -------------------------------------------------------------------------

async function activePlanRow(conn, userId) {
  const [[plan]] = await conn.query(
    `SELECT id, name, goal, level, days_per_week, split, source, requires_professional_review,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date
     FROM workout_plans WHERE user_id = ? AND status = 'active'`,
    [userId],
  );
  return plan ?? null;
}

/**
 * The member's active plan id, creating one from whatever their profile holds when they have
 * none (the spec's ensurePlan). Idempotent and safe to call twice at once: the member's users
 * row is locked for the transaction, and the one-active-plan key refuses a second plan.
 */
async function ensurePlan(pool, userId, today) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[user]] = await conn.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    if (!user) throw new Error("ensurePlan needs a users row (call ensureUser first)");
    const existing = await activePlanRow(conn, userId);
    if (existing) {
      await conn.commit();
      return { planId: existing.id, created: false };
    }

    await syncLibrary(conn);
    const { library, idByName } = await programmableLibrary(conn);
    const { eato, saved } = await memberSources(conn, userId);
    const inputs = workout.inputsForMember(eato, saved, today);
    const plan = workout.generatePlan(inputs, library);

    const [[{ id: planId }]] = await conn.query("SELECT UUID() AS id");
    await conn.query(
      `INSERT INTO workout_plans
         (id, user_id, name, goal, level, days_per_week, split, source, status, engine_version, input_hash, inputs_snapshot, calibration, requires_professional_review, start_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'engine', 'active', ?, ?, ?, ?, ?, ?)`,
      [planId, userId, plan.name, plan.goal, plan.level, plan.daysPerWeek, plan.split, plan.engineVersion, plan.inputHash,
        JSON.stringify(inputs), JSON.stringify(plan.calibration), plan.requiresProfessionalReview, today],
    );
    for (const day of plan.days) {
      const [[{ id: dayId }]] = await conn.query("SELECT UUID() AS id");
      await conn.query("INSERT INTO workout_days (id, plan_id, user_id, weekday, title, session_type) VALUES (?, ?, ?, ?, ?, ?)", [dayId, planId, userId, day.weekday, day.title, day.sessionType]);
      for (const e of day.exercises) {
        const exerciseId = idByName(e.name);
        if (!exerciseId) throw new Error(`The engine chose an exercise the library doesn't have: ${e.name}`);
        await conn.query(
          `INSERT INTO workout_day_exercises (day_id, plan_id, user_id, exercise_id, section, position, sets, rest_sec, role, reps_min, reps_max, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [dayId, planId, userId, exerciseId, e.section, e.order, JSON.stringify(e.sets), e.restSec, e.role, e.repsMin ?? null, e.repsMax ?? null, e.note ?? null],
        );
      }
    }
    await conn.commit();
    return { planId, created: true };
  } catch (error) {
    await conn.rollback().catch(() => {});
    // Another request made the plan first: theirs is the one
    if (error?.code === "ER_DUP_ENTRY") {
      const winner = await activePlanRow(pool, userId);
      if (winner) return { planId: winner.id, created: false };
    }
    throw error;
  } finally {
    conn.release();
  }
}

function planToApi(plan, weekdays) {
  return {
    id: plan.id,
    name: plan.name,
    goal: plan.goal,
    level: plan.level,
    daysPerWeek: plan.days_per_week,
    split: plan.split,
    source: plan.source,
    requiresProfessionalReview: Boolean(plan.requires_professional_review),
    weekdays: workout.sortWeekdays(weekdays),
  };
}

// ---- days --------------------------------------------------------------------------

const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const parseSets = (value) => (Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value) : []);

/**
 * What runs on each date and how it stands, in the spec's precedence: a log for that date (a
 * completed one over one in progress), then a per-date override, then the plan's day pinned
 * to that weekday, else a rest day. Days before the plan started have no weekday session (a
 * new plan doesn't count the days before it as missed). Status: completed, in_progress, missed
 * (scheduled and past), planned (scheduled, today or later) or rest.
 */
async function resolveDates(conn, userId, planId, dates, today, startDate = null) {
  if (dates.length === 0) return [];
  const [planDays] = planId ? await conn.query("SELECT id, weekday FROM workout_days WHERE plan_id = ? AND user_id = ?", [planId, userId]) : [[]];
  const byWeekday = new Map(planDays.map((d) => [d.weekday, d.id]));
  const [overrides] = await conn.query(
    "SELECT DATE_FORMAT(on_date, '%Y-%m-%d') AS date, day_id FROM workout_day_overrides WHERE user_id = ? AND on_date IN (?)",
    [userId, dates],
  );
  const overrideOf = new Map(overrides.map((o) => [o.date, o.day_id]));
  const [logs] = await conn.query(
    `SELECT DATE_FORMAT(on_date, '%Y-%m-%d') AS date, day_id, status FROM workout_logs
     WHERE user_id = ? AND on_date IN (?) AND status IN ('completed', 'in_progress')`,
    [userId, dates],
  );
  const logOf = new Map();
  for (const log of logs) {
    const held = logOf.get(log.date);
    if (!held || (held.status !== "completed" && log.status === "completed")) logOf.set(log.date, log);
  }
  return dates.map((date) => {
    const log = logOf.get(date);
    const weekdayDay = startDate && date < startDate ? null : byWeekday.get(weekdayOf(date));
    const dayId = log?.day_id ?? overrideOf.get(date) ?? weekdayDay ?? null;
    const status = log ? log.status : dayId === null ? "rest" : date < today ? "missed" : "planned";
    return { date, dayId, status };
  });
}

// Minutes, exercise and set counts for some days (the member's own only), keyed by day id
async function daySummaries(conn, userId, dayIds) {
  const ids = [...new Set(dayIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const [days] = await conn.query("SELECT id, title, session_type FROM workout_days WHERE user_id = ? AND id IN (?)", [userId, ids]);
  const [exercises] = await conn.query(
    "SELECT day_id, section, sets, rest_sec FROM workout_day_exercises WHERE user_id = ? AND day_id IN (?)",
    [userId, ids],
  );
  const summaries = new Map(days.map((d) => [d.id, { title: d.title, sessionType: d.session_type, seconds: 0, exerciseCount: 0, setCount: 0 }]));
  for (const e of exercises) {
    const summary = summaries.get(e.day_id);
    if (!summary) continue;
    const sets = parseSets(e.sets);
    summary.seconds += workout.exerciseSeconds({ sets, restSec: e.rest_sec });
    // Warm-ups and stretches aren't "exercises" to a member reading a summary
    if (e.section === "workout") {
      summary.exerciseCount += 1;
      summary.setCount += sets.length;
    }
  }
  return new Map([...summaries].map(([id, s]) => [id, { title: s.title, sessionType: s.sessionType, minutes: workout.toMinutes(s.seconds), exerciseCount: s.exerciseCount, setCount: s.setCount }]));
}

// One day in full: its exercises in section order with what the library knows about each
async function dayDetail(conn, userId, dayId, weightKg) {
  const [[day]] = await conn.query("SELECT id, weekday, title, session_type FROM workout_days WHERE id = ? AND user_id = ?", [dayId, userId]);
  if (!day) return null;
  const [rows] = await conn.query(
    `SELECT e.id, e.section, e.position, e.sets, e.rest_sec, e.role, e.reps_min, e.reps_max, e.note,
            l.name, l.muscle_group, l.pattern, l.equipment, l.timed_sec, l.instructions
     FROM workout_day_exercises e JOIN workout_exercise_library l ON l.id = e.exercise_id
     WHERE e.day_id = ? AND e.user_id = ?
     ORDER BY ${SECTION_ORDER}, e.position`,
    [dayId, userId],
  );
  const sectionSeconds = { warmup: 0, workout: 0, cooldown: 0 };
  const exercises = rows.map((row) => {
    const sets = parseSets(row.sets);
    sectionSeconds[row.section] += workout.exerciseSeconds({ sets, restSec: row.rest_sec });
    return {
      id: row.id,
      name: row.name,
      muscleGroup: row.muscle_group,
      pattern: row.pattern,
      equipment: row.equipment,
      section: row.section,
      role: row.role,
      sets,
      restSec: row.rest_sec,
      repsMin: row.reps_min,
      repsMax: row.reps_max,
      note: row.note,
      instructions: Array.isArray(row.instructions) ? row.instructions : [],
    };
  });
  const totalSeconds = sectionSeconds.warmup + sectionSeconds.workout + sectionSeconds.cooldown;
  const minutes = workout.toMinutes(totalSeconds);
  const workoutOnly = exercises.filter((e) => e.section === "workout");
  return {
    id: day.id,
    weekday: day.weekday,
    title: day.title,
    sessionType: day.session_type,
    minutes,
    sectionMinutes: { warmup: workout.toMinutes(sectionSeconds.warmup), workout: workout.toMinutes(sectionSeconds.workout), cooldown: workout.toMinutes(sectionSeconds.cooldown) },
    exerciseCount: workoutOnly.length,
    setCount: workoutOnly.reduce((sum, e) => sum + e.sets.length, 0),
    totalSets: exercises.reduce((sum, e) => sum + e.sets.length, 0),
    // kcal = MET x kg x hours; null (the row is hidden) when the member has no weight saved
    kcal: weightKg ? workout.estimateKcal(workout.metFor(day.session_type), weightKg, minutes) : null,
    exercises,
  };
}

// ---- reads for the screens ---------------------------------------------------------

/** The hub and the day screen: the active plan, the day for `date` in full, and the week strip. */
async function home(pool, userId, { date, dates, today }) {
  const plan = await activePlanRow(pool, userId);
  if (!plan) return { plan: null };
  const [weekdays] = await pool.query("SELECT weekday FROM workout_days WHERE plan_id = ? AND user_id = ?", [plan.id, userId]);
  const all = [...new Set([date, ...dates])];
  const resolved = await resolveDates(pool, userId, plan.id, all, today, plan.start_date);
  const of = new Map(resolved.map((r) => [r.date, r]));
  const target = of.get(date);
  const day = target.dayId ? await dayDetail(pool, userId, target.dayId, await memberWeight(pool, userId)) : null;
  return {
    plan: planToApi(plan, weekdays.map((w) => w.weekday)),
    date,
    status: target.status,
    day,
    week: dates.map((d) => ({ date: d, status: of.get(d).status })),
  };
}

/** One row per date that was trained or missed, newest first (a session still ahead isn't history). */
async function history(pool, userId, { from, to, today }) {
  const plan = await activePlanRow(pool, userId);
  const dates = [];
  for (let d = new Date(`${to}T00:00:00Z`); d >= new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1)) dates.push(d.toISOString().slice(0, 10));
  const resolved = (await resolveDates(pool, userId, plan?.id ?? null, dates, today, plan?.start_date ?? null)).filter((r) => r.status !== "rest" && r.status !== "planned");
  const summaries = await daySummaries(pool, userId, resolved.map((r) => r.dayId));
  return resolved.map((r) => {
    const s = summaries.get(r.dayId);
    return { date: r.date, status: r.status, title: s?.title ?? null, sessionType: s?.sessionType ?? null, totalMinutes: s?.minutes ?? 0, exerciseCount: s?.exerciseCount ?? 0 };
  });
}

module.exports = { syncLibrary, ensurePlan, home, history, resolveDates };
