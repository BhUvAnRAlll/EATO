// Active this week (Home's card) end to end: GET /api/workout/activity against justfit_test.
// Completed sessions count by their length (start to finish, capped); running and abandoned
// ones don't; the week is Monday to Sunday around the member's today; last week compares;
// another member's sessions never show; a bad date, and no or a forged session, are refused.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("workout activity e2e: minutes trained this week", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const ids = {};
  const tokens = {};
  // The validator wants a today near the server's, so the week is built from the real date
  let TODAY, WEEK, LAST_WEEK;

  const get = async (route, token) => {
    const response = await fetch(`${server.baseUrl}${route}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const activity = (token, today = TODAY) => get(`/api/workout/activity?today=${encodeURIComponent(today)}`, token);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  // A session on `date`: completed after `minutes`, or left in another status (no finish time)
  const session = (userId, date, minutes, status = "completed") =>
    status === "completed"
      ? connection.query(
        "INSERT INTO workout_logs (user_id, on_date, started_at, completed_at, status) VALUES (?, ?, CONCAT(?, ' 07:00:00'), CONCAT(?, ' 07:00:00') + INTERVAL ? MINUTE, 'completed')",
        [userId, date, date, date, minutes],
      )
      : connection.query("INSERT INTO workout_logs (user_id, on_date, started_at, completed_at, status) VALUES (?, ?, CONCAT(?, ' 07:00:00'), NULL, ?)", [userId, date, date, status]);

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const tag of ["a", "b"]) {
        const identity = await testAccounts.createIdentity(runId, tag);
        ids[tag] = identity.id;
        tokens[tag] = (await testAccounts.mintToken(identity.id)).jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    // Monday to Sunday of the database's current week, and of the week before
    const [[row]] = await connection.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today, DATE_FORMAT(CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY, '%Y-%m-%d') AS monday");
    TODAY = row.today;
    const shift = (iso, days) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
    WEEK = Array.from({ length: 7 }, (_, i) => shift(row.monday, i));
    LAST_WEEK = Array.from({ length: 7 }, (_, i) => shift(row.monday, i - 7));
    // a this week: Mon 40, Wed 32 + 20, a running one on Wed and an abandoned one on Fri (neither counts),
    // Sun 400 (capped to 180); last week: Tue 60, Thu 30; the week before: 500 (out of the window)
    await session(ids.a, WEEK[0], 40);
    await session(ids.a, WEEK[2], 32);
    await session(ids.a, WEEK[2], 20);
    await session(ids.a, WEEK[2], 0, "in_progress");
    await session(ids.a, WEEK[4], 0, "abandoned");
    await session(ids.a, WEEK[6], 400);
    await session(ids.a, LAST_WEEK[1], 60);
    await session(ids.a, LAST_WEEK[3], 30);
    await session(ids.a, shift(LAST_WEEK[0], -3), 500);
    // b: a big session this week that must never show on a's card
    await session(ids.b, WEEK[1], 90);
  });

  after(async () => {
    if (server) await server.stop();
    if (connection) {
      for (const tag of ["a", "b"]) if (ids[tag]) await db.deleteUsers(connection, [ids[tag]]);
      await connection.end();
    }
  });

  it("1. needs a valid session", run(async () => {
    assert.equal((await activity(null)).status, 401);
    assert.equal((await activity("jfs_" + "x".repeat(43))).status, 401);
  }));

  it("2. the week around today, Monday to Sunday, with minutes per day; only completed sessions count, long ones are capped", run(async () => {
    const { status, json } = await activity(tokens.a);
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.today, TODAY);
    assert.deepEqual(json.week.map((d) => d.date), WEEK);
    assert.deepEqual(json.week.map((d) => d.minutes), [40, 0, 52, 0, 0, 0, 180], "Wed adds two sessions; the running and abandoned ones add nothing; Sunday is capped at 180");
    assert.equal(json.totalMinutes, 272);
  }));

  it("3. last week compares: its total and the change", run(async () => {
    const { json } = await activity(tokens.a);
    assert.equal(json.previousTotalMinutes, 90, "last week only: the week before that is out of the window");
    assert.equal(json.changePercent, 202, "(272 - 90) / 90");
  }));

  it("4. a member with nothing last week gets no change figure, and never another member's minutes", run(async () => {
    const { json } = await activity(tokens.b);
    assert.deepEqual(json.week.map((d) => d.minutes), [0, 90, 0, 0, 0, 0, 0]);
    assert.equal(json.previousTotalMinutes, 0);
    assert.equal(json.changePercent, null);
  }));

  it("5. a bad or far-off today is refused with one friendly line", run(async () => {
    for (const bad of ["2026-13-01", "yesterday", "", "2020-01-01", "2026-10-28; DROP TABLE users"]) {
      const { status, json } = await activity(tokens.a, bad);
      assert.equal(status, 400, bad);
      assert.ok(!/sql|syntax/i.test(json?.error ?? ""), bad);
    }
  }));
});
