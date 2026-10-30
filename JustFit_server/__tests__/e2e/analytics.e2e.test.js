// App event tracking end to end: the real Express server against justfit_test. A member's
// batch is stored for that member only (the body never names one), a retried batch stores
// nothing twice, sessions are kept in step, metadata that would carry personal data is dropped,
// and the attack paths: no or forged session, a bad event in the batch, too many events, an
// extra field, someone else's user id in the body, a huge body, the per-user budget.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("analytics e2e: the app's usage events", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const ids = {};
  const tokens = {};

  const post = async (body, token, raw = false) => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${server.baseUrl}/api/analytics/events`, { method: "POST", headers, body: raw ? body : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const count = async (sql, params = []) => Number((await connection.query(sql, params))[0][0].n);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const event = (name, over = {}) => ({ id: crypto.randomUUID(), name, at: Date.now() - 1000, sessionId: SESSION, ...over });
  const batch = (events, over = {}) => ({ events, platform: "ios", appVersion: "1.0.0", ...over });
  const SESSION = crypto.randomUUID();

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
  });

  after(async () => {
    if (server) await server.stop();
    if (connection) {
      await connection.query("DELETE FROM analytics_events");
      await connection.query("DELETE FROM analytics_sessions");
      for (const tag of ["a", "b"]) if (ids[tag]) await db.deleteUsers(connection, [ids[tag]]);
      await connection.end();
    }
  });

  it("1. needs a valid session; a forged token stores nothing", run(async () => {
    assert.equal((await post(batch([event("app_opened")]))).status, 401);
    assert.equal((await post(batch([event("app_opened")]), "jfs_" + "x".repeat(43))).status, 401);
    assert.equal(await count("SELECT COUNT(*) AS n FROM analytics_events"), 0);
  }));

  it("2. a batch is stored for the signed-in member, with its module, screen and clean metadata; the session row follows", run(async () => {
    const events = [
      event("app_opened", { at: Date.now() - 60_000 }),
      event("screen_viewed", { screen: "home", at: Date.now() - 50_000 }),
      event("meal_logged", { metadata: { slot: "lunch", kcal: 420, email: "a@b.c", nested: { x: 1 } } }),
    ];
    const { status, json } = await post(batch(events), tokens.a);
    assert.equal(status, 200, JSON.stringify(json));
    assert.deepEqual(json, { stored: 3, dropped: 0 });
    const [rows] = await connection.query("SELECT user_id, event_name, module, screen_name, metadata FROM analytics_events WHERE session_id = ? ORDER BY occurred_at", [SESSION]);
    assert.deepEqual(rows.map((r) => [r.user_id, r.event_name, r.module, r.screen_name]), [[ids.a, "app_opened", "app", null], [ids.a, "screen_viewed", "app", "home"], [ids.a, "meal_logged", "nutrition", null]]);
    assert.deepEqual(rows[2].metadata, { slot: "lunch", kcal: 420 }, "the email and the nested value never reached the database");
    const [[s]] = await connection.query("SELECT user_id, platform, app_version, event_count, TIMESTAMPDIFF(SECOND, started_at, last_event_at) AS seconds FROM analytics_sessions WHERE id = ?", [SESSION]);
    assert.equal(s.user_id, ids.a);
    assert.equal(s.platform, "ios");
    assert.equal(s.app_version, "1.0.0");
    assert.equal(Number(s.event_count), 3);
    assert.ok(Number(s.seconds) >= 58 && Number(s.seconds) <= 61, `session length ${s.seconds}s`);
  }));

  it("3. the same batch sent again (a lost reply) stores nothing twice, and the session's count doesn't grow", run(async () => {
    const events = [event("water_logged"), event("water_logged")];
    const first = await post(batch(events), tokens.a);
    assert.deepEqual(first.json, { stored: 2, dropped: 0 });
    const again = await post(batch(events), tokens.a);
    assert.equal(again.status, 200);
    assert.equal(again.json.stored, 0, "both ids were already stored");
    assert.equal(await count("SELECT COUNT(*) AS n FROM analytics_events WHERE event_name = 'water_logged'"), 2);
    const [[s]] = await connection.query("SELECT event_count FROM analytics_sessions WHERE id = ?", [SESSION]);
    assert.equal(Number(s.event_count), 5, "3 from before + 2, not + 4");
  }));

  it("4. the member is the session's, never the body's: a userId field is refused, and b's events never land on a", run(async () => {
    const forged = await post({ ...batch([event("meal_logged")]), userId: ids.a }, tokens.b);
    assert.equal(forged.status, 400);
    const ok = await post(batch([event("meal_logged", { sessionId: crypto.randomUUID() })]), tokens.b);
    assert.equal(ok.status, 200);
    assert.equal(await count("SELECT COUNT(*) AS n FROM analytics_events WHERE user_id = ? AND event_name = 'meal_logged'", [ids.b]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM analytics_events WHERE user_id = ? AND event_name = 'meal_logged'", [ids.a]), 1, "still only a's own");
  }));

  it("5. bad batches are refused with one friendly line and store nothing: an unknown event, a bad id, too many, an unknown platform, a huge body", run(async () => {
    const before = await count("SELECT COUNT(*) AS n FROM analytics_events");
    for (const [body, raw] of [
      [batch([event("meal_logged"), event("credit_card_entered")])],
      [batch([event("meal_logged", { id: "1 OR 1=1" })])],
      [batch(Array.from({ length: 51 }, () => event("app_opened")))],
      [batch([event("app_opened")], { platform: "tizen" })],
      [batch([])],
      ["[]", true],
      ["{\"events\": [" + Array.from({ length: 400 }, () => JSON.stringify(event("app_opened", { metadata: { note: "x".repeat(200) } }))).join(",") + "], \"platform\": \"ios\"}", true],
    ]) {
      const { status, json } = await post(body, tokens.a, raw);
      assert.ok(status === 400 || status === 413, `${status} for ${raw ? body.slice(0, 40) : JSON.stringify(body).slice(0, 60)}`);
      if (status === 400) assert.ok(typeof json?.error === "string" && !/sql|syntax/i.test(json.error));
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM analytics_events"), before, "a refused batch stores nothing, not even its good events");
  }));

  it("6. events too old are dropped (counted in `dropped`), never refused; a view of an uncharted screen is dropped too", run(async () => {
    const { status, json } = await post(batch([event("meal_logged", { at: Date.now() - 30 * 24 * 3600 * 1000 }), event("screen_viewed", { screen: "secret-debug-panel" }), event("meal_logged")]), tokens.a);
    assert.equal(status, 200);
    assert.deepEqual(json, { stored: 1, dropped: 2 });
  }));

  it("7. the per-user budget: a flood of batches is slowed with 429 and Retry-After, and the other member is unaffected", run(async () => {
    let limited = null;
    for (let i = 0; i < 400 && !limited; i++) {
      const r = await fetch(`${server.baseUrl}/api/analytics/events`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.a}` }, body: JSON.stringify(batch([event("app_opened")])) });
      if (r.status === 429) limited = r;
    }
    assert.ok(limited, "the budget kicked in");
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    assert.equal((await post(batch([event("app_opened", { sessionId: crypto.randomUUID() })]), tokens.b)).status, 200, "b has their own budget");
  }));
});
