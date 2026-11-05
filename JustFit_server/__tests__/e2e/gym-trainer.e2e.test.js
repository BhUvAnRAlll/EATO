// Gym trainers and their PT clients end to end (phase 2 of Staff / Admin Login): test accounts in
// justfit_test against the real Express server. A gym admin adds two Trainers and a Staff member
// (another gym adds a third trainer); the PT form and Change trainer give members a trainer; each
// trainer's My Clients lists only their own clients (active, then ended in the last 30 days) with
// no money; a client's page shows their visits; trainers have no AI Coach, Workout or Fitness.
// Attack paths: no session, members and gym admins on the trainer routes, another trainer's or
// another gym's client ids, a trainer from another gym or a non-trainer on a PT payment, SQL in
// ids, unexpected fields, a stale pt_trainer_id after the trainer left the branch, and refused PT
// payments that write nothing.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("gym trainer e2e: PT trainers, My Clients and no AI Coach or Fitness", () => {
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
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const as = (tag) => ({
    get: (route) => api("GET", route, tokens[tag]),
    post: (route, body) => api("POST", route, tokens[tag], body ?? {}),
    del: (route) => api("DELETE", route, tokens[tag]),
  });
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const trainerOf = async (memberId) => (await connection.query("SELECT pt_trainer_id FROM gym_members WHERE id = ?", [memberId]))[0][0].pt_trainer_id;
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const admit = async (tag, name, phone) => {
    const r = await as(tag).post("/api/gym/members", { name, phone, unit: "months", duration: 3, fee: 3000, paid: 3000, method: "cash" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.member.id;
  };
  const pt = (memberId, extra = {}) => ({ package: "1 Month PT", amount: 2500, method: "online", unit: "months", duration: 1, ...extra });

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["owner", "gym_admin"], ["otherOwner", "gym_admin"], ["ravi", "user"], ["meena", "user"], ["far", "user"], ["staffer", "user"], ["member", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = 'Ravi Kumar' WHERE id = ?", [identities.ravi.id]);
    await connection.query("UPDATE users SET full_name = 'Meena S' WHERE id = ?", [identities.meena.id]);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const gymIds = [state.tumkur, state.other].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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

  it("1. two gyms; the gym admin adds two Trainers and Staff; the other gym adds its own trainer", run(async () => {
    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    state.tumkur = a.json.gym.id;
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Iron House", branch: "Main", area: "MG Road", city: "Bengaluru" });
    state.other = b.json.gym.id;
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.tumkur}/staff`, { phone: identities.owner.phone })).status, 201);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.other}/staff`, { phone: identities.otherOwner.phone })).status, 201);
    for (const [tag, kind] of [["ravi", "trainer"], ["meena", "trainer"], ["staffer", "staff"]]) {
      assert.equal((await as("owner").post("/api/gym/staff", { phone: identities[tag].phone, kind })).status, 201, tag);
    }
    assert.equal((await as("otherOwner").post("/api/gym/staff", { phone: identities.far.phone, kind: "trainer" })).status, 201);

    const trainers = await as("owner").get("/api/gym/trainers");
    assert.equal(trainers.status, 200, JSON.stringify(trainers.json));
    assert.deepEqual(trainers.json.trainers, [{ id: identities.meena.id, name: "Meena S" }, { id: identities.ravi.id, name: "Ravi Kumar" }]);
    assert.equal((await as("staffer").get("/api/gym/trainers")).json.trainers.length, 2, "Staff see the trainers too (they sell PT)");
    assert.equal((await as("ravi").get("/api/gym/trainers")).status, 403, "a trainer isn't gym staff");
  }));

  it("2. the PT form gives a member a trainer; a trainer from elsewhere or a non-trainer is refused and nothing is saved", run(async () => {
    state.arjun = await admit("owner", "Arjun M", "9123456780");
    state.sneha = await admit("owner", "Sneha R", "9123456781");
    state.kiran = await admit("owner", "Kiran P", "9123456782");
    state.old = await admit("owner", "Old Client", "9123456783");
    state.farClient = await admit("otherOwner", "Far Away", "9123456784");

    const paid = await as("owner").post(`/api/gym/members/${state.arjun}/pt`, pt(state.arjun, { trainerId: identities.ravi.id }));
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    assert.deepEqual(paid.json.member.pt.trainer, { id: identities.ravi.id, name: "Ravi Kumar" });
    assert.equal((await as("staffer").post(`/api/gym/members/${state.sneha}/pt`, pt(state.sneha, { trainerId: identities.meena.id }))).status, 200, "Staff can sell PT with a trainer");

    const payments = await count("gym_payments", "gym_id = ?", [state.tumkur]);
    for (const trainerId of [identities.far.id, identities.owner.id, identities.staffer.id, identities.member.id, "user_nobody", "x' OR '1'='1", 7]) {
      const r = await as("owner").post(`/api/gym/members/${state.kiran}/pt`, pt(state.kiran, { trainerId }));
      assert.equal(r.status, 400, `${trainerId} → ${JSON.stringify(r.json)}`);
    }
    assert.equal(await count("gym_payments", "gym_id = ?", [state.tumkur]), payments, "a refused PT payment writes nothing");
    assert.equal(await trainerOf(state.kiran), null);

    // Left out: a renewal keeps the trainer
    assert.equal((await as("owner").post(`/api/gym/members/${state.arjun}/pt`, pt(state.arjun))).status, 200);
    assert.equal(await trainerOf(state.arjun), identities.ravi.id);
  }));

  it("3. Change trainer: this branch's trainers or none; not another gym's member", run(async () => {
    for (const id of [state.kiran, state.old]) assert.equal((await as("owner").post(`/api/gym/members/${id}/pt`, pt(id, { trainerId: identities.ravi.id }))).status, 200);
    // Kiran's PT ended 10 days ago (still shown), the old client's 40 days ago (no longer shown)
    await connection.query("UPDATE gym_members SET pt_from = CURDATE() - INTERVAL 40 DAY, pt_until = ? WHERE id = ?", [rules.addDays(today, -10), state.kiran]);
    await connection.query("UPDATE gym_members SET pt_from = CURDATE() - INTERVAL 70 DAY, pt_until = ? WHERE id = ?", [rules.addDays(today, -40), state.old]);

    const changed = await as("owner").post(`/api/gym/members/${state.sneha}/trainer`, { trainerId: identities.ravi.id });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.equal(changed.json.member.pt.trainer.name, "Ravi Kumar");
    assert.equal((await as("owner").post(`/api/gym/members/${state.sneha}/trainer`, { trainerId: identities.meena.id })).status, 200, "back to Meena");
    assert.equal((await as("owner").post(`/api/gym/members/${state.sneha}/trainer`, { trainerId: identities.far.id })).status, 400);
    assert.equal((await as("owner").post(`/api/gym/members/${state.sneha}/trainer`, { trainerId: identities.meena.id, gymId: state.other })).status, 400);
    assert.equal((await as("owner").post(`/api/gym/members/${state.farClient}/trainer`, { trainerId: identities.meena.id })).status, 404, "another gym's member");
    assert.equal(await trainerOf(state.farClient), null);
    assert.equal(await trainerOf(state.sneha), identities.meena.id);
  }));

  it("4. My Clients: only the trainer's own, active first, then ended in the last 30 days, with no money", run(async () => {
    for (const token of [null, "not-a-token"]) assert.equal((await api("GET", "/api/trainer/clients", token)).status, 401);
    for (const tag of ["member", "owner", "staffer", "admin"]) assert.equal((await as(tag).get("/api/trainer/clients")).status, 403, `${tag} has no clients`);

    const ravi = await as("ravi").get("/api/trainer/clients");
    assert.equal(ravi.status, 200, JSON.stringify(ravi.json));
    assert.equal(ravi.json.gym, "Forma");
    assert.deepEqual(ravi.json.branches, ["Tumkur"]);
    assert.deepEqual(ravi.json.clients.map((c) => c.name), ["Arjun M", "Kiran P"], "not Meena's client, not PT ended 40 days ago");
    const [arjun, kiran] = ravi.json.clients;
    assert.equal(arjun.pt.active, true);
    assert.equal(arjun.phone, "+919123456780");
    assert.equal(kiran.pt.active, false);
    assert.equal(kiran.pt.daysLeft, -10);
    for (const c of ravi.json.clients) for (const key of ["due", "fee", "amount", "payments", "dueBy", "notes"]) assert.equal(key in c, false, `${c.name} has no ${key}`);

    assert.deepEqual((await as("meena").get("/api/trainer/clients")).json.clients.map((c) => c.name), ["Sneha R"]);
    assert.deepEqual((await as("far").get("/api/trainer/clients")).json.clients, []);
  }));

  it("5. a client's page: their PT and visits; never someone else's client", run(async () => {
    assert.equal((await as("owner").post(`/api/gym/members/${state.arjun}/check-in`)).status, 200);
    const page = await as("ravi").get(`/api/trainer/clients/${state.arjun}`);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.equal(page.json.client.name, "Arjun M");
    assert.equal(page.json.client.inToday, true);
    assert.equal(page.json.visits.length, 1);
    assert.equal(page.json.visits[0].onDate, today);
    assert.equal("payments" in page.json, false);

    for (const id of [state.sneha, state.old, state.farClient, 999999]) assert.equal((await as("ravi").get(`/api/trainer/clients/${id}`)).status, 404, `client ${id}`);
    assert.equal((await as("ravi").get(`/api/trainer/clients/${state.sneha}/photo`)).status, 404);
    for (const bad of ["abc", "1%20OR%201%3D1", "0"]) assert.equal((await as("ravi").get(`/api/trainer/clients/${bad}`)).status, 400, bad);
    assert.equal((await as("member").get(`/api/trainer/clients/${state.arjun}`)).status, 403);
  }));

  it("6. trainers have no AI Coach, Workout or Fitness; members still do", run(async () => {
    for (const route of ["/api/coach/intake", "/api/coach/plan", "/api/workout/home", "/api/workout/activity", "/api/fitness/programs"]) {
      const r = await as("ravi").get(route);
      assert.equal(r.status, 403, `${route} → ${JSON.stringify(r.json)}`);
      assert.match(r.json.error, /trainer/);
      assert.notEqual((await as("member").get(route)).status, 403, `${route} for a member`);
    }
    assert.notEqual((await as("ravi").get(`/api/macro/day?date=${today}`)).status, 403, "Macro stays");
  }));

  it("7. a trainer who leaves the branch sees none of its members, even with a stale trainer link", run(async () => {
    // Removing clears the members' trainer (phase 1); a link left behind by hand still shows nothing
    assert.equal((await as("owner").del(`/api/gym/staff/${identities.ravi.id}`)).status, 200);
    assert.equal(await trainerOf(state.arjun), null);
    await connection.query("UPDATE gym_members SET pt_trainer_id = ? WHERE id = ?", [identities.ravi.id, state.arjun]);
    assert.equal((await as("ravi").get("/api/trainer/clients")).status, 403, "a member again: no trainer routes");
    await connection.query("UPDATE users SET role = 'trainer' WHERE id = ?", [identities.ravi.id]);
    const list = await as("ravi").get("/api/trainer/clients");
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.clients, [], "no branch as a trainer: nobody");
    assert.equal((await as("ravi").get(`/api/trainer/clients/${state.arjun}`)).status, 404);
    await connection.query("UPDATE users SET role = 'user' WHERE id = ?", [identities.ravi.id]);
  }));
});
