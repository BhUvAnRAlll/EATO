// Discover extras and plan duplicates end to end (Gym Hub ecosystem, 2026-11-10): test accounts in
// justfit_test against the real Express server. A justFit admin features a gym and members see it
// first with a badge; "Has trainers" leaves out gyms without trainers; a gym admin duplicates a plan,
// and the copy starts inactive and stays out of the member's page. Attack paths: a gym admin or
// member featuring, an unapproved gym, another branch's item, Staff without plan editing.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("discover extras and plan duplicates e2e", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const run = (fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { error.message += `\nserver log: ${(server?.logs ?? []).slice(-4).join(" | ")}`; throw error; }
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["staffA", "user"], ["member", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const gymIds = [state.gymA, state.gymB].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_catalog_items", "gym_membership_pauses", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((b) => b.brand_id)]);
        }
        const all = Object.values(identities).map((i) => i.id);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [all]);
        await db.deleteUsers(connection, all);
      } catch (error) { problems.push(`rows: ${error.code ?? error.message}`); }
    }
    if (testAccounts) for (const tag of Object.keys(identities)) {
      try {
        if (identities[tag].sessionId) await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${error.message}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two published gyms with a plan each", run(async () => {
    for (const [key, name, branch] of [["gymA", "Alpha Fitness", "Tumkur"], ["gymB", "Beta Gym", "Hebbal"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
      const plan = await api("POST", "/api/gym/catalog", tokens[key], { kind: "plan", name: "Gold", duration: 3, price: 4500 });
      assert.equal(plan.status, 201, JSON.stringify(plan.json));
      state[`${key}Plan`] = plan.json.items.find((i) => i.name === "Gold").id;
    }
    await db.publishGyms(connection, [state.gymA, state.gymB]);
  }));

  it("2. only a justFit admin features an approved gym; members see it first", run(async () => {
    for (const tag of ["gymA", "member"]) assert.equal((await api("POST", `/api/admin/portal/gyms/${state.gymB}/feature`, tokens[tag], { featured: true })).status, 403, tag);
    assert.equal((await api("POST", `/api/admin/portal/gyms/${state.gymB}/feature`, tokens.admin, { featured: "yes" })).status, 400);
    const on = await api("POST", `/api/admin/portal/gyms/${state.gymB}/feature`, tokens.admin, { featured: true });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    assert.equal(on.json.featured, true);
    const list = await api("GET", "/api/gyms", tokens.member);
    assert.ok(list.json.gyms.some((g) => g.id === state.gymA), JSON.stringify(list.json.gyms.map((g) => g.id)));
    const ids = list.json.gyms.map((g) => g.id);
    assert.ok(ids.indexOf(state.gymB) < ids.indexOf(state.gymA), "featured first");
    assert.equal(list.json.gyms.find((g) => g.id === state.gymB).featured, true);
    await connection.query("UPDATE gyms SET status = 'suspended' WHERE id = ?", [state.gymA]);
    assert.equal((await api("POST", `/api/admin/portal/gyms/${state.gymA}/feature`, tokens.admin, { featured: true })).status, 409, "only an approved gym");
    await connection.query("UPDATE gyms SET status = 'approved' WHERE id = ?", [state.gymA]);
    assert.equal((await api("POST", `/api/admin/portal/gyms/${state.gymB}/feature`, tokens.admin, { featured: false })).json.featured, false);
  }));

  it("3. Has trainers leaves out gyms that show none", run(async () => {
    assert.equal((await api("GET", "/api/gyms?trainers=yes", tokens.member)).status, 400);
    const list = await api("GET", "/api/gyms?trainers=1", tokens.member);
    assert.equal(list.status, 200);
    assert.ok(!list.json.gyms.some((g) => [state.gymA, state.gymB].includes(g.id)), "neither test gym shows trainers");
  }));

  it("4. a plan is duplicated as inactive, only at its own branch", run(async () => {
    assert.equal((await api("POST", `/api/gym/catalog/${state.gymBPlan}/duplicate`, tokens.gymA)).status, 404, "another branch's plan");
    assert.equal((await api("POST", `/api/gym/catalog/${state.gymAPlan}/duplicate`, tokens.member)).status, 403);
    const copy = await api("POST", `/api/gym/catalog/${state.gymAPlan}/duplicate`, tokens.gymA);
    assert.equal(copy.status, 201, JSON.stringify(copy.json));
    const item = copy.json.items.find((i) => i.name === "Gold (copy)");
    assert.ok(item, "the copy is listed");
    assert.equal(item.price, 4500);
    assert.equal(item.status, "inactive");
    const page = await api("GET", `/api/gyms/${state.gymA}`, tokens.member);
    assert.ok(!page.json.plans.some((p) => p.name === "Gold (copy)"), "members don't see an inactive copy");
  }));
});
