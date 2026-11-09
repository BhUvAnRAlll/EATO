// Super Admin › the gym platform end to end (Gym Hub ecosystem, section 7): test accounts in
// justfit_test against the real Express server. Analytics count every gym, the staff directory lists
// every team with its role, suspending an account ends its sessions and refuses it everywhere until
// it is reactivated, and a branch moves to a new owner in one audited step. Attack paths: a gym
// admin or member calling these, suspending an admin or yourself, bad bodies, a trainer as owner.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("super admin platform e2e: analytics, all staff, suspension and ownership", () => {
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
      for (const [tag, role] of [["admin", "admin"], ["admin2", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["staffA", "user"], ["member", "user"], ["buyer", "user"]]) {
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
          for (const table of ["gym_activity_log", "gym_membership_pauses", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((b) => b.brand_id)]);
        }
        const all = Object.values(identities).map((i) => i.id);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [all]);
        await connection.query("DELETE FROM account_suspensions WHERE user_id IN (?)", [all]);
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

  it("1. two gyms with an owner, Staff and a member", run(async () => {
    for (const [key, name, branch, city] of [["gymA", "Forma", "Tumkur", "Tumakuru"], ["gymB", "Zen", "Hebbal", "Bengaluru"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.staffA.phone, kind: "staff", preset: "receptionist" })).status, 201);
    assert.equal((await api("POST", "/api/gym/members", tokens.gymA, { name: "Asif Khan", phone: identities.member.phone, unit: "months", duration: 3, fee: 3000, paid: 3000, method: "cash" })).status, 201);
  }));

  it("2. only justFit admins read the platform; analytics count every gym", run(async () => {
    for (const tag of ["gymA", "staffA", "member"]) assert.equal((await api("GET", "/api/admin/portal/gym-analytics", tokens[tag])).status, 403, tag);
    assert.equal((await api("GET", "/api/admin/portal/gym-analytics?days=12", tokens.admin)).status, 400);
    const a = await api("GET", "/api/admin/portal/gym-analytics?days=7", tokens.admin);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.ok(a.json.gyms.approved >= 2);
    assert.ok(a.json.memberships.total >= 1);
    assert.equal(a.json.series.visits.length, 7);
    assert.ok(a.json.cities.some((c) => c.city === "Tumakuru"));
  }));

  it("3. the staff directory lists every team with its role", run(async () => {
    const all = await api("GET", "/api/admin/portal/gym-staff?search=Forma", tokens.admin);
    assert.equal(all.status, 200, JSON.stringify(all.json));
    const desk = all.json.staff.find((s) => s.userId === identities.staffA.id);
    assert.equal(desk.roleLabel, "Receptionist");
    assert.ok(all.json.staff.some((s) => s.userId === identities.gymA.id && s.role === "owner"));
    assert.ok(!all.json.staff.some((s) => s.gym.id === state.gymB), "the search narrows to Forma");
    assert.equal((await api("GET", "/api/admin/portal/gym-staff?role=boss", tokens.admin)).status, 400);
    const page = await api("GET", "/api/admin/portal/users/" + identities.member.id + "/gyms", tokens.admin);
    assert.equal(page.json.memberships.length, 1);
  }));

  it("4. suspending ends the account's sessions until it is reactivated", run(async () => {
    const route = `/api/admin/portal/users/${identities.staffA.id}/suspend`;
    assert.equal((await api("POST", route, tokens.gymA, { reason: "Shared their login with others." })).status, 403);
    assert.equal((await api("POST", route, tokens.admin, { reason: "no" })).status, 400);
    assert.equal((await api("POST", `/api/admin/portal/users/${identities.admin2.id}/suspend`, tokens.admin, { reason: "Testing an admin." })).status, 409, "never an admin");
    assert.equal((await api("POST", `/api/admin/portal/users/${identities.admin.id}/suspend`, tokens.admin, { reason: "Testing yourself." })).status, 409, "never yourself");
    assert.equal((await api("GET", "/api/gym/dashboard", tokens.staffA)).status, 200);
    const done = await api("POST", route, tokens.admin, { reason: "Shared their login with others." });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.suspension.reason, "Shared their login with others.");
    assert.equal((await api("GET", "/api/gym/dashboard", tokens.staffA)).status, 401, "the old session is gone");
    const fresh = (await testAccounts.mintToken(identities.staffA.id)).jwt;
    assert.equal((await api("GET", "/api/auth/me", fresh)).status, 401, "a new session doesn't open it either");
    assert.equal((await api("POST", route, tokens.admin, { reason: "Shared their login again." })).status, 409, "already suspended");
    // Signing in with a real code from the (fake) SMS is refused too, with no session made
    const phone = identities.staffA.phone.replace(/^\+91/, "");
    assert.equal((await api("POST", "/api/auth/request-otp", null, { phone })).status, 200);
    const refused = await api("POST", "/api/auth/verify-otp", null, { phone, code: server.readCode(phone) });
    assert.equal(refused.status, 403, JSON.stringify(refused.json));
    assert.match(refused.json.error, /suspended/);
    assert.equal(refused.json.token, undefined);
    const directory = await api("GET", "/api/admin/portal/gym-staff?search=Forma", tokens.admin);
    assert.equal(directory.json.staff.find((s) => s.userId === identities.staffA.id).suspended, true);

    assert.equal((await api("POST", `/api/admin/portal/users/${identities.staffA.id}/reactivate`, tokens.admin)).status, 200);
    assert.equal((await api("GET", "/api/auth/me", fresh)).status, 200, "a new session works again");
    const [[audited]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE target_id = ? AND action IN ('user.suspend', 'user.reactivate')", [identities.staffA.id]);
    assert.equal(audited.n, 2);
  }));

  it("5. a branch moves to a new owner in one audited step", run(async () => {
    const route = `/api/admin/portal/gyms/${state.gymA}/transfer`;
    assert.equal((await api("POST", route, tokens.gymA, { phone: identities.buyer.phone, reason: "The gym was sold." })).status, 403);
    assert.equal((await api("POST", route, tokens.admin, { phone: identities.buyer.phone })).status, 400, "a reason is needed");
    assert.equal((await api("POST", route, tokens.admin, { phone: identities.gymB.phone, reason: "The gym was sold." })).status, 409, "works at another gym");
    const moved = await api("POST", route, tokens.admin, { phone: identities.buyer.phone, reason: "The gym was sold." });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    const [[buyer]] = await connection.query("SELECT role FROM users WHERE id = ?", [identities.buyer.id]);
    assert.equal(buyer.role, "gym_admin");
    const [[old]] = await connection.query("SELECT role FROM users WHERE id = ?", [identities.gymA.id]);
    assert.equal(old.role, "user", "the old owner had no other branch");
    const [owners] = await connection.query("SELECT user_id FROM gym_staff WHERE gym_id = ? AND kind = 'owner'", [state.gymA]);
    assert.deepEqual(owners.map((o) => o.user_id), [identities.buyer.id]);
    assert.equal((await api("GET", "/api/gym/dashboard", tokens.buyer)).status, 200, "the new owner opens the portal");
    const [[audited]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'gym.owner_transfer' AND target_id = ?", [String(state.gymA)]);
    assert.equal(audited.n, 1);
  }));
});
