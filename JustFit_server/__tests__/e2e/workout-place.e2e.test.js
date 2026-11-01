// Workout › At home / At center end to end: test accounts in justfit_test against the real
// Express server (fake AI) and the isolated justfit_test database. Covers today's place on the
// hub, switching to home (an adapted day with home exercises only, made once and reused, kept out
// of the plan's own days), switching back, the refusals (started session, no plan), and the
// attack paths: no or forged session, unexpected fields, bad places and dates.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const WORKOUT_TABLES = ["workout_set_logs", "workout_logs", "workout_day_overrides", "workout_day_exercises", "workout_days", "workout_plans", "workout_profiles", "ai_usage", "profiles"];
const TODAY = new Date().toISOString().slice(0, 10);
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

describe("workout e2e: At home / At center", () => {
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
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const home = (token) => api("GET", `/api/workout/home?date=${TODAY}&dates=${TODAY}&today=${TODAY}`, token);
  const setPlace = (token, body) => api("POST", "/api/workout/place", token, body);
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const overrideOf = async (date) => {
    const [[row]] = await connection.query("SELECT day_id FROM workout_day_overrides WHERE user_id = ? AND on_date = ?", [ids.a, date]);
    return row?.day_id ?? null;
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
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" });
    try {
      await newIdentity("a");
      await newIdentity("b");
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    for (const tag of ["a", "b"]) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user') ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)", [ids[tag], identities[tag].emailAddress, `Member ${tag.toUpperCase()}`]);
      await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency) VALUES (?, '1995-05-10', 'male', 'muscle_gain', 175, 70, '3-4')", [ids[tag]]);
    }
    // A has a plan (no coach intake: written for the center), and a session today whatever the weekday
    const made = await api("POST", "/api/workout/plan/ensure", tokens.a, { today: TODAY });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    state.planId = made.json.planId;
    const [days] = await connection.query("SELECT id, weekday FROM workout_days WHERE plan_id = ? ORDER BY weekday", [state.planId]);
    state.dayCount = days.length;
    const own = days.find((d) => d.weekday === weekdayOf(TODAY));
    state.baseId = own?.id ?? days[0].id;
    if (!own) await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?)", [ids.a, TODAY, state.baseId]);
    state.ownWeekday = Boolean(own);
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

  it("1. the switch needs a valid session", run(async () => {
    for (const token of [null, "not-a-jwt"]) assert.equal((await setPlace(token, { today: TODAY, place: "home" })).status, 401);
  }));

  it("2. the hub says where today's session is set for: the plan's place, changeable before it starts", run(async () => {
    const r = await home(tokens.a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.place, { current: "center", plan: "center", canChange: true });
  }));

  it("3. At home: today runs a home version (bodyweight only), the plan's own days unchanged", run(async () => {
    const r = await setPlace(tokens.a, { today: TODAY, place: "home" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.place, "home");
    const [[variant]] = await connection.query("SELECT id, variant_of, place, weekday FROM workout_days WHERE id = ?", [r.json.dayId]);
    assert.deepEqual({ of: variant.variant_of, place: variant.place }, { of: state.baseId, place: "home" });
    assert.equal(await overrideOf(TODAY), variant.id);
    state.variantId = variant.id;

    const view = await home(tokens.a);
    assert.equal(view.json.place.current, "home");
    assert.equal(view.json.day.id, variant.id);
    const [equipment] = await connection.query(
      "SELECT DISTINCT l.equipment FROM workout_day_exercises e JOIN workout_exercise_library l ON l.id = e.exercise_id WHERE e.day_id = ?",
      [variant.id],
    );
    assert.deepEqual(equipment.map((e) => e.equipment), ["Bodyweight"], "home without an intake means no equipment");
    assert.ok(view.json.day.exerciseCount >= 1);
    assert.equal(await count("ai_usage", "user_id = ? AND feature = 'workout_place'", [ids.a]), 1, "one small AI call");

    // The plan still has its own days only: the overview and preferences don't see the home version
    const overview = await api("GET", "/api/workout/plan/overview", tokens.a);
    assert.equal(overview.json.sessions.length, state.dayCount);
    assert.ok(!overview.json.sessions.some((s) => s.dayId === variant.id));
    const prefs = await api("GET", "/api/workout/preferences", tokens.a);
    assert.equal(prefs.json.weekdays.length, state.dayCount);
  }));

  it("4. back to the center runs the plan's own day; home again reuses the kept version (no new AI call)", run(async () => {
    const back = await setPlace(tokens.a, { today: TODAY, place: "center" });
    assert.equal(back.status, 200, JSON.stringify(back.json));
    assert.equal(back.json.dayId, state.baseId);
    assert.equal(await overrideOf(TODAY), state.ownWeekday ? null : state.baseId);
    assert.equal((await home(tokens.a)).json.place.current, "center");

    const days = await count("workout_days", "user_id = ?", [ids.a]);
    const again = await setPlace(tokens.a, { today: TODAY, place: "home" });
    assert.equal(again.json.dayId, state.variantId);
    assert.equal(await count("workout_days", "user_id = ?", [ids.a]), days);
    assert.equal(await count("ai_usage", "user_id = ? AND feature = 'workout_place'", [ids.a]), 1);
  }));

  it("5. once today's session has started, the place can't change", run(async () => {
    await connection.query("INSERT INTO workout_logs (user_id, plan_id, day_id, on_date, status) VALUES (?, ?, ?, ?, 'in_progress')", [ids.a, state.planId, state.variantId, TODAY]);
    const view = await home(tokens.a);
    assert.equal(view.json.place.canChange, false);
    const r = await setPlace(tokens.a, { today: TODAY, place: "center" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, "Today's session has already started.");
    assert.equal(await overrideOf(TODAY), state.variantId);
    await connection.query("DELETE FROM workout_logs WHERE user_id = ? AND on_date = ?", [ids.a, TODAY]);
  }));

  it("6. bad requests are 400s; a member with no plan is refused and can't touch anyone else's", run(async () => {
    for (const body of [{ today: TODAY, place: "gym" }, { today: TODAY }, { today: TODAY, place: "home", dayId: state.baseId }, { today: "2001-01-01", place: "home" }, { today: TODAY, place: "home' OR 1=1" }]) {
      const r = await setPlace(tokens.a, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.doesNotMatch(r.json.error, /SELECT|sql|stack/i);
    }
    const none = await setPlace(tokens.b, { today: TODAY, place: "home" });
    assert.equal(none.status, 400);
    assert.equal(none.json.error, "No active plan");
    assert.equal(await overrideOf(TODAY), state.variantId, "A's day is untouched");
  }));
});
