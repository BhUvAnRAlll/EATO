// Complaints and platform settings end to end (Gym Hub ecosystem, section 7): test accounts in
// justfit_test against the real Express server. A member reports a gym; the admins hear about it,
// one takes it, notes it internally and resolves it, and the member is told the resolution (never the
// notes). Platform settings close registration, change the documents asked for and give branches
// without their own a default pause policy. Attack paths: no session, a gym admin or member working
// cases or changing settings, a hidden gym, duplicate reports, closing without words.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("complaints and platform settings e2e", () => {
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
  const DETAILS = "The treadmill belt snapped while I was running and nobody fixed it for a week.";

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["staffA", "user"], ["member", "user"], ["applicant", "user"]]) {
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
          await connection.query("DELETE e FROM complaint_events e JOIN complaints c ON c.id = e.complaint_id WHERE c.gym_id IN (?)", [gymIds]);
          await connection.query("DELETE FROM complaints WHERE gym_id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_membership_pauses", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((b) => b.brand_id)]);
        }
        const all = Object.values(identities).map((i) => i.id);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [all]);
        await connection.query("DELETE FROM platform_settings");
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

  it("1. two gyms; only gym A is published", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Zen", "Hebbal"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    await db.publishGyms(connection, [state.gymA]);
    assert.equal((await api("POST", "/api/gym/members", tokens.gymA, { name: "Asif Khan", phone: identities.member.phone, unit: "months", duration: 3, fee: 3000, paid: 3000, method: "cash" })).status, 201);
  }));

  it("2. a member reports a gym they can see, once", run(async () => {
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await api("POST", "/api/complaints", token, { gymId: state.gymA, category: "safety", details: DETAILS })).status, 401);
    assert.equal((await api("POST", "/api/complaints", tokens.member, { gymId: state.gymB, category: "safety", details: DETAILS })).status, 404, "an unpublished gym");
    for (const bad of [{ gymId: state.gymA, category: "safety", details: "Bad." }, { gymId: state.gymA, category: "spam", details: DETAILS }]) {
      assert.equal((await api("POST", "/api/complaints", tokens.member, bad)).status, 400, JSON.stringify(bad));
    }
    const made = await api("POST", "/api/complaints", tokens.member, { gymId: state.gymA, category: "safety", details: DETAILS });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    state.case = made.json.complaint.id;
    assert.equal(made.json.complaint.status, "open");
    assert.equal((await api("POST", "/api/complaints", tokens.member, { gymId: state.gymA, category: "billing", details: DETAILS })).status, 409, "one open report per gym");
    const admins = (await api("GET", "/api/notifications", tokens.admin)).json;
    assert.ok(admins.notifications.some((n) => n.kind === "platform.complaint" && n.link === `/admin/complaints/${state.case}`));
  }));

  it("3. only justFit admins work a case; the member sees the outcome, never the notes", run(async () => {
    for (const tag of ["gymA", "member"]) assert.equal((await api("GET", "/api/admin/portal/complaints", tokens[tag])).status, 403, tag);
    const list = await api("GET", "/api/admin/portal/complaints", tokens.admin);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.ok(list.json.complaints.some((c) => c.id === state.case));
    assert.equal((await api("POST", `/api/admin/portal/complaints/${state.case}/assign`, tokens.admin)).json.complaint.assignee.id, identities.admin.id);
    assert.equal((await api("POST", `/api/admin/portal/complaints/${state.case}/notes`, tokens.admin, { note: "Called the gym owner; machine replaced." })).status, 200);
    assert.equal((await api("POST", `/api/admin/portal/complaints/${state.case}/status`, tokens.admin, { status: "resolved" })).status, 400, "closing needs words for the member");
    assert.equal((await api("POST", `/api/admin/portal/complaints/${state.case}/status`, tokens.admin, { status: "open" })).status, 409);
    const closed = await api("POST", `/api/admin/portal/complaints/${state.case}/status`, tokens.admin, { status: "resolved", resolution: "The gym replaced the treadmill." });
    assert.equal(closed.status, 200, JSON.stringify(closed.json));
    assert.deepEqual(closed.json.history.map((h) => h.kind), ["created", "assigned", "note", "status"]);
    const mine = await api("GET", "/api/complaints", tokens.member);
    assert.equal(mine.json.complaints[0].status, "resolved");
    assert.equal(mine.json.complaints[0].resolution, "The gym replaced the treadmill.");
    assert.ok(!JSON.stringify(mine.json).includes("Called the gym owner"), "internal notes never reach the member");
    assert.ok((await api("GET", "/api/notifications", tokens.member)).json.notifications.some((n) => n.kind === "gym.complaint_update"));
  }));

  it("4. platform settings: only admins; they change registration and the defaults", run(async () => {
    assert.equal((await api("PUT", "/api/admin/portal/platform-settings", tokens.gymA, { registrationOpen: false })).status, 403);
    assert.equal((await api("PUT", "/api/admin/portal/platform-settings", tokens.admin, { registrationOpen: "no" })).status, 400);
    const saved = await api("PUT", "/api/admin/portal/platform-settings", tokens.admin, { registrationOpen: false, requiredDocuments: ["address", "registration"], pausePolicy: { maxDaysEach: 7 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.settings.registrationOpen, false);

    const closed = await api("POST", "/api/gym-registration", tokens.applicant, { gymName: "Pulse", area: "HSR", city: "Bengaluru" });
    assert.equal(closed.status, 403);
    assert.match(closed.json.error, /closed/);
    assert.equal((await api("GET", "/api/gym-registration", tokens.applicant)).json.canStart, false);

    // Gym A has no pause policy of its own: the platform's 7-day limit applies
    const member = (await api("GET", "/api/membership", tokens.member)).json.memberships[0];
    const tooLong = await api("POST", `/api/membership/${member.id}/pause`, tokens.member, { from: today, until: rules.addDays(today, 9), reason: "Travelling for work" });
    assert.equal(tooLong.status, 409);
    assert.match(tooLong.json.error, /up to 7 days/);

    assert.equal((await api("PUT", "/api/admin/portal/platform-settings", tokens.admin, { registrationOpen: true })).status, 200);
    const open = await api("POST", "/api/gym-registration", tokens.applicant, { gymName: "Pulse", area: "HSR", city: "Bengaluru" });
    assert.equal(open.status, 201, JSON.stringify(open.json));
    state.gymB2 = open.json.id;
    assert.deepEqual(open.json.missing.filter((m) => m.key === "documents").map((m) => m.text), ["A registration document", "An address proof"]);
    await connection.query("DELETE FROM gym_status_history WHERE gym_id = ?", [state.gymB2]);
    const [[brand]] = await connection.query("SELECT brand_id FROM gyms WHERE id = ?", [state.gymB2]);
    await connection.query("DELETE FROM gyms WHERE id = ?", [state.gymB2]);
    await connection.query("DELETE FROM gym_brands WHERE id = ?", [brand.brand_id]);
  }));
});
