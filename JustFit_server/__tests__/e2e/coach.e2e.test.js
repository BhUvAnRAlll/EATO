// The AI Coach end to end: test accounts in justfit_test against the real Express server
// and the isolated justfit_test database, with the fake AI (never a paid model). Covers the intake
// (prefill from setup and the workout profile, saving and replacing the answers) and the plan
// (made from the intake, remade, its meals logged to Macro once, no trainer state left),
// and the attack paths: no or forged session, another member's answers or meals, unexpected
// fields (including a user id), bad options and dates, SQL in text.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const answers = (over = {}) => ({
  goal: "lose_weight", experience: "beginner", currentlyTraining: false, weekdays: [1, 3, 5], sessionMinutes: 45,
  mainSpot: "home", backupSpot: "gym", mainEquipment: "none", backupEquipment: "full_gym", joints: ["knees"], conditions: [],
  limitationNotes: null, cookingTime: "quick", foodBudget: "medium", stress: null, sleep: "7_8", coach: "priya",
  coachStyle: "supportive", planNotes: null, acceptedDisclaimer: true, ...over,
});

describe("coach e2e: the intake, its prefill, and who may see it", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const ids = {};
  const tokens = {};

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const rows = async () => (await connection.query("SELECT COUNT(*) AS n FROM coach_profiles"))[0][0].n;
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" }); // the plan's meals never call a paid model in tests
    try {
      for (const tag of ["a", "b"]) {
        const identity = await testAccounts.createIdentity(runId, tag);
        const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        ids[tag] = identity.id;
        tokens[tag] = jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    // Member A finished setup (muscle gain, gym) and has a workout profile; B has neither
    await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, 'Member A', 'user') ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [ids.a, identities.a.emailAddress]);
    await connection.query(
      "INSERT INTO profiles (user_id, goal, workout_type, dob, gender, height_cm, weight_kg, diet, allergies) VALUES (?, 'muscle_gain', 'gym', '1995-05-01', 'male', 175, 72, 'vegetarian', 'peanuts')",
      [ids.a],
    );
    await connection.query(
      "INSERT INTO nutrition_targets (user_id, formula, config_version, inputs, calculated_at, calories, protein_g, carbs_g, fat_g) VALUES (?, 'justfit-calculator', 'test', '{}', NOW(), 2000, 120, 220, 60)",
      [ids.a],
    );
    await connection.query("INSERT INTO workout_profiles (user_id, experience, weekdays) VALUES (?, 'intermediate', '[2,4,6]')", [ids.a]);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const tables = [
          "coach_plan_meal_items", "coach_plan_meals", "coach_plans", "macro_meal_items", "macro_meal_logs", "workout_day_overrides",
          "workout_day_exercises", "workout_days", "workout_plans", "nutrition_targets", "coach_profiles", "workout_profiles", "profiles",
        ];
        for (const table of tables) await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [Object.values(ids)]);
        await db.deleteUsers(connection, Object.values(ids));
      } catch (error) { problems.push(`rows: ${error.code}`); }
    }
    if (testAccounts) for (const tag of Object.keys(identities)) {
      try {
        if (identities[tag].sessionId) await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  it("1. both routes need a valid session", run(async () => {
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      assert.equal((await api("GET", "/api/coach/intake", token)).status, 401);
      assert.equal((await api("PUT", "/api/coach/intake", token, answers())).status, 401);
    }
    assert.equal(await rows(), 0, "nothing was written");
  }));

  it("2. before the intake: no answers, and a prefill from what setup and the workout profile know", run(async () => {
    const a = await api("GET", "/api/coach/intake", tokens.a);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.deepEqual(a.json, { intake: null, prefill: { goal: "build_muscle", mainSpot: "gym", experience: "intermediate", weekdays: [2, 4, 6] } });
    // B has no users row, no setup and no workout profile yet
    const b = await api("GET", "/api/coach/intake", tokens.b);
    assert.deepEqual(b.json, { intake: null, prefill: {} });
  }));

  it("3. saving stores the caller's answers once; a second save replaces them", run(async () => {
    const first = await api("PUT", "/api/coach/intake", tokens.b, answers({ limitationNotes: "Robert'); DROP TABLE coach_profiles;--" }));
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.intake.coach, "priya");
    assert.equal(first.json.intake.limitationNotes, "Robert'); DROP TABLE coach_profiles;--", "stored as text, never run");
    assert.deepEqual(first.json.intake.weekdays, [1, 3, 5]);

    const second = await api("PUT", "/api/coach/intake", tokens.b, answers({ coach: "arjun", coachStyle: "direct", backupSpot: null, backupEquipment: null }));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(await rows(), 1, "one row per member");
    const [[row]] = await connection.query("SELECT user_id, coach, backup_spot, disclaimer_accepted_at FROM coach_profiles");
    assert.deepEqual({ user: row.user_id, coach: row.coach, backup: row.backup_spot }, { user: ids.b, coach: "arjun", backup: null });
    assert.ok(row.disclaimer_accepted_at instanceof Date);

    const read = await api("GET", "/api/coach/intake", tokens.b);
    assert.equal(read.json.intake.coachStyle, "direct");
  }));

  it("4. a member only ever sees and writes their own answers", run(async () => {
    const a = await api("GET", "/api/coach/intake", tokens.a);
    assert.equal(a.json.intake, null, "B's answers never reach A");
    const sneaky = await api("PUT", "/api/coach/intake", tokens.a, { ...answers(), userId: ids.b });
    assert.equal(sneaky.status, 400);
    const [[row]] = await connection.query("SELECT coach FROM coach_profiles WHERE user_id = ?", [ids.b]);
    assert.equal(row.coach, "arjun", "B's row is untouched");
  }));

  it("5. bad answers are 400s with one friendly line, never 500s, and write nothing", run(async () => {
    const before = await rows();
    const cases = [
      answers({ acceptedDisclaimer: false }),
      answers({ goal: "fly" }),
      answers({ coach: "' OR 1=1 --" }),
      answers({ weekdays: [] }),
      answers({ weekdays: ["1"] }),
      answers({ sessionMinutes: 50 }),
      answers({ mainSpot: "gym", mainEquipment: "none" }),
      answers({ backupSpot: "home", mainSpot: "home" }),
      answers({ joints: ["neck"] }),
      answers({ limitationNotes: 42 }),
    ];
    for (const body of cases) {
      const r = await api("PUT", "/api/coach/intake", tokens.a, body);
      assert.equal(r.status, 400, JSON.stringify(r.json));
      assert.equal(typeof r.json.error, "string");
    }
    assert.equal((await api("PUT", "/api/coach/intake", tokens.a, "{not json")).status, 400);
    assert.equal((await api("PUT", "/api/coach/intake", tokens.a, { ...answers(), planNotes: "x".repeat(20 * 1024) })).status, 413);
    assert.equal(await rows(), before);
  }));

  // ---- the plan ------------------------------------------------------------------------

  const today = () => new Date().toISOString().slice(0, 10);
  const count = async (sql, params) => (await connection.query(sql, params))[0][0].n;
  let planA;

  it("6. the plan routes need a valid session", run(async () => {
    const meal = crypto.randomUUID();
    for (const token of [null, "not-a-jwt"]) {
      assert.equal((await api("GET", `/api/coach/plan?date=${today()}`, token)).status, 401);
      assert.equal((await api("POST", "/api/coach/plan", token, { today: today() })).status, 401);
      assert.equal((await api("POST", `/api/coach/plan/meals/${meal}/log`, token, { date: today() })).status, 401);
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM coach_plans"), 0);
  }));

  it("7. no plan before the intake, and none without the setup profile and targets", run(async () => {
    const none = await api("GET", `/api/coach/plan?date=${today()}`, tokens.a);
    assert.equal(none.status, 200, JSON.stringify(none.json));
    assert.deepEqual(none.json, { state: "none", plan: null, workout: null });
    const early = await api("POST", "/api/coach/plan", tokens.a, { today: today() });
    assert.equal(early.status, 400);
    assert.match(early.json.error, /questions first/);
    // B saved an intake in test 3 but never finished setup
    const noProfile = await api("POST", "/api/coach/plan", tokens.b, { today: today() });
    assert.equal(noProfile.status, 400);
    assert.match(noProfile.json.error, /Finish your profile/);
    assert.equal(await count("SELECT COUNT(*) AS n FROM coach_plans"), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM workout_plans WHERE user_id = ?", [ids.b]), 0, "no half-made workout");
  }));

  it("8. the plan: five meals on the member's calories, and the engine's workout shaped by the intake", run(async () => {
    const intake = answers({ goal: "get_stronger", experience: "expert", weekdays: [1, 3, 5], sessionMinutes: 30, mainSpot: "gym", mainEquipment: "full_gym", backupSpot: null, backupEquipment: null, joints: ["knees"] });
    assert.equal((await api("PUT", "/api/coach/intake", tokens.a, intake)).status, 200);
    const made = await api("POST", "/api/coach/plan", tokens.a, { today: today() });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json.state, "ready");
    planA = made.json.plan;
    assert.equal(planA.coach, "priya");
    assert.deepEqual(planA.meals.map((m) => m.slot), ["breakfast", "morning_snack", "lunch", "evening_snack", "dinner"]);
    assert.ok(Math.abs(planA.totals.kcal - 2000) / 2000 < 0.1, `the day is ${planA.totals.kcal} kcal`);
    assert.deepEqual(planA.targets, { calories: 2000, proteinG: 120, carbsG: 220, fatG: 60 });
    assert.ok(planA.meals.every((m) => m.logged === false && m.items.length > 0));
    assert.equal(made.json.workout.daysPerWeek, 3);
    assert.equal(made.json.workout.level, "advanced");
    assert.ok(made.json.workout.sessions.every((s) => s.exerciseCount >= 2));

    // The workout: the member's answers saved, a member plan on Mon/Wed/Fri, no high-risk lift (knees)
    const [[answersRow]] = await connection.query("SELECT goal, experience, weekdays FROM workout_profiles WHERE user_id = ?", [ids.a]);
    assert.deepEqual({ goal: answersRow.goal, experience: answersRow.experience, weekdays: answersRow.weekdays }, { goal: "build_muscle", experience: "advanced", weekdays: [1, 3, 5] });
    const [[workoutPlan]] = await connection.query("SELECT id, source FROM workout_plans WHERE user_id = ? AND status = 'active'", [ids.a]);
    assert.equal(workoutPlan.source, "member");
    const [days] = await connection.query("SELECT weekday FROM workout_days WHERE plan_id = ? ORDER BY weekday", [workoutPlan.id]);
    assert.deepEqual(days.map((d) => d.weekday), [1, 3, 5]);
    assert.equal(await count(
      "SELECT COUNT(*) AS n FROM workout_day_exercises x JOIN workout_exercise_library l ON l.id = x.exercise_id WHERE x.plan_id = ? AND l.high_risk = TRUE",
      [workoutPlan.id],
    ), 0);
    const [[coachRow]] = await connection.query("SELECT workout_plan_id, status FROM coach_plans WHERE id = ?", [planA.id]);
    assert.deepEqual({ ...coachRow }, { workout_plan_id: workoutPlan.id, status: "active" });
  }));

  it("9. making a new plan keeps one active plan and the old ones as history", run(async () => {
    const again = await api("POST", "/api/coach/plan", tokens.a, { today: today() });
    assert.equal(again.status, 201, JSON.stringify(again.json));
    assert.notEqual(again.json.plan.id, planA.id);
    assert.equal(await count("SELECT COUNT(*) AS n FROM coach_plans WHERE user_id = ? AND status = 'active'", [ids.a]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM coach_plans WHERE user_id = ? AND status = 'superseded'", [ids.a]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM workout_plans WHERE user_id = ? AND status = 'active'", [ids.a]), 1);
    planA = again.json.plan;
  }));

  it("10. logging a meal puts it in the Macro diary once; nobody else can log it", run(async () => {
    const lunch = planA.meals.find((m) => m.slot === "lunch");
    const first = await api("POST", `/api/coach/plan/meals/${lunch.id}/log`, tokens.a, { date: today() });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.alreadyLogged, false);
    const repeat = await api("POST", `/api/coach/plan/meals/${lunch.id}/log`, tokens.a, { date: today() });
    assert.deepEqual({ again: repeat.json.alreadyLogged, id: repeat.json.logId }, { again: true, id: first.json.logId });
    const [[log]] = await connection.query("SELECT slot, title, source FROM macro_meal_logs WHERE id = ? AND user_id = ?", [first.json.logId, ids.a]);
    assert.deepEqual({ ...log }, { slot: "lunch", title: lunch.name, source: "plan" });
    assert.equal(await count("SELECT COUNT(*) AS n FROM macro_meal_items WHERE macro_meal_id = ?", [first.json.logId]), lunch.items.length);
    const read = await api("GET", `/api/coach/plan?date=${today()}`, tokens.a);
    assert.deepEqual(read.json.plan.meals.map((m) => m.logged), [false, false, true, false, false]);

    // B can't log A's meal, and bad ids, dates and fields are 400s
    assert.equal((await api("POST", `/api/coach/plan/meals/${lunch.id}/log`, tokens.b, { date: today() })).status, 404);
    assert.equal((await api("POST", "/api/coach/plan/meals/' OR 1=1 --/log", tokens.a, { date: today() })).status, 400);
    assert.equal((await api("POST", `/api/coach/plan/meals/${lunch.id}/log`, tokens.a, { date: "2020-01-01" })).status, 400);
    assert.equal((await api("POST", `/api/coach/plan/meals/${lunch.id}/log`, tokens.a, { date: today(), userId: ids.b })).status, 400);
    assert.equal((await api("GET", "/api/coach/plan?date=yesterday", tokens.a)).status, 400);
    assert.equal(await count("SELECT COUNT(*) AS n FROM macro_meal_logs WHERE user_id IN (?)", [[ids.a, ids.b]]), 1);
  }));

  it("11. bad plan requests are 400s and write nothing", run(async () => {
    for (const body of [{ today: today(), userId: ids.a }, { today: "2020-01-01" }, {}, "{not json"]) {
      const r = await api("POST", "/api/coach/plan", tokens.b, body);
      assert.equal(r.status, 400, JSON.stringify(r.json));
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM coach_plans WHERE user_id = ?", [ids.b]), 0);
  }));

  it("12. the plan's state is only none or ready: there is no trainer state any more", run(async () => {
    for (const [tag, state] of [["a", "ready"], ["b", "none"]]) {
      const read = await api("GET", `/api/coach/plan?date=${today()}`, tokens[tag]);
      assert.equal(read.status, 200, JSON.stringify(read.json));
      assert.equal(read.json.state, state, tag);
    }
  }));
});

