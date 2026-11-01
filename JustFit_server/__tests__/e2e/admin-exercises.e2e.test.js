// Admin › Exercises end to end: test accounts in justfit_test against the real Express server
// with the fake AI. Covers the list (every built-in exercise, video counts, filters, search), the
// AI adding exercises (cleaned, duplicates left out, recorded in AI usage and the audit log),
// archiving and restoring, and the attack paths: no or forged session, a member calling the
// routes, malformed ids and bodies, SQL and wildcards in a search.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("admin exercises e2e: the full list, AI additions and archiving", () => {
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
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const BASE = "/api/admin/portal/exercises";
  const list = (query = "", token = tokens.admin) => api("GET", `${BASE}${query}`, token);
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const newIdentity = async (tag, role) => {
    const identity = await testAccounts.createIdentity(runId, tag, { role });
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
      await newIdentity("admin", "admin");
      await newIdentity("member");
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    for (const tag of ["admin", "member"]) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)", [ids[tag], identities[tag].emailAddress, tag === "admin" ? "Maya Ortiz" : "Priya Patel", tag === "admin" ? "admin" : "user"]);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const all = Object.values(ids);
        await connection.query("DELETE FROM workout_exercise_library WHERE created_by IN (?)", [all]);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [all]);
        await connection.query("DELETE FROM ai_usage WHERE user_id IN (?)", [all]);
        await db.deleteUsers(connection, all);
      } catch (error) { problems.push(`rows: ${error.code ?? error.message}`); }
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

  it("1. every route needs a valid session and the admin role", run(async () => {
    const someId = crypto.randomUUID();
    const routes = [["GET", BASE], ["GET", `${BASE}/${someId}`], ["POST", `${BASE}/ai-draft`, { request: "Yoga stretches" }], ["POST", `${BASE}/${someId}/archive`], ["POST", `${BASE}/${someId}/restore`]];
    for (const [method, route, body] of routes) {
      for (const token of [null, "not-a-jwt"]) assert.equal((await api(method, route, token, body)).status, 401, `${method} ${route}`);
      assert.equal((await api(method, route, tokens.member, body)).status, 403, `a member: ${method} ${route}`);
    }
    assert.equal(await count("ai_usage", "user_id = ?", [ids.member]), 0, "a refused member spends nothing");
  }));

  it("2. the list has every built-in exercise, none with a video yet, with counts", run(async () => {
    const r = await list();
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.exercises.length >= 50, "the built-in library is listed before any plan exists");
    assert.equal(r.json.counts.total, r.json.exercises.length);
    assert.equal(r.json.counts.withVideo, 0);
    const squat = r.json.exercises.find((e) => e.name === "Bodyweight Squat");
    assert.ok(squat);
    assert.equal(squat.source, "built_in");
    assert.equal(squat.hasVideo, false);
    assert.ok(Array.isArray(squat.instructions) && squat.instructions.length > 0);
  }));

  it("3. filters and search, with SQL and wildcards read as plain text", run(async () => {
    const legs = await list("?group=legs");
    assert.ok(legs.json.exercises.length > 0 && legs.json.exercises.every((e) => e.muscleGroup === "legs"));
    assert.equal((await list("?video=ready")).json.exercises.length, 0);
    const squat = await list("?search=squat");
    assert.ok(squat.json.exercises.length > 0 && squat.json.exercises.every((e) => /squat/i.test(e.name)));
    for (const search of ["%", "_", "' OR 1=1 --", "\\"]) {
      const r = await list(`?search=${encodeURIComponent(search)}`);
      assert.equal(r.status, 200);
      assert.equal(r.json.exercises.length, 0, search);
    }
    const bad = await list("?group=legs'%20OR%201=1&video=x&show=y");
    assert.equal(bad.status, 200);
    assert.equal(bad.json.exercises.length, (await list()).json.exercises.length, "unknown filters read as none");
  }));

  it("4. the AI adds new exercises, leaving out duplicates and broken rows", run(async () => {
    const auditBefore = await count("admin_audit_log", "admin_id = ?", [ids.admin]);
    const r = await api("POST", `${BASE}/ai-draft`, tokens.admin, { request: "Indian warm-ups", count: 5 });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(r.json.added.map((e) => e.name), ["Surya Namaskar"]);
    assert.equal(r.json.added[0].source, "ai");
    assert.equal(r.json.added[0].hasVideo, false);
    assert.equal(r.json.skipped.length, 2);
    assert.ok(r.json.skipped.some((s) => s.name === "Bodyweight Squats" && /already/.test(s.reason)));

    assert.equal(await count("workout_exercise_library", "name = ? AND ai_drafted = TRUE AND created_by = ? AND archived_at IS NULL", ["Surya Namaskar", ids.admin]), 1, "live at once");
    assert.equal(await count("ai_usage", "user_id = ? AND feature = 'exercise_library'", [ids.admin]), 1);
    assert.equal(await count("admin_audit_log", "admin_id = ? AND action = 'exercise.ai_add'", [ids.admin]), 1);
    assert.equal(await count("admin_audit_log", "admin_id = ?", [ids.admin]), auditBefore + 1);
    assert.equal((await list()).json.counts.ai, 1);

    // The same answer again adds nothing and writes no audit line
    const again = await api("POST", `${BASE}/ai-draft`, tokens.admin, { request: "More Indian warm-ups", count: 5 });
    assert.equal(again.status, 201);
    assert.equal(again.json.added.length, 0);
    assert.equal(await count("workout_exercise_library", "name = ?", ["Surya Namaskar"]), 1);
    assert.equal(await count("admin_audit_log", "admin_id = ? AND action = 'exercise.ai_add'", [ids.admin]), 1);
  }));

  it("5. bad AI requests are refused before any AI call", run(async () => {
    const before = await count("ai_usage", "user_id = ?", [ids.admin]);
    for (const body of [{}, { request: "x" }, { request: "Yoga", count: 50 }, { request: "Yoga", count: "5" }, { request: "Yoga", userId: ids.member }]) {
      const r = await api("POST", `${BASE}/ai-draft`, tokens.admin, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(typeof r.json.error, "string");
    }
    assert.equal(await count("ai_usage", "user_id = ?", [ids.admin]), before);
  }));

  it("6. archive and restore, logged; malformed or unknown ids read as missing", run(async () => {
    const [[row]] = await connection.query("SELECT id FROM workout_exercise_library WHERE name = 'Surya Namaskar'");
    const archived = await api("POST", `${BASE}/${row.id}/archive`, tokens.admin);
    assert.equal(archived.status, 200, JSON.stringify(archived.json));
    assert.equal(archived.json.exercise.archived, true);
    assert.ok(!(await list()).json.exercises.some((e) => e.id === row.id), "archived exercises leave the active list");
    assert.ok((await list("?show=archived")).json.exercises.some((e) => e.id === row.id));
    const restored = await api("POST", `${BASE}/${row.id}/restore`, tokens.admin);
    assert.equal(restored.json.exercise.archived, false);
    assert.equal(await count("admin_audit_log", "admin_id = ? AND target_type = 'exercise' AND target_id = ?", [ids.admin, row.id]), 2);

    const detail = await api("GET", `${BASE}/${row.id}`, tokens.admin);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.exercise.name, "Surya Namaskar");
    for (const bad of ["1", "x' OR '1'='1", crypto.randomUUID()]) {
      assert.equal((await api("GET", `${BASE}/${encodeURIComponent(bad)}`, tokens.admin)).status, 404, bad);
      assert.equal((await api("POST", `${BASE}/${encodeURIComponent(bad)}/archive`, tokens.admin)).status, 404, bad);
    }
  }));
});
