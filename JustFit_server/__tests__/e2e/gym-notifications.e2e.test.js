// In-app notifications end to end (Gym Hub ecosystem, section 9): test accounts in justfit_test
// against the real Express server. A member joins a gym, asks for a pause and is refused; the
// gym's team hears about the request; a gym submitted for review reaches the justFit admins; muted
// categories stay quiet; an event is written once. Attack paths: no session, another person's
// notifications, bad ids, unknown categories.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("notifications e2e: the right people hear about each event, once", () => {
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
  const inbox = async (tag) => (await api("GET", "/api/notifications", tokens[tag])).json;
  const kinds = async (tag) => (await inbox(tag)).notifications.map((n) => n.kind);

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
        const gymIds = [state.gymA, state.gymB, state.applied].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_status_history", "gym_documents", "gym_membership_pauses", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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

  it("1. a member joins a gym and hears about it", run(async () => {
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await api("GET", "/api/notifications", token)).status, 401);
    assert.deepEqual((await inbox("member")).notifications, []);
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Zen", "Hebbal"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    const admitted = await api("POST", "/api/gym/members", tokens.gymA, { name: "Asif Khan", phone: identities.member.phone, unit: "months", duration: 3, fee: 3000, paid: 3000, method: "cash" });
    assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
    state.member = admitted.json.member.id;
    const box = await inbox("member");
    assert.deepEqual(box.notifications.map((n) => n.kind), ["membership.activated"]);
    assert.equal(box.unread, 1);
    assert.equal(box.notifications[0].link, `/gym-hub/${state.member}`);
    assert.match(box.notifications[0].title, /Forma/);
  }));

  it("2. a pause request reaches the team that answers it; the answer reaches the member", run(async () => {
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.staffA.phone, kind: "staff" })).status, 201);
    assert.equal((await api("PUT", `/api/gym/staff/${identities.staffA.id}/permissions`, tokens.gymA, { options: ["attendance.view"] })).status, 200);
    const asked = await api("POST", `/api/membership/${state.member}/pause`, tokens.member, { from: today, until: rules.addDays(today, 4), reason: "Travelling for work" });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.ok((await kinds("member")).includes("pause.submitted"));
    assert.deepEqual(await kinds("gymA"), ["pause.request"], "the gym admin answers pauses");
    assert.ok(!(await kinds("staffA")).includes("pause.request"), "Staff without Pause don't hear about it");
    assert.deepEqual(await kinds("gymB"), [], "never another gym's");

    const rejected = await api("POST", `/api/gym/pauses/${asked.json.pause.id}/reject`, tokens.gymA, { note: "Not during the challenge month." });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.json));
    const box = await inbox("member");
    assert.equal(box.notifications[0].kind, "pause.rejected");
    assert.match(box.notifications[0].body, /challenge month/);
  }));

  it("3. reading and muting are the caller's own; a muted category stays quiet", run(async () => {
    const mine = await inbox("member");
    const theirs = await inbox("gymA");
    const read = await api("POST", "/api/notifications/read", tokens.member, { ids: [theirs.notifications[0].id] });
    assert.equal(read.status, 200);
    assert.equal((await inbox("gymA")).unread, theirs.unread, "another person's notification stays unread");
    for (const bad of [{ ids: ["1 OR 1=1"] }, { ids: [] }, { all: true, userId: identities.gymA.id }]) assert.equal((await api("POST", "/api/notifications/read", tokens.member, bad)).status, 400);
    assert.equal((await api("POST", "/api/notifications/read", tokens.member, { all: true })).json.unread, 0);
    assert.ok(mine.unread > 0);

    assert.equal((await api("PUT", "/api/notifications/preferences", tokens.member, { muted: ["spam"] })).status, 400);
    const muted = await api("PUT", "/api/notifications/preferences", tokens.member, { muted: ["pauses"] });
    assert.deepEqual(muted.json.muted, ["pauses"]);
    const before = (await inbox("member")).notifications.length;
    const asked = await api("POST", `/api/membership/${state.member}/pause`, tokens.member, { from: today, until: rules.addDays(today, 2), reason: "Travelling for work" });
    assert.equal(asked.status, 201);
    assert.equal((await inbox("member")).notifications.length, before, "pauses are muted");
    assert.equal((await api("DELETE", `/api/membership/${state.member}/pause/${asked.json.pause.id}`, tokens.member)).status, 200);
  }));

  it("4. suspending tells the member once; a gym submitted for review reaches the admins", run(async () => {
    assert.equal((await api("POST", `/api/gym/members/${state.member}/standing`, tokens.gymA, { standing: "suspended", note: "Fees unpaid for two months." })).status, 200);
    assert.ok((await kinds("member")).includes("membership.suspended"));
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'membership.activated'", [identities.member.id]);
    assert.equal(n, 1, "the welcome was written once");

    const started = await api("POST", "/api/gym-registration", tokens.applicant, { gymName: "Pulse", area: "HSR", city: "Bengaluru" });
    assert.equal(started.status, 201, JSON.stringify(started.json));
    state.applied = started.json.id;
    await connection.query("UPDATE gyms SET status = 'pending_review' WHERE id = ?", [state.applied]);
    assert.equal((await api("POST", `/api/admin/portal/gyms/${state.applied}/decision`, tokens.admin, { action: "reject", note: "We couldn't verify the address." })).status, 200);
    const applicantBox = await inbox("applicant");
    assert.equal(applicantBox.notifications[0].kind, "registration.decided");
    assert.equal(applicantBox.notifications[0].link, "/gym-register");
  }));
});
