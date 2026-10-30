// Workout preferences end to end: test accounts in eato_test against the real Express
// server and the isolated eato_test database. Covers reading the four settings, saving new ones
// (a new plan from the engine, the old one kept as superseded with its days and logs, sessions
// moved onto today or later cleared), no trainer read-only flag, every refusal the spec
// lists, and the attack paths: no or forged session, another member's plan, unexpected fields,
// out-of-list values, SQL in input, two saves at once.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const WORKOUT_TABLES = ["workout_set_logs", "workout_logs", "workout_day_overrides", "workout_day_exercises", "workout_days", "workout_plans", "workout_profiles", "profiles"];
const utcDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const TODAY = utcDay();

describe("workout e2e: preferences rebuild the plan from goal, level, days and split", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const ids = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const qs = (params) => "?" + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const home = (token, date, dates = [date]) => api("GET", `/api/workout/home${qs({ date, dates: dates.join(","), today: TODAY })}`, token);
  const ensure = (token) => api("POST", "/api/workout/plan/ensure", token, { today: TODAY });
  const getPrefs = (token) => api("GET", "/api/workout/preferences", token);
  const putPrefs = (token, body) => api("PUT", "/api/workout/preferences", token, body);
  const prefs = (overrides = {}) => ({ today: TODAY, goal: "lose_weight", level: "advanced", weekdays: [1, 2, 4, 5], split: "upper_lower", ...overrides });
  const activePlan = async (userId) => (await connection.query("SELECT id, goal, level, split, source, days_per_week FROM workout_plans WHERE user_id = ? AND status = 'active'", [userId]))[0][0] ?? null;
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const refused = (response, message) => {
    assert.equal(response.status, 400, JSON.stringify(response.json));
    if (message instanceof RegExp) assert.match(response.json.error, message);
    else assert.equal(response.json.error, message);
    assert.doesNotMatch(response.json.error, /SELECT|sql|stack|at \//i);
  };
  const newIdentity = async (tag) => {
    const identity = await testAccounts.createIdentity(runId, tag);
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      await newIdentity("a");
      await newIdentity("b");
      await newIdentity("c"); // signed up, never finished setup: no profile row
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, 'Member C', 'user') ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [ids.c, identities.c.emailAddress]);
    for (const tag of ["a", "b"]) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user') ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [ids[tag], identities[tag].emailAddress, `Member ${tag.toUpperCase()}`]);
      await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency) VALUES (?, '1995-05-10', 'male', 'muscle_gain', 175, 70, '3-4')", [ids[tag]]);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of WORKOUT_TABLES) await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [Object.values(ids)]);
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

  it("1. both routes need a valid session and write nothing without one", run(async () => {
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      assert.equal((await getPrefs(token)).status, 401);
      assert.equal((await putPrefs(token, prefs())).status, 401);
    }
    assert.equal(await count("workout_plans", "1 = ?", [1]), 0);
    assert.equal(await count("workout_profiles", "1 = ?", [1]), 0);
  }));

  it("2. no plan yet reads \"No active plan\"; no setup profile is \"Profile missing\"", run(async () => {
    refused(await getPrefs(tokens.a), "No active plan");
    refused(await putPrefs(tokens.c, prefs()), "Profile missing");
    assert.equal(await count("workout_plans", "user_id = ?", [ids.c]), 0);
    assert.equal(await count("workout_profiles", "user_id = ?", [ids.c]), 0, "nothing saved for C");
  }));

  it("3. preferences show the active plan's goal, level, days and split", run(async () => {
    for (const tag of ["a", "b"]) assert.ok([200, 201].includes((await ensure(tokens[tag])).status));
    const r = await getPrefs(tokens.a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const plan = await activePlan(ids.a);
    assert.equal(r.json.goal, plan.goal);
    assert.equal(r.json.level, plan.level);
    assert.equal(r.json.split, plan.split);
    assert.equal(r.json.weekdays.length, plan.days_per_week);
    state.firstPlanA = plan.id;
  }));

  it("4. saving builds a new plan from the four settings; the old one is kept with its days and logs", run(async () => {
    const [[day]] = await connection.query("SELECT id FROM workout_days WHERE plan_id = ? LIMIT 1", [state.firstPlanA]);
    // A finished session last week, a past move, and a move onto tomorrow, all on the old plan
    await connection.query("INSERT INTO workout_logs (user_id, plan_id, day_id, on_date, status, completed_at) VALUES (?, ?, ?, ?, 'completed', NOW(3))", [ids.a, state.firstPlanA, day.id, utcDay(-3)]);
    await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?), (?, ?, ?)", [ids.a, utcDay(-2), day.id, ids.a, utcDay(1), day.id]);
    const daysBefore = await count("workout_days", "plan_id = ?", [state.firstPlanA]);

    const saved = await putPrefs(tokens.a, prefs());
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(
      { level: saved.json.level, goal: saved.json.goal, days: saved.json.daysPerWeek, review: saved.json.requiresProfessionalReview },
      { level: "advanced", goal: "lose_weight", days: 4, review: false },
      "the engine lands on the level the member picked",
    );
    const plan = await activePlan(ids.a);
    assert.equal(plan.id, saved.json.planId);
    assert.deepEqual({ goal: plan.goal, level: plan.level, split: plan.split, source: plan.source }, { goal: "lose_weight", level: "advanced", split: "upper_lower", source: "member" });
    const [weekdays] = await connection.query("SELECT weekday FROM workout_days WHERE plan_id = ? ORDER BY weekday", [plan.id]);
    assert.deepEqual(weekdays.map((w) => w.weekday), [1, 2, 4, 5]);

    const [[old]] = await connection.query("SELECT status FROM workout_plans WHERE id = ?", [state.firstPlanA]);
    assert.equal(old.status, "superseded");
    assert.equal(await count("workout_days", "plan_id = ?", [state.firstPlanA]), daysBefore, "the old plan's days are kept");
    assert.equal(await count("workout_logs", "user_id = ? AND on_date = ?", [ids.a, utcDay(-3)]), 1, "history is kept");
    assert.equal(await count("workout_day_overrides", "user_id = ? AND on_date = ?", [ids.a, utcDay(-2)]), 1, "a past move stays");
    assert.equal(await count("workout_day_overrides", "user_id = ? AND on_date = ?", [ids.a, utcDay(1)]), 0, "a move onto a later date is cleared");
    assert.equal(await count("workout_plans", "user_id = ? AND status = 'active'", [ids.a]), 1);

    const [[answers]] = await connection.query("SELECT goal, experience, weekdays, split, fitness_base, squat_score FROM workout_profiles WHERE user_id = ?", [ids.a]);
    assert.deepEqual({ ...answers, weekdays: typeof answers.weekdays === "string" ? JSON.parse(answers.weekdays) : answers.weekdays },
      { goal: "lose_weight", experience: "advanced", weekdays: [1, 2, 4, 5], split: "upper_lower", fitness_base: 4, squat_score: null });
    const r = await getPrefs(tokens.a);
    assert.deepEqual(r.json, { goal: "lose_weight", level: "advanced", weekdays: [1, 2, 4, 5], split: "upper_lower" });
  }));

  it("5. keeping the level keeps the saved performance answers", run(async () => {
    await connection.query("UPDATE workout_profiles SET squat_score = 4, push_score = 4, pull_score = 4 WHERE user_id = ?", [ids.a]);
    const saved = await putPrefs(tokens.a, prefs({ goal: "build_muscle" }));
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const [[answers]] = await connection.query("SELECT goal, squat_score, push_score, pull_score FROM workout_profiles WHERE user_id = ?", [ids.a]);
    assert.deepEqual({ ...answers }, { goal: "build_muscle", squat_score: 4, push_score: 4, pull_score: 4 });
    assert.equal((await activePlan(ids.a)).goal, "build_muscle");
  }));

  it("6. preferences carry no trainer read-only flag", run(async () => {
    const r = await getPrefs(tokens.b);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(Object.keys(r.json).sort(), ["goal", "level", "split", "weekdays"]);
  }));

  it("7. refusals and one member's change never touches another's plan", run(async () => {
    const planB = await activePlan(ids.b);
    const plansBefore = await count("workout_plans", "1 = ?", [1]);
    refused(await putPrefs(tokens.a, prefs({ weekdays: [1, 3] })), "Pick at least 3 training days");
    refused(await putPrefs(tokens.a, prefs({ weekdays: [] })), "Pick at least 3 training days");
    refused(await putPrefs(tokens.a, prefs({ weekdays: [1, 1, 3] })), /different days/);
    refused(await putPrefs(tokens.a, prefs({ weekdays: [1, 3, 7] })), /different days/);
    refused(await putPrefs(tokens.a, prefs({ weekdays: [1, 3, "5"] })), /different days/);
    refused(await putPrefs(tokens.a, prefs({ goal: "get_huge" })), /fitness goal/);
    refused(await putPrefs(tokens.a, prefs({ goal: "lose_weight' OR '1'='1" })), /fitness goal/);
    refused(await putPrefs(tokens.a, prefs({ level: "elite" })), /fitness level/);
    refused(await putPrefs(tokens.a, prefs({ split: "bro_split" })), /workout split/);
    refused(await putPrefs(tokens.a, prefs({ userId: ids.b })), /Unexpected field: userId/);
    refused(await putPrefs(tokens.a, prefs({ editable: true })), /Unexpected field: editable/);
    refused(await putPrefs(tokens.a, prefs({ today: utcDay(-5) })), /server's date/);
    refused(await putPrefs(tokens.a, [1, 2, 3]), /Send the request as/);
    assert.equal((await putPrefs(tokens.a, "{not json")).status, 400);
    assert.equal((await putPrefs(tokens.a, JSON.stringify({ ...prefs(), pad: "x".repeat(8 * 1024) }))).status, 413, "an oversized body is refused");
    assert.equal(await count("workout_plans", "1 = ?", [1]), plansBefore, "no refusal made a plan");

    assert.equal((await putPrefs(tokens.a, prefs({ goal: "get_fitter" }))).status, 200);
    assert.equal((await activePlan(ids.b)).id, planB.id, "B's plan is untouched");
  }));

  it("8. two saves at once still leave one active plan", run(async () => {
    const results = await Promise.all([putPrefs(tokens.a, prefs({ goal: "stay_healthy" })), putPrefs(tokens.a, prefs({ goal: "lose_weight" }))]);
    for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(await count("workout_plans", "user_id = ? AND status = 'active'", [ids.a]), 1);
    const plan = await activePlan(ids.a);
    assert.ok(results.some((r) => r.json.planId === plan.id), "the active plan is the last save's");
  }));
});
