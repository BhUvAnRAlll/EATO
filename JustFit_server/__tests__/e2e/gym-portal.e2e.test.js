// The gym admin portal end to end, with the Super Admin's Gyms: test accounts in justfit_test
// against the real Express server. A justFit admin creates two gyms and links a gym admin to
// each; each gym admin records admissions, renewals, due payments, sales, enquiries and check-ins
// and reads them back on Home, Members, Transactions and Wallet; the admin sees the same numbers.
// Attack paths: no session, members and admins on gym routes, a gym admin with no gym, another
// gym's member ids, unexpected fields (a gym id in the body), SQL in a search, overpaying a due,
// a duplicate phone, and failed writes leaving nothing behind.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("gym portal e2e: gyms, staff, members, money and attendance", () => {
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
    patch: (route, body) => api("PATCH", route, tokens[tag], body),
    del: (route) => api("DELETE", route, tokens[tag]),
  });
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
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
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["loner", "gym_admin"], ["member", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = 'Arjun Kumar' WHERE id = ?", [identities.gymA.id]);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const gymIds = [state.gymA, state.gymB].filter(Boolean);
        if (gymIds.length) {
          for (const table of ["gym_attendance", "gym_payments", "gym_enquiries", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
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

  it("1. only justFit admins manage gyms; they create two and link a gym admin to each", run(async () => {
    for (const token of [null, "not-a-token"]) assert.equal((await api("GET", "/api/admin/portal/gyms", token)).status, 401);
    for (const tag of ["gymA", "member"]) assert.equal((await as(tag).get("/api/admin/portal/gyms")).status, 403, `${tag} is refused`);

    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Just Fit Anna Nagar", area: "Anna Nagar", city: "Chennai" });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.gymA = a.json.gym.id;
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Just Fit Indiranagar", area: "Indiranagar", city: "Bengaluru" });
    state.gymB = b.json.gym.id;
    assert.equal((await as("admin").post("/api/admin/portal/gyms", { name: "No city", area: "Somewhere" })).status, 400);
    assert.equal((await as("admin").post("/api/admin/portal/gyms", { name: "X Gym", area: "A", city: "B", created_by: "me" })).status, 400);

    // Linking: by sign-in number, only gym_admin accounts, one gym each
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.member.phone })).status, 400, "a member account isn't a gym admin");
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: "6000000000" })).status, 404, "no such account");
    const linked = await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.gymA.phone });
    assert.equal(linked.status, 201, JSON.stringify(linked.json));
    assert.deepEqual(linked.json.staff.map((s) => s.name), ["Arjun Kumar"]);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/staff`, { phone: identities.gymA.phone })).status, 409, "already at another gym");
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/staff`, { phone: identities.gymB.phone })).status, 201);
    assert.equal((await as("admin").get("/api/admin/portal/gyms/999999")).status, 404);
    assert.equal((await as("admin").get("/api/admin/portal/gyms/1%20OR%201=1")).status, 400);
    assert.equal(await count("admin_audit_log", "admin_id = ? AND action IN ('gym.create', 'gym.staff_add')", [identities.admin.id]), 4);
  }));

  it("2. gym routes: a session, the gym_admin role and a linked gym, read from the database", run(async () => {
    assert.equal((await api("GET", "/api/gym/dashboard", null)).status, 401);
    for (const tag of ["member", "admin"]) assert.equal((await as(tag).get("/api/gym/dashboard")).status, 403, `${tag} is refused`);
    const loner = await as("loner").get("/api/gym/dashboard");
    assert.equal(loner.status, 403);
    assert.match(loner.json.error, /isn't linked to a gym/);
    const empty = await as("gymA").get("/api/gym/dashboard");
    assert.equal(empty.status, 200, JSON.stringify(empty.json));
    assert.deepEqual(empty.json.gym, { name: "Just Fit Anna Nagar", area: "Anna Nagar", city: "Chennai" });
    assert.deepEqual(empty.json.revenue, { online: 0, cash: 0 });
    assert.deepEqual(empty.json.recent, []);
  }));

  it("3. an admission: the member and the payment in one go; refused ones write nothing", run(async () => {
    const gym = as("gymA");
    const r = await gym.post("/api/gym/members", { name: "Mohammed Asif", phone: "98765 43210", months: 3, fee: 4500, paid: 3000, method: "online" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    state.asif = r.json.member.id;
    assert.equal(r.json.member.phone, "+919876543210");
    assert.equal(r.json.member.due, 1500);
    assert.equal(r.json.member.joinedOn, today);
    assert.equal(r.json.member.expiresOn, rules.planEnd(today, 3));
    assert.deepEqual(r.json.payments.map((p) => [p.kind, p.amount, p.method, p.detail]), [["admission", 3000, "online", "3 Months"]]);

    const before = await count("gym_members", "gym_id = ?", [state.gymA]);
    assert.equal((await gym.post("/api/gym/members", { name: "Copy", phone: "9876543210", months: 1, fee: 1000, paid: 1000, method: "cash" })).status, 409, "same phone at the same gym");
    assert.equal((await gym.post("/api/gym/members", { name: "Ravi", months: 1, fee: 1000, paid: 1500, method: "cash" })).status, 400);
    assert.equal((await gym.post("/api/gym/members", { name: "Ravi", months: 1, fee: 1000, paid: 1000, method: "cash", gymId: state.gymB })).status, 400, "no gym id from the body");
    assert.equal(await count("gym_members", "gym_id = ?", [state.gymA]), before);
    assert.equal(await count("gym_payments", "gym_id = ?", [state.gymA]), 1, "the refused admissions left no payment");

    // The same phone is fine at another gym
    const other = await as("gymB").post("/api/gym/members", { name: "Asif at B", phone: "9876543210", months: 1, fee: 1200, paid: 1200, method: "cash" });
    assert.equal(other.status, 201);
    state.bMember = other.json.member.id;
  }));

  it("4. renewals, due payments, sales, enquiries and check-ins", run(async () => {
    const gym = as("gymA");
    const renewed = await gym.post(`/api/gym/members/${state.asif}/renew`, { months: 1, fee: 1500, paid: 1000, method: "cash" });
    assert.equal(renewed.status, 200, JSON.stringify(renewed.json));
    assert.equal(renewed.json.member.due, 2000, "1500 still owed plus 500 from the renewal");
    assert.equal(renewed.json.member.expiresOn, rules.renewedUntil(rules.planEnd(today, 3), today, 1));

    assert.equal((await gym.post(`/api/gym/members/${state.asif}/due`, { amount: 5000, method: "online" })).status, 400, "more than they owe");
    const paid = await gym.post(`/api/gym/members/${state.asif}/due`, { amount: 2000, method: "online" });
    assert.equal(paid.json.member.due, 0);
    assert.equal((await gym.post(`/api/gym/members/${state.asif}/due`, { amount: 1, method: "online" })).status, 400, "nothing left to pay");

    const sold = await gym.post("/api/gym/sales", { item: "Whey Protein 1kg", category: "supplement", amount: 3200, method: "cash" });
    assert.equal(sold.status, 201);
    assert.deepEqual([sold.json.payment.title, sold.json.payment.detail, sold.json.payment.memberId], ["Whey Protein 1kg", "Supplement Sale", null]);

    assert.equal((await gym.post("/api/gym/enquiries", { name: "Priya", phone: "9123456780", note: "Evening batch?" })).status, 201);

    const first = await gym.post(`/api/gym/members/${state.asif}/check-in`);
    assert.equal(first.json.alreadyIn, false);
    assert.equal(first.json.member.inToday, true);
    assert.equal((await gym.post(`/api/gym/members/${state.asif}/check-in`)).json.alreadyIn, true, "once a day");
    assert.equal(await count("gym_attendance", "member_id = ?", [state.asif]), 1);

    const edited = await gym.patch(`/api/gym/members/${state.asif}`, { name: "Mohammed Asif K" });
    assert.equal(edited.json.member.name, "Mohammed Asif K");
  }));

  it("5. another gym's members can't be read or changed", run(async () => {
    const gym = as("gymA");
    for (const [method, route, body] of [
      ["GET", `/api/gym/members/${state.bMember}`],
      ["PATCH", `/api/gym/members/${state.bMember}`, { name: "Taken" }],
      ["POST", `/api/gym/members/${state.bMember}/renew`, { months: 1, fee: 100, paid: 100, method: "cash" }],
      ["POST", `/api/gym/members/${state.bMember}/due`, { amount: 1, method: "cash" }],
      ["POST", `/api/gym/members/${state.bMember}/check-in`],
    ]) {
      const r = await api(method, route, tokens.gymA, body);
      assert.equal(r.status, 404, `${method} ${route}`);
    }
    assert.equal(await count("gym_payments", "gym_id = ?", [state.gymB]), 1, "gym B's money is untouched");
    assert.equal(await count("gym_attendance", "gym_id = ?", [state.gymB]), 0);
    assert.equal((await gym.get("/api/gym/members/abc")).status, 400);
  }));

  it("6. Home, Members, Transactions and Wallet show what was recorded", run(async () => {
    const gym = as("gymA");
    const home = (await gym.get("/api/gym/dashboard")).json;
    assert.deepEqual(home.revenue, { online: 3000 + 2000, cash: 1000 + 3200 });
    assert.deepEqual(home.stats, { admission: 1, renewal: 1, enquiry: 1, duePaid: 1 });
    assert.deepEqual(home.alerts, { dueMembers: 0, expiringToday: 0, attendance: 1 });
    assert.deepEqual(home.recent.map((p) => p.kind), ["sale", "due", "renewal", "admission"]);

    const list = async (query) => (await gym.get(`/api/gym/members${query}`)).json.members.map((m) => m.id);
    assert.deepEqual(await list(""), [state.asif], "only this gym's members");
    assert.deepEqual(await list("?filter=in_today"), [state.asif]);
    assert.deepEqual(await list("?filter=due"), []);
    assert.deepEqual(await list("?search=asif"), [state.asif]);
    assert.deepEqual(await list("?search=98765"), [state.asif], "by phone");
    assert.deepEqual(await list(`?search=${encodeURIComponent("%' OR 1=1 --")}`), [], "SQL and wildcards are just text");
    assert.equal((await gym.get("/api/gym/members?filter=everyone")).status, 400);

    const sales = (await gym.get("/api/gym/payments?kind=sale")).json;
    assert.deepEqual(sales.payments.map((p) => p.title), ["Whey Protein 1kg"]);
    assert.equal(sales.nextBefore, null);
    assert.equal((await gym.get("/api/gym/enquiries")).json.enquiries[0].name, "Priya");

    const wallet = (await gym.get("/api/gym/wallet")).json;
    assert.deepEqual(wallet.today, { online: 5000, cash: 4200, total: 9200, byKind: { admission: 3000, renewal: 1000, due: 2000, sale: 3200 } });
    assert.deepEqual(wallet.owed, { total: 0, members: 0 });
  }));

  it("7. the justFit admin sees each gym's numbers and staff, and can unlink and edit", run(async () => {
    const list = (await as("admin").get("/api/admin/portal/gyms")).json.gyms;
    const a = list.find((g) => g.id === state.gymA);
    assert.deepEqual([a.staff, a.members, a.active, a.revenueToday, a.attendanceToday], [1, 1, 1, 9200, 1]);
    const detail = (await as("admin").get(`/api/admin/portal/gyms/${state.gymA}`)).json;
    assert.equal(detail.stats.todayOnline + detail.stats.todayCash, 9200);
    assert.equal(detail.stats.enquiriesMonth, 1);
    assert.equal(detail.recent.length, 4);
    const overview = (await as("admin").get("/api/admin/portal/overview")).json;
    assert.ok(overview.gyms.gyms >= 2);
    assert.ok(overview.gyms.gymRevenueToday >= 9200 + 1200);

    const edited = await as("admin").patch(`/api/admin/portal/gyms/${state.gymB}`, { city: "Bangalore" });
    assert.equal(edited.json.gym.city, "Bangalore");
    const removed = await as("admin").del(`/api/admin/portal/gyms/${state.gymB}/staff/${identities.gymB.id}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.json.staff, []);
    assert.equal((await as("gymB").get("/api/gym/dashboard")).status, 403, "unlinked: no gym any more");
    assert.equal((await as("admin").del(`/api/admin/portal/gyms/${state.gymB}/staff/${identities.gymB.id}`)).status, 404);
  }));

  it("8. a demoted gym admin loses the portal at once", run(async () => {
    await connection.query("UPDATE users SET role = 'user' WHERE id = ?", [identities.gymA.id]);
    assert.equal((await as("gymA").get("/api/gym/dashboard")).status, 403);
    await connection.query("UPDATE users SET role = 'gym_admin' WHERE id = ?", [identities.gymA.id]);
    assert.equal((await as("gymA").get("/api/gym/dashboard")).status, 200);
  }));
});
