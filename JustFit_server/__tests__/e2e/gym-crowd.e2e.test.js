// Live gym crowd and best time to visit end to end (Gym Hub ecosystem, 2026-11-09): test accounts in
// justfit_test against the real Express server. The gym sets its capacity; members see the live
// estimate at their own gym only, with a forgotten check-out left out; the forecast stays
// "not enough data" until there is history, then follows it. Attack paths: no session, another
// member's membership, Staff without the settings option, bad settings, a settings write from a member.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");
const crowdRules = require("../../gym/crowdRules.js");

describe("gym crowd e2e: a live estimate from real check-ins, a forecast only with history", () => {
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
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["staffA", "user"], ["member", "user"], ["other", "user"]]) {
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
        if (state.gym) {
          const [[{ brand_id: brandId }]] = await connection.query("SELECT brand_id FROM gyms WHERE id = ?", [state.gym]);
          for (const table of ["gym_activity_log", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
          await connection.query("DELETE FROM gyms WHERE id = ?", [state.gym]);
          await connection.query("DELETE FROM gym_brands WHERE id = ?", [brandId]);
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

  it("1. a gym with a member; nothing to show before any check-in", run(async () => {
    const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name: "Forma", branch: "Tumkur", area: "Tumkur", city: "Tumakuru" });
    assert.equal(gym.status, 201, JSON.stringify(gym.json));
    state.gym = gym.json.gym.id;
    assert.equal((await api("POST", `/api/admin/portal/gyms/${state.gym}/staff`, tokens.admin, { phone: identities.gymA.phone })).status, 201);
    const added = await api("POST", "/api/gym/members", tokens.gymA, { name: "Arjun Member", phone: identities.member.phone, unit: "months", duration: 3, fee: 3000, paid: 3000, method: "cash" });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    state.member = added.json.member.id;
    // Fifteen more members, so check-ins can fill the gym
    state.others = [];
    for (let i = 0; i < 15; i += 1) {
      const r = await api("POST", "/api/gym/members", tokens.gymA, { name: `Crowd Person ${i + 1}`, phone: `9${String(100000000 + i * 7919 + Number.parseInt(runId.slice(0, 4), 16)).slice(0, 9)}`, unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash" });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      state.others.push(r.json.member.id);
    }

    for (const token of [null, "jfs_not-a-token"]) assert.equal((await api("GET", `/api/membership/${state.member}/crowd`, token)).status, 401);
    assert.equal((await api("GET", `/api/membership/${state.member}/crowd`, tokens.other)).status, 404, "another member's membership");
    const empty = await api("GET", `/api/membership/${state.member}/crowd`, tokens.member);
    assert.equal(empty.status, 200, JSON.stringify(empty.json));
    assert.equal(empty.json.live.available, false);
    assert.equal(empty.json.live.reason, "no_attendance");
    assert.equal(empty.json.forecast.enough, false);
    assert.equal(empty.json.settings, undefined, "members never see the gym's settings");
  }));

  it("2. the gym sets its capacity; Staff without the settings option and members can't", run(async () => {
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.staffA.phone, kind: "staff" })).status, 201);
    assert.equal((await api("PUT", `/api/gym/staff/${identities.staffA.id}/permissions`, tokens.gymA, { options: ["attendance.view"] })).status, 200);
    assert.equal((await api("PUT", "/api/gym/attendance/crowd-settings", tokens.staffA, { capacity: 20 })).status, 403);
    assert.equal((await api("GET", "/api/gym/attendance/crowd", tokens.staffA)).status, 200, "Staff with Attendance read it");
    assert.equal((await api("PUT", "/api/gym/attendance/crowd-settings", tokens.member, { capacity: 20 })).status, 403);
    for (const bad of [{ capacity: 2 }, { capacity: "20" }, { thresholds: { moderate: 80, busy: 50, veryBusy: 90 } }, { gymId: 1 }, {}]) {
      assert.equal((await api("PUT", "/api/gym/attendance/crowd-settings", tokens.gymA, bad)).status, 400, JSON.stringify(bad));
    }
    const saved = await api("PUT", "/api/gym/attendance/crowd-settings", tokens.gymA, { capacity: 20, avgStayMin: 60 });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.settings.capacity, 20);
    assert.equal(saved.json.stay.source, "gym");
  }));

  it("3. live: real check-ins count, a forgotten one from this morning doesn't", run(async () => {
    const now = Date.now();
    const ids = state.others.slice(0, 15);
    // 14 people in the last 30 minutes, and one still open from 5 hours ago
    for (let i = 0; i < 14; i += 1) {
      await connection.query("INSERT INTO gym_attendance (gym_id, member_id, on_date, checked_in_at, status) VALUES (?, ?, ?, FROM_UNIXTIME(?), 'inside')", [state.gym, ids[i], today, Math.floor((now - (i + 1) * 120000) / 1000)]);
    }
    const morning = Math.max(Math.floor((now - 5 * 3600000) / 1000), Math.floor(crowdRules.indiaMs(today, 0, 5) / 1000));
    await connection.query("INSERT INTO gym_attendance (gym_id, member_id, on_date, checked_in_at, status) VALUES (?, ?, ?, FROM_UNIXTIME(?), 'inside')", [state.gym, ids[14], today, morning]);

    const seen = await api("GET", `/api/membership/${state.member}/crowd`, tokens.member);
    assert.equal(seen.status, 200, JSON.stringify(seen.json));
    const stale = now - morning * 1000 > 120 * 60000;
    assert.equal(seen.json.live.inside, stale ? 14 : 15);
    assert.equal(seen.json.live.capacity, 20);
    assert.equal(seen.json.live.percent, stale ? 70 : 75);
    assert.equal(seen.json.live.level, "busy");
    assert.equal(seen.json.live.kind, "live");
    assert.ok(seen.json.live.updatedAt);
  }));

  it("4. the forecast appears once two weeks of the same weekday are on record", run(async () => {
    for (const back of [7, 14]) {
      const day = rules.addDays(today, -back);
      for (let i = 0; i < 4; i += 1) {
        const inMs = crowdRules.indiaMs(day, 18, 5 * i);
        await connection.query(
          "INSERT INTO gym_attendance (gym_id, member_id, on_date, checked_in_at, checked_out_at, status, duration_min) VALUES (?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), 'completed', 60)",
          [state.gym, state.others[i], day, Math.floor(inMs / 1000), Math.floor((inMs + 3600000) / 1000)],
        );
      }
    }
    const seen = await api("GET", `/api/membership/${state.member}/crowd`, tokens.member);
    assert.equal(seen.json.forecast.enough, true);
    assert.equal(seen.json.forecast.kind, "forecast");
    const six = seen.json.forecast.today.hours.find((h) => h.hour === 18);
    assert.equal(six.expected, 4);
    assert.equal(seen.json.forecast.today.busiest.hour, 18);
    assert.equal(seen.json.forecast.week.length, 7);
  }));
});
