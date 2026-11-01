// The Super Admin portal end to end: test accounts in justfit_test against the real Express
// server and the isolated justfit_test database. Covers the Overview's counts and the audit log
// that admin actions write (publish and delete a promotion), Users (list, filters, search,
// detail), the removed trainer, Community, gym, owner and WhatsApp routes staying gone, and the
// attack paths: no or forged session, members calling admin routes, malformed ids, SQL and
// wildcards in a search, and a failed action leaving no log line.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("admin portal e2e: the Overview, users and the admin audit log", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const ids = {};
  const tokens = {};
  const state = { promotions: [] };

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const overview = (token) => api("GET", "/api/admin/portal/overview", token);
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
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      await newIdentity("admin", "admin");
      // A second admin, for the admins filter
      await newIdentity("moderator", "admin");
      await newIdentity("marcus");
      await newIdentity("member");
      await newIdentity("rohan");
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    const names = { admin: "Maya Ortiz", moderator: "Sam Rivera", marcus: "Marcus Johnson", member: "Priya Patel", rohan: "Rohan Verma" };
    for (const tag of Object.keys(names)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [ids[tag], identities[tag].emailAddress, names[tag], tag === "admin" || tag === "moderator" ? "admin" : "user"]);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const all = Object.values(ids);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?) OR target_id IN (?)", [all, [...all, ...state.promotions.map(String)]]);
        if (state.promotions.length) await connection.query("DELETE FROM promotions WHERE id IN (?)", [state.promotions]);
        for (const table of ["workout_logs", "macro_meal_logs"]) await connection.query(`DELETE FROM \`${table}\` WHERE user_id IN (?)`, [all]);
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

  it("1. the overview needs a valid session and the admin role", run(async () => {
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) assert.equal((await overview(token)).status, 401);
    for (const tag of ["member", "marcus"]) {
      const r = await overview(tokens[tag]);
      assert.equal(r.status, 403, `${tag} is refused`);
      assert.equal(typeof r.json.error, "string");
    }
    assert.equal((await overview(tokens.admin)).status, 200);
  }));

  it("2. the counts come from real rows: users, new this week, workouts and meals in the last seven days", run(async () => {
    const before = (await overview(tokens.admin)).json;
    assert.deepEqual(Object.keys(before.counts).sort(), ["meals", "newUsers", "users", "workouts"]);
    assert.equal(Object.hasOwn(before, "todo"), false, "no reports or gym trials to do any more");
    await connection.query("INSERT INTO workout_logs (user_id, on_date, status, completed_at) VALUES (?, CURDATE(), 'completed', NOW()), (?, CURDATE() - INTERVAL 1 DAY, 'in_progress', NULL)", [ids.rohan, ids.rohan]);
    await connection.query("INSERT INTO macro_meal_logs (user_id, log_date, slot, title, logged_at) VALUES (?, CURDATE(), 'lunch', 'Dal and rice', NOW(3)), (?, CURDATE() - INTERVAL 20 DAY, 'dinner', 'Old meal', NOW(3) - INTERVAL 20 DAY)", [ids.member, ids.member]);
    const r = await overview(tokens.admin);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.counts.users, before.counts.users);
    assert.ok(r.json.counts.newUsers >= 5, "the test accounts joined just now");
    assert.equal(r.json.counts.workouts, before.counts.workouts + 1, "only a completed workout counts");
    assert.equal(r.json.counts.meals, before.counts.meals + 1, "a meal from 20 days ago is outside the week");
  }));

  it("3. admin actions write the audit log, newest first, with who did them", run(async () => {
    const logBefore = await count("admin_audit_log", "admin_id = ?", [ids.admin]);
    const promo = await api("POST", "/api/admin/promotions", tokens.admin, {
      title: "Train at home", eyebrow: "NEW", headline: "Train at home", description: "Plans that fit your space", imageUrl: "asset:hero-meals", ctaLabel: "See plans", ctaDestination: "explore", status: "published",
    });
    assert.equal(promo.status, 201, JSON.stringify(promo.json));
    state.promotions.push(promo.json.promotion.id);
    assert.equal((await api("DELETE", `/api/admin/promotions/${promo.json.promotion.id}`, tokens.admin)).status, 200);

    assert.equal(await count("admin_audit_log", "admin_id = ?", [ids.admin]), logBefore + 2);
    const { activity } = (await overview(tokens.admin)).json;
    assert.deepEqual(activity.slice(0, 2).map((a) => a.summary), ["Deleted promotion “Train at home”", "Published promotion “Train at home”"], "newest first");
    assert.ok(activity.slice(0, 2).every((a) => a.by === "Maya Ortiz" && a.at));
  }));

  it("4. a refused or failed action leaves no log line", run(async () => {
    const before = await count("admin_audit_log", "1 = ?", [1]);
    assert.equal((await api("POST", "/api/admin/promotions", tokens.member, { title: "x" })).status, 403);
    assert.equal((await api("DELETE", "/api/admin/promotions/999999", tokens.admin)).status, 404);
    assert.equal((await api("POST", "/api/admin/promotions", tokens.admin, { title: "" })).status, 400);
    assert.equal(await count("admin_audit_log", "1 = ?", [1]), before);
  }));

  it("5. users: every route needs the admin role", run(async () => {
    for (const token of [null, "not-a-jwt"]) assert.equal((await api("GET", "/api/admin/portal/users", token)).status, 401);
    for (const tag of ["member", "marcus"]) {
      assert.equal((await api("GET", "/api/admin/portal/users", tokens[tag])).status, 403);
      assert.equal((await api("GET", `/api/admin/portal/users/${ids.member}`, tokens[tag])).status, 403);
    }
  }));

  it("6. the users list: kinds, filters and search by name or email", run(async () => {
    const all = await api("GET", "/api/admin/portal/users", tokens.admin);
    assert.equal(all.status, 200, JSON.stringify(all.json));
    const byId = Object.fromEntries(all.json.users.map((u) => [u.id, u]));
    assert.equal(byId[ids.admin].kind, "admin");
    assert.equal(byId[ids.marcus].kind, "member");
    assert.deepEqual(Object.keys(byId[ids.rohan]).sort(), ["id", "kind", "name"], "no suspension flag any more");
    const kinds = async (filter) => (await api("GET", `/api/admin/portal/users?filter=${filter}`, tokens.admin)).json.users.map((u) => u.id);
    assert.deepEqual((await kinds("admins")).filter((id) => Object.values(ids).includes(id)).sort(), [ids.admin, ids.moderator].sort());
    assert.ok((await kinds("members")).includes(ids.rohan));
    assert.ok(!(await kinds("members")).includes(ids.admin));
    const search = async (text) => (await api("GET", `/api/admin/portal/users?search=${encodeURIComponent(text)}`, tokens.admin)).json.users.map((u) => u.id);
    assert.deepEqual(await search("Rohan Ver"), [ids.rohan]);
    assert.ok((await search(identities.rohan.emailAddress)).includes(ids.rohan), "search by email");
    assert.deepEqual(await search("%"), [], "a percent sign is matched literally, not as a wildcard");
    assert.deepEqual(await search("' OR '1'='1"), []);
    for (const gone of ["everyone", "trainers", "owners", "suspended"]) {
      assert.equal((await api("GET", `/api/admin/portal/users?filter=${gone}`, tokens.admin)).status, 400, gone);
    }
    assert.equal((await api("GET", `/api/admin/portal/users?search=${"x".repeat(81)}`, tokens.admin)).status, 400);
  }));

  it("7. a user's page: when they joined and what they logged", run(async () => {
    const member = await api("GET", `/api/admin/portal/users/${ids.rohan}`, tokens.admin);
    assert.equal(member.status, 200, JSON.stringify(member.json));
    assert.deepEqual({ name: member.json.user.name, kind: member.json.user.kind }, { name: "Rohan Verma", kind: "member" });
    assert.deepEqual(member.json.user.counts, { meals: 0, workouts: 1, orders: 0 });
    assert.match(member.json.user.joinedAt, /^\d{4}-\d{2}-\d{2}T/);
    for (const gone of ["gyms", "suspended", "trainer"]) assert.equal(Object.hasOwn(member.json.user, gone), false, gone);
    assert.equal((await api("GET", "/api/admin/portal/users/user_doesnotexist", tokens.admin)).status, 404);
    assert.equal((await api("GET", `/api/admin/portal/users/${encodeURIComponent("x' OR '1'='1")}`, tokens.admin)).status, 404);
  }));

  it("8. the removed Community, gym, owner and WhatsApp routes are gone, and asking writes nothing", run(async () => {
    const before = await count("admin_audit_log", "1 = ?", [1]);
    for (const [method, route] of [
      ["GET", "/api/admin/portal/gyms"], ["POST", "/api/admin/portal/gyms"], ["GET", "/api/admin/portal/reports"], ["POST", "/api/admin/portal/reports/resolve"],
      ["PUT", `/api/admin/portal/users/${ids.marcus}/verified`], ["POST", `/api/community/admin/members/${ids.rohan}/suspend`],
      ["GET", "/api/community/feed"], ["GET", "/api/gyms"], ["GET", "/api/owner/gyms"], ["GET", "/api/media/00000000-0000-0000-0000-000000000000"],
    ]) {
      assert.equal((await api(method, route, tokens.admin, method === "GET" ? undefined : {})).status, 404, `${method} ${route}`);
    }
    assert.equal((await api("GET", "/api/whatsapp/webhook")).status, 404, "Meta's webhook is gone too");
    assert.equal(await count("admin_audit_log", "1 = ?", [1]), before);
  }));
});
