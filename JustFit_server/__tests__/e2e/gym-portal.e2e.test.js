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
        const gymIds = [state.gymA, state.gymA2, state.gymB].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_attendance", "gym_payments", "gym_enquiries", "gym_catalog_items", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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

  it("1. only justFit admins manage gyms; they create two and link a gym admin to each", run(async () => {
    for (const token of [null, "not-a-token"]) assert.equal((await api("GET", "/api/admin/portal/gyms", token)).status, 401);
    for (const tag of ["gymA", "member"]) assert.equal((await as(tag).get("/api/admin/portal/gyms")).status, 403, `${tag} is refused`);

    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.gymA = a.json.gym.id;
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Just Fit", branch: "Indiranagar", area: "Indiranagar", city: "Bengaluru" });
    state.gymB = b.json.gym.id;
    assert.equal((await as("admin").post("/api/admin/portal/gyms", { name: "No city", branch: "Main", area: "Somewhere" })).status, 400);
    assert.equal((await as("admin").post("/api/admin/portal/gyms", { name: "X Gym", branch: "Main", area: "Area", city: "City", created_by: "me" })).status, 400);

    // Linking: by sign-in number, only gym_admin accounts, one gym each
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.member.phone })).status, 400, "a member account isn't a gym admin");
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: "6000000000" })).status, 404, "no such account");
    const linked = await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.gymA.phone });
    assert.equal(linked.status, 201, JSON.stringify(linked.json));
    assert.deepEqual(linked.json.staff.map((s) => s.name), ["Arjun Kumar"]);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/staff`, { phone: identities.gymA.phone })).status, 409, "already at another gym");
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.gymA.phone })).status, 409, "already at this branch");
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
    assert.deepEqual(empty.json.gym, { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru", branchCount: 1 });
    assert.deepEqual(empty.json.revenue, { online: 0, cash: 0 });
    assert.deepEqual(empty.json.recent, []);
  }));

  it("3. an admission: the member and the payment in one go; refused ones write nothing", run(async () => {
    const gym = as("gymA");
    assert.equal((await gym.post("/api/gym/members", { name: "Mohammed Asif", phone: "98765 43210", unit: "months", duration: 3, fee: 4500, paid: 3000, method: "online" })).status, 400, "something owed needs a due date");
    const r = await gym.post("/api/gym/members", { name: "Mohammed Asif", phone: "98765 43210", unit: "months", duration: 3, fee: 4500, paid: 3000, method: "online", dueBy: rules.addDays(today, 7) });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    state.asif = r.json.member.id;
    assert.equal(r.json.member.code, "FOR-TUM-0001", "the first member's ID: gym, branch, number");
    assert.equal(r.json.member.phone, "+919876543210");
    assert.equal(r.json.member.due, 1500);
    assert.equal(r.json.member.dueBy, rules.addDays(today, 7));
    assert.equal(r.json.member.overdue, false);
    assert.equal(r.json.member.joinedOn, today);
    assert.equal(r.json.member.expiresOn, rules.planEnd(today, 3));
    assert.deepEqual(r.json.payments.map((p) => [p.kind, p.amount, p.method, p.detail]), [["admission", 3000, "online", "3 Months"]]);

    const before = await count("gym_members", "gym_id = ?", [state.gymA]);
    assert.equal((await gym.post("/api/gym/members", { name: "Copy", phone: "9876543210", unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash" })).status, 409, "same phone at the same gym");
    assert.equal((await gym.post("/api/gym/members", { name: "Ravi", unit: "months", duration: 1, fee: 1000, paid: 1500, method: "cash" })).status, 400);
    assert.equal((await gym.post("/api/gym/members", { name: "Ravi", unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash", gymId: state.gymB })).status, 400, "no gym id from the body");
    assert.equal(await count("gym_members", "gym_id = ?", [state.gymA]), before);
    assert.equal(await count("gym_payments", "gym_id = ?", [state.gymA]), 1, "the refused admissions left no payment");

    // The same phone is fine at another gym
    const other = await as("gymB").post("/api/gym/members", { name: "Asif at B", phone: "9876543210", unit: "months", duration: 1, fee: 1200, paid: 1200, method: "cash" });
    assert.equal(other.status, 201);
    state.bMember = other.json.member.id;
    assert.equal(other.json.member.code, "JUS-IND-0001");
  }));

  it("3b. member IDs: previewed, then made by the server, unique even when saved at once", run(async () => {
    const gym = as("gymA");
    assert.deepEqual((await gym.get("/api/gym/members/next-code")).json, { code: "FOR-TUM-0002" });
    // Five admissions at the same moment: five different IDs, the counter moves by five
    const saves = await Promise.all([1, 2, 3, 4, 5].map((n) => gym.post("/api/gym/members", { name: `Batch Member ${n}`, gender: "male", unit: "months", duration: 1, fee: 100, paid: 100, method: "cash" })));
    assert.ok(saves.every((r) => r.status === 201), JSON.stringify(saves.map((r) => r.status)));
    const codes = saves.map((r) => r.json.member.code).sort();
    assert.deepEqual(codes, ["FOR-TUM-0002", "FOR-TUM-0003", "FOR-TUM-0004", "FOR-TUM-0005", "FOR-TUM-0006"]);
    assert.equal(saves[0].json.member.gender, "male");
    assert.equal("batch" in saves[0].json.member, false, "no batch");
    assert.deepEqual((await gym.get("/api/gym/members/next-code")).json, { code: "FOR-TUM-0007" });
    assert.equal((await gym.post("/api/gym/members", { name: "Sneaky", code: "FOR-TUM-0001", unit: "months", duration: 1, fee: 100, paid: 100, method: "cash" })).status, 400, "the app can't choose an ID");
    assert.equal((await gym.post("/api/gym/members", { name: "Has batch", batch: "evening", unit: "months", duration: 1, fee: 100, paid: 100, method: "cash" })).status, 400);
    // Search by ID
    assert.deepEqual((await gym.get("/api/gym/members?search=FOR-TUM-0001")).json.members.map((m) => m.id), [state.asif]);
    // Another gym counts on its own
    assert.equal((await as("gymB").get("/api/gym/members/next-code")).json.code, "JUS-IND-0002");
    // These five members aren't needed by the later tests
    const ids = saves.map((r) => r.json.member.id);
    await connection.query("DELETE FROM gym_payments WHERE member_id IN (?)", [ids]);
    await connection.query("DELETE FROM gym_members WHERE id IN (?)", [ids]);
  }));

  it("4. renewals, due payments, sales, enquiries and check-ins", run(async () => {
    const gym = as("gymA");
    const renewed = await gym.post(`/api/gym/members/${state.asif}/renew`, { unit: "months", duration: 1, fee: 1500, paid: 1000, method: "cash", dueBy: rules.addDays(today, 14) });
    assert.equal(renewed.status, 200, JSON.stringify(renewed.json));
    assert.equal(renewed.json.member.due, 2000, "1500 still owed plus 500 from the renewal");
    assert.equal(renewed.json.member.dueBy, rules.addDays(today, 14), "the new amount owed takes the new date");

    // Past the date: overdue, and on the Overdue filter
    await connection.query("UPDATE gym_members SET due_by = ? WHERE id = ?", [rules.addDays(today, -1), state.asif]);
    assert.equal((await gym.get(`/api/gym/members/${state.asif}`)).json.member.overdue, true);
    assert.deepEqual((await gym.get("/api/gym/members?filter=overdue")).json.members.map((m) => m.id), [state.asif]);
    // A part payment can set a new date for the rest
    const part = await gym.post(`/api/gym/members/${state.asif}/due`, { amount: 500, method: "cash", dueBy: rules.addDays(today, 5), paidOn: today });
    assert.deepEqual([part.json.member.due, part.json.member.dueBy, part.json.member.overdue], [1500, rules.addDays(today, 5), false]);
    assert.equal((await gym.post(`/api/gym/members/${state.asif}/due`, { amount: 100, method: "cash", dueBy: rules.addDays(today, -3) })).status, 400, "not a past date");
    assert.equal(renewed.json.member.expiresOn, rules.renewedUntil(rules.planEnd(today, 3), today, 1));

    assert.equal((await gym.post(`/api/gym/members/${state.asif}/due`, { amount: 5000, method: "online" })).status, 400, "more than they owe");
    const paid = await gym.post(`/api/gym/members/${state.asif}/due`, { amount: 1500, method: "online" });
    assert.equal(paid.json.member.due, 0);
    assert.equal(paid.json.member.dueBy, null, "paid in full: the date goes");
    assert.equal((await gym.post(`/api/gym/members/${state.asif}/due`, { amount: 1, method: "online" })).status, 400, "nothing left to pay");

    const sold = await gym.post("/api/gym/sales", { item: "Whey Protein 1kg", category: "supplement", amount: 3200, method: "cash" });
    assert.equal(sold.status, 201);
    assert.deepEqual([sold.json.payment.title, sold.json.payment.detail, sold.json.payment.memberId], ["Whey Protein 1kg", "Supplement", null]);

    const pt = await gym.post(`/api/gym/members/${state.asif}/pt`, { package: "12 sessions", amount: 6000, method: "online", unit: "months", duration: 1 });
    assert.equal(pt.status, 200, JSON.stringify(pt.json));
    assert.deepEqual([pt.json.payments[0].kind, pt.json.payments[0].detail, pt.json.payments[0].amount], ["pt", "PT · 12 sessions", 6000]);
    assert.deepEqual(pt.json.member.pt, { label: "12 sessions", from: today, until: rules.planEnd(today, 1), active: true }, "the PT period");
    const again = await gym.post(`/api/gym/members/${state.asif}/pt`, { package: "8 sessions", amount: 1, method: "cash", unit: "days", duration: 10 });
    assert.deepEqual([again.json.member.pt.label, again.json.member.pt.from, again.json.member.pt.until], ["8 sessions", rules.addDays(rules.planEnd(today, 1), 1), rules.addDays(rules.planEnd(today, 1), 10)], "a renewal follows on from the running period");
    await connection.query("DELETE FROM gym_payments WHERE member_id = ? AND amount = 1 AND kind = 'pt'", [state.asif]);
    assert.equal(typeof pt.json.member.daysLeft, "number");
    assert.equal((await gym.post(`/api/gym/members/${state.asif}/pt`, { package: "", amount: 6000, method: "online", unit: "months", duration: 1 })).status, 400);
    assert.equal((await gym.post(`/api/gym/members/${state.bMember}/pt`, { package: "12 sessions", amount: 6000, method: "online", unit: "months", duration: 1 })).status, 404, "another gym's member");

    // Birthdays and plans ending in the next 1-3 days
    const born = `1995-${today.slice(5)}`;
    const bday = await gym.post("/api/gym/members", { name: "Kavya", dob: born, unit: "months", duration: 1, fee: 1500, paid: 1500, method: "cash" });
    assert.equal(bday.status, 201, JSON.stringify(bday.json));
    state.kavya = bday.json.member.id;
    assert.equal(bday.json.member.dob, born);
    assert.equal(bday.json.member.birthdayToday, true);
    await connection.query("UPDATE gym_members SET expires_on = ? WHERE id = ?", [rules.addDays(today, 2), state.kavya]);
    for (const dob of ["2999-01-01", "1995-02-30", "15-08-1995", "1900-01-01"]) {
      assert.equal((await gym.post("/api/gym/members", { name: "Bad Date", dob, unit: "months", duration: 1, fee: 100, paid: 100, method: "cash" })).status, 400, dob);
    }
    assert.equal((await gym.patch(`/api/gym/members/${state.kavya}`, { dob: "" })).json.member.dob, null, "removed");
    await gym.patch(`/api/gym/members/${state.kavya}`, { dob: born });

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
      ["POST", `/api/gym/members/${state.bMember}/renew`, { unit: "months", duration: 1, fee: 100, paid: 100, method: "cash" }],
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
    assert.deepEqual(home.revenue, { online: 3000 + 1500 + 6000, cash: 1000 + 500 + 3200 + 1500 });
    assert.deepEqual(home.stats, { admission: 2, renewal: 1, enquiry: 1, duePaid: 2, pt: 1, product: 1 });
    assert.deepEqual(home.alerts, { dueMembers: 0, expiringToday: 0, attendance: 1, expiringSoon: 1, birthdays: 1 });
    assert.deepEqual(home.recent.map((p) => p.kind), ["admission", "pt", "sale", "due", "due"], "the newest five");

    const list = async (query) => (await gym.get(`/api/gym/members${query}`)).json.members.map((m) => m.id);
    assert.deepEqual(await list(""), [state.kavya, state.asif], "only this gym's members");
    assert.deepEqual(await list("?filter=birthday"), [state.kavya]);
    assert.deepEqual(await list("?filter=expiring_soon"), [state.kavya]);
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
    assert.deepEqual(wallet.today, { online: 10500, cash: 6200, total: 16700, byKind: { admission: 4500, renewal: 1000, due: 2000, pt: 6000, service: 0, sale: 3200 } });
    assert.deepEqual(wallet.owed, { total: 0, members: 0 });
  }));

  it("7. the justFit admin sees each gym's numbers and staff, and can unlink and edit", run(async () => {
    const list = (await as("admin").get("/api/admin/portal/gyms")).json.gyms;
    const a = list.find((g) => g.id === state.gymA);
    assert.deepEqual([a.staff, a.members, a.active, a.revenueToday, a.attendanceToday], [1, 2, 2, 16700, 1]);
    const detail = (await as("admin").get(`/api/admin/portal/gyms/${state.gymA}`)).json;
    assert.equal(detail.stats.todayOnline + detail.stats.todayCash, 16700);
    assert.equal(detail.stats.enquiriesMonth, 1);
    assert.equal(detail.recent.length, 7);
    const overview = (await as("admin").get("/api/admin/portal/overview")).json;
    assert.ok(overview.gyms.gyms >= 2);
    assert.ok(overview.gyms.gymRevenueToday >= 16700 + 1200);

    const edited = await as("admin").patch(`/api/admin/portal/gyms/${state.gymB}`, { city: "Bangalore" });
    assert.equal(edited.json.gym.city, "Bangalore");
    const removed = await as("admin").del(`/api/admin/portal/gyms/${state.gymB}/staff/${identities.gymB.id}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.json.staff, []);
    assert.equal((await as("gymB").get("/api/gym/dashboard")).status, 403, "unlinked: no gym any more");
    assert.equal((await as("admin").del(`/api/admin/portal/gyms/${state.gymB}/staff/${identities.gymB.id}`)).status, 404);
  }));

  it("9. a gym admin changes their gym's name and location, and their own name; the admin sees it", run(async () => {
    const gym = as("gymA");
    const r = await gym.patch("/api/gym/details", { branch: "Tumkur Main", area: "SIT Road", city: "Tumakuru", adminName: "Arjun K" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { gym: { name: "Forma", branch: "Tumkur Main", area: "SIT Road", city: "Tumakuru", branchCount: 1 }, adminName: "Arjun K" });
    assert.equal((await gym.get("/api/gym/dashboard")).json.gym.area, "SIT Road");
    const detail = (await as("admin").get(`/api/admin/portal/gyms/${state.gymA}`)).json;
    assert.deepEqual([detail.gym.name, detail.gym.branch], ["Forma", "Tumkur Main"]);
    assert.deepEqual(detail.staff.map((s) => s.name), ["Arjun K"]);
    assert.equal(await count("admin_audit_log", "admin_id = ? AND action = 'gym.edit' AND target_id = ?", [identities.gymA.id, String(state.gymA)]), 1);
    for (const body of [{}, { gymId: state.gymB, branch: "Taken" }, { name: "Renamed" }, { city: "X" }, { adminName: "" }, { role: "admin" }]) {
      assert.equal((await gym.patch("/api/gym/details", body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await as("admin").get(`/api/admin/portal/gyms/${state.gymB}`)).json.gym.branch, "Indiranagar", "only their own branch changes");
    assert.equal((await as("member").patch("/api/gym/details", { branch: "Mine" })).status, 403);
  }));

  it("10. a second branch: the admin adds it and links the gym admin, who switches between them", run(async () => {
    const added = await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/branches`, { branch: "Kunigal", area: "Main Road", city: "Kunigal" });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    state.gymA2 = added.json.gym.id;
    assert.equal(added.json.gym.name, "Forma", "the same gym");
    assert.deepEqual(added.json.branches.map((b) => b.branch).sort(), ["Kunigal", "Tumkur Main"]);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA2}/staff`, { phone: identities.gymA.phone })).status, 201, "a second branch of the same gym");
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/branches`, { branch: "X", area: "A", city: "B" })).status, 400);

    const gym = as("gymA");
    const list = (await gym.get("/api/gym/branches")).json;
    assert.equal(list.gym, "Forma");
    assert.deepEqual(list.branches.map((b) => b.branch), ["Kunigal", "Tumkur Main"]);
    assert.equal(list.currentId, state.gymA, "still on the branch it was using");
    const switched = await gym.post("/api/gym/branch", { branchId: state.gymA2 });
    assert.equal(switched.status, 200);
    assert.equal(switched.json.currentId, state.gymA2);
    const home = (await gym.get("/api/gym/dashboard")).json;
    assert.deepEqual([home.gym.branch, home.gym.branchCount, home.revenue.online + home.revenue.cash, home.recent.length], ["Kunigal", 2, 0, 0], "Kunigal's own numbers");
    assert.deepEqual((await gym.get("/api/gym/members")).json.members, [], "Tumkur's members aren't at Kunigal");
    assert.equal((await gym.get(`/api/gym/members/${state.asif}`)).status, 404, "a Tumkur member from the Kunigal branch");
    assert.equal((await gym.post("/api/gym/branch", { branchId: state.gymB })).status, 404, "another gym's branch");
    assert.equal((await gym.post("/api/gym/branch", { branchId: 999999 })).status, 404);
    assert.equal((await gym.post("/api/gym/branch", { branchId: "1 OR 1=1" })).status, 400);
    assert.equal((await gym.post("/api/gym/branch", { branchId: state.gymA })).json.currentId, state.gymA, "back to Tumkur");
    assert.equal((await gym.get(`/api/gym/members/${state.asif}`)).status, 200);
  }));

  it("11. Plans / Catalogue: each branch's own price list; services are recorded like products", run(async () => {
    const gym = as("gymA");
    assert.deepEqual((await gym.get("/api/gym/catalog")).json.items, []);
    for (const item of [
      { kind: "plan", name: "12 Months", unit: "months", duration: 12, price: 12000 },
      { kind: "plan", name: "1 Month", unit: "months", duration: 1, price: 1500 },
      { kind: "pt", name: "12 sessions", unit: "months", duration: 1, price: 6000 },
      { kind: "service", name: "Steam bath", price: 300 },
      { kind: "product", name: "Whey Protein 1kg", price: 3200 },
    ]) assert.equal((await gym.post("/api/gym/catalog", item)).status, 201, JSON.stringify(item));
    const items = (await gym.get("/api/gym/catalog")).json.items;
    assert.deepEqual(items.map((i) => [i.kind, i.name]), [["plan", "1 Month"], ["plan", "12 Months"], ["pt", "12 sessions"], ["service", "Steam bath"], ["product", "Whey Protein 1kg"]], "plans by length, then PT, services, products");
    for (const bad of [{ kind: "plan", name: "No months", price: 100 }, { kind: "pt", name: "No length PT", price: 100 }, { kind: "service", name: "Long service", unit: "months", duration: 3, price: 100 }, { kind: "plan", name: "Stocked plan", unit: "months", duration: 1, price: 100, stock: 5 }, { kind: "gift", name: "X item", price: 1 }, { kind: "product", name: "Free", price: 0 }, { kind: "product", name: "Mine", price: 10, gymId: state.gymB }]) {
      assert.equal((await gym.post("/api/gym/catalog", bad)).status, 400, JSON.stringify(bad));
    }
    const plan = items[0];
    const edited = await gym.patch(`/api/gym/catalog/${plan.id}`, { price: 1800, name: "Monthly" });
    assert.deepEqual([edited.json.items[0].name, edited.json.items[0].price], ["Monthly", 1800]);
    assert.equal((await gym.patch(`/api/gym/catalog/${items[3].id}`, { unit: "months", duration: 3 })).status, 400, "a service has no duration");
    assert.equal((await gym.patch(`/api/gym/catalog/${items[3].id}`, { stock: 4 })).status, 400, "only products have stock");
    const pt = await gym.patch(`/api/gym/catalog/${items[2].id}`, { unit: "months", duration: 3 });
    assert.deepEqual(pt.json.items.find((i) => i.id === items[2].id).duration, 3, "a PT package's length can change");
    // A day pass: plans in days sort first, and an admission on it ends after that many days
    assert.equal((await gym.post("/api/gym/catalog", { kind: "plan", name: "15-day pass", unit: "days", duration: 15, price: 900 })).status, 201);
    assert.equal((await gym.get("/api/gym/catalog")).json.items[0].name, "15-day pass");
    for (const bad of [{ unit: "days", duration: 366 }, { unit: "months", duration: 25 }, { unit: "weeks", duration: 2 }, { unit: "days" }]) {
      assert.equal((await gym.post("/api/gym/catalog", { kind: "plan", name: "Bad plan", price: 100, ...bad })).status, 400, JSON.stringify(bad));
    }
    const pass = await gym.post("/api/gym/members", { name: "Day Pass", unit: "days", duration: 15, fee: 900, paid: 900, method: "cash" });
    assert.equal(pass.status, 201, JSON.stringify(pass.json));
    assert.deepEqual(pass.json.member.planLength, { duration: 15, unit: "days" });
    assert.equal(pass.json.member.expiresOn, rules.addDays(today, 14));
    assert.equal(pass.json.payments[0].detail, "15 Days");
    const renewed = await gym.post(`/api/gym/members/${pass.json.member.id}/renew`, { unit: "months", duration: 1, fee: 1500, paid: 1500, method: "cash" });
    assert.deepEqual(renewed.json.member.planLength, { duration: 1, unit: "months" });
    assert.equal(renewed.json.member.expiresOn, rules.planEnd(rules.addDays(today, 15), 1));
    // Another gym's admin can't see, change or delete it
    const other = as("gymB");
    await connection.query("INSERT IGNORE INTO gym_staff (user_id, gym_id) VALUES (?, ?)", [identities.gymB.id, state.gymB]);
    assert.deepEqual((await other.get("/api/gym/catalog")).json.items, []);
    assert.equal((await other.patch(`/api/gym/catalog/${plan.id}`, { price: 1 })).status, 404);
    assert.equal((await other.del(`/api/gym/catalog/${plan.id}`)).status, 404);
    assert.equal((await gym.del(`/api/gym/catalog/${plan.id}`)).json.items.length, 5);

    const sold = await gym.post("/api/gym/services", { item: "Steam bath", amount: 300, method: "cash" });
    assert.equal(sold.status, 201, JSON.stringify(sold.json));
    assert.deepEqual([sold.json.payment.kind, sold.json.payment.detail], ["service", "Service"]);
    assert.equal((await gym.get("/api/gym/payments?kind=service")).json.payments.length, 1);
    assert.equal((await gym.get("/api/gym/wallet")).json.today.byKind.service, 300);
  }));

  it("12. Add New Member's full form: admission amount, discount, dates, details; saved as given", run(async () => {
    const gym = as("gymA");
    const r = await gym.post("/api/gym/members", {
      name: "Kiran Rao", phone: "9000012345", gender: "female", email: "kiran@example.com", heightCm: 165, weightKg: 58.5, address: "SIT Road, Tumakuru", notes: "Prefers mornings",
      unit: "months", duration: 1, fee: 1500, admissionFee: 500, discount: 200, paid: 1000, method: "online",
      dueBy: rules.addDays(today, 10), joinedOn: rules.addDays(today, -5), paidOn: rules.addDays(today, -1),
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const m = r.json.member;
    assert.deepEqual([m.email, m.heightCm, m.weightKg, m.address, m.notes], ["kiran@example.com", 165, 58.5, "SIT Road, Tumakuru", "Prefers mornings"]);
    assert.deepEqual([m.due, m.dueBy, m.joinedOn, m.expiresOn], [800, rules.addDays(today, 10), rules.addDays(today, -5), rules.planEnd(rules.addDays(today, -5), 1)], "1500 + 500 − 200 = 1800 payable, 1000 collected");
    assert.deepEqual([r.json.payments[0].amount, r.json.payments[0].paidOn], [1000, rules.addDays(today, -1)], "paid on the payment date");
    const edited = await gym.patch(`/api/gym/members/${m.id}`, { weightKg: 57, notes: "" });
    assert.deepEqual([edited.json.member.weightKg, edited.json.member.notes], [57, null]);
    assert.equal((await gym.patch(`/api/gym/members/${m.id}`, { heightCm: 400 })).status, 400);
    await connection.query("DELETE FROM gym_payments WHERE member_id = ?", [m.id]);
    await connection.query("DELETE FROM gym_members WHERE id = ?", [m.id]);
  }));

  it("13. selling to a member: priced from the catalogue, out of stock, what's not collected is owed", run(async () => {
    const gym = as("gymA");
    for (const item of [{ kind: "product", name: "Shaker Bottle", price: 350, stock: 3 }, { kind: "service", name: "Diet Consultation", price: 1000 }]) {
      assert.equal((await gym.post("/api/gym/catalog", item)).status, 201, JSON.stringify(item));
    }
    const items = (await gym.get("/api/gym/catalog")).json.items;
    const shaker = items.find((i) => i.name === "Shaker Bottle");
    const whey = items.find((i) => i.name === "Whey Protein 1kg");
    const diet = items.find((i) => i.name === "Diet Consultation");
    assert.deepEqual([shaker.stock, whey.stock, diet.stock], [3, null, null], "stock only where it's counted");
    const rahul = (await gym.post("/api/gym/members", { name: "Rahul Verma", unit: "months", duration: 6, fee: 9000, paid: 9000, method: "cash" })).json.member;
    const sales = `/api/gym/members/${rahul.id}/sales`;
    const paymentsOf = () => count("gym_payments", "member_id = ?", [rahul.id]);
    const stockOf = async (id) => (await connection.query("SELECT stock FROM gym_catalog_items WHERE id = ?", [id]))[0][0].stock;

    // Two shakers, ₹100 off, all collected: 700 − 100 = 600 paid, two out of stock
    const sold = await gym.post(sales, { itemId: shaker.id, quantity: 2, discount: 100, paid: 600, method: "online" });
    assert.equal(sold.status, 201, JSON.stringify(sold.json));
    assert.deepEqual([sold.json.payments[0].kind, sold.json.payments[0].title, sold.json.payments[0].detail, sold.json.payments[0].amount, sold.json.payments[0].memberId], ["sale", "Rahul Verma", "Shaker Bottle × 2", 600, rahul.id]);
    assert.equal(sold.json.member.due, 0);
    assert.equal(await stockOf(shaker.id), 1);

    // Refused ones change nothing: more than in stock, the rest owed with no date, a price sent,
    // too big a discount, more collected than payable
    const before = await paymentsOf();
    const short = await gym.post(sales, { itemId: shaker.id, quantity: 2, paid: 700, method: "cash" });
    assert.deepEqual([short.status, short.json.error], [409, "Only 1 of Shaker Bottle left in stock."]);
    for (const bad of [
      { itemId: shaker.id, quantity: 1, paid: 100, method: "cash" },
      { itemId: shaker.id, quantity: 1, paid: 1, method: "cash", price: 1 },
      { itemId: shaker.id, quantity: 1, discount: 350, paid: 1, method: "cash" },
      { itemId: shaker.id, quantity: 1, paid: 351, method: "cash" },
    ]) assert.equal((await gym.post(sales, bad)).status, 400, JSON.stringify(bad));
    assert.deepEqual([await paymentsOf(), await stockOf(shaker.id), (await gym.get(`/api/gym/members/${rahul.id}`)).json.member.due], [before, 1, 0], "nothing written");

    // Part paid: the rest is owed by the date given; the last one leaves it out of stock
    const part = await gym.post(sales, { itemId: shaker.id, quantity: 1, paid: 100, method: "cash", dueBy: rules.addDays(today, 5), paidOn: rules.addDays(today, -1) });
    assert.equal(part.status, 201, JSON.stringify(part.json));
    assert.deepEqual([part.json.member.due, part.json.member.dueBy, part.json.payments[0].paidOn, part.json.payments[0].detail], [250, rules.addDays(today, 5), rules.addDays(today, -1), "Shaker Bottle"]);
    assert.equal(await stockOf(shaker.id), 0);
    const out = await gym.post(sales, { itemId: shaker.id, quantity: 1, paid: 350, method: "cash" });
    assert.deepEqual([out.status, out.json.error], [409, "Shaker Bottle is out of stock."]);
    assert.equal((await gym.get("/api/gym/catalog")).json.items.find((i) => i.id === shaker.id).stock, 0);

    // A product that isn't counted sells any number; restocking is an edit
    assert.equal((await gym.post(sales, { itemId: whey.id, quantity: 5, paid: 16000, method: "online" })).status, 201);
    assert.equal(await stockOf(whey.id), null);
    assert.equal((await gym.patch(`/api/gym/catalog/${shaker.id}`, { stock: 40 })).json.items.find((i) => i.id === shaker.id).stock, 40);

    // A service: one, priced from the catalogue; each kind only on its own route
    const service = await gym.post(`/api/gym/members/${rahul.id}/services`, { itemId: diet.id, paid: 1000, method: "cash" });
    assert.equal(service.status, 201, JSON.stringify(service.json));
    assert.deepEqual([service.json.payments[0].kind, service.json.payments[0].detail, service.json.payments[0].amount], ["service", "Diet Consultation", 1000]);
    assert.equal((await gym.post(`/api/gym/members/${rahul.id}/services`, { itemId: shaker.id, paid: 350, method: "cash" })).status, 404, "a product isn't a service");
    assert.equal((await gym.post(sales, { itemId: diet.id, quantity: 1, paid: 1000, method: "cash" })).status, 404, "a service isn't a product");
    assert.equal((await gym.post(`/api/gym/members/${rahul.id}/services`, { itemId: diet.id, quantity: 1, paid: 1000, method: "cash" })).status, 400);

    // Nobody else: no session, a member account, another gym's admin (its member or its item)
    assert.equal((await api("POST", sales, null, { itemId: shaker.id, quantity: 1, paid: 350, method: "cash" })).status, 401);
    assert.equal((await as("member").post(sales, { itemId: shaker.id, quantity: 1, paid: 350, method: "cash" })).status, 403);
    assert.equal((await as("gymB").post(sales, { itemId: shaker.id, quantity: 1, paid: 350, method: "cash" })).status, 404, "another gym's member");
    const theirs = (await as("gymB").post("/api/gym/catalog", { kind: "product", name: "Their Shaker", price: 300, stock: 5 })).json.items.find((i) => i.name === "Their Shaker");
    assert.equal((await gym.post(sales, { itemId: theirs.id, quantity: 1, paid: 300, method: "cash" })).status, 404, "another gym's product");
    assert.equal(await stockOf(theirs.id), 5);
    assert.equal((await gym.post("/api/gym/members/1%20OR%201=1/sales", { itemId: shaker.id, quantity: 1, paid: 350, method: "cash" })).status, 400);

    // Home counts each sale, the wallet adds what was collected
    const wallet = (await gym.get("/api/gym/wallet")).json.today.byKind;
    assert.ok(wallet.sale >= 600 + 16000, JSON.stringify(wallet));
  }));

  it("8. a demoted gym admin loses the portal at once", run(async () => {
    await connection.query("UPDATE users SET role = 'user' WHERE id = ?", [identities.gymA.id]);
    assert.equal((await as("gymA").get("/api/gym/dashboard")).status, 403);
    await connection.query("UPDATE users SET role = 'gym_admin' WHERE id = ?", [identities.gymA.id]);
    assert.equal((await as("gymA").get("/api/gym/dashboard")).status, 200);
  }));
});
