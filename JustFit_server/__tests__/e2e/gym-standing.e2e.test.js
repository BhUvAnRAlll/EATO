// Membership states and the pause policy end to end (Gym Hub ecosystem, 2026-11-09): test accounts in
// justfit_test against the real Express server. The gym suspends a member (no check-in by staff or
// QR, no pause request; the member sees why), cancels, reactivates; sets a pause policy the member's
// requests must follow; a rejection must give its reason. Attack paths: no session, Staff without
// the option, a member calling the gym's route, another gym's member, bad bodies, wrong moves.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("gym membership states e2e: suspend, cancel, reactivate, and the pause policy", () => {
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
  const standing = (token, body, id = state.member) => api("POST", `/api/gym/members/${id}/standing`, token, body);

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
          for (const table of ["gym_activity_log", "gym_membership_pauses", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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

  it("1. two gyms, a member at gym A, Staff who may only see members", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Zen", "Hebbal"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    const admitted = await api("POST", "/api/gym/members", tokens.gymA, { name: "Asif Khan", phone: identities.member.phone, unit: "months", duration: 3, fee: 3000, paid: 3000, method: "cash" });
    assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
    state.member = admitted.json.member.id;
    assert.equal(admitted.json.member.standing, "active");
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.staffA.phone, kind: "staff" })).status, 201);
    assert.equal((await api("PUT", `/api/gym/staff/${identities.staffA.id}/permissions`, tokens.gymA, { options: ["members.view"] })).status, 200);
    const qr = await api("POST", "/api/gym/attendance/qr", tokens.gymA);
    assert.equal(qr.status, 200, JSON.stringify(qr.json));
    state.qr = qr.json.qr.payload;
  }));

  it("2. who may change a membership's state, and what they must send", run(async () => {
    const body = { standing: "suspended", note: "Fees unpaid for two months." };
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await standing(token, body)).status, 401);
    assert.equal((await standing(tokens.staffA, body)).status, 403, "Staff without the option");
    assert.equal((await standing(tokens.member, body)).status, 403, "a member");
    assert.equal((await standing(tokens.gymB, body)).status, 404, "another gym's member");
    for (const bad of [{ standing: "suspended" }, { standing: "banned", note: "Anything at all" }, { ...body, expiresOn: "2030-01-01" }]) {
      assert.equal((await standing(tokens.gymA, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await standing(tokens.gymA, { standing: "active" })).status, 409, "already active");
  }));

  it("3. suspended: no check-in by staff or QR, no pause request; the member sees why", run(async () => {
    const suspended = await standing(tokens.gymA, { standing: "suspended", note: "Fees unpaid for two months." });
    assert.equal(suspended.status, 200, JSON.stringify(suspended.json));
    assert.equal(suspended.json.member.standing, "suspended");
    assert.equal(suspended.json.member.standingNote, "Fees unpaid for two months.");

    const list = await api("GET", "/api/gym/members?filter=suspended", tokens.gymA);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.deepEqual(list.json.members.map((m) => m.id), [state.member]);
    assert.equal(list.json.counts.suspended, 1);

    const byStaff = await api("POST", `/api/gym/members/${state.member}/check-in`, tokens.gymA);
    assert.equal(byStaff.status, 403);
    assert.match(byStaff.json.error, /suspended/);
    const scan = await api("POST", "/api/attendance/scan", tokens.member, { qr: state.qr });
    assert.equal(scan.status, 403);
    assert.match(scan.json.error, /suspended by Forma/);
    const pause = await api("POST", `/api/membership/${state.member}/pause`, tokens.member, { from: today, until: rules.addDays(today, 4), reason: "Travelling for work" });
    assert.equal(pause.status, 403);

    const mine = await api("GET", "/api/membership", tokens.member);
    const m = mine.json.memberships.find((x) => x.id === state.member);
    assert.equal(m.standing, "suspended");
    assert.equal(m.canPause, false);
    const [[audited]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'gym.member_suspend' AND target_id = ?", [String(state.gymA)]);
    assert.equal(audited.n, 1);
  }));

  it("4. cancelled can't be suspended; reactivating brings check-ins back", run(async () => {
    assert.equal((await standing(tokens.gymA, { standing: "cancelled", note: "Asked to stop the membership." })).status, 200);
    assert.equal((await standing(tokens.gymA, { standing: "suspended", note: "Fees unpaid for two months." })).status, 409);
    const back = await standing(tokens.gymA, { standing: "active" });
    assert.equal(back.status, 200);
    assert.equal(back.json.member.standing, "active");
    const inNow = await api("POST", `/api/gym/members/${state.member}/check-in`, tokens.gymA);
    assert.ok([200, 201].includes(inNow.status), JSON.stringify(inNow.json));
  }));

  it("5. the pause policy limits members' requests; a rejection must say why", run(async () => {
    assert.equal((await api("PUT", "/api/gym/pause-policy", tokens.staffA, { maxPerYear: 1 })).status, 403);
    assert.equal((await api("PUT", "/api/gym/pause-policy", tokens.gymA, { maxPerYear: 0 })).status, 400);
    assert.equal((await api("PUT", "/api/gym/pause-policy", tokens.gymA, { maxDaysPerYear: 5, maxDaysEach: 10 })).status, 400);
    const saved = await api("PUT", "/api/gym/pause-policy", tokens.gymA, { maxPerYear: 1, maxDaysEach: 10 });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.policy, { maxPerYear: 1, maxDaysPerYear: null, maxDaysEach: 10 });

    const tooLong = await api("POST", `/api/membership/${state.member}/pause`, tokens.member, { from: today, until: rules.addDays(today, 11), reason: "Travelling for work" });
    assert.equal(tooLong.status, 409);
    assert.match(tooLong.json.error, /up to 10 days/);
    const asked = await api("POST", `/api/membership/${state.member}/pause`, tokens.member, { from: today, until: rules.addDays(today, 4), reason: "Travelling for work" });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    assert.equal(asked.json.pauseAllowance.pausesLeft, 0);

    const [[pause]] = await connection.query("SELECT id FROM gym_membership_pauses WHERE member_id = ? ORDER BY id DESC LIMIT 1", [state.member]);
    assert.equal((await api("POST", `/api/gym/pauses/${pause.id}/reject`, tokens.gymA, {})).status, 400, "no reason");
    const rejected = await api("POST", `/api/gym/pauses/${pause.id}/reject`, tokens.gymA, { note: "Not during the challenge month." });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.json));

    // A rejected request doesn't use up the allowance
    const again = await api("POST", `/api/membership/${state.member}/pause`, tokens.member, { from: today, until: rules.addDays(today, 2), reason: "Travelling for work" });
    assert.equal(again.status, 201, JSON.stringify(again.json));
    const third = await api("DELETE", `/api/membership/${state.member}/pause/${again.json.pause.id}`, tokens.member);
    assert.equal(third.status, 200);
  }));
});
