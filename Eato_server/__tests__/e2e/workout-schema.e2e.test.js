// The workout tables in schema.sql against the isolated eato_test database: they build, the
// engine's real output fits them, and the rules the screens will rely on are enforced by
// MySQL itself (one active plan, one running session per date, a redone set replaces the
// first, value limits, in-use exercises kept, everything removed with the member).
// Test 10 pins the cascade shape: every table hangs directly off users, because MySQL 9.7.0
// orphans the second plan's days and exercises when the chain is users > plans > days >
// exercises (see the "Workout" section of schema.sql).
// Database only: no Express server, no Clerk, no browser. Test members are plain rows.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const workout = require("../../../Eato_client/src/lib/workout/index.ts");

const WORKOUT_TABLES = ["workout_set_logs", "workout_logs", "workout_day_overrides", "workout_day_exercises", "workout_days", "workout_plans", "workout_profiles", "workout_exercise_library"];
const TODAY = "2026-10-15";

describe("workout schema e2e: the eight tables, the engine's output, and the rules MySQL enforces", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  const userA = `user_wk_${runId}_a`;
  const userB = `user_wk_${runId}_b`;
  let skipReason = null;
  let connection;
  const libraryIds = new Map();
  const state = {};

  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const sqlError = async (promise) => { try { await promise; } catch (error) { return error.code; } return null; };
  const count = async (table, where = "1", params = []) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;

  // Writes one generated plan for a member: the plan row, its days and their exercises
  const savePlan = async (userId, generated, status = "active") => {
    const [[{ id: planId }]] = await connection.query("SELECT UUID() AS id");
    await connection.query(
      `INSERT INTO workout_plans (id, user_id, name, goal, level, days_per_week, split, source, status, engine_version, input_hash, inputs_snapshot, calibration, requires_professional_review, start_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'engine', ?, ?, ?, ?, ?, ?, ?)`,
      [planId, userId, generated.name, generated.goal, generated.level, generated.daysPerWeek, generated.split, status, generated.engineVersion, generated.inputHash,
        JSON.stringify(generated.inputs ?? null), JSON.stringify(generated.calibration), generated.requiresProfessionalReview, TODAY],
    );
    const dayIds = [];
    for (const day of generated.days) {
      const [[{ id: dayId }]] = await connection.query("SELECT UUID() AS id");
      await connection.query("INSERT INTO workout_days (id, plan_id, user_id, weekday, title, session_type) VALUES (?, ?, ?, ?, ?, ?)", [dayId, planId, userId, day.weekday, day.title, day.sessionType]);
      dayIds.push(dayId);
      for (const e of day.exercises) {
        await connection.query(
          `INSERT INTO workout_day_exercises (day_id, plan_id, user_id, exercise_id, section, position, sets, rest_sec, role, reps_min, reps_max, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [dayId, planId, userId, libraryIds.get(e.name), e.section, e.order, JSON.stringify(e.sets), e.restSec, e.role, e.repsMin ?? null, e.repsMax ?? null, e.note ?? null],
        );
      }
    }
    return { planId, dayIds };
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    try { connection = await db.connect(loaded.env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), 44, "schema.sql should create 44 tables in eato_test");
    for (const tag of ["a", "b"]) {
      await connection.query("INSERT INTO users (id, email, full_name) VALUES (?, ?, ?)", [`user_wk_${runId}_${tag}`, `wk-${runId}-${tag}@example.com`, `Workout ${tag}`]);
    }
  });

  after(async () => {
    if (!connection) return;
    try {
      await connection.query("DELETE FROM users WHERE id IN (?, ?)", [userA, userB]);
      await connection.query("DELETE FROM workout_exercise_library");
      for (const table of WORKOUT_TABLES) assert.equal(await count(table), 0, `${table} is empty after the run`);
    } finally {
      await connection.end(); // always, so a failed run never leaves the process hanging
    }
  });

  it("1. builds the eight workout tables, empty", run(async () => {
    for (const table of WORKOUT_TABLES) assert.equal(await count(table), 0, table);
  }));

  it("2. holds the 77 built-in exercises, unique by name whatever the case, with engine fields required", run(async () => {
    for (const e of workout.EXERCISE_LIBRARY) {
      await connection.query(
        `INSERT INTO workout_exercise_library (name, muscle_group, equipment, pattern, difficulty, high_risk, low_impact, machine, region, timed_sec, instructions, built_in)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [e.name, e.muscleGroup, e.equipment, e.pattern, e.difficulty, e.highRisk, e.lowImpact, e.machine, e.region, e.timedSec ?? null, e.instructions ? JSON.stringify(e.instructions) : null],
      );
    }
    const [rows] = await connection.query("SELECT id, name FROM workout_exercise_library");
    for (const row of rows) libraryIds.set(row.name, row.id);
    assert.equal(rows.length, 77);
    assert.equal(await sqlError(connection.query("INSERT INTO workout_exercise_library (name, muscle_group, pattern, difficulty) VALUES ('bodyweight squat', 'legs', 'squat', 1)")), "ER_DUP_ENTRY");
    assert.equal(await sqlError(connection.query("INSERT INTO workout_exercise_library (name, muscle_group, pattern, difficulty) VALUES ('Too hard', 'legs', 'squat', 4)")), "ER_CHECK_CONSTRAINT_VIOLATED");
    // MySQL gives a NOT NULL ENUM its first value when none is sent, so the database cannot
    // require a pattern by itself: the admin route's validation does (admin slice)
    await connection.query("INSERT INTO workout_exercise_library (name, muscle_group, difficulty) VALUES ('No pattern', 'legs', 1)");
    const [[implicit]] = await connection.query("SELECT pattern FROM workout_exercise_library WHERE name = 'No pattern'");
    assert.equal(implicit.pattern, "squat", "documented MySQL behaviour the server must guard against");
    await connection.query("DELETE FROM workout_exercise_library WHERE name = 'No pattern'");
    assert.equal(await sqlError(connection.query("INSERT INTO workout_exercise_library (name, muscle_group, pattern, difficulty) VALUES ('Bad pattern', 'legs', 'jumping', 1)")), "WARN_DATA_TRUNCATED");
  }));

  it("3. every plan the engine can produce fits the columns", run(async () => {
    const goals = ["fat_loss", "muscle_gain", "maintenance", "healthy_eating"];
    const strengths = [{}, { experience: "beginner", fitnessBase: 1 }, { experience: "advanced", fitnessBase: 4, squatScore: 4, pushScore: 4, pullScore: 4 }];
    const splits = ["auto", "full_body", "upper_lower", "push_pull_legs"];
    let saved = 0;
    for (const goal of goals) for (const answers of strengths) for (const split of splits) for (const weekdays of [[3], [1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6]]) {
      const inputs = workout.inputsForMember({ goal, weightKg: 70, dob: "1990-01-01" }, { ...answers, split, weekdays, pace: "brisk", seriousInjury: false }, TODAY);
      const generated = { ...workout.generatePlan(inputs, workout.EXERCISE_LIBRARY), inputs };
      await connection.query("UPDATE workout_plans SET status = 'superseded' WHERE user_id = ? AND status = 'active'", [userA]);
      await savePlan(userA, generated);
      saved++;
    }
    assert.equal(saved, 240);
    assert.equal(await count("workout_plans", "user_id = ? AND status = 'active'", [userA]), 1);
    assert.equal(await count("workout_plans", "user_id = ? AND status = 'superseded'", [userA]), 239, "older plans are kept");
    const [[{ unresolved }]] = await connection.query("SELECT COUNT(*) AS unresolved FROM workout_day_exercises WHERE exercise_id IS NULL");
    assert.equal(unresolved, 0, "every engine exercise resolves to a library row by name");
  }));

  it("4. a member can never have two active plans; superseded ones may pile up", run(async () => {
    const generated = { ...workout.generatePlan(workout.inputsForMember({}, {}, TODAY), workout.EXERCISE_LIBRARY), inputs: null };
    const first = await savePlan(userB, generated);
    assert.equal(await sqlError(savePlan(userB, generated)), "ER_DUP_ENTRY");
    await connection.query("UPDATE workout_plans SET status = 'superseded' WHERE id = ?", [first.planId]);
    state.planB = await savePlan(userB, generated);
    assert.equal(await count("workout_plans", "user_id = ?", [userB]), 2);
    assert.equal(await sqlError(connection.query("INSERT INTO workout_days (plan_id, user_id, weekday, title) VALUES (?, ?, ?, 'Again')", [state.planB.planId, userB, generated.days[0].weekday])), "ER_DUP_ENTRY", "one day per weekday in a plan");
    assert.equal(await sqlError(connection.query("INSERT INTO workout_days (plan_id, user_id, weekday, title) VALUES (?, ?, 7, 'No such day')", [state.planB.planId, userB])), "ER_CHECK_CONSTRAINT_VIOLATED");
    assert.equal(await sqlError(connection.query("UPDATE workout_plans SET days_per_week = 8 WHERE id = ?", [state.planB.planId])), "ER_CHECK_CONSTRAINT_VIOLATED");
  }));

  it("5. one override per date: moving again replaces the first", run(async () => {
    const [dayA, dayB] = state.planB.dayIds;
    await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?)", [userB, TODAY, dayA]);
    assert.equal(await sqlError(connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?)", [userB, TODAY, dayB ?? dayA])), "ER_DUP_ENTRY");
    await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE day_id = VALUES(day_id)", [userB, TODAY, dayB ?? dayA]);
    assert.equal(await count("workout_day_overrides", "user_id = ?", [userB]), 1);
  }));

  it("6. one running session per member and date; finished or abandoned ones don't block a new start", run(async () => {
    const [dayId] = state.planB.dayIds;
    const start = () => connection.query("INSERT INTO workout_logs (id, user_id, plan_id, day_id, on_date) VALUES (UUID(), ?, ?, ?, ?)", [userB, state.planB.planId, dayId, TODAY]);
    await start();
    assert.equal(await sqlError(start()), "ER_DUP_ENTRY", "a second running log for the same date");
    await connection.query("UPDATE workout_logs SET status = 'abandoned' WHERE user_id = ? AND status = 'in_progress'", [userB]);
    await start();
    const [[log]] = await connection.query("SELECT id FROM workout_logs WHERE user_id = ? AND status = 'in_progress'", [userB]);
    state.logId = log.id;
    assert.equal(await count("workout_logs", "user_id = ? AND on_date = ?", [userB, TODAY]), 2);
  }));

  it("7. a redone set replaces the first; impossible values are refused", run(async () => {
    const [[exercise]] = await connection.query("SELECT id FROM workout_day_exercises WHERE day_id = ? AND section = 'workout' ORDER BY position LIMIT 1", [state.planB.dayIds[0]]);
    const logSet = (reps, weightKg = null) => connection.query(
      "INSERT INTO workout_set_logs (log_id, user_id, day_exercise_id, set_index, reps, weight_kg) VALUES (?, ?, ?, 0, ?, ?) ON DUPLICATE KEY UPDATE reps = VALUES(reps), weight_kg = VALUES(weight_kg), completed_at = CURRENT_TIMESTAMP(3)",
      [state.logId, userB, exercise.id, reps, weightKg],
    );
    await logSet(10);
    await logSet(12, 40);
    const [rows] = await connection.query("SELECT reps, weight_kg FROM workout_set_logs WHERE log_id = ?", [state.logId]);
    assert.deepEqual(rows.map((r) => [r.reps, Number(r.weight_kg)]), [[12, 40]], "one row, the second attempt");
    assert.equal(await sqlError(logSet(1001)), "ER_CHECK_CONSTRAINT_VIOLATED");
    assert.equal(await sqlError(logSet(10, 1000.5)), "ER_CHECK_CONSTRAINT_VIOLATED");
    assert.equal(await sqlError(logSet(10, -1)), "ER_CHECK_CONSTRAINT_VIOLATED");
  }));

  it("8. workout answers are range-checked like the engine", run(async () => {
    await connection.query("INSERT INTO workout_profiles (user_id, age_years, weekdays, fitness_base) VALUES (?, 30, ?, 3)", [userB, JSON.stringify([1, 3, 5])]);
    assert.equal(await sqlError(connection.query("UPDATE workout_profiles SET age_years = 12 WHERE user_id = ?", [userB])), "ER_CHECK_CONSTRAINT_VIOLATED");
    assert.equal(await sqlError(connection.query("UPDATE workout_profiles SET weight_kg = 301 WHERE user_id = ?", [userB])), "ER_CHECK_CONSTRAINT_VIOLATED");
    assert.equal(await sqlError(connection.query("UPDATE workout_profiles SET height_cm = 99 WHERE user_id = ?", [userB])), "ER_CHECK_CONSTRAINT_VIOLATED");
    assert.equal(await sqlError(connection.query("UPDATE workout_profiles SET pull_score = 5 WHERE user_id = ?", [userB])), "ER_CHECK_CONSTRAINT_VIOLATED");
  }));

  it("9. an exercise a plan uses cannot be deleted (it is archived instead)", run(async () => {
    const [[used]] = await connection.query("SELECT exercise_id FROM workout_day_exercises LIMIT 1");
    assert.equal(await sqlError(connection.query("DELETE FROM workout_exercise_library WHERE id = ?", [used.exercise_id])), "ER_ROW_IS_REFERENCED_2");
    await connection.query("UPDATE workout_exercise_library SET archived_at = CURRENT_TIMESTAMP WHERE id = ?", [used.exercise_id]);
    assert.equal(await count("workout_exercise_library", "id = ? AND archived_at IS NOT NULL", [used.exercise_id]), 1);
  }));

  it("10. removing a member removes every workout row of theirs and nobody else's", run(async () => {
    const before = await count("workout_plans", "user_id = ?", [userA]);
    assert.ok(before > 0);
    await connection.query("DELETE FROM users WHERE id = ?", [userB]);
    for (const table of WORKOUT_TABLES.filter((t) => t !== "workout_exercise_library")) {
      assert.equal(await count(table, "user_id = ?", [userB]), 0, `${table} has nothing left for the removed member`);
    }
    assert.equal(await count("workout_plans", "user_id = ?", [userA]), before, "the other member's plans are untouched");
    assert.equal(await count("workout_exercise_library"), 77, "the library is shared and stays");
  }));
});
