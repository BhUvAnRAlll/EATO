// Moving and swapping workout sessions end to end: real Clerk development identities against
// the real Express server and the isolated eato_test database. Covers "Do it today instead?"
// (move a missed session to today) and "Swap with today?" (two dates trade sessions), every
// refusal the workout spec lists word for word, and the attack paths: no or forged session,
// another member's training day, unexpected fields, malformed or far-off dates, SQL in input.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const WORKOUT_TABLES = ["workout_set_logs", "workout_logs", "workout_day_overrides", "workout_day_exercises", "workout_days", "workout_plans", "workout_profiles", "profiles"];
const utcDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const TODAY = utcDay();

describe("workout e2e: moving a missed session to today and swapping days", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, clerk;
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
  const move = (token, body) => api("POST", "/api/workout/reschedule/move", token, body);
  const swap = (token, body) => api("POST", "/api/workout/reschedule/swap", token, body);
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const overrideOf = async (userId, date) => {
    const [[row]] = await connection.query("SELECT day_id FROM workout_day_overrides WHERE user_id = ? AND on_date = ?", [userId, date]);
    return row?.day_id ?? null;
  };
  const clearDates = async (userId, dates) => {
    await connection.query("DELETE FROM workout_day_overrides WHERE user_id = ? AND on_date IN (?)", [userId, dates]);
    await connection.query("DELETE FROM workout_logs WHERE user_id = ? AND on_date IN (?)", [userId, dates]);
  };
  const log = (userId, date, dayId, status) =>
    connection.query(
      `INSERT INTO workout_logs (user_id, plan_id, day_id, on_date, status, completed_at) VALUES (?, ?, ?, ?, ?, ${status === "completed" ? "NOW(3)" : "NULL"})`,
      [userId, state.planA, dayId, date, status],
    );
  const refused = (response, message) => {
    assert.equal(response.status, 400, JSON.stringify(response.json));
    if (message instanceof RegExp) assert.match(response.json.error, message);
    else assert.equal(response.json.error, message);
    assert.doesNotMatch(response.json.error, /SELECT|sql|stack|at \//i);
  };
  const newIdentity = async (tag) => {
    const identity = await clerk.createIdentity(runId, tag);
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
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
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      await newIdentity("a");
      await newIdentity("b");
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of ["a", "b"]) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user')", [ids[tag], identities[tag].emailAddress, `Member ${tag.toUpperCase()}`]);
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
    if (clerk) for (const tag of Object.keys(identities)) {
      try {
        if (identities[tag].sessionId) await clerk.revokeSession(identities[tag].sessionId).catch(() => {});
        await clerk.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeClerkError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  it("1. both routes need a valid session and write nothing without one", run(async () => {
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      assert.equal((await move(token, { from: utcDay(-1), today: TODAY })).status, 401);
      assert.equal((await swap(token, { a: TODAY, b: utcDay(1), today: TODAY })).status, 401);
    }
    assert.equal(await count("workout_day_overrides", "1 = ?", [1]), 0);
  }));

  it("2. with no plan yet, both answer \"No active plan\"", run(async () => {
    refused(await move(tokens.a, { from: utcDay(-1), today: TODAY }), "No active plan");
    refused(await swap(tokens.a, { a: TODAY, b: utcDay(1), today: TODAY }), "No active plan");

    // Now give both members a plan that has been running for a month
    for (const tag of ["a", "b"]) assert.ok([200, 201].includes((await ensure(tokens[tag])).status));
    const [[plan]] = await connection.query("SELECT id FROM workout_plans WHERE user_id = ? AND status = 'active'", [ids.a]);
    state.planA = plan.id;
    await connection.query("UPDATE workout_plans SET start_date = ? WHERE user_id IN (?)", [utcDay(-30), [ids.a, ids.b]]);
    const [days] = await connection.query("SELECT id, weekday FROM workout_days WHERE user_id = ?", [ids.a]);
    state.dayOf = (iso) => days.find((d) => d.weekday === weekdayOf(iso))?.id ?? null;
    state.anyDayA = days[0].id;
    const [[dayB]] = await connection.query("SELECT id FROM workout_days WHERE user_id = ? LIMIT 1", [ids.b]);
    state.anyDayB = dayB.id;
    const past = Array.from({ length: 13 }, (_, i) => utcDay(-(i + 1)));
    const future = Array.from({ length: 13 }, (_, i) => utcDay(i + 1));
    state.pastScheduled = past.filter((d) => state.dayOf(d));
    state.pastRest = past.filter((d) => !state.dayOf(d));
    state.futureScheduled = future.filter((d) => state.dayOf(d));
    state.futureRest = future.filter((d) => !state.dayOf(d));
    assert.ok(state.pastScheduled.length >= 3 && state.pastRest.length >= 1 && state.futureScheduled.length >= 2 && state.futureRest.length >= 1);
  }));

  it("3. a missed session moves to today: one override, the plan untouched", run(async () => {
    const missed = state.pastScheduled[0];
    const planRowsBefore = await count("workout_day_exercises", "user_id = ?", [ids.a]);
    const moved = await move(tokens.a, { from: missed, today: TODAY });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.deepEqual(moved.json, { date: TODAY, dayId: state.dayOf(missed) });
    assert.equal(await overrideOf(ids.a, TODAY), state.dayOf(missed));
    assert.equal(await count("workout_day_overrides", "user_id = ?", [ids.a]), 1);
    assert.equal(await count("workout_day_exercises", "user_id = ?", [ids.a]), planRowsBefore, "the plan itself is not rewritten");

    const h = await home(tokens.a, TODAY);
    assert.equal(h.json.status, "planned");
    assert.equal(h.json.day.id, state.dayOf(missed), "today now runs the missed session");

    // Moving again (another missed day) just re-points today
    const again = await move(tokens.a, { from: state.pastScheduled[1], today: TODAY });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(await count("workout_day_overrides", "user_id = ?", [ids.a]), 1);
    await clearDates(ids.a, [TODAY]);
  }));

  it("4. move refuses each case with the spec's words", run(async () => {
    const [missed, done] = state.pastScheduled;
    refused(await move(tokens.a, { from: TODAY, today: TODAY }), "Only a past session can be moved");
    refused(await move(tokens.a, { from: utcDay(1), today: TODAY }), "Only a past session can be moved");
    refused(await move(tokens.a, { from: state.pastRest[0], today: TODAY }), "Nothing was scheduled that day");
    refused(await move(tokens.a, { from: utcDay(-40), today: TODAY }), "Only a session from the last month can be moved");

    await log(ids.a, done, state.dayOf(done), "completed");
    refused(await move(tokens.a, { from: done, today: TODAY }), "That session is already done");

    await log(ids.a, TODAY, state.anyDayA, "in_progress");
    refused(await move(tokens.a, { from: missed, today: TODAY }), "Finish today's session before moving another one here");
    await connection.query("UPDATE workout_logs SET status = 'completed', completed_at = NOW(3) WHERE user_id = ? AND on_date = ?", [ids.a, TODAY]);
    refused(await move(tokens.a, { from: missed, today: TODAY }), "Today's session is already done");

    assert.equal(await count("workout_day_overrides", "user_id = ?", [ids.a]), 0, "no refusal wrote anything");
    await clearDates(ids.a, [done, TODAY]);
  }));

  it("5. today and a later day swap sessions: two overrides, crossed", run(async () => {
    // Make sure today has a session, whatever weekday this runs on
    const todayDay = state.dayOf(TODAY) ?? state.anyDayA;
    if (!state.dayOf(TODAY)) await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?)", [ids.a, TODAY, todayDay]);
    const later = state.futureScheduled.find((d) => state.dayOf(d) !== todayDay) ?? state.futureScheduled[0];
    const laterDay = state.dayOf(later);

    const swapped = await swap(tokens.a, { a: TODAY, b: later, today: TODAY });
    assert.equal(swapped.status, 200, JSON.stringify(swapped.json));
    assert.deepEqual(swapped.json, { swapped: [TODAY, later] });
    assert.equal(await overrideOf(ids.a, TODAY), laterDay);
    assert.equal(await overrideOf(ids.a, later), todayDay);
    const h = await home(tokens.a, TODAY, [TODAY, later]);
    assert.equal(h.json.day.id, laterDay, "today runs the later session");
    assert.deepEqual(h.json.week.map((w) => w.status), ["planned", "planned"]);
    await clearDates(ids.a, [TODAY, later]);
  }));

  it("6. swap refuses each case with the spec's words", run(async () => {
    const todayDay = state.dayOf(TODAY) ?? state.anyDayA;
    if (!state.dayOf(TODAY)) await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?)", [ids.a, TODAY, todayDay]);
    const [later] = state.futureScheduled;
    const overridesBefore = await count("workout_day_overrides", "user_id = ?", [ids.a]);

    refused(await swap(tokens.a, { a: TODAY, b: TODAY, today: TODAY }), "Pick two different dates");
    refused(await swap(tokens.a, { a: TODAY, b: utcDay(-1), today: TODAY }), "A past session cannot be swapped");
    refused(await swap(tokens.a, { a: TODAY, b: state.futureRest[0], today: TODAY }), "Both days need a session to swap");
    refused(await swap(tokens.a, { a: TODAY, b: utcDay(20), today: TODAY }), "Pick a date in the next two weeks");

    await log(ids.a, later, state.dayOf(later), "in_progress");
    refused(await swap(tokens.a, { a: TODAY, b: later, today: TODAY }), "A session already under way cannot be swapped");
    await connection.query("UPDATE workout_logs SET status = 'completed', completed_at = NOW(3) WHERE user_id = ? AND on_date = ?", [ids.a, later]);
    refused(await swap(tokens.a, { a: TODAY, b: later, today: TODAY }), "A finished session cannot be swapped");

    assert.equal(await count("workout_day_overrides", "user_id = ?", [ids.a]), overridesBefore, "no refusal wrote anything");
    await clearDates(ids.a, [TODAY, later]);
  }));

  it("7. another member's day is never copied, and one member's change never touches another's", run(async () => {
    // A stray row under B points a past date at A's day: B can't move it onto today
    const stray = utcDay(-2);
    await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE day_id = VALUES(day_id)", [ids.b, stray, state.anyDayA]);
    refused(await move(tokens.b, { from: stray, today: TODAY }), "Nothing was scheduled that day");
    assert.equal(await overrideOf(ids.b, TODAY), null);

    // Nor swap with it
    const strayLater = state.futureRest[0];
    await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?), (?, ?, ?)", [ids.b, TODAY, state.anyDayB, ids.b, strayLater, state.anyDayA]);
    refused(await swap(tokens.b, { a: TODAY, b: strayLater, today: TODAY }), "Both days need a session to swap");
    assert.equal(await overrideOf(ids.b, TODAY), state.anyDayB, "B's today is unchanged");

    // B's own move writes only B's rows
    const aOverrides = await count("workout_day_overrides", "user_id = ?", [ids.a]);
    const [[bPast]] = await connection.query("SELECT weekday, id FROM workout_days WHERE user_id = ? LIMIT 1", [ids.b]);
    const bMissed = Array.from({ length: 7 }, (_, i) => utcDay(-(i + 1))).find((d) => weekdayOf(d) === bPast.weekday);
    await clearDates(ids.b, [TODAY, stray, strayLater]);
    const ok = await move(tokens.b, { from: bMissed, today: TODAY });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(await overrideOf(ids.b, TODAY), bPast.id);
    assert.equal(await count("workout_day_overrides", "user_id = ?", [ids.a]), aOverrides, "A's rows are untouched");
    await clearDates(ids.b, [TODAY]);
  }));

  it("8. two moves at once leave one override for today", run(async () => {
    const [first, second] = state.pastScheduled;
    const results = await Promise.all([move(tokens.a, { from: first, today: TODAY }), move(tokens.a, { from: second, today: TODAY })]);
    for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(await count("workout_day_overrides", "user_id = ? AND on_date = ?", [ids.a, TODAY]), 1);
    assert.ok([state.dayOf(first), state.dayOf(second)].includes(await overrideOf(ids.a, TODAY)));
    await clearDates(ids.a, [TODAY]);
  }));

  it("9. bad input is refused with one friendly line and changes nothing", run(async () => {
    const before = await count("workout_day_overrides", "1 = ?", [1]);
    refused(await move(tokens.a, { from: utcDay(-1), today: TODAY, userId: ids.b }), /Unexpected field: userId/);
    refused(await swap(tokens.a, { a: TODAY, b: utcDay(1), today: TODAY, dayId: state.anyDayA }), /Unexpected field: dayId/);
    refused(await move(tokens.a, [utcDay(-1)]), /\{ from, today \}/);
    refused(await move(tokens.a, { from: "yesterday", today: TODAY }), /YYYY-MM-DD/);
    refused(await move(tokens.a, { from: "2026-01-01' OR '1'='1", today: TODAY }), /YYYY-MM-DD/);
    refused(await swap(tokens.a, { a: TODAY, b: "1); DROP TABLE workout_day_overrides; --", today: TODAY }), /YYYY-MM-DD/);
    refused(await swap(tokens.a, { a: TODAY, b: "2026-02-30", today: TODAY }), /real day/);
    refused(await move(tokens.a, { from: utcDay(-1), today: utcDay(-5) }), /server's date/);
    refused(await swap(tokens.a, { a: TODAY, b: utcDay(1) }), /Today/);
    assert.equal((await move(tokens.a, "{not json")).status, 400);
    assert.equal((await move(tokens.a, JSON.stringify({ from: utcDay(-1), today: TODAY, pad: "x".repeat(8 * 1024) }))).status, 413, "an oversized body is refused");
    assert.equal(await count("workout_day_overrides", "1 = ?", [1]), before, "nothing was written and the table is intact");
  }));
});
