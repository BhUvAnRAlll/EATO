// QR attendance end to end against the real Express server and justfit_test: a gym admin sets the
// branch's location and radius and makes its QR code; members scan it to check in and out within
// the radius; staff check members in and out by hand; the dashboard, history and CSV export read
// the visits back. The user's scenario table, one assertion group each, plus the attack paths: no
// session, members on staff routes, staff of another gym, forged / old / other-gym codes, a gym
// or member id in the body, mock and stale readings, SQL in a filter, and refused scans leaving
// no row behind.
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
const att = require("../../gym/attendanceRules.js");

// Forma Tumkur's entrance; points north of it in metres (1° of latitude ≈ 111,195 m)
const PLACE = { latitude: 13.3392, longitude: 77.1012 };
const NEW_PLACE = { latitude: 12.9716, longitude: 77.5946 };
const north = (from, metres) => ({ latitude: Math.round((from.latitude + metres / 111195) * 1e6) / 1e6, longitude: from.longitude });

describe("gym QR attendance e2e: settings, scans, staff, dashboard and export", () => {
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
    return { status: response.status, json, text, type: response.headers.get("content-type") ?? "" };
  };
  const as = (tag) => ({
    get: (route) => api("GET", route, tokens[tag]),
    post: (route, body) => api("POST", route, tokens[tag], body ?? {}),
    put: (route, body) => api("PUT", route, tokens[tag], body),
  });
  const reading = (point, over = {}) => ({ ...point, accuracy: 15, mocked: false, capturedAt: Date.now(), ...over });
  const checkIn = (tag, qr, point, over) => as(tag).post("/api/attendance/check-in", { qr, ...reading(point, over) });
  const checkOut = (tag, qr, point, over) => as(tag).post("/api/attendance/check-out", { qr, ...reading(point, over) });
  const visits = async (memberId) => (await connection.query("SELECT COUNT(*) AS n FROM gym_attendance WHERE member_id = ?", [memberId]))[0][0].n;
  // Moves a member's open visit back in time, as if they had checked in earlier
  const backdate = (memberId, minutes) => connection.query("UPDATE gym_attendance SET checked_in_at = NOW() - INTERVAL ? MINUTE WHERE member_id = ? AND status = 'inside'", [minutes, memberId]);
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
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["member", "user"], ["expired", "user"], ["stranger", "user"]]) {
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
          for (const table of ["gym_activity_log", "gym_attendance", "gym_payments", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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

  it("1. two gyms, their admins, and members matched by their sign-in numbers", run(async () => {
    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.gymA = a.json.gym.id;
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Just Fit", branch: "Indiranagar", area: "Indiranagar", city: "Bengaluru" });
    state.gymB = b.json.gym.id;
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.gymA.phone })).status, 201);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/staff`, { phone: identities.gymB.phone })).status, 201);

    const admit = async (tag, gymTag, name) => {
      const r = await as(gymTag).post("/api/gym/members", { name, phone: identities[tag].phone, unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash" });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      return r.json.member.id;
    };
    state.member = await admit("member", "gymA", "Asif Khan");
    state.expired = await admit("expired", "gymA", "Old Member");
    state.memberAtB = await admit("member", "gymB", "Asif at B");
    await connection.query("UPDATE gym_members SET expires_on = ? WHERE id = ?", [rules.addDays(today, -3), state.expired]);
  }));

  it("2. settings: only the branch's admins; a location, a radius and a QR code", run(async () => {
    // Missing or bad sessions, members and admins are refused
    for (const token of [null, "not-a-token"]) assert.equal((await api("GET", "/api/gym/attendance/settings", token)).status, 401);
    for (const tag of ["member", "admin"]) {
      assert.equal((await as(tag).get("/api/gym/attendance/settings")).status, 403, `${tag} reads`);
      assert.equal((await as(tag).put("/api/gym/attendance/location", { ...PLACE, radiusM: 100 })).status, 403, `${tag} sets the place`);
      assert.equal((await as(tag).post("/api/gym/attendance/qr")).status, 403, `${tag} makes a code`);
    }

    const fresh = await as("gymA").get("/api/gym/attendance/settings");
    assert.equal(fresh.status, 200);
    assert.deepEqual([fresh.json.location, fresh.json.radiusM, fresh.json.qr], [null, 100, null], "default radius 100 m, nothing set yet");

    // Bad values: radius zero, negative, too big; coordinates out of range; a gym id in the body
    for (const body of [{ ...PLACE, radiusM: 0 }, { ...PLACE, radiusM: -10 }, { ...PLACE, radiusM: 5000 }, { latitude: 95, longitude: 77, radiusM: 100 }, { ...PLACE, radiusM: 100, gymId: state.gymB }]) {
      assert.equal((await as("gymA").put("/api/gym/attendance/location", body)).status, 400, JSON.stringify(body));
    }
    const saved = await as("gymA").put("/api/gym/attendance/location", { ...PLACE, radiusM: 100 });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.location, saved.json.radiusM], [PLACE, 100]);

    const made = await as("gymA").post("/api/gym/attendance/qr");
    assert.equal(made.status, 200);
    assert.equal(made.json.qr.version, 1);
    assert.match(made.json.qr.payload, new RegExp(`^justfit://attendance\\?b=${state.gymA}&v=1&k=`));
    state.qrA = made.json.qr.payload;

    // Gym B: elsewhere, with its own code
    await as("gymB").put("/api/gym/attendance/location", { ...NEW_PLACE, radiusM: 100 });
    state.qrB = (await as("gymB").post("/api/gym/attendance/qr")).json.qr.payload;
    // Each admin sees only their own branch
    assert.deepEqual((await as("gymB").get("/api/gym/attendance/settings")).json.location, NEW_PLACE);
    const [[audits]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE admin_id = ? AND action IN ('gym.attendance_place', 'gym.qr_regenerate')", [identities.gymA.id]);
    assert.equal(audits.n, 2);
  }));

  it("3. scan preview: the gym, the membership and the next action; never another member", run(async () => {
    for (const token of [null, "not-a-token"]) assert.equal((await api("POST", "/api/attendance/scan", token, { qr: state.qrA })).status, 401);
    const preview = await as("member").post("/api/attendance/scan", { qr: state.qrA });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.equal(preview.json.gym.name, "Forma");
    assert.equal(preview.json.member.name, "Asif Khan");
    assert.equal(preview.json.nextAction, "check_in");
    assert.equal(preview.json.radiusM, 100);
    assert.equal(JSON.stringify(preview.json).includes(identities.member.phone), false, "no phone number in the answer");

    assert.equal((await as("stranger").post("/api/attendance/scan", { qr: state.qrA })).status, 403, "not a member here");
    assert.equal((await as("member").post("/api/attendance/scan", { qr: state.qrA, memberId: state.expired })).status, 400, "no member id from the app");
    assert.equal((await as("member").post("/api/attendance/scan", { qr: "https://evil.example/x" })).status, 400, "not our code");
  }));

  it("4. scenario: within 100 m checks in; outside 100 m is refused with the agreed message", run(async () => {
    const outside = await checkIn("member", state.qrA, north(PLACE, 150));
    assert.equal(outside.status, 403);
    assert.equal(outside.json.error, att.OUTSIDE);
    assert.equal(await visits(state.member), 0, "nothing recorded");

    const inside = await checkIn("member", state.qrA, north(PLACE, 60));
    assert.equal(inside.status, 201, JSON.stringify(inside.json));
    assert.equal(inside.json.action, "check_in");
    assert.equal(inside.json.distanceM, 60);
    assert.ok(Math.abs(Date.parse(inside.json.checkedInAt) - Date.now()) < 60_000, "the server's time");
    const [[row]] = await connection.query("SELECT status, in_source, check_in_distance_m, gym_id, on_date FROM gym_attendance WHERE member_id = ?", [state.member]);
    assert.deepEqual([row.status, row.in_source, row.check_in_distance_m, row.gym_id], ["inside", "qr", 60, state.gymA]);
  }));

  it("5. scenario: a second check-in while checked in is refused", run(async () => {
    const again = await checkIn("member", state.qrA, north(PLACE, 10));
    assert.equal(again.status, 409);
    assert.match(again.json.error, /already checked in/);
    // Two at the same moment: still one open visit
    const both = await Promise.all([checkIn("member", state.qrA, north(PLACE, 10)), checkIn("member", state.qrA, north(PLACE, 10))]);
    assert.deepEqual(both.map((r) => r.status), [409, 409]);
    assert.equal(await visits(state.member), 1);
    assert.equal((await as("member").post("/api/attendance/scan", { qr: state.qrA })).json.nextAction, "check_out");
  }));

  it("6. scenario: check-out within the radius records the time and the server's duration; outside is refused", run(async () => {
    const tooSoon = await checkOut("member", state.qrA, north(PLACE, 20));
    assert.equal(tooSoon.status, 409, "a double scan right after checking in");
    await backdate(state.member, 75);
    const far = await checkOut("member", state.qrA, north(PLACE, 300));
    assert.equal(far.status, 403);
    assert.equal(far.json.error, att.OUTSIDE_OUT);
    const out = await checkOut("member", state.qrA, north(PLACE, 30));
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal(out.json.action, "check_out");
    assert.ok(out.json.durationMin >= 75 && out.json.durationMin <= 76, `duration ${out.json.durationMin}`);
    const [[row]] = await connection.query("SELECT status, out_source, duration_min, check_out_distance_m FROM gym_attendance WHERE member_id = ?", [state.member]);
    assert.deepEqual([row.status, row.out_source, row.check_out_distance_m], ["completed", "qr", 30]);
  }));

  it("7. scenario: check-out without a check-in is refused; a second visit the same day is allowed", run(async () => {
    const none = await checkOut("member", state.qrA, north(PLACE, 10));
    assert.equal(none.status, 409);
    assert.match(none.json.error, /haven't checked in/);
    assert.equal((await checkIn("member", state.qrA, north(PLACE, 10))).status, 201, "the evening session");
    assert.equal(await visits(state.member), 2);
  }));

  it("8. scenario: an expired membership can't check in", run(async () => {
    const r = await checkIn("expired", state.qrA, north(PLACE, 10));
    assert.equal(r.status, 403);
    assert.match(r.json.error, /membership ended/);
    assert.equal(await visits(state.expired), 0);
  }));

  it("9. scenario: GPS unavailable, imprecise, stale or mocked records nothing", run(async () => {
    const qr = state.qrA;
    const cases = [
      [{ qr }, 400], // no reading at all
      [{ qr, ...reading(north(PLACE, 5)), accuracy: 0 }, 400],
      [{ qr, ...reading(north(PLACE, 5), { accuracy: 900 }) }, 403],
      [{ qr, ...reading(north(PLACE, 5), { capturedAt: Date.now() - 10 * 60 * 1000 }) }, 403],
      [{ qr, ...reading(north(PLACE, 5), { mocked: true }) }, 403],
    ];
    // The member is checked in, so each of these would otherwise be a valid check-out
    for (const [body, status] of cases) {
      const m = await as("member").post("/api/attendance/check-out", body);
      assert.equal(m.status, status, JSON.stringify([Object.keys(body), m.json]));
    }
    const [[row]] = await connection.query("SELECT COUNT(*) AS n FROM gym_attendance WHERE member_id = ? AND status = 'inside'", [state.member]);
    assert.equal(row.n, 1, "still the one open visit");
  }));

  it("10. scenario: invalid, forged and regenerated codes, and another gym's code", run(async () => {
    const forged = state.qrA.replace(/k=.*/, `k=${"A".repeat(22)}`);
    assert.equal((await checkIn("expired", forged, north(PLACE, 5))).status, 403);
    const otherGymWithOurToken = state.qrA.replace(`b=${state.gymA}`, `b=${state.gymB}`);
    assert.equal((await as("member").post("/api/attendance/scan", { qr: otherGymWithOurToken })).status, 403);

    // Another gym's real code: the member is a member there too, but far from it
    const atB = await checkIn("member", state.qrB, north(PLACE, 5));
    assert.equal(atB.status, 403);
    assert.equal(atB.json.error, att.OUTSIDE, "measured against gym B's location, not A's");
    // …and at B's door, B's code checks in to B (A's open visit is a different membership row)
    const atBdoor = await checkIn("member", state.qrB, north(NEW_PLACE, 5));
    assert.equal(atBdoor.status, 201, JSON.stringify(atBdoor.json));
    const [[bRow]] = await connection.query("SELECT gym_id FROM gym_attendance WHERE member_id = ?", [state.memberAtB]);
    assert.equal(bRow.gym_id, state.gymB);
    // Gym A's admin never sees gym B's visit
    const aHistory = await as("gymA").get("/api/gym/attendance/visits");
    assert.ok(aHistory.json.visits.every((v) => v.memberId !== state.memberAtB));

    // Regenerating voids the printed code at once
    const old = state.qrA;
    const renewed = await as("gymA").post("/api/gym/attendance/qr");
    assert.equal(renewed.json.qr.version, 2);
    state.qrA = renewed.json.qr.payload;
    const stale = await as("member").post("/api/attendance/scan", { qr: old });
    assert.equal(stale.status, 403);
    assert.match(stale.json.error, /no longer valid/);
    assert.equal((await as("member").post("/api/attendance/scan", { qr: state.qrA })).status, 200);
  }));

  it("11. scenario: a wider radius and a new location apply at once", run(async () => {
    // The member is inside at A; check them out first so check-ins can be tried
    await backdate(state.member, 30);
    assert.equal((await checkOut("member", state.qrA, north(PLACE, 10))).status, 200);
    assert.equal((await checkIn("member", state.qrA, north(PLACE, 150))).status, 403, "150 m with 100 m");
    await as("gymA").put("/api/gym/attendance/location", { ...PLACE, radiusM: 200 });
    assert.equal((await checkIn("member", state.qrA, north(PLACE, 150))).status, 201, "150 m with 200 m");
    await backdate(state.member, 5);
    assert.equal((await checkOut("member", state.qrA, north(PLACE, 150))).status, 200);

    const moved = { latitude: 13.35, longitude: 77.11 };
    await as("gymA").put("/api/gym/attendance/location", { ...moved, radiusM: 100 });
    assert.equal((await checkIn("member", state.qrA, north(PLACE, 0))).status, 403, "the old place no longer counts");
    assert.equal((await checkIn("member", state.qrA, north(moved, 20))).status, 201, "the new place does");
  }));

  it("12. staff: check in and out by hand, members and other gyms refused", run(async () => {
    const expiredIn = await as("gymA").post(`/api/gym/members/${state.expired}/check-in`);
    assert.equal(expiredIn.status, 200);
    assert.equal(expiredIn.json.alreadyIn, false);
    assert.equal(expiredIn.json.member.insideNow, true);
    assert.equal((await as("gymA").post(`/api/gym/members/${state.expired}/check-in`)).json.alreadyIn, true);
    await backdate(state.expired, 40);
    const out = await as("gymA").post(`/api/gym/members/${state.expired}/check-out`);
    assert.equal(out.status, 200);
    assert.ok(out.json.durationMin >= 40);
    assert.equal(out.json.member.insideNow, false);
    assert.equal((await as("gymA").post(`/api/gym/members/${state.expired}/check-out`)).status, 409, "not checked in");
    assert.equal((await as("gymB").post(`/api/gym/members/${state.expired}/check-in`)).status, 404, "another gym's member");
    assert.equal((await as("member").post(`/api/gym/members/${state.expired}/check-out`)).status, 403, "members aren't staff");
  }));

  it("13. a visit still open at midnight becomes no check-out and doesn't block the next check-in", run(async () => {
    assert.equal((await as("gymA").post(`/api/gym/members/${state.expired}/check-in`)).status, 200);
    // Opened yesterday (India's day), so midnight has passed; a long visit today is still inside
    await connection.query("UPDATE gym_attendance SET on_date = ?, checked_in_at = NOW() - INTERVAL 13 HOUR WHERE member_id = ? AND status = 'inside'", [rules.addDays(today, -1), state.expired]);
    const summary = await as("gymA").get("/api/gym/attendance");
    assert.equal(summary.json.inside.some((v) => v.memberId === state.expired), false);
    const [[row]] = await connection.query("SELECT COUNT(*) AS n FROM gym_attendance WHERE member_id = ? AND status = 'no_checkout'", [state.expired]);
    assert.equal(row.n, 1);
    // The midnight sweep itself: closes every branch's visits from earlier days, never today's
    const [open] = await connection.query("SELECT COUNT(*) AS n FROM gym_attendance WHERE status = 'inside' AND on_date = ?", [today]);
    assert.ok(open[0].n > 0, "today's open visits exist");
    assert.equal(await attendance.closeOpenVisits(connection, today), 0, "nothing older is open");
    const [stillOpen] = await connection.query("SELECT COUNT(*) AS n FROM gym_attendance WHERE status = 'inside' AND on_date = ?", [today]);
    assert.equal(stillOpen[0].n, open[0].n);
    // Inside is always today's: the history fixes the range to today for that status
    const inside = await as("gymA").get(`/api/gym/attendance/visits?from=${rules.addDays(today, -30)}&status=inside`);
    assert.equal(inside.status, 200);
    assert.deepEqual([inside.json.from, inside.json.to], [today, today]);
    // Renewed, the member scans in: the forgotten visit doesn't block it
    await connection.query("UPDATE gym_members SET expires_on = ? WHERE id = ?", [rules.addDays(today, 30), state.expired]);
    assert.equal((await checkIn("expired", state.qrA, { latitude: 13.35, longitude: 77.11 })).status, 201);
  }));

  it("14. dashboard, history, filters, search and member history", run(async () => {
    const summary = await as("gymA").get("/api/gym/attendance");
    assert.equal(summary.status, 200);
    assert.equal(summary.json.insideNow, 2);
    assert.deepEqual(summary.json.inside.map((v) => v.memberName).sort(), ["Asif Khan", "Old Member"]);
    assert.equal(summary.json.stats.today.members, 2);
    assert.equal(summary.json.stats.today.visits, 6); // the no-check-out visit of 13 is yesterday's
    assert.equal(summary.json.stats.today.completed, 4);
    assert.equal(summary.json.stats.week.visits, 7);
    assert.equal(summary.json.lastSevenDays.length, 7);
    assert.equal(summary.json.lastSevenDays[6].day, today);
    // The Statistics chart follows the period: today by hour, then 7 and 30 days ending today
    const { charts } = summary.json;
    assert.equal(charts.today.reduce((n, h) => n + h.visits, 0), 6, "every check-in today is in an hour bar");
    assert.deepEqual(charts.week, summary.json.lastSevenDays);
    assert.deepEqual([charts.month.length, charts.month[29].day, charts.month[29].visits], [30, today, 6]);
    assert.equal(charts.week[5].visits, 1, "yesterday's bar holds the visit closed at midnight");
    assert.equal(summary.json.stats.month.visits >= summary.json.stats.week.visits, true, "30 days holds the 7");
    assert.deepEqual(summary.json.setup, { location: true, qr: true });

    const all = await as("gymA").get("/api/gym/attendance/visits");
    assert.equal(all.status, 200);
    assert.equal(all.json.total, summary.json.stats.today.visits);
    const completed = await as("gymA").get("/api/gym/attendance/visits?status=completed");
    assert.ok(completed.json.visits.every((v) => v.status === "completed" && v.checkedOutAt && Number.isInteger(v.durationMin)));
    const found = await as("gymA").get(`/api/gym/attendance/visits?search=${encodeURIComponent("Old Mem")}`);
    assert.deepEqual([...new Set(found.json.visits.map((v) => v.memberId))], [state.expired]);
    const mine = await as("gymA").get(`/api/gym/attendance/visits?memberId=${state.member}&from=${rules.addDays(today, -30)}`);
    assert.ok(mine.json.visits.length >= 4 && mine.json.visits.every((v) => v.memberId === state.member));
    // Another gym's member id reads as nothing
    assert.equal((await as("gymA").get(`/api/gym/attendance/visits?memberId=${state.memberAtB}`)).json.total, 0);

    for (const q of ["status=inside'%20OR%20'1'='1", "memberId=1%20OR%201=1", "from=2026-13-01", "sort=id", `from=${today}&to=${rules.addDays(today, -1)}`]) {
      assert.equal((await as("gymA").get(`/api/gym/attendance/visits?${q}`)).status, 400, q);
    }
    const injected = await as("gymA").get(`/api/gym/attendance/visits?search=${encodeURIComponent("' OR 1=1 --")}`);
    assert.equal(injected.status, 200);
    assert.equal(injected.json.total, 0);
    assert.equal((await as("member").get("/api/gym/attendance")).status, 403);

    // The member's own history in the app
    const own = await as("expired").get("/api/attendance");
    assert.equal(own.status, 200);
    assert.deepEqual(own.json.visits.map((v) => v.status), ["inside", "completed", "no_checkout"]);
    assert.ok(own.json.visits.every((v) => v.gym === "Forma Tumkur"));
    assert.deepEqual((await as("gymB").get("/api/gym/attendance/visits")).json.visits.map((v) => v.memberId), [state.memberAtB]);
    assert.equal((await as("stranger").get("/api/attendance")).json.visits.length, 0);
  }));

  it("15. CSV export: the filtered visits, safe cells, staff only", run(async () => {
    const r = await as("gymA").get(`/api/gym/attendance/export?from=${today}&to=${today}`);
    assert.equal(r.status, 200);
    assert.match(r.type, /^text\/csv/);
    const lines = r.text.replace(/^﻿/, "").trim().split("\r\n");
    assert.equal(lines[0], "Date,Member ID,Member,Check-in,Check-out,Duration (min),Status,Checked in by,Distance at check-in (m)");
    assert.equal(lines.length - 1, (await as("gymA").get("/api/gym/attendance/visits")).json.total);
    assert.ok(lines.some((l) => l.includes("Asif Khan") && l.includes("QR scan")));
    assert.ok(lines.some((l) => l.includes("Old Member") && l.includes("Staff")));
    assert.ok(!r.text.includes(identities.member.phone), "no phone numbers");
    assert.equal((await as("gymA").get("/api/gym/attendance/export?from=2020-01-01")).status, 400, "more than a year");
    assert.equal((await as("member").get("/api/gym/attendance/export")).status, 403);
  }));

  it("15b. Excel export: the same visits as an .xlsx, a bad format refused, staff only", run(async () => {
    const response = await fetch(`${server.baseUrl}/api/gym/attendance/export?from=${today}&to=${today}&format=xlsx`, { headers: { Authorization: `Bearer ${tokens.gymA}` } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(response.headers.get("content-disposition"), `attachment; filename="attendance-${today}-to-${today}.xlsx"`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50, "a zip, as every .xlsx is");
    // The sheet is the last part written: inflate it and count its rows against the history
    const zlib = require("node:zlib");
    let at = 0;
    let sheet = "";
    while (bytes.readUInt32LE(at) === 0x04034b50) {
      const size = bytes.readUInt32LE(at + 18);
      const nameLength = bytes.readUInt16LE(at + 26);
      const name = bytes.toString("utf8", at + 30, at + 30 + nameLength);
      const start = at + 30 + nameLength;
      if (name === "xl/worksheets/sheet1.xml") sheet = zlib.inflateRawSync(bytes.subarray(start, start + size)).toString("utf8");
      at = start + size;
    }
    const total = (await as("gymA").get("/api/gym/attendance/visits")).json.total;
    assert.equal((sheet.match(/<row /g) ?? []).length, total + 1, "the header and one row a visit");
    assert.ok(sheet.includes("Asif Khan") && sheet.includes("QR scan"));
    assert.ok(!sheet.includes(identities.member.phone), "no phone numbers");
    assert.equal((await as("gymA").get("/api/gym/attendance/export?format=pdf")).status, 400);
    assert.equal((await as("gymA").get("/api/gym/attendance/export?format=xlsx&from=2020-01-01")).status, 400, "more than a year");
    assert.equal((await as("member").get("/api/gym/attendance/export?format=xlsx")).status, 403);
  }));

  it("16. scans are rate limited per account: the member's budget is used up by now", run(async () => {
    const r = await as("member").post("/api/attendance/scan", { qr: state.qrA });
    assert.equal(r.status, 429);
    assert.equal((await as("stranger").post("/api/attendance/scan", { qr: state.qrA })).status, 403, "another account has its own budget");
  }));
});
