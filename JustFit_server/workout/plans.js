// Workout plans for the hub and the day screen: creating a member's first plan, and turning
// dates into the session that runs on them. The plan itself comes from the engine in
// JustFit_client/src/lib/workout (deterministic arithmetic, no AI); this file only reads the
// member's answers, stores what the engine produced, and reads it back.
//
// Every query is scoped to the verified member id passed in by the route, never one taken
// from the request. Structural links (plan_id, day_id) are not foreign keys (see the Workout
// section of schema.sql), so every lookup here also filters on user_id.
const workout = require("../../JustFit_client/src/lib/workout/index.ts");
// A failed check the member should read word for word (the route answers 400 with it)
const { ValidationError } = require("../profile");

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
  const justfit = profile
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
  return { justfit, saved };
}

// The member's body weight for calorie estimates, or null: never a guessed number
async function memberWeight(conn, userId) {
  const { justfit, saved } = await memberSources(conn, userId);
  return saved.weightKg ?? justfit.weightKg ?? null;
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

    const { planId } = await generateAndStore(conn, userId, today, "engine");
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

/**
 * Runs the engine on the member's current answers and stores the plan it produced as the
 * active one, stamped with the engine version, the input hash, the inputs and the calibration.
 * The caller holds the transaction and has already retired any previous active plan.
 * `shape` (the AI Coach's) may narrow the library the engine picks from and trim the days.
 */
async function generateAndStore(conn, userId, today, source, shape = {}) {
  await syncLibrary(conn);
  const { library, idByName } = await programmableLibrary(conn);
  const { justfit, saved } = await memberSources(conn, userId);
  const inputs = workout.inputsForMember(justfit, saved, today);
  const generated = workout.generatePlan(inputs, shape.library ? shape.library(library) : library);
  const plan = shape.days ? { ...generated, days: shape.days(generated.days) } : generated;

  const [[{ id: planId }]] = await conn.query("SELECT UUID() AS id");
  await conn.query(
    `INSERT INTO workout_plans
       (id, user_id, name, goal, level, days_per_week, split, source, status, engine_version, input_hash, inputs_snapshot, calibration, requires_professional_review, start_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    [planId, userId, plan.name, plan.goal, plan.level, plan.daysPerWeek, plan.split, source, plan.engineVersion, plan.inputHash,
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
  return { planId, plan };
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

// ---- rescheduling ------------------------------------------------------------------

/**
 * Runs `work` in one transaction with the member's users row locked, so two reschedules (or
 * a reschedule and a session start) for the same member can't interleave.
 */
async function withMemberLock(pool, userId, work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

// "On this date, run that day": the only thing move and swap write. The plan stays as it is.
const pointDate = (conn, userId, date, dayId) =>
  conn.query(
    "INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE day_id = VALUES(day_id), created_at = CURRENT_TIMESTAMP",
    [userId, date, dayId],
  );

// Which of these day ids are the member's own: a stray row pointing at someone else's day is
// treated as no session at all, so it can never be copied onto another date
async function ownDayIds(conn, userId, dayIds) {
  const wanted = [...new Set(dayIds.filter(Boolean))];
  if (wanted.length === 0) return new Set();
  const [rows] = await conn.query("SELECT id FROM workout_days WHERE user_id = ? AND id IN (?)", [userId, wanted]);
  return new Set(rows.map((r) => r.id));
}

/** "Do it today instead?": point today at a missed day's session. */
async function moveSessionToToday(pool, userId, { from, today }) {
  if (from >= today) throw new ValidationError("Only a past session can be moved");
  return withMemberLock(pool, userId, async (conn) => {
    const plan = await activePlanRow(conn, userId);
    if (!plan) throw new ValidationError("No active plan");
    const [past, now] = await resolveDates(conn, userId, plan.id, [from, today], today, plan.start_date);
    const own = await ownDayIds(conn, userId, [past.dayId]);
    if (!past.dayId || !own.has(past.dayId)) throw new ValidationError("Nothing was scheduled that day");
    if (past.status === "completed") throw new ValidationError("That session is already done");
    if (now.status === "completed") throw new ValidationError("Today's session is already done");
    if (now.status === "in_progress") throw new ValidationError("Finish today's session before moving another one here");
    await pointDate(conn, userId, today, past.dayId);
    return { date: today, dayId: past.dayId };
  });
}

/** "Swap with today?": two dates trade sessions. */
async function swapDays(pool, userId, { a, b, today }) {
  if (a === b) throw new ValidationError("Pick two different dates");
  if (a < today || b < today) throw new ValidationError("A past session cannot be swapped");
  return withMemberLock(pool, userId, async (conn) => {
    const plan = await activePlanRow(conn, userId);
    if (!plan) throw new ValidationError("No active plan");
    const [first, second] = await resolveDates(conn, userId, plan.id, [a, b], today, plan.start_date);
    const own = await ownDayIds(conn, userId, [first.dayId, second.dayId]);
    if (!own.has(first.dayId) || !own.has(second.dayId)) throw new ValidationError("Both days need a session to swap");
    if (first.status === "completed" || second.status === "completed") throw new ValidationError("A finished session cannot be swapped");
    if (first.status === "in_progress" || second.status === "in_progress") throw new ValidationError("A session already under way cannot be swapped");
    await pointDate(conn, userId, a, second.dayId);
    await pointDate(conn, userId, b, first.dayId);
    return { swapped: [a, b] };
  });
}

// ---- running a session -------------------------------------------------------------

const SET_LOG_CAP = 500; // sessionProgress: never more set rows than this in one answer

function logToApi(row) {
  return { id: row.id, date: row.date, dayId: row.day_id, status: row.status, startedAt: row.started_at, completedAt: row.completed_at };
}

const LOG_COLUMNS = "id, DATE_FORMAT(on_date, '%Y-%m-%d') AS date, day_id, status, started_at, completed_at";

/** The completed log for a date if there is one, else the one in progress, with its sets. */
async function sessionProgress(pool, userId, { date }) {
  const [logs] = await pool.query(
    `SELECT ${LOG_COLUMNS} FROM workout_logs
     WHERE user_id = ? AND on_date = ? AND status IN ('completed', 'in_progress')
     ORDER BY status = 'completed' DESC, started_at DESC LIMIT 1`,
    [userId, date],
  );
  if (logs.length === 0) return { log: null, sets: [] };
  const [sets] = await pool.query(
    `SELECT day_exercise_id, set_index, reps, weight_kg, duration_sec FROM workout_set_logs
     WHERE log_id = ? AND user_id = ? ORDER BY completed_at, set_index LIMIT ?`,
    [logs[0].id, userId, SET_LOG_CAP],
  );
  return {
    log: logToApi(logs[0]),
    sets: sets.map((s) => ({ dayExerciseId: s.day_exercise_id, setIndex: s.set_index, reps: s.reps, weightKg: s.weight_kg, durationSec: s.duration_sec })),
  };
}

/** Today's running log, created the first time. Only today can be started. */
async function startSession(pool, userId, { date, today }) {
  if (date !== today) throw new ValidationError("Only today's session can be started");
  return withMemberLock(pool, userId, async (conn) => {
    const plan = await activePlanRow(conn, userId);
    if (!plan) throw new ValidationError("No active plan");
    const [resolved] = await resolveDates(conn, userId, plan.id, [today], today, plan.start_date);
    const own = await ownDayIds(conn, userId, [resolved.dayId]);
    if (!resolved.dayId || !own.has(resolved.dayId)) throw new ValidationError("Nothing is scheduled today");
    if (resolved.status === "completed") throw new ValidationError("That session is already done");
    const [[running]] = await conn.query(`SELECT ${LOG_COLUMNS} FROM workout_logs WHERE user_id = ? AND on_date = ? AND status = 'in_progress'`, [userId, today]);
    if (running) return { log: logToApi(running), created: false };
    const [[{ id }]] = await conn.query("SELECT UUID() AS id");
    await conn.query("INSERT INTO workout_logs (id, user_id, plan_id, day_id, on_date, status) VALUES (?, ?, ?, ?, ?, 'in_progress')", [id, userId, plan.id, resolved.dayId, today]);
    const [[created]] = await conn.query(`SELECT ${LOG_COLUMNS} FROM workout_logs WHERE id = ?`, [id]);
    return { log: logToApi(created), created: true };
  });
}

// The member's own running log, or the spec's refusal. Someone else's log reads as missing.
async function runningLog(conn, userId, logId) {
  const [[log]] = await conn.query("SELECT id, day_id, status FROM workout_logs WHERE id = ? AND user_id = ?", [logId, userId]);
  if (!log) throw new ValidationError("Session not found");
  if (log.status !== "in_progress") throw new ValidationError("That session is no longer running");
  return log;
}

/** One finished set, written at once. Doing a set again replaces it (one row per set). */
async function logSet(pool, userId, { logId, dayExerciseId, setIndex, reps, weightKg, durationSec }) {
  return withMemberLock(pool, userId, async (conn) => {
    const log = await runningLog(conn, userId, logId);
    const [[exercise]] = await conn.query("SELECT sets FROM workout_day_exercises WHERE id = ? AND user_id = ? AND day_id = ?", [dayExerciseId, userId, log.day_id]);
    if (!exercise) throw new ValidationError("That exercise is not part of this session");
    if (setIndex >= parseSets(exercise.sets).length) throw new ValidationError("Invalid set");
    await conn.query(
      `INSERT INTO workout_set_logs (log_id, user_id, day_exercise_id, set_index, reps, weight_kg, duration_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reps = VALUES(reps), weight_kg = VALUES(weight_kg), duration_sec = VALUES(duration_sec), completed_at = CURRENT_TIMESTAMP(3)`,
      [logId, userId, dayExerciseId, setIndex, reps ?? null, weightKg ?? null, durationSec ?? null],
    );
    return { logged: { dayExerciseId, setIndex, reps: reps ?? null, weightKg: weightKg ?? null, durationSec: durationSec ?? null } };
  });
}

/** Finish: the log is completed. End early: abandoned, so the date goes back to planned (sets are kept). */
async function closeSession(pool, userId, { logId }, outcome) {
  return withMemberLock(pool, userId, async (conn) => {
    await runningLog(conn, userId, logId);
    if (outcome === "completed") await conn.query("UPDATE workout_logs SET status = 'completed', completed_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND user_id = ?", [logId, userId]);
    else await conn.query("UPDATE workout_logs SET status = 'abandoned' WHERE id = ? AND user_id = ?", [logId, userId]);
    const [[row]] = await conn.query(`SELECT ${LOG_COLUMNS} FROM workout_logs WHERE id = ?`, [logId]);
    return { log: logToApi(row) };
  });
}

// ---- preferences -------------------------------------------------------------------

/** The four settings of the active plan, and whether the member may change them. */
async function preferences(pool, userId) {
  const plan = await activePlanRow(pool, userId);
  if (!plan) throw new ValidationError("No active plan");
  const [days] = await pool.query("SELECT weekday FROM workout_days WHERE plan_id = ? AND user_id = ?", [plan.id, userId]);
  return {
    goal: plan.goal,
    level: plan.level,
    weekdays: workout.sortWeekdays(days.map((d) => d.weekday)),
    split: plan.split,
  };
}

/**
 * Saves goal, level, training days and split as the member's answers, generates a new plan
 * from them and makes it the active one; the old plan is kept as superseded, with its logs.
 * A level the member picks becomes their experience, and the fitness scores follow it, so the
 * engine calibrates to that level (a safety-mode answer still keeps the plan at beginner).
 */
async function updatePreferences(pool, userId, { today, goal, level, weekdays, split }) {
  return withMemberLock(pool, userId, async (conn) => {
    const current = await activePlanRow(conn, userId);
    const [[profile]] = await conn.query("SELECT user_id FROM profiles WHERE user_id = ?", [userId]);
    if (!profile) throw new ValidationError("Profile missing");

    const levelChanged = !current || current.level !== level;
    const base = workout.fitnessBaseFromExperience(level);
    await conn.query(
      `INSERT INTO workout_profiles (user_id, goal, experience, weekdays, split${levelChanged ? ", fitness_base, squat_score, push_score, pull_score" : ""})
       VALUES (?, ?, ?, ?, ?${levelChanged ? ", ?, NULL, NULL, NULL" : ""})
       ON DUPLICATE KEY UPDATE goal = VALUES(goal), experience = VALUES(experience), weekdays = VALUES(weekdays), split = VALUES(split)${
         levelChanged ? ", fitness_base = VALUES(fitness_base), squat_score = NULL, push_score = NULL, pull_score = NULL" : ""
       }`,
      [userId, goal, level, JSON.stringify(weekdays), split, ...(levelChanged ? [base] : [])],
    );

    // The old plan stays (superseded) with its days and logs. Sessions moved or swapped onto
    // today or later pointed at its days, so they go; past ones stay as history.
    if (current) await conn.query("UPDATE workout_plans SET status = 'superseded' WHERE id = ? AND user_id = ?", [current.id, userId]);
    await conn.query("DELETE FROM workout_day_overrides WHERE user_id = ? AND on_date >= ?", [userId, today]);
    const { planId, plan } = await generateAndStore(conn, userId, today, "member");
    return { planId, level: plan.level, goal: plan.goal, daysPerWeek: plan.daysPerWeek, requiresProfessionalReview: plan.requiresProfessionalReview };
  });
}

// ---- rebuild my plan ---------------------------------------------------------------

/**
 * The thirteen answers that seed the rebuild flow: what the member saved before, else what
 * their setup profile already says (gender, age, weight, height, goal), else null (asked).
 */
async function recreateInputs(pool, userId, { today }) {
  const plan = await activePlanRow(pool, userId);
  const { justfit, saved } = await memberSources(pool, userId);
  const fromSetup = workout.engineProfileFor(justfit, {});
  const age = saved.ageYears ?? (justfit.dob ? workout.ageOn(justfit.dob, today) : null);
  return {
    answers: {
      gender: saved.gender ?? fromSetup.gender ?? null,
      ageYears: age !== null && age >= 13 && age <= 100 ? age : null,
      weightKg: saved.weightKg ?? fromSetup.weightKg ?? null,
      heightCm: saved.heightCm ?? (fromSetup.heightCm !== undefined ? Math.round(fromSetup.heightCm) : null),
      bodyType: saved.bodyType ?? null,
      goal: saved.goal ?? fromSetup.goal ?? null,
      weekdays: saved.weekdays ?? null,
      pace: saved.pace ?? null,
      fitnessBase: saved.fitnessBase ?? null,
      squatScore: saved.squatScore ?? null,
      pushScore: saved.pushScore ?? null,
      pullScore: saved.pullScore ?? null,
      seriousInjury: saved.seriousInjury ?? null,
    },
    units: { weight: "kg", height: "cm" },
    hasPlan: plan !== null,
  };
}

/**
 * Saves all thirteen answers, generates a plan from them (split automatic: the flow asks
 * about the body, not the split), makes it the active one, and writes the calibrated level
 * back as the member's experience. The old plan stays, superseded, with its history.
 */
async function recreatePlan(pool, userId, { today, answers }) {
  return withMemberLock(pool, userId, async (conn) => {
    const current = await activePlanRow(conn, userId);
    const [[profile]] = await conn.query("SELECT user_id FROM profiles WHERE user_id = ?", [userId]);
    if (!profile) throw new ValidationError("Profile missing");
    const a = answers;
    await conn.query(
      `INSERT INTO workout_profiles (user_id, gender, age_years, weight_kg, height_cm, body_type, goal, weekdays, pace, fitness_base, squat_score, push_score, pull_score, serious_injury, split)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto')
       ON DUPLICATE KEY UPDATE gender = VALUES(gender), age_years = VALUES(age_years), weight_kg = VALUES(weight_kg), height_cm = VALUES(height_cm),
         body_type = VALUES(body_type), goal = VALUES(goal), weekdays = VALUES(weekdays), pace = VALUES(pace), fitness_base = VALUES(fitness_base),
         squat_score = VALUES(squat_score), push_score = VALUES(push_score), pull_score = VALUES(pull_score), serious_injury = VALUES(serious_injury), split = 'auto'`,
      [userId, a.gender, a.ageYears, a.weightKg, a.heightCm, a.bodyType, a.goal, JSON.stringify(a.weekdays), a.pace, a.fitnessBase, a.squatScore, a.pushScore, a.pullScore, a.seriousInjury],
    );
    if (current) await conn.query("UPDATE workout_plans SET status = 'superseded' WHERE id = ? AND user_id = ?", [current.id, userId]);
    await conn.query("DELETE FROM workout_day_overrides WHERE user_id = ? AND on_date >= ?", [userId, today]);
    const { planId, plan } = await generateAndStore(conn, userId, today, "member");
    // The level the engine calibrated becomes the member's experience (Preferences shows it)
    await conn.query("UPDATE workout_profiles SET experience = ? WHERE user_id = ?", [plan.level, userId]);
    return { planId, level: plan.level, goal: plan.goal, daysPerWeek: plan.daysPerWeek, requiresProfessionalReview: plan.requiresProfessionalReview };
  });
}

/**
 * The AI Coach's workout: saves the intake's goal, level and training days as the member's
 * answers, then makes a new active plan from them with the coach's `shape` (equipment, joints,
 * session length). Runs inside the caller's transaction, which holds the member's lock. The
 * old plan stays as superseded, with its history.
 */
async function planFromCoach(conn, userId, { today, goal, level, weekdays, shape }) {
  const current = await activePlanRow(conn, userId);
  const levelChanged = !current || current.level !== level;
  const base = workout.fitnessBaseFromExperience(level);
  await conn.query(
    `INSERT INTO workout_profiles (user_id, goal, experience, weekdays${levelChanged ? ", fitness_base, squat_score, push_score, pull_score" : ""})
     VALUES (?, ?, ?, ?${levelChanged ? ", ?, NULL, NULL, NULL" : ""})
     ON DUPLICATE KEY UPDATE goal = VALUES(goal), experience = VALUES(experience), weekdays = VALUES(weekdays)${
       levelChanged ? ", fitness_base = VALUES(fitness_base), squat_score = NULL, push_score = NULL, pull_score = NULL" : ""
     }`,
    [userId, goal, level, JSON.stringify(weekdays), ...(levelChanged ? [base] : [])],
  );
  if (current) await conn.query("UPDATE workout_plans SET status = 'superseded' WHERE id = ? AND user_id = ?", [current.id, userId]);
  await conn.query("DELETE FROM workout_day_overrides WHERE user_id = ? AND on_date >= ?", [userId, today]);
  const { planId, plan } = await generateAndStore(conn, userId, today, "member", shape);
  return { planId, plan };
}

/**
 * What the reveal shows, read from what was saved: the plan's facts, every session with its
 * minutes and exercise count (workout section only), and the first session's exercises.
 */
async function planOverview(pool, userId) {
  const plan = await activePlanRow(pool, userId);
  if (!plan) throw new ValidationError("No active plan");
  const [[stamp]] = await pool.query("SELECT inputs_snapshot FROM workout_plans WHERE id = ? AND user_id = ?", [plan.id, userId]);
  const inputs = typeof stamp.inputs_snapshot === "string" ? JSON.parse(stamp.inputs_snapshot) : stamp.inputs_snapshot;
  const [days] = await pool.query("SELECT id, weekday, title, session_type FROM workout_days WHERE plan_id = ? AND user_id = ?", [plan.id, userId]);
  const ordered = [...days].sort((x, y) => ((x.weekday + 6) % 7) - ((y.weekday + 6) % 7));
  const summaries = await daySummaries(pool, userId, ordered.map((d) => d.id));
  const first = ordered[0] ? await dayDetail(pool, userId, ordered[0].id, null) : null;
  return {
    goal: plan.goal,
    level: plan.level,
    daysPerWeek: plan.days_per_week,
    pace: inputs?.pace ?? null,
    split: plan.split,
    requiresProfessionalReview: Boolean(plan.requires_professional_review),
    sessions: ordered.map((d) => ({ dayId: d.id, weekday: d.weekday, title: d.title, sessionType: d.session_type, minutes: summaries.get(d.id)?.minutes ?? 0, exerciseCount: summaries.get(d.id)?.exerciseCount ?? 0 })),
    firstSession: first
      ? { weekday: first.weekday, title: first.title, exercises: first.exercises.filter((e) => e.section === "workout").map((e) => ({ id: e.id, name: e.name, sets: e.sets, repsMin: e.repsMin, repsMax: e.repsMax, restSec: e.restSec })) }
      : null,
  };
}

module.exports = {
  recreateInputs, recreatePlan, planOverview, planFromCoach, activePlanRow,
  preferences, updatePreferences,
  syncLibrary, ensurePlan, home, history, resolveDates, moveSessionToToday, swapDays, withMemberLock,
  sessionProgress, startSession, logSet, completeSession: (pool, userId, body) => closeSession(pool, userId, body, "completed"),
  abandonSession: (pool, userId, body) => closeSession(pool, userId, body, "abandoned"), SET_LOG_CAP,
};
