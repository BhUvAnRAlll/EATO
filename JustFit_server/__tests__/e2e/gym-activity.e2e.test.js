// Activity log end to end (2026-11-09): test accounts in justfit_test against the real Express
// server. A justFit admin makes a gym and links the gym admin, who adds a Staff login. The Staff
// login and the gym admin add, edit and delete members, plans, enquiries and expenses; ☰ › Activity
// shows each change with who made it (Staff or the gym admin), the record's name as it was (a
// deleted plan still reads), and what changed (field names; prices and amounts with their values,
// never a phone number).
// Attack paths: no session, a member, Staff and another gym's admin reading the log; refused or
// failed changes never logged; another gym's records never named; SQL and junk in the query.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("gym activity e2e: who added, edited or deleted what", () => {
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
    put: (route, body) => api("PUT", route, tokens[tag], body ?? {}),
    patch: (route, body) => api("PATCH", route, tokens[tag], body ?? {}),
    del: (route) => api("DELETE", route, tokens[tag]),
  });
  const logRows = async (gymId) => (await connection.query("SELECT * FROM gym_activity_log WHERE gym_id = ? ORDER BY id", [gymId]))[0];
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
      for (const [tag, role] of [["admin", "admin"], ["owner", "gym_admin"], ["otherOwner", "gym_admin"], ["staffer", "user"], ["member", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = 'Ravi Kumar' WHERE id = ?", [identities.staffer.id]);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const gymIds = [state.gym, state.other].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_expenses", "gym_enquiries", "gym_catalog_items", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((b) => b.brand_id)]);
        }
        const all = Object.values(identities).map((i) => i.id);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?) OR target_id IN (?)", [all, gymIds.length ? gymIds.map(String) : ["-"]]);
        await connection.query("DELETE FROM auth_sessions WHERE user_id IN (?)", [all]);
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

  it("1. a gym with a gym admin and a Staff login, and another gym", run(async () => {
    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.gym = a.json.gym.id;
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Iron House", branch: "Main", area: "MG Road", city: "Bengaluru" });
    state.other = b.json.gym.id;
    for (const [gym, tag] of [[state.gym, "owner"], [state.other, "otherOwner"]]) {
      assert.equal((await as("admin").post(`/api/admin/portal/gyms/${gym}/staff`, { phone: identities[tag].phone })).status, 201);
    }
    assert.equal((await as("owner").post("/api/gym/staff", { phone: identities.staffer.phone, kind: "staff" })).status, 201);
    const rows = await logRows(state.gym);
    assert.equal(rows.length, 1, "the gym admin's own change is logged too");
    assert.equal(rows[0].actor_id, identities.owner.id);
    assert.equal(rows[0].actor_kind, "owner");
    assert.equal(rows[0].target_type, "team");
    assert.match(rows[0].target_label, /^\+91 ••••• ••\d{3}$/, "a number is masked");
  }));

  it("2. Staff add, edit and delete: each change names who made it and what changed", run(async () => {
    const admitted = await as("staffer").post("/api/gym/members", { name: "Arjun M", phone: "9123456780", unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash" });
    assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
    state.memberId = admitted.json.member.id;
    const code = admitted.json.member.code;
    const edited = await as("staffer").patch(`/api/gym/members/${state.memberId}`, { phone: "9123456789", weightKg: 70 });
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
    const plan = await as("staffer").post("/api/gym/catalog", { kind: "plan", name: "Gold", unit: "months", duration: 3, price: 1500 });
    assert.equal(plan.status, 201, JSON.stringify(plan.json));
    const planId = plan.json.items.find((i) => i.name === "Gold").id;
    assert.equal((await as("staffer").patch(`/api/gym/catalog/${planId}`, { price: 1800 })).status, 200);
    assert.equal((await as("staffer").del(`/api/gym/catalog/${planId}`)).status, 200);
    assert.equal((await as("staffer").post("/api/gym/enquiries", { name: "Sneha R", phone: "9123400001" })).status, 201);

    const rows = (await logRows(state.gym)).slice(1);
    assert.deepEqual(rows.map((r) => [r.action, r.target_type]), [["create", "member"], ["edit", "member"], ["create", "catalog"], ["edit", "catalog"], ["delete", "catalog"], ["create", "enquiry"]]);
    for (const r of rows) {
      assert.equal(r.actor_id, identities.staffer.id);
      assert.equal(r.actor_kind, "staff");
    }
    assert.equal(rows[0].target_label, `Arjun M (${code})`);
    assert.equal(rows[0].detail, "New member · paid ₹1,000 · cash");
    assert.equal(rows[1].detail, "Changed: mobile, weight");
    assert.equal(rows[3].detail, "Changed: price ₹1,500 → ₹1,800");
    assert.equal(rows[4].target_label, "Plan Gold", "a deleted plan still reads");
    assert.equal(rows[4].detail, "Was ₹1,800");
    assert.equal(rows.some((r) => /9123456789|9123456780|9123400001/.test(`${r.target_label} ${r.detail}`)), false, "phone numbers never go into the log");
  }));

  it("3. refused and failed changes are not logged", run(async () => {
    const before = (await logRows(state.gym)).length;
    assert.equal((await as("staffer").patch(`/api/gym/members/${state.memberId}`, { phone: "12" })).status, 400);
    assert.equal((await as("staffer").patch("/api/gym/members/999999", { name: "Nobody" })).status, 404);
    assert.equal((await as("staffer").post("/api/gym/expenses", { category: "rent", amount: 1000, method: "cash", spentOn: today })).status, 201);
    const [[expense]] = await connection.query("SELECT id FROM gym_expenses WHERE gym_id = ?", [state.gym]);
    assert.equal((await as("staffer").del(`/api/gym/expenses/${expense.id}`)).status, 403, "deleting an expense is the gym admin's");
    assert.equal((await as("staffer").post("/api/gym/staff", { phone: identities.member.phone, kind: "staff" })).status, 403);
    const rows = (await logRows(state.gym)).slice(before);
    assert.deepEqual(rows.map((r) => [r.action, r.target_type, r.target_label]), [["create", "expense", "Rent"]], "only the expense that was saved");
    const removed = await as("owner").del(`/api/gym/expenses/${expense.id}`);
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    const last = (await logRows(state.gym)).at(-1);
    assert.deepEqual([last.actor_kind, last.action, last.target_label, last.detail], ["owner", "delete", "Rent", "Was ₹1,000 · cash"]);
  }));

  it("4. only the gym admin reads the log: one day, newest first, with who and filters", run(async () => {
    for (const token of [null, "not-a-token"]) assert.equal((await api("GET", "/api/gym/activity", token)).status, 401);
    for (const tag of ["member", "admin", "staffer"]) assert.equal((await as(tag).get("/api/gym/activity")).status, 403, tag);
    const log = await as("owner").get("/api/gym/activity");
    assert.equal(log.status, 200, JSON.stringify(log.json));
    assert.equal(log.json.day, today);
    assert.equal(log.json.counts.all, 9);
    assert.deepEqual([log.json.counts.create, log.json.counts.edit, log.json.counts.delete], [5, 2, 2]);
    const newest = log.json.entries[0];
    assert.deepEqual([newest.by.name, newest.by.kind, newest.by.you, newest.action, newest.type, newest.label], ["You", "owner", true, "delete", "expense", "Rent"]);
    const ravi = log.json.entries.find((e) => e.by.id === identities.staffer.id);
    assert.deepEqual([ravi.by.name, ravi.by.kind, ravi.by.you], ["Ravi Kumar", "staff", false]);
    assert.deepEqual(log.json.people.map((p) => p.name).sort(), ["Ravi Kumar", "You"]);
    assert.equal(log.json.nextPage, null);

    const deletes = await as("owner").get("/api/gym/activity?action=delete");
    assert.deepEqual(deletes.json.entries.map((e) => e.label), ["Rent", "Plan Gold"]);
    const staffOnly = await as("owner").get(`/api/gym/activity?person=${identities.staffer.id}`);
    assert.equal(staffOnly.json.entries.length, 7);
    assert.ok(staffOnly.json.entries.every((e) => e.by.kind === "staff"));
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    assert.deepEqual((await as("owner").get(`/api/gym/activity?day=${yesterday}`)).json.entries, []);

    for (const query of ["day=2020-01-01", "day=tomorrow", "action=drop", "person=x'%20OR%201%3D1", "page=0", "gymId=1"]) {
      assert.equal((await as("owner").get(`/api/gym/activity?${query}`)).status, 400, query);
    }
    // Another gym's admin sees only their own (empty) log, and can't reach this gym's records
    const other = await as("otherOwner").get("/api/gym/activity");
    assert.equal(other.status, 200);
    assert.equal(other.json.counts.all, 0);
    assert.equal((await as("otherOwner").patch(`/api/gym/members/${state.memberId}`, { name: "Hijack" })).status, 404);
    assert.equal((await logRows(state.other)).length, 0);
  }));

  it("5. rows older than a year are deleted when the log is read", run(async () => {
    await connection.query("INSERT INTO gym_activity_log (gym_id, actor_id, actor_kind, action, target_type, target_label, created_at) VALUES (?, ?, 'staff', 'edit', 'member', 'Old', NOW() - INTERVAL 400 DAY)", [state.gym, identities.staffer.id]);
    assert.equal((await as("owner").get("/api/gym/activity")).status, 200);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM gym_activity_log WHERE gym_id = ? AND target_label = 'Old'", [state.gym]))[0][0].n, 0);
  }));
});
