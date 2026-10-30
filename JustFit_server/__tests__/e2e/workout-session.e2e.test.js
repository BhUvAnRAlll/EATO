// Running a workout session end to end: test accounts in eato_test against the real
// Express server and the isolated eato_test database. Covers starting today's session (once,
// even when asked twice at once), logging sets (one row per set, replaced when redone),
// finishing, ending early (sets kept, the date back to planned), reading progress, every refusal
// the workout spec lists word for word, and the attack paths: no or forged session, another
// member's log or exercise, out-of-range values, unexpected fields, SQL in input.
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

describe("workout e2e: starting, logging and finishing a session", () => {
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
  const start = (token, body = { date: TODAY, today: TODAY }) => api("POST", "/api/workout/session/start", token, body);
  const logSet = (token, body) => api("POST", "/api/workout/session/sets", token, body);
  const complete = (token, logId) => api("POST", "/api/workout/session/complete", token, { logId });
  const abandon = (token, logId) => api("POST", "/api/workout/session/abandon", token, { logId });
  const progress = (token, date = TODAY) => api("GET", `/api/workout/session${qs({ date, today: TODAY })}`, token);
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
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
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

  // Today's session for a member: its day id, a rep exercise in it and an exercise from another day
  const todaysSession = async (userId) => {
    const [[row]] = await connection.query("SELECT day_id FROM workout_day_overrides WHERE user_id = ? AND on_date = ?", [userId, TODAY]);
    const dayId = row.day_id;
    const [exercises] = await connection.query("SELECT id, sets FROM workout_day_exercises WHERE user_id = ? AND day_id = ? AND section = 'workout' ORDER BY position", [userId, dayId]);
    const sets = (e) => (typeof e.sets === "string" ? JSON.parse(e.sets) : e.sets);
    const rep = exercises.find((e) => sets(e)[0].reps !== undefined);
    const [[other]] = await connection.query("SELECT id FROM workout_day_exercises WHERE user_id = ? AND day_id <> ? LIMIT 1", [userId, dayId]);
    return { dayId, rep: { id: rep.id, setCount: sets(rep).length }, otherDayExercise: other.id };
  };

  it("1. every session route needs a valid session and writes nothing without one", run(async () => {
    const fakeLog = "00000000-0000-4000-8000-000000000000";
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      assert.equal((await start(token)).status, 401);
      assert.equal((await logSet(token, { logId: fakeLog, dayExerciseId: fakeLog, setIndex: 0, reps: 5 })).status, 401);
      assert.equal((await complete(token, fakeLog)).status, 401);
      assert.equal((await abandon(token, fakeLog)).status, 401);
      assert.equal((await progress(token)).status, 401);
    }
    assert.equal(await count("workout_logs", "1 = ?", [1]), 0);
  }));

  it("2. start refuses each case with the spec's words", run(async () => {
    refused(await start(tokens.a), "No active plan");
    for (const tag of ["a", "b"]) assert.ok([200, 201].includes((await ensure(tokens[tag])).status));
    refused(await start(tokens.a, { date: "not-a-date", today: TODAY }), "Invalid date");
    refused(await start(tokens.a, { date: utcDay(1), today: TODAY }), "Only today's session can be started");
    refused(await start(tokens.a, { date: utcDay(-1), today: TODAY }), "Only today's session can be started");
    // A plan that starts tomorrow schedules nothing today
    await connection.query("UPDATE workout_plans SET start_date = ? WHERE user_id IN (?)", [utcDay(1), [ids.a, ids.b]]);
    refused(await start(tokens.a), "Nothing is scheduled today");
    assert.equal(await count("workout_logs", "1 = ?", [1]), 0, "no refusal wrote a log");

    // From here on both plans have run for a month and today has a session, whatever the weekday
    await connection.query("UPDATE workout_plans SET start_date = ? WHERE user_id IN (?)", [utcDay(-30), [ids.a, ids.b]]);
    for (const tag of ["a", "b"]) {
      const [[day]] = await connection.query("SELECT id FROM workout_days WHERE user_id = ? ORDER BY weekday LIMIT 1", [ids[tag]]);
      await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?)", [ids[tag], TODAY, day.id]);
    }
    state.a = await todaysSession(ids.a);
    state.b = await todaysSession(ids.b);
  }));

  it("3. starting twice at once makes one running log, and progress shows it", run(async () => {
    const results = await Promise.all([start(tokens.a), start(tokens.a)]);
    for (const r of results) assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
    assert.equal(results.filter((r) => r.json.created).length, 1, "exactly one request created it");
    assert.equal(results[0].json.log.id, results[1].json.log.id);
    state.logA = results[0].json.log.id;
    assert.equal(results[0].json.log.status, "in_progress");
    assert.equal(results[0].json.log.dayId, state.a.dayId);
    assert.equal(await count("workout_logs", "user_id = ?", [ids.a]), 1);
    const again = await start(tokens.a);
    assert.equal(again.status, 200);
    assert.equal(again.json.log.id, state.logA, "starting again picks up the running log");
    const p = await progress(tokens.a);
    assert.equal(p.status, 200);
    assert.equal(p.json.log.id, state.logA);
    assert.deepEqual(p.json.sets, []);
    assert.equal((await home(tokens.a, TODAY)).json.status, "in_progress");
  }));

  it("4. a set is logged once; doing it again replaces it", run(async () => {
    const first = await logSet(tokens.a, { logId: state.logA, dayExerciseId: state.a.rep.id, setIndex: 0, reps: 8, weightKg: 22.5 });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.deepEqual(first.json.logged, { dayExerciseId: state.a.rep.id, setIndex: 0, reps: 8, weightKg: 22.5, durationSec: null });
    const redo = await logSet(tokens.a, { logId: state.logA, dayExerciseId: state.a.rep.id, setIndex: 0, reps: 10 });
    assert.equal(redo.status, 200);
    assert.equal(await count("workout_set_logs", "log_id = ?", [state.logA]), 1, "one row per set");
    const [[row]] = await connection.query("SELECT reps, weight_kg, user_id FROM workout_set_logs WHERE log_id = ?", [state.logA]);
    assert.deepEqual({ ...row }, { reps: 10, weight_kg: null, user_id: ids.a });
    assert.equal((await logSet(tokens.a, { logId: state.logA, dayExerciseId: state.a.rep.id, setIndex: 1, durationSec: 45 })).status, 200);
    const p = await progress(tokens.a);
    assert.deepEqual(p.json.sets.map((s) => s.setIndex).sort(), [0, 1]);
  }));

  it("5. logSet refuses each case with the spec's words", run(async () => {
    const before = await count("workout_set_logs", "1 = ?", [1]);
    const ok = { logId: state.logA, dayExerciseId: state.a.rep.id, setIndex: 0 };
    refused(await logSet(tokens.a, { ...ok, setIndex: state.a.rep.setCount }), "Invalid set");
    refused(await logSet(tokens.a, { ...ok, setIndex: -1 }), "Invalid set");
    refused(await logSet(tokens.a, { ...ok, setIndex: 1.5 }), "Invalid set");
    refused(await logSet(tokens.a, { ...ok, dayExerciseId: state.a.otherDayExercise }), "That exercise is not part of this session");
    refused(await logSet(tokens.a, { ...ok, dayExerciseId: state.b.rep.id }), "That exercise is not part of this session");
    refused(await logSet(tokens.a, { ...ok, logId: "00000000-0000-4000-8000-000000000000" }), "Session not found");
    refused(await logSet(tokens.a, { ...ok, reps: 1001 }), /Reps must be a whole number/);
    refused(await logSet(tokens.a, { ...ok, reps: 2.5 }), /Reps must be a whole number/);
    refused(await logSet(tokens.a, { ...ok, weightKg: 1000.5 }), /Weight must be between 0 and 1000/);
    refused(await logSet(tokens.a, { ...ok, weightKg: -1 }), /Weight must be between 0 and 1000/);
    refused(await logSet(tokens.a, { ...ok, weightKg: "20" }), /Weight must be between 0 and 1000/);
    refused(await logSet(tokens.a, { ...ok, durationSec: 3601 }), /Duration must be a whole number/);
    assert.equal(await count("workout_set_logs", "1 = ?", [1]), before, "no refusal wrote a set");
  }));

  it("6. another member's log is \"Session not found\" for every action, and progress is per member", run(async () => {
    const startedB = await start(tokens.b);
    assert.equal(startedB.status, 201, JSON.stringify(startedB.json));
    state.logB = startedB.json.log.id;
    refused(await logSet(tokens.b, { logId: state.logA, dayExerciseId: state.a.rep.id, setIndex: 0, reps: 1 }), "Session not found");
    refused(await complete(tokens.b, state.logA), "Session not found");
    refused(await abandon(tokens.b, state.logA), "Session not found");
    const p = await progress(tokens.b);
    assert.equal(p.json.log.id, state.logB, "B sees only B's log");
    assert.deepEqual(p.json.sets, []);
    const [[a]] = await connection.query("SELECT status FROM workout_logs WHERE id = ?", [state.logA]);
    assert.equal(a.status, "in_progress", "A's session is untouched");
  }));

  it("7. ending early keeps the sets and puts today back to planned; it can start again", run(async () => {
    assert.equal((await logSet(tokens.b, { logId: state.logB, dayExerciseId: state.b.rep.id, setIndex: 0, reps: 5 })).status, 200);
    const ended = await abandon(tokens.b, state.logB);
    assert.equal(ended.status, 200, JSON.stringify(ended.json));
    assert.equal(ended.json.log.status, "abandoned");
    assert.equal(await count("workout_set_logs", "log_id = ?", [state.logB]), 1, "the logged set is kept");
    assert.equal((await home(tokens.b, TODAY)).json.status, "planned");
    refused(await logSet(tokens.b, { logId: state.logB, dayExerciseId: state.b.rep.id, setIndex: 1, reps: 5 }), "That session is no longer running");
    refused(await abandon(tokens.b, state.logB), "That session is no longer running");
    const restart = await start(tokens.b);
    assert.equal(restart.status, 201);
    assert.notEqual(restart.json.log.id, state.logB, "a fresh log");
    assert.equal(await count("workout_logs", "user_id = ? AND status = 'in_progress'", [ids.b]), 1);
  }));

  it("8. finishing completes the log; the day is done and can't be started or logged again", run(async () => {
    const done = await complete(tokens.a, state.logA);
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.log.status, "completed");
    assert.ok(done.json.log.completedAt);
    assert.equal((await home(tokens.a, TODAY)).json.status, "completed");
    refused(await start(tokens.a), "That session is already done");
    refused(await logSet(tokens.a, { logId: state.logA, dayExerciseId: state.a.rep.id, setIndex: 0, reps: 3 }), "That session is no longer running");
    refused(await complete(tokens.a, state.logA), "That session is no longer running");
    const p = await progress(tokens.a);
    assert.equal(p.json.log.status, "completed", "progress shows the completed log");
    assert.equal(p.json.sets.length, 2);
  }));

  it("9. bad input is refused with one friendly line and changes nothing", run(async () => {
    const logs = await count("workout_logs", "1 = ?", [1]);
    const sets = await count("workout_set_logs", "1 = ?", [1]);
    refused(await start(tokens.b, { date: TODAY, today: TODAY, userId: ids.a }), /Unexpected field: userId/);
    refused(await start(tokens.b, [TODAY]), /\{ date, today \}/);
    refused(await logSet(tokens.b, { logId: "1' OR '1'='1", dayExerciseId: state.b.rep.id, setIndex: 0 }), "Session not found");
    refused(await logSet(tokens.b, { logId: state.logB, dayExerciseId: "1); DROP TABLE workout_set_logs; --", setIndex: 0 }), "That exercise is not part of this session");
    refused(await logSet(tokens.b, { logId: state.logB, dayExerciseId: state.b.rep.id, setIndex: 0, userId: ids.a }), /Unexpected field: userId/);
    refused(await complete(tokens.b, 42), "Session not found");
    refused(await api("POST", "/api/workout/session/complete", tokens.b, { logId: state.logB, status: "completed" }), /Unexpected field: status/);
    refused(await api("GET", `/api/workout/session${qs({ date: "x", today: TODAY })}`, tokens.b), /YYYY-MM-DD/);
    refused(await start(tokens.b, { date: TODAY, today: utcDay(-5) }), /server's date/);
    assert.equal((await logSet(tokens.b, "{not json")).status, 400);
    assert.equal((await logSet(tokens.b, JSON.stringify({ logId: state.logB, dayExerciseId: state.b.rep.id, setIndex: 0, pad: "x".repeat(8 * 1024) }))).status, 413, "an oversized body is refused");
    assert.equal(await count("workout_logs", "1 = ?", [1]), logs);
    assert.equal(await count("workout_set_logs", "1 = ?", [1]), sets, "nothing was written and the tables are intact");
  }));
});
