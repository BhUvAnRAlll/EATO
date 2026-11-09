// Attendance corrections end to end (Gym Hub ecosystem, 2026-11-10): test accounts in justfit_test
// against the real Express server. Staff add a missed visit and correct a visit's times, each with a
// reason, kept in the corrections history; the member's page counts the corrected visits and the
// streak. Attack paths: no session, Staff without the option, a member, another gym's member or
// visit, overlaps, future times, no reason.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("gym attendance corrections e2e: missed visits and fixed times, always with a reason", () => {
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
  const add = (token, body) => api("POST", "/api/gym/attendance/visits", token, body);

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
          for (const table of ["gym_activity_log", "gym_attendance_corrections", "gym_membership_pauses", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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

  it("1. two gyms, a member at gym A, Staff who may only see attendance", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Zen", "Hebbal"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    const admitted = await api("POST", "/api/gym/members", tokens.gymA, { name: "Asif Khan", phone: identities.member.phone, unit: "months", duration: 3, fee: 3000, paid: 3000, method: "cash", joinedOn: rules.addDays(today, -20) });
    assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
    state.member = admitted.json.member.id;
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.staffA.phone, kind: "staff" })).status, 201);
    assert.equal((await api("PUT", `/api/gym/staff/${identities.staffA.id}/permissions`, tokens.gymA, { options: ["attendance.view"] })).status, 200);
  }));

  it("2. adding a missed visit: who may, and what must be sent", run(async () => {
    const day = rules.addDays(today, -2);
    const body = { memberId: state.member, date: day, inTime: "06:30", outTime: "07:45", reason: "Forgot to scan the QR code." };
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await add(token, body)).status, 401);
    assert.equal((await add(tokens.staffA, body)).status, 403, "Staff without Correct visits");
    assert.equal((await add(tokens.member, body)).status, 403, "a member");
    assert.equal((await add(tokens.gymB, body)).status, 404, "another gym's member");
    for (const bad of [{ ...body, reason: "" }, { ...body, outTime: "06:00" }, { ...body, date: rules.addDays(today, 1) }, { ...body, inTime: "6:30" }, { ...body, memberId: `${state.member}` }]) {
      assert.equal((await add(tokens.gymA, bad)).status, 400, JSON.stringify(bad));
    }
    const added = await add(tokens.gymA, body);
    assert.equal(added.status, 201, JSON.stringify(added.json));
    state.visit = added.json.visit.id;
    assert.equal(added.json.visit.durationMin, 75);
    assert.equal(added.json.visit.status, "completed");
    assert.equal((await add(tokens.gymA, { ...body, inTime: "07:00", outTime: "08:00" })).status, 409, "overlaps the visit just added");
  }));

  it("3. correcting a visit's times keeps the before and after with the reason", run(async () => {
    const route = `/api/gym/attendance/visits/${state.visit}`;
    assert.equal((await api("PATCH", route, tokens.gymB, { outTime: "08:00", reason: "Left later than recorded." })).status, 404, "another gym's visit");
    assert.equal((await api("PATCH", route, tokens.gymA, { outTime: "08:00" })).status, 400, "no reason");
    const fixed = await api("PATCH", route, tokens.gymA, { outTime: "08:15", reason: "Left later than recorded." });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
    assert.equal(fixed.json.visit.durationMin, 105);

    const list = await api("GET", "/api/gym/attendance/corrections", tokens.staffA);
    assert.equal(list.status, 200, "Staff with Attendance read the history");
    assert.deepEqual(list.json.corrections.map((c) => c.kind), ["edit", "add"]);
    assert.equal(list.json.corrections[0].reason, "Left later than recorded.");
    assert.ok(list.json.corrections[0].before.out === null || typeof list.json.corrections[0].before.out === "string");
    assert.equal((await api("GET", "/api/gym/attendance/corrections", tokens.gymB)).json.corrections.length, 0, "never another gym's");
    const [[audited]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action IN ('gym.attendance_add', 'gym.attendance_edit') AND target_id = ?", [String(state.gymA)]);
    assert.equal(audited.n, 2);
  }));

  it("4. the member's page counts it, with the streak and this week", run(async () => {
    await add(tokens.gymA, { memberId: state.member, date: rules.addDays(today, -1), inTime: "06:30", outTime: "07:30", reason: "Forgot to scan the QR code." });
    const page = await api("GET", `/api/membership/${state.member}`, tokens.member);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.equal(page.json.attendance.stats.streakDays, 2);
    assert.equal(typeof page.json.attendance.stats.thisWeek, "number");
    assert.ok(page.json.attendance.stats.totalDays >= 2);
  }));
});
