// Super Admin › App Usage phase 3 end to end: retention by join cohort, the member-level list
// and one feature's detail, against justfit_test. Seeds members who joined on known days with
// known activity, checks the retention maths, the list's sorts, search and paging, the detail's
// numbers, and the attack paths: no or forged session, a member, bad sorts, SQL in a search or
// a feature id, demo accounts never counted.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("admin retention e2e: cohorts, the member list and feature detail", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const ids = {};
  const tokens = {};

  const api = async (route, token) => {
    const response = await fetch(`${server.baseUrl}${route}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const admin = (route) => api(`/api/admin/portal${route}`, tokens.admin);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const at = (daysAgo) => `DATE_SUB(CURDATE(), INTERVAL ${daysAgo} DAY) + INTERVAL 10 HOUR`;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role, email] of [["admin", "admin"], ["a", "user"], ["b", "user"], ["c", "user"], ["demo", "user", `demo-${runId}@demo.justfit.test`]]) {
        const identity = await testAccounts.createIdentity(runId, tag, { role, ...(email ? { email } : {}) });
        ids[tag] = identity.id;
        tokens[tag] = (await testAccounts.mintToken(identity.id)).jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    const q = (sql, params = []) => connection.query(sql, params);
    await q("UPDATE users SET full_name = 'Asha Rao' WHERE id = ?", [ids.a]);
    await q("UPDATE users SET full_name = 'Bala Nair' WHERE id = ?", [ids.b]);
    await q("UPDATE users SET full_name = 'Chitra Sen' WHERE id = ?", [ids.c]);
    // Joins: a and b 20 days ago (same cohort), c 3 days ago, demo 20 days ago; sessions old
    await q(`UPDATE users SET created_at = ${at(20)} WHERE id IN (?, ?, ?, ?)`, [ids.a, ids.b, ids.demo, ids.admin]);
    await q(`UPDATE users SET created_at = ${at(3)} WHERE id = ?`, [ids.c]);
    await q(`UPDATE auth_sessions SET created_at = ${at(40)}, last_used_at = ${at(40)}`);
    // a: meals on days 0, 1, 8 after joining (came back on day 1 and day 7+); b: a meal and a workout only on the join day; c: a meal the day after joining; demo: active on days 1 and 10 (never counts)
    await q(`INSERT INTO macro_meal_logs (user_id, log_date, slot, title, logged_at, created_at) VALUES
      (?, CURDATE() - INTERVAL 20 DAY, 'lunch', 'A0', ${at(20)}, ${at(20)}), (?, CURDATE() - INTERVAL 19 DAY, 'lunch', 'A1', ${at(19)}, ${at(19)}), (?, CURDATE() - INTERVAL 12 DAY, 'lunch', 'A8', ${at(12)}, ${at(12)}),
      (?, CURDATE() - INTERVAL 20 DAY, 'lunch', 'B0', ${at(20)}, ${at(20)}),
      (?, CURDATE() - INTERVAL 2 DAY, 'lunch', 'C1', ${at(2)}, ${at(2)}),
      (?, CURDATE() - INTERVAL 19 DAY, 'lunch', 'D1', ${at(19)}, ${at(19)}), (?, CURDATE() - INTERVAL 10 DAY, 'lunch', 'D10', ${at(10)}, ${at(10)})`,
      [ids.a, ids.a, ids.a, ids.b, ids.c, ids.demo, ids.demo]);
    // a: a completed workout yesterday; b: an abandoned one on the day they joined (so b never came back)
    await q(`INSERT INTO workout_logs (user_id, on_date, started_at, completed_at, status) VALUES (?, CURDATE() - INTERVAL 1 DAY, ${at(1)}, ${at(1)} + INTERVAL 30 MINUTE, 'completed'), (?, CURDATE() - INTERVAL 20 DAY, ${at(20)}, NULL, 'abandoned')`, [ids.a, ids.b]);
  });

  after(async () => {
    if (server) await server.stop();
    if (connection) {
      for (const tag of ["admin", "a", "b", "c", "demo"]) if (ids[tag]) await db.deleteUsers(connection, [ids[tag]]);
      await connection.end();
    }
  });

  it("1. every route needs a valid session and the admin role", run(async () => {
    for (const route of ["/usage/retention", "/usage/members", "/usage/features/meal_log"]) {
      assert.equal((await api(`/api/admin/portal${route}`)).status, 401, route);
      assert.equal((await api(`/api/admin/portal${route}`, "jfs_" + "x".repeat(43))).status, 401, route);
      assert.equal((await api(`/api/admin/portal${route}`, tokens.a)).status, 403, route);
      assert.equal((await admin(route)).status, 200, route);
    }
  }));

  it("2. retention by week: the cohort that joined 20 days ago has day-1 50% and day-7 50%; the 3-day-old cohort has no day-7 yet; the demo account never counts", run(async () => {
    const { json } = await admin("/usage/retention?unit=week");
    assert.equal(json.unit, "week");
    assert.deepEqual(json.days, [1, 7, 30]);
    const old = json.cohorts.find((c) => c.joined === 2);
    assert.ok(old, `a and b's cohort: ${JSON.stringify(json.cohorts)}`);
    assert.equal(old.retention.day1, 50, "a came back on day 1; b never did");
    assert.equal(old.retention.day7, 50, "a was active on day 8 and day 19");
    assert.equal(old.retention.day30, null, "20 days old: too soon for day 30");
    assert.equal(old.periods[0], 100, "both were active in the week they joined");
    const young = json.cohorts.find((c) => c.joined === 1);
    assert.ok(young, "c's cohort");
    assert.equal(young.retention.day1, 100);
    assert.equal(young.retention.day7, null);
    assert.equal(json.cohorts.reduce((s, c) => s + c.joined, 0), 3, "a, b, c: never the admin or the demo account");
  }));

  it("3. retention by month groups them into one cohort", run(async () => {
    const { json } = await admin("/usage/retention?unit=month");
    assert.equal(json.unit, "month");
    assert.equal(json.cohorts.reduce((s, c) => s + c.joined, 0), 3);
    assert.equal((await admin("/usage/retention?unit=day")).status, 400);
  }));

  it("4. the member list: last active, interactions, active days and most-used feature; sorted; demo and admin left out", run(async () => {
    const { json } = await admin("/usage/members");
    assert.equal(json.total, 3);
    assert.equal(json.sort, "last_active");
    assert.equal(json.members[0].name, "Asha Rao", "a was active yesterday (the workout)");
    const a = json.members.find((m) => m.name === "Asha Rao");
    assert.equal(a.interactions, 5, "3 meals + a workout started + completed");
    assert.equal(a.activeDays, 6, "3 meal days, the workout day, the day the harness's session was made, and today (test 1 used a's token, which counts as activity)");
    assert.equal(a.mostUsed.id, "meal_log");
    const [[{ today, twentyAgo }]] = await connection.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today, DATE_FORMAT(CURDATE() - INTERVAL 20 DAY, '%Y-%m-%d') AS twentyAgo");
    assert.equal(a.lastActive, today, "dates are the database's own day, never shifted by a time zone");
    assert.equal(a.joined, twentyAgo);
    assert.equal(a.sessions, 0, "the sessions table exists here and none were seeded; null is only for a server without the table");
    const byInteractions = (await admin("/usage/members?sort=interactions")).json.members.map((m) => m.name);
    assert.deepEqual(byInteractions, ["Asha Rao", "Bala Nair", "Chitra Sen"]);
    const byName = (await admin("/usage/members?sort=name")).json.members.map((m) => m.name);
    assert.deepEqual(byName, ["Asha Rao", "Bala Nair", "Chitra Sen"]);
    assert.ok(!json.members.some((m) => m.id === ids.demo || m.id === ids.admin));
  }));

  it("5. search by name or exact id, paging, and refusals: a bad sort, a huge search, SQL in the search", run(async () => {
    assert.deepEqual((await admin("/usage/members?search=chitra")).json.members.map((m) => m.name), ["Chitra Sen"]);
    assert.deepEqual((await admin(`/usage/members?search=${ids.b}`)).json.members.map((m) => m.name), ["Bala Nair"]);
    assert.equal((await admin("/usage/members?search=%25")).json.total, 0, "a literal % matches no name");
    assert.equal((await admin("/usage/members?search=' OR 1=1 --")).json.total, 0);
    assert.equal((await admin("/usage/members?page=2")).json.members.length, 0, "3 members fit on page 1");
    for (const bad of ["?sort=u.id%3B%20DROP%20TABLE%20users", "?page=0", "?page=abc", `?search=${"x".repeat(81)}`]) {
      assert.equal((await admin(`/usage/members${bad}`)).status, 400, bad);
    }
  }));

  it("6. a feature's detail: uses and members for the range, the range before, a per-day series, the top members", run(async () => {
    const { json } = await admin("/usage/features/meal_log?range=30d");
    assert.equal(json.tracked, true);
    assert.equal(json.feature.label, "Meals logged");
    assert.deepEqual(json.current, { uses: 5, members: 3 }, "a's 3, b's 1, c's 1; the demo's 2 don't count");
    assert.equal(json.series.length, 30);
    assert.equal(json.series.reduce((s, p) => s + p.uses, 0), 5);
    assert.equal(json.topMembers[0].name, "Asha Rao");
    assert.equal(json.topMembers[0].uses, 3);
    assert.equal(json.topMembers.length, 3);
    const week = (await admin("/usage/features/workout_completed?range=7d")).json;
    assert.deepEqual(week.current, { uses: 1, members: 1 }, "only a's completed workout");
  }));

  it("7. an unknown feature, or SQL in the id, is refused with one friendly line", run(async () => {
    for (const bad of ["users", "meal_log%3B%20DROP%20TABLE%20users", "..%2F..%2Fetc", "meals"]) {
      const { status, json } = await admin(`/usage/features/${bad}`);
      assert.ok(status === 400 || status === 404, `${status} for ${bad}`);
      if (json?.error) assert.ok(!/sql|syntax/i.test(json.error));
    }
  }));
});
