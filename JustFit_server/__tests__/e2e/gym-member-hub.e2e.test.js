// Gym Hub's membership page end to end (GET /api/membership/:id, 2026-11-09): test accounts in
// justfit_test against the real Express server. A member reads one of their own memberships with
// its payments, pauses (and their count) and a month of visits. Attack paths: no session, another
// member's membership, a membership at another gym on the same number (theirs, so allowed, but its
// visits never mix), bad ids and months, extra query fields, SQL in the query.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("Gym Hub membership page e2e: the member's own membership, payments, pauses and visits", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();
  const day = (n) => rules.addDays(today, n);

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, text };
  };
  const as = (tag) => ({
    get: (route) => api("GET", route, tokens[tag]),
    post: (route, body) => api("POST", route, tokens[tag], body ?? {}),
    put: (route, body) => api("PUT", route, tokens[tag], body),
    delete: (route) => api("DELETE", route, tokens[tag]),
  });
  // A finished visit on a day (minutes long), as the desk would have recorded it
  const visit = async (gymId, memberId, on, minutes = 60) => {
    await connection.query(
      "INSERT INTO gym_attendance (gym_id, member_id, on_date, checked_in_at, checked_out_at, status, in_source, out_source, duration_min) VALUES (?, ?, ?, ?, ?, 'completed', 'staff', 'staff', ?)",
      [gymId, memberId, on, `${on} 07:00:00`, `${on} 08:00:00`, minutes],
    );
  };
  // A failure carries the server's last log lines (a 500's cause is only there)
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
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["member", "user"], ["other", "user"], ["stranger", "user"]]) {
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
          for (const table of ["gym_activity_log", "gym_membership_pauses", "gym_attendance", "gym_payments", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
        await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  const thisMonth = today.slice(0, 7);
  const firstOfMonth = `${thisMonth}-01`;
  // A day in last month (the 15th), for the month switch
  const lastMonthDay = `${rules.addDays(firstOfMonth, -1).slice(0, 7)}-15`;

  it("1. two gyms; the member at both, another member at A; visits at each", run(async () => {
    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.gymA = a.json.gym.id;
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Just Fit", branch: "Indiranagar", area: "Indiranagar", city: "Bengaluru" });
    state.gymB = b.json.gym.id;
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.gymA.phone })).status, 201);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/staff`, { phone: identities.gymB.phone })).status, 201);
    const admit = async (tag, gymTag, name) => {
      const r = await as(gymTag).post("/api/gym/members", { name, phone: identities[tag].phone, duration: 3, fee: 3000, paid: 3000, method: "cash" });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      return r.json.member.id;
    };
    state.member = await admit("member", "gymA", "Asif Khan");
    state.other = await admit("other", "gymA", "Priya Rao");
    state.memberAtB = await admit("member", "gymB", "Asif at B");
    // The member at A: today (60 min) and twice on the first of the month (45 + 15), once last month
    await visit(state.gymA, state.member, today, 60);
    if (firstOfMonth !== today) {
      await visit(state.gymA, state.member, firstOfMonth, 45);
      await visit(state.gymA, state.member, firstOfMonth, 15);
    }
    await visit(state.gymA, state.member, lastMonthDay, 30);
    // Others' visits that must never show: the other member at A, and the member at B
    await visit(state.gymA, state.other, today, 90);
    await visit(state.gymB, state.memberAtB, today, 90);
  }));

  it("2. the page: this month's visits and stats, payments, no pauses yet", run(async () => {
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await api("GET", `/api/membership/${state.member}`, token)).status, 401);
    const r = await as("member").get(`/api/membership/${state.member}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const page = r.json;
    assert.equal(page.today, today);
    assert.equal(page.membership.id, state.member);
    assert.equal(page.membership.gym.name, "Forma");
    assert.deepEqual(page.pauseCounts, { approved: 0, requested: 0, daysPaused: 0 });
    assert.equal(page.payments.length, 1);
    assert.deepEqual([page.payments[0].kind, page.payments[0].label, page.payments[0].amount, page.payments[0].method], ["admission", "Admission", 3000, "cash"]);

    const a = page.attendance;
    assert.equal(a.month, thisMonth);
    assert.equal(a.nextMonth, null);
    assert.ok(a.previousMonth);
    const days = firstOfMonth === today ? 1 : 2;
    assert.equal(a.days.length, days);
    assert.equal(a.visits.length, days === 1 ? 1 : 3, "only this member's visits at this gym");
    assert.ok(a.visits.every((v) => v.date.startsWith(thisMonth)));
    if (days === 2) assert.deepEqual(a.days.find((d) => d.date === firstOfMonth), { date: firstOfMonth, visits: 2, minutes: 60 });
    assert.equal(a.stats.thisMonth, days, "visit days, not check-ins");
    assert.equal(a.stats.totalDays, days + 1);
    assert.equal(a.stats.lastVisit, today);
    assert.ok(!JSON.stringify(page).includes(identities.other.phone), "nothing of the other member");
  }));

  it("3. last month, and the month rules", run(async () => {
    const r = await as("member").get(`/api/membership/${state.member}?month=${lastMonthDay.slice(0, 7)}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.attendance.days, [{ date: lastMonthDay, visits: 1, minutes: 30 }]);
    assert.equal(r.json.attendance.nextMonth, thisMonth);
    const future = `${rules.addDays(rules.addDays(firstOfMonth, 31), 0).slice(0, 7)}`;
    for (const query of [`month=${future}`, "month=2020-01", "month=2026-13", "month=2026-11'%20OR%201=1--", "memberId=2", "month=2026-11&x=1"]) {
      assert.equal((await as("member").get(`/api/membership/${state.member}?${query}`)).status, 400, query);
    }
  }));

  it("4. another member's membership reads as missing; the member's other gym is theirs but separate", run(async () => {
    assert.equal((await as("member").get(`/api/membership/${state.other}`)).status, 404);
    assert.equal((await as("stranger").get(`/api/membership/${state.member}`)).status, 404);
    for (const id of ["abc", "0", "1%20OR%201=1"]) assert.equal((await as("member").get(`/api/membership/${id}`)).status, 400, id);
    const atB = await as("member").get(`/api/membership/${state.memberAtB}`);
    assert.equal(atB.status, 200);
    assert.equal(atB.json.membership.gym.name, "Just Fit");
    assert.equal(atB.json.attendance.visits.length, 1, "B's visit only");
    assert.equal(atB.json.attendance.visits[0].durationMin, 90);
  }));

  it("5. a pause the gym approves is counted, with the days it added", run(async () => {
    const asked = await as("member").post(`/api/membership/${state.member}/pause`, { from: day(3), until: day(7), reason: "Travelling for work" });
    assert.equal(asked.status, 201, JSON.stringify(asked.json));
    let page = (await as("member").get(`/api/membership/${state.member}`)).json;
    assert.deepEqual(page.pauseCounts, { approved: 0, requested: 1, daysPaused: 0 });
    assert.equal(page.membership.pause.status, "pending");
    const approved = await as("gymA").post(`/api/gym/pauses/${page.membership.pause.id}/approve`, {});
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    page = (await as("member").get(`/api/membership/${state.member}`)).json;
    assert.deepEqual(page.pauseCounts, { approved: 1, requested: 1, daysPaused: 5 });
    assert.equal(page.membership.history.length, 1);
  }));
});
