// Pause Membership end to end against the real Express server and justfit_test: a member reads
// their membership in the app, asks for a pause (Option A), the gym's staff see it on the list and
// approve or reject it, the plan's end moves out by the paused days, and QR check-ins are refused
// while it runs; staff pause a member themselves (Option B). Attack paths: no session, another
// member's membership id, a member on the staff routes, staff of another gym, a status or a member
// id in the body, bad dates, SQL in the view, a second request while one is open, and a decision
// made twice.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");
const att = require("../../gym/attendanceRules.js");

const PLACE = { latitude: 13.3392, longitude: 77.1012 };

describe("gym pause membership e2e: the member's request, the gym's answer, the plan and attendance", () => {
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
  const expiresOn = async (memberId) => (await connection.query("SELECT DATE_FORMAT(expires_on, '%Y-%m-%d') AS d FROM gym_members WHERE id = ?", [memberId]))[0][0].d;
  const pauseRows = async (memberId) => (await connection.query("SELECT status FROM gym_membership_pauses WHERE member_id = ? ORDER BY id", [memberId]))[0].map((r) => r.status);
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
          for (const table of ["gym_membership_pauses", "gym_attendance", "gym_payments", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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

  it("1. two gyms, their admins and two members on their sign-in numbers", run(async () => {
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
    state.until = await expiresOn(state.member);
  }));

  it("2. the member's memberships: their own only, with the pause rules", run(async () => {
    for (const token of [null, "not-a-token"]) assert.equal((await api("GET", "/api/membership", token)).status, 401);
    const mine = await as("member").get("/api/membership");
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    assert.equal(mine.json.memberships.length, 2, "both gyms on the number");
    const forma = mine.json.memberships.find((m) => m.id === state.member);
    assert.equal(forma.gym.name, "Forma");
    assert.equal(forma.code.startsWith("FOR-TUM-"), true);
    assert.deepEqual([forma.status, forma.pause, forma.pausedNow, forma.canPause, forma.pauseProblem, forma.history], ["active", null, false, true, null, []]);
    assert.deepEqual(forma.limits, { maxDays: 90, maxStartAheadDays: 60 });
    assert.equal(forma.expiresOn, state.until);
    const none = await as("stranger").get("/api/membership");
    assert.deepEqual(none.json.memberships, [], "a number no gym has: nothing");
    // The gym's own dashboard and list start with no request
    const dash = await as("gymA").get("/api/gym/dashboard");
    assert.equal(dash.json.alerts.pauseRequests, 0);
    assert.deepEqual((await as("gymA").get("/api/gym/pauses")).json.pauses, []);
  }));

  it("3. the member asks for a pause (Option A): checked, once, their own membership only", run(async () => {
    const body = { from: day(3), until: day(12), reason: "Travelling for work" };
    // Bad inputs
    assert.equal((await as("member").post(`/api/membership/${state.member}/pause`, { ...body, from: day(-1) })).status, 400, "can't start yesterday");
    assert.equal((await as("member").post(`/api/membership/${state.member}/pause`, { ...body, until: day(2) })).status, 400, "ends before it starts");
    assert.equal((await as("member").post(`/api/membership/${state.member}/pause`, { ...body, until: day(95) })).status, 400, "longer than 90 days");
    assert.equal((await as("member").post(`/api/membership/${state.member}/pause`, { ...body, reason: "" })).status, 400, "no reason");
    assert.equal((await as("member").post(`/api/membership/${state.member}/pause`, { ...body, status: "approved" })).status, 400, "nothing in the body picks the status");
    assert.equal((await as("member").post(`/api/membership/${state.member}/pause`, { ...body, memberId: state.other })).status, 400);
    // Another member's membership, a stranger, bad ids
    assert.equal((await as("member").post(`/api/membership/${state.other}/pause`, body)).status, 404, "not on their number");
    assert.equal((await as("stranger").post(`/api/membership/${state.member}/pause`, body)).status, 404);
    for (const id of ["0", "x", "1 OR 1=1"]) assert.equal((await as("member").post(`/api/membership/${id}/pause`, body)).status, 400, id);
    assert.deepEqual(await pauseRows(state.member), [], "nothing was written by the refusals");

    const sent = await as("member").post(`/api/membership/${state.member}/pause`, body);
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    assert.equal(sent.json.pause.status, "pending");
    assert.deepEqual([sent.json.pause.from, sent.json.pause.until, sent.json.pause.days, sent.json.pause.by, sent.json.pause.reason], [day(3), day(12), 10, "member", "Travelling for work"]);
    assert.deepEqual([sent.json.canPause, sent.json.pausedNow], [false, false]);
    assert.match(sent.json.pauseProblem, /already waiting/);
    assert.equal(sent.json.expiresOn, state.until, "nothing changes until the gym approves");
    state.pause = sent.json.pause.id;
    assert.equal((await as("member").post(`/api/membership/${state.member}/pause`, body)).status, 409, "one open request at a time");

    // The gym sees it; the other gym and the member don't
    const dash = await as("gymA").get("/api/gym/dashboard");
    assert.equal(dash.json.alerts.pauseRequests, 1);
    const list = await as("gymA").get("/api/gym/pauses");
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.equal(list.json.pauses.length, 1);
    assert.deepEqual([list.json.pauses[0].id, list.json.pauses[0].member.id, list.json.pauses[0].member.name, list.json.pauses[0].wouldEndOn], [state.pause, state.member, "Asif Khan", rules.addDays(state.until, 10)]);
    assert.equal(list.json.counts.pending, 1);
    assert.deepEqual((await as("gymB").get("/api/gym/pauses")).json.pauses, [], "another gym's list");
    assert.equal((await as("member").get("/api/gym/pauses")).status, 403, "a member on the staff route");
    assert.equal((await as("gymA").get("/api/gym/pauses?view=1%20OR%201%3D1")).status, 400, "SQL in the view");
    const detail = await as("gymA").get(`/api/gym/members/${state.member}`);
    assert.equal(detail.json.member.pause.status, "pending", "the member's page shows the request");
  }));

  it("4. rejecting: the plan stays; the member sees the note; a decision is made once", run(async () => {
    assert.equal((await as("gymB").post(`/api/gym/pauses/${state.pause}/reject`, { note: "Not ours" })).status, 404, "another gym's request");
    assert.equal((await as("member").post(`/api/gym/pauses/${state.pause}/reject`)).status, 403);
    assert.equal((await as("gymA").post(`/api/gym/pauses/${state.pause}/reject`, { note: "x".repeat(201) })).status, 400);
    assert.equal((await as("gymA").post(`/api/gym/pauses/${state.pause}/reject`, { note: "No", status: "approved" })).status, 400);
    const rejected = await as("gymA").post(`/api/gym/pauses/${state.pause}/reject`, { note: "Please renew first" });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.json));
    assert.deepEqual([rejected.json.pause.status, rejected.json.pause.note], ["rejected", "Please renew first"]);
    assert.equal(await expiresOn(state.member), state.until, "the plan is as it was");
    assert.equal((await as("gymA").post(`/api/gym/pauses/${state.pause}/approve`)).status, 409, "already decided");
    const mine = (await as("member").get("/api/membership")).json.memberships.find((m) => m.id === state.member);
    assert.equal(mine.pause, null);
    assert.equal(mine.canPause, true, "may ask again");
    assert.deepEqual([mine.history[0].status, mine.history[0].note], ["rejected", "Please renew first"]);
    assert.equal((await as("gymA").get("/api/gym/dashboard")).json.alerts.pauseRequests, 0);
    assert.equal((await as("gymA").get("/api/gym/pauses?view=all")).json.pauses.length, 1, "All keeps the history");
  }));

  it("5. cancelling: a waiting request is taken back by the member, nothing else", run(async () => {
    const sent = await as("member").post(`/api/membership/${state.member}/pause`, { from: day(1), until: day(5), reason: "Changed my mind soon" });
    assert.equal(sent.status, 201);
    const id = sent.json.pause.id;
    assert.equal((await as("other").delete(`/api/membership/${state.member}/pause/${id}`)).status, 404, "another member");
    assert.equal((await as("member").delete(`/api/membership/${state.other}/pause/${id}`)).status, 404, "another membership");
    const cancelled = await as("member").delete(`/api/membership/${state.member}/pause/${id}`);
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
    assert.deepEqual([cancelled.json.pause, cancelled.json.canPause, cancelled.json.history[0].status], [null, true, "cancelled"]);
    assert.equal((await as("member").delete(`/api/membership/${state.member}/pause/${id}`)).status, 409, "no longer open");
    assert.equal((await as("gymA").post(`/api/gym/pauses/${id}/approve`)).status, 409, "the gym can't approve a cancelled one");
  }));

  it("6. approving: the plan's end moves out by the paused days and QR check-in is refused while paused", run(async () => {
    // A pause starting today, so the attendance check applies at once
    const sent = await as("member").post(`/api/membership/${state.member}/pause`, { from: today, until: day(6), reason: "Unwell this week" });
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    const id = sent.json.pause.id;
    const approved = await as("gymA").post(`/api/gym/pauses/${id}/approve`);
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    assert.deepEqual([approved.json.pause.status, approved.json.pause.extendedDays, approved.json.pause.member.expiresOn], ["approved", 7, rules.addDays(state.until, 7)]);
    assert.equal(await expiresOn(state.member), rules.addDays(state.until, 7));
    const mine = (await as("member").get("/api/membership")).json.memberships.find((m) => m.id === state.member);
    assert.deepEqual([mine.pause.status, mine.pausedNow, mine.canPause, mine.expiresOn], ["approved", true, false, rules.addDays(state.until, 7)]);
    assert.match(mine.pauseProblem, /already paused/);
    const detail = await as("gymA").get(`/api/gym/members/${state.member}`);
    assert.deepEqual([detail.json.member.pause.status, detail.json.member.pausedNow], ["approved", true]);
    const [audits] = await connection.query("SELECT action FROM admin_audit_log WHERE admin_id = ? ORDER BY created_at", [identities.gymA.id]);
    assert.deepEqual(audits.map((a) => a.action).filter((a) => a.startsWith("gym.pause")), ["gym.pause_reject", "gym.pause_approve"]);

    // QR attendance: the gym's code and place, then a scan while paused
    assert.equal((await as("gymA").put("/api/gym/attendance/location", { ...PLACE, radiusM: 100 })).status, 200);
    const qr = (await as("gymA").post("/api/gym/attendance/qr")).json.qr;
    assert.equal(typeof qr?.payload, "string");
    const preview = await as("member").post("/api/attendance/scan", { qr: qr.payload });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.deepEqual([preview.json.member.active, preview.json.member.pausedUntil], [false, day(6)]);
    const reading = { ...PLACE, accuracy: 15, mocked: false, capturedAt: Date.now() };
    const refused = await as("member").post("/api/attendance/check-in", { qr: qr.payload, ...reading });
    assert.equal(refused.status, 403);
    assert.match(refused.json.error, /paused until/);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM gym_attendance WHERE member_id = ?", [state.member]))[0][0].n, 0, "no visit was written");
    // The other member, not paused, checks in as usual
    const ok = await as("other").post("/api/attendance/check-in", { qr: qr.payload, ...reading });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.ok(att.MIN_VISIT_MS > 0);
  }));

  it("7. staff pause a member themselves (Option B): approved at once, their branch only", run(async () => {
    const body = { from: day(-2), until: day(4), reason: "Away for a family function" };
    assert.equal((await as("gymB").post(`/api/gym/members/${state.other}/pause`, body)).status, 404, "another gym's member");
    assert.equal((await as("member").post(`/api/gym/members/${state.other}/pause`, body)).status, 403);
    assert.equal((await as("gymA").post(`/api/gym/members/${state.other}/pause`, { ...body, from: day(-31) })).status, 400, "more than 30 days back");
    assert.equal((await as("gymA").post(`/api/gym/members/${state.other}/pause`, { ...body, gymId: state.gymB })).status, 400);
    assert.equal((await as("gymA").post(`/api/gym/members/${state.member}/pause`, body)).status, 409, "already paused");
    const before = await expiresOn(state.other);
    const paused = await as("gymA").post(`/api/gym/members/${state.other}/pause`, body);
    assert.equal(paused.status, 201, JSON.stringify(paused.json));
    assert.deepEqual([paused.json.member.pause.status, paused.json.member.pause.by, paused.json.member.pause.days, paused.json.member.pausedNow, paused.json.member.expiresOn], ["approved", "staff", 7, true, rules.addDays(before, 7)]);
    const mine = (await as("other").get("/api/membership")).json.memberships.find((m) => m.id === state.other);
    assert.deepEqual([mine.pause.by, mine.pausedNow, mine.expiresOn], ["staff", true, rules.addDays(before, 7)], "the member sees it in the app");
    const all = await as("gymA").get("/api/gym/pauses?view=all");
    assert.deepEqual(all.json.pauses.map((p) => p.status), ["approved", "approved", "cancelled", "rejected"], "newest first, waiting ones first");
    assert.equal((await as("gymA").get("/api/gym/dashboard")).json.alerts.pauseRequests, 0);
  }));
});
