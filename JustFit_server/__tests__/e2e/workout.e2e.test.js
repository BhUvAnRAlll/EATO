// The Fitness tab end to end: test accounts in justfit_test against the real Express
// server and the isolated justfit_test database. Covers building the first plan (once, even when
// asked for at the same time), the hub and day reads, how each date resolves (log, then
// override, then weekday), history, and the attack paths: no or forged session, another
// member's training day, malformed or far-off dates, unexpected fields, SQL in input.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const WORKOUT_TABLES = ["workout_logs", "workout_day_overrides", "workout_day_exercises", "workout_days", "workout_plans", "workout_profiles", "profiles"];
const utcDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const TODAY = utcDay();

describe("workout e2e: the first plan, the hub, the training day and who may see them", () => {
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
  const home = (token, date, dates = [date], today = TODAY) => api("GET", `/api/workout/home${qs({ date, dates: dates.join(","), today })}`, token);
  const history = (token, from, to, today = TODAY) => api("GET", `/api/workout/history${qs({ from, to, today })}`, token);
  const ensure = (token, body = { today: TODAY }) => api("POST", "/api/workout/plan/ensure", token, body);
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
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
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
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
    }
    // A finished setup: gaining muscle, training 3-4 days, 70 kg. B flagged a health condition and saved no weight.
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency) VALUES (?, '1995-05-10', 'male', 'muscle_gain', 175, 70, '3-4')", [ids.a]);
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, workout_frequency, health_flags) VALUES (?, '1990-01-01', 'female', 'fat_loss', '1-2', JSON_ARRAY('pregnant'))", [ids.b]);
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

  it("1. every workout route needs a valid session", run(async () => {
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      assert.equal((await home(token, TODAY)).status, 401);
      assert.equal((await history(token, utcDay(-6), TODAY)).status, 401);
      assert.equal((await ensure(token)).status, 401);
    }
    assert.equal(await count("workout_plans", "1 = ?", [1]), 0, "nothing was written");
  }));

  it("2. before a plan exists: the hub says so and history is empty", run(async () => {
    const h = await home(tokens.a, TODAY);
    assert.equal(h.status, 200, JSON.stringify(h.json));
    assert.deepEqual(h.json, { plan: null });
    const past = await history(tokens.a, utcDay(-6), TODAY);
    assert.equal(past.status, 200);
    assert.deepEqual(past.json, { days: [] });
  }));

  it("3. ensure builds the plan from the setup profile once, then returns the same plan", run(async () => {
    const first = await ensure(tokens.a);
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.match(first.json.planId, /^[0-9a-f-]{36}$/);
    assert.equal(first.json.created, true);
    const again = await ensure(tokens.a);
    assert.equal(again.status, 200);
    assert.deepEqual(again.json, { planId: first.json.planId, created: false });
    assert.equal(await count("workout_plans", "user_id = ?", [ids.a]), 1);
    state.planA = first.json.planId;

    const h = await home(tokens.a, TODAY);
    const plan = h.json.plan;
    assert.equal(plan.id, state.planA);
    assert.equal(plan.goal, "build_muscle", "muscle_gain maps to build_muscle");
    assert.equal(plan.daysPerWeek, 3, "3-4 days a week starts at 3");
    assert.equal(plan.weekdays.length, 3);
    assert.equal(plan.source, "engine");
    assert.equal(plan.requiresProfessionalReview, false);
    // Every day row and exercise row is the member's own
    assert.equal(await count("workout_days", "plan_id = ? AND user_id <> ?", [state.planA, ids.a]), 0);
    assert.equal(await count("workout_day_exercises", "plan_id = ? AND user_id <> ?", [state.planA, ids.a]), 0);
    const [days] = await connection.query("SELECT id, weekday, title FROM workout_days WHERE user_id = ? ORDER BY weekday", [ids.a]);
    state.daysA = days;
    state.weekdaysA = new Set(plan.weekdays);

    // A plan made today doesn't count the days before it as missed
    const lastWeek = Array.from({ length: 7 }, (_, i) => utcDay(-i));
    const fresh = await home(tokens.a, TODAY, lastWeek);
    assert.ok(fresh.json.week.every((w) => w.status !== "missed"), JSON.stringify(fresh.json.week));
    assert.ok((await history(tokens.a, utcDay(-6), TODAY)).json.days.every((d) => d.status !== "missed"));
  }));

  it("4. asking for the first plan three times at once still makes one plan", run(async () => {
    const results = await Promise.all([ensure(tokens.b), ensure(tokens.b), ensure(tokens.b)]);
    for (const r of results) assert.ok([200, 201].includes(r.status), JSON.stringify(r.json));
    assert.equal(results.filter((r) => r.json.created).length, 1, "exactly one request built it");
    assert.equal(new Set(results.map((r) => r.json.planId)).size, 1, "all three got the same plan");
    assert.equal(await count("workout_plans", "user_id = ?", [ids.b]), 1);
    const h = await home(tokens.b, TODAY);
    assert.equal(h.json.plan.requiresProfessionalReview, true, "a health flag puts the plan in safety mode");
    assert.equal(h.json.plan.goal, "lose_weight");
  }));

  it("5. a scheduled day comes in full; a rest day has no session", run(async () => {
    const window = Array.from({ length: 7 }, (_, i) => utcDay(i));
    const scheduled = window.find((d) => state.weekdaysA.has(weekdayOf(d)));
    const rest = window.find((d) => !state.weekdaysA.has(weekdayOf(d)));
    const h = await home(tokens.a, scheduled, window);
    assert.equal(h.status, 200, JSON.stringify(h.json));
    assert.equal(h.json.date, scheduled);
    assert.equal(h.json.status, "planned");
    const day = h.json.day;
    assert.equal(day.weekday, weekdayOf(scheduled));
    assert.ok(day.exercises.length > 0);
    const order = { warmup: 0, workout: 1, cooldown: 2 };
    for (let i = 1; i < day.exercises.length; i++) assert.ok(order[day.exercises[i - 1].section] <= order[day.exercises[i].section], "sections in order");
    const workoutOnly = day.exercises.filter((e) => e.section === "workout");
    assert.equal(day.exerciseCount, workoutOnly.length);
    assert.equal(day.setCount, workoutOnly.reduce((n, e) => n + e.sets.length, 0));
    assert.equal(day.totalSets, day.exercises.reduce((n, e) => n + e.sets.length, 0));
    assert.ok(day.minutes > 0 && day.minutes >= day.sectionMinutes.workout);
    assert.ok(Number.isInteger(day.kcal) && day.kcal > 0, "A saved a weight, so the burn is estimated");
    for (const e of day.exercises) {
      assert.ok(e.name && e.muscleGroup && e.pattern && Array.isArray(e.sets) && Array.isArray(e.instructions));
    }
    assert.deepEqual(h.json.week.map((w) => w.date), window);
    for (const w of h.json.week) assert.equal(w.status, state.weekdaysA.has(weekdayOf(w.date)) ? "planned" : "rest");

    const r = await home(tokens.a, rest, [rest]);
    assert.equal(r.json.status, "rest");
    assert.equal(r.json.day, null);

    const bDates = Array.from({ length: 7 }, (_, i) => utcDay(i));
    const [[bDay]] = await connection.query("SELECT weekday FROM workout_days WHERE user_id = ? LIMIT 1", [ids.b]);
    const bScheduled = bDates.find((d) => weekdayOf(d) === bDay.weekday);
    const b = await home(tokens.b, bScheduled, [bScheduled]);
    assert.equal(b.json.day.kcal, null, "no saved weight: no guessed burn");
  }));

  it("6. each date resolves log first, then override, then weekday", run(async () => {
    // The plan has been running for a month
    await connection.query("UPDATE workout_plans SET start_date = ? WHERE id = ?", [utcDay(-30), state.planA]);
    const past = Array.from({ length: 13 }, (_, i) => utcDay(-(i + 1)));
    const scheduled = past.filter((d) => state.weekdaysA.has(weekdayOf(d)));
    const rest = past.filter((d) => !state.weekdaysA.has(weekdayOf(d)));
    assert.ok(scheduled.length >= 3 && rest.length >= 2);
    const [missed, running, done] = scheduled;
    const [moved, idle] = rest;
    const dayFor = (iso) => state.daysA.find((d) => d.weekday === weekdayOf(iso)).id;

    await connection.query("INSERT INTO workout_logs (user_id, plan_id, day_id, on_date, status) VALUES (?, ?, ?, ?, 'in_progress')", [ids.a, state.planA, dayFor(running), running]);
    await connection.query("INSERT INTO workout_logs (user_id, plan_id, day_id, on_date, status) VALUES (?, ?, ?, ?, 'in_progress')", [ids.a, state.planA, dayFor(done), done]);
    await connection.query("INSERT INTO workout_logs (user_id, plan_id, day_id, on_date, status, completed_at) VALUES (?, ?, ?, ?, 'completed', NOW(3))", [ids.a, state.planA, dayFor(done), done]);
    await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?)", [ids.a, moved, state.daysA[0].id]);

    const dates = [missed, running, done, moved, idle];
    const h = await home(tokens.a, moved, dates);
    assert.equal(h.status, 200, JSON.stringify(h.json));
    const statusOf = Object.fromEntries(h.json.week.map((w) => [w.date, w.status]));
    assert.deepEqual(statusOf, { [missed]: "missed", [running]: "in_progress", [done]: "completed", [moved]: "missed", [idle]: "rest" });
    assert.equal(h.json.day.id, state.daysA[0].id, "the override's session is shown on the moved date");

    const past14 = await history(tokens.a, utcDay(-13), TODAY);
    assert.equal(past14.status, 200);
    const rows = past14.json.days;
    assert.ok(rows.every((r, i) => i === 0 || r.date < rows[i - 1].date), "newest first");
    assert.ok(rows.every((r) => r.status !== "rest" && r.status !== "planned"), "rest days and sessions still ahead are left out");
    const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
    assert.equal(byDate[done].status, "completed");
    assert.equal(byDate[running].status, "in_progress");
    assert.equal(byDate[missed].status, "missed");
    assert.equal(byDate[moved].title, state.daysA[0].title);
    assert.equal(byDate[idle], undefined);
    assert.ok(byDate[done].totalMinutes > 0 && byDate[done].exerciseCount > 0);
  }));

  it("7. another member's training day never shows up, even when a row points at it", run(async () => {
    // A forged override and log under B that point at A's day: B must not see A's session
    const target = utcDay(-20);
    await connection.query("INSERT INTO workout_day_overrides (user_id, on_date, day_id) VALUES (?, ?, ?)", [ids.b, target, state.daysA[0].id]);
    const h = await home(tokens.b, target, [target], TODAY);
    assert.equal(h.status, 200);
    assert.equal(h.json.day, null, "A's exercises are not returned to B");
    assert.notEqual(h.json.plan.id, state.planA);

    const logDate = utcDay(-21);
    await connection.query("INSERT INTO workout_logs (user_id, plan_id, day_id, on_date, status, completed_at) VALUES (?, ?, ?, ?, 'completed', NOW(3))", [ids.b, state.planA, state.daysA[1].id, logDate]);
    const past = await history(tokens.b, utcDay(-21), utcDay(-20), TODAY);
    for (const row of past.json.days) {
      assert.equal(row.title, null, "A's day title is not leaked");
      assert.equal(row.exerciseCount, 0);
    }
    // And A's view is untouched by B's rows
    const a = await home(tokens.a, target, [target], TODAY);
    assert.equal(a.json.status, state.weekdaysA.has(weekdayOf(target)) ? "missed" : "rest");
  }));

  it("8. bad input is refused with one friendly line and changes nothing", run(async () => {
    const plansBefore = await count("workout_plans", "1 = ?", [1]);
    const bad = async (response, pattern) => {
      assert.equal(response.status, 400, JSON.stringify(response.json));
      assert.equal(typeof response.json.error, "string");
      if (pattern) assert.match(response.json.error, pattern);
      assert.doesNotMatch(response.json.error, /SELECT|sql|stack|at \//i);
    };
    await bad(await home(tokens.a, "2026-02-30"), /real day/);
    await bad(await home(tokens.a, "today"), /YYYY-MM-DD/);
    await bad(await home(tokens.a, "2026-01-01' OR '1'='1"), /YYYY-MM-DD/);
    await bad(await api("GET", `/api/workout/home${qs({ date: TODAY, today: TODAY })}`, tokens.a), /comma-separated/);
    await bad(await home(tokens.a, TODAY, Array.from({ length: 15 }, (_, i) => utcDay(i))), /at most 14/);
    await bad(await home(tokens.a, TODAY, [TODAY, "1); DROP TABLE workout_plans; --"]), /YYYY-MM-DD/);
    await bad(await home(tokens.a, TODAY, [TODAY], utcDay(-3)), /server's date/);
    await bad(await history(tokens.a, TODAY, utcDay(-1)), /on or before/);
    await bad(await history(tokens.a, utcDay(-31), TODAY), /at most 31/);
    await bad(await history(tokens.a, "x", TODAY), /From/);
    await bad(await ensure(tokens.a, { today: TODAY, userId: ids.b }), /Unexpected field: userId/);
    await bad(await ensure(tokens.a, [TODAY]), /\{ today \}/);
    await bad(await ensure(tokens.a, { today: utcDay(5) }), /server's date/);
    await bad(await ensure(tokens.a, {}), /Today/);
    assert.equal((await ensure(tokens.a, "{not json")).status, 400);
    assert.equal((await ensure(tokens.a, JSON.stringify({ today: TODAY, pad: "x".repeat(8 * 1024) }))).status, 413, "an oversized body is refused");
    assert.equal(await count("workout_plans", "1 = ?", [1]), plansBefore);
    assert.equal(await count("workout_plans", "user_id = ? AND status = 'active'", [ids.a]), 1, "the table and A's plan are intact");
  }));
});
