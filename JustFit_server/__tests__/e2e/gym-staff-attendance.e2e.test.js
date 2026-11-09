// Staff and trainer attendance end to end (2026-11-09) against the real Express server and
// justfit_test: a gym admin adds a Staff login and a Trainer; both scan the branch's QR code
// through /api/attendance (the same GPS checks as members) and land in gym_staff_attendance, not
// in a member's visits; the gym admin reads Attendance › Staff & Trainers and checks them in and
// out by hand. Attack paths: no session, a member, a Staff login and another gym's admin on the
// tab; someone not on the team checked in by hand; a far or mocked reading; a stale code; SQL
// in the search; unknown fields; a double check-in.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");
const attendance = require("../../gym/attendance.js");

const PLACE = { latitude: 13.3392, longitude: 77.1012 };
const north = (from, metres) => ({ latitude: Math.round((from.latitude + metres / 111195) * 1e6) / 1e6, longitude: from.longitude });

describe("gym staff & trainer attendance e2e: scans, the gym admin's tab, by hand", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();

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
  });
  const reading = (point, over = {}) => ({ ...point, accuracy: 15, mocked: false, capturedAt: Date.now(), ...over });
  const scan = (tag, qr) => as(tag).post("/api/attendance/scan", { qr });
  const checkIn = (tag, qr, point, over) => as(tag).post("/api/attendance/check-in", { qr, ...reading(point, over) });
  const checkOut = (tag, qr, point, over) => as(tag).post("/api/attendance/check-out", { qr, ...reading(point, over) });
  const staffRows = async (tag) => (await connection.query("SELECT COUNT(*) AS n FROM gym_staff_attendance WHERE user_id = ?", [identities[tag].id]))[0][0].n;
  const backdate = (tag, minutes) => connection.query("UPDATE gym_staff_attendance SET checked_in_at = NOW() - INTERVAL ? MINUTE WHERE user_id = ? AND status = 'inside'", [minutes, identities[tag].id]);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["owner", "gym_admin"], ["ownerB", "gym_admin"], ["staffer", "user"], ["coach", "user"], ["member", "user"], ["stranger", "user"]]) {
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
          for (const table of ["gym_activity_log", "gym_staff_attendance", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) {
            await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          }
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

  it("1. a branch with its place and code, a Staff login, a Trainer and a member", run(async () => {
    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.gymA = a.json.gym.id;
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Just Fit", branch: "Indiranagar", area: "Indiranagar", city: "Bengaluru" });
    state.gymB = b.json.gym.id;
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.owner.phone })).status, 201);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/staff`, { phone: identities.ownerB.phone })).status, 201);
    assert.equal((await as("owner").post("/api/gym/staff", { phone: identities.staffer.phone, kind: "staff" })).status, 201);
    assert.equal((await as("owner").post("/api/gym/staff", { phone: identities.coach.phone, kind: "trainer" })).status, 201);
    // Names, as a person adds them in their profile: the tab shows them and the search reads them
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", [`Ravi Staff ${runId}`, identities.staffer.id]);
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", [`Priya Trainer ${runId}`, identities.coach.id]);
    const m = await as("owner").post("/api/gym/members", { name: "Asif Khan", phone: identities.member.phone, unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash" });
    assert.equal(m.status, 201, JSON.stringify(m.json));
    state.member = m.json.member.id;
    assert.equal((await as("owner").put("/api/gym/attendance/location", { ...PLACE, radiusM: 100 })).status, 200);
    state.qr = (await as("owner").post("/api/gym/attendance/qr")).json.qr.payload;
    assert.match(state.qr, /^justfit:\/\/attendance\?/);
  }));

  it("2. the tab is the gym admin's alone", run(async () => {
    for (const token of [null, "not-a-token"]) assert.equal((await api("GET", "/api/gym/team-attendance", token)).status, 401);
    // A member, a trainer and the Super Admin aren't portal logins; a Staff login isn't the gym admin
    for (const tag of ["member", "coach", "admin", "staffer"]) {
      assert.equal((await as(tag).get("/api/gym/team-attendance")).status, 403, `${tag} reads the tab`);
      assert.equal((await as(tag).post(`/api/gym/team-attendance/${identities.coach.id}/check-in`)).status, 403, `${tag} checks someone in`);
    }
    const board = await as("owner").get("/api/gym/team-attendance");
    assert.equal(board.status, 200, JSON.stringify(board.json));
    assert.deepEqual(board.json.team.map((t) => [t.name !== null, t.kind, t.today]).sort(), [[true, "staff", "absent"], [true, "trainer", "absent"]]);
    assert.equal(JSON.stringify(board.json).includes(identities.staffer.phone), false, "no full phone number in the answer");
    assert.deepEqual([board.json.stats.teamSize, board.json.stats.insideNow, board.json.stats.absentToday], [2, 0, 2]);
    assert.equal(board.json.team.some((t) => t.userId === identities.owner.id), false, "the gym admin isn't on their own list");
    // Another gym's admin sees their own (empty) team, never this branch's people
    const other = await as("ownerB").get("/api/gym/team-attendance");
    assert.equal(other.status, 200);
    assert.deepEqual(other.json.team, []);
  }));

  it("3. the query is checked: unknown fields, a bad range or page, SQL in the search", run(async () => {
    for (const q of ["range=year", "page=0", "page=abc", "gymId=1", `search=${"x".repeat(61)}`]) {
      assert.equal((await as("owner").get(`/api/gym/team-attendance?${q}`)).status, 400, q);
    }
    for (const search of ["' OR 1=1 --", "%", "_"]) {
      const r = await as("owner").get(`/api/gym/team-attendance?range=month&search=${encodeURIComponent(search)}`);
      assert.equal(r.status, 200, search);
      assert.deepEqual(r.json.visits, [], `${search} matches nothing`);
    }
  }));

  it("4. Staff and a Trainer scan the branch's code: their own work visits, not a member's", run(async () => {
    const preview = await scan("staffer", state.qr);
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.deepEqual([preview.json.as, preview.json.nextAction, preview.json.staff.kind, preview.json.member.active], ["staff", "check_in", "staff", true]);
    // Far away or a mocked reading: refused, nothing written
    assert.equal((await checkIn("staffer", state.qr, north(PLACE, 2000))).status, 403);
    assert.equal((await checkIn("staffer", state.qr, PLACE, { mocked: true })).status, 403);
    assert.equal(await staffRows("staffer"), 0);

    const inside = await checkIn("staffer", state.qr, north(PLACE, 20));
    assert.equal(inside.status, 201, JSON.stringify(inside.json));
    assert.deepEqual([inside.json.as, inside.json.action], ["staff", "check_in"]);
    assert.equal((await checkIn("staffer", state.qr, PLACE)).status, 409, "a second check-in");
    assert.equal(await staffRows("staffer"), 1);

    const trainer = await checkIn("coach", state.qr, PLACE);
    assert.equal(trainer.status, 201, JSON.stringify(trainer.json));
    assert.equal(trainer.json.as, "staff");
    const [[{ n: memberVisits }]] = await connection.query("SELECT COUNT(*) AS n FROM gym_attendance WHERE gym_id = ?", [state.gymA]);
    assert.equal(memberVisits, 0, "no member visit was written");

    // A member still checks in as a member
    const member = await checkIn("member", state.qr, PLACE);
    assert.equal(member.status, 201, JSON.stringify(member.json));
    assert.equal(member.json.as, "member");

    // Checking out: within a minute is a double scan; later it closes the visit with its minutes
    assert.equal((await checkOut("staffer", state.qr, PLACE)).status, 409);
    await backdate("staffer", 95);
    const out = await checkOut("staffer", state.qr, PLACE);
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal(out.json.action, "check_out");
    assert.ok(out.json.durationMin >= 94 && out.json.durationMin <= 96, String(out.json.durationMin));

    // Their own list shows the day at work
    const mine = await as("staffer").get("/api/attendance");
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.json.visits.map((v) => [v.as, v.status]), [["staff", "completed"]]);
  }));

  it("5. someone not on the team, at another branch, scans as a stranger", run(async () => {
    // The stranger has no membership and no team link here: refused, nothing written
    assert.equal((await scan("stranger", state.qr)).status, 403);
    assert.equal((await checkIn("stranger", state.qr, PLACE)).status, 403);
    assert.equal(await staffRows("stranger"), 0);
  }));

  it("6. the gym admin's tab reads it back and checks people in and out by hand", run(async () => {
    const board = await as("owner").get("/api/gym/team-attendance");
    const byKind = Object.fromEntries(board.json.team.map((t) => [t.kind, t]));
    assert.equal(byKind.staff.today, "left");
    assert.ok(byKind.staff.minutesToday >= 94);
    assert.equal(byKind.trainer.today, "inside");
    assert.deepEqual([board.json.stats.insideNow, board.json.stats.cameToday, board.json.stats.absentToday], [1, 2, 0]);
    assert.equal(board.json.visits.length, 2);
    assert.ok(board.json.visits.every((v) => v.date === today));

    // By hand: someone not on this branch's team (a member, the gym admin, another gym's admin) is 404
    for (const userId of [identities.member.id, identities.owner.id, identities.ownerB.id, "nobody_here"]) {
      assert.equal((await as("owner").post(`/api/gym/team-attendance/${userId}/check-in`)).status, 404, userId);
    }
    assert.equal((await as("owner").post("/api/gym/team-attendance/bad%20id/check-in")).status, 400);
    // Another gym's admin can't reach this branch's people
    assert.equal((await as("ownerB").post(`/api/gym/team-attendance/${identities.coach.id}/check-out`)).status, 404);

    assert.equal((await as("owner").post(`/api/gym/team-attendance/${identities.coach.id}/check-in`)).json.alreadyIn, true);
    const out = await as("owner").post(`/api/gym/team-attendance/${identities.coach.id}/check-out`);
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal((await as("owner").post(`/api/gym/team-attendance/${identities.coach.id}/check-out`)).status, 409, "already out");
    const again = await as("owner").post(`/api/gym/team-attendance/${identities.staffer.id}/check-in`);
    assert.equal(again.status, 201);
    const [[row]] = await connection.query("SELECT in_source, created_by FROM gym_staff_attendance WHERE user_id = ? AND status = 'inside'", [identities.staffer.id]);
    assert.deepEqual([row.in_source, row.created_by], ["admin", identities.owner.id]);

    // Search by name narrows the visits
    const name = byKind.trainer.name;
    assert.equal(name, `Priya Trainer ${runId}`);
    const found = await as("owner").get(`/api/gym/team-attendance?search=${encodeURIComponent(name)}`);
    assert.ok(found.json.visits.length >= 1 && found.json.visits.every((v) => v.name === name));
  }));

  it("7. a visit left open at midnight becomes no check-out", run(async () => {
    await connection.query("UPDATE gym_staff_attendance SET on_date = ? WHERE user_id = ? AND status = 'inside'", [rules.addDays(today, -1), identities.staffer.id]);
    assert.ok((await attendance.closeOpenVisits(connection, today)) >= 1);
    const [[row]] = await connection.query("SELECT status FROM gym_staff_attendance WHERE user_id = ? AND on_date = ?", [identities.staffer.id, rules.addDays(today, -1)]);
    assert.equal(row.status, "no_checkout");
    const board = await as("owner").get("/api/gym/team-attendance?range=week");
    assert.ok(board.json.visits.some((v) => v.status === "no_checkout"));
  }));
});
