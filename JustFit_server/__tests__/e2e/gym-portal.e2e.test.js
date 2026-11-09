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

// What the gym admin (owner) may use: every area of Role & Permission (gym/staffRules.js AREAS)
const ALL_AREAS = ["home", "members", "payments", "enquiries", "catalog", "profile", "attendance", "sms", "templates", "predictions", "expenses"];
// Every option inside them (2026-11-08): the gym admin has all
const ALL_OPTIONS = require("../../gym/staffRules").OPTION_IDS;

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
        const gymIds = [state.gymA, state.gymA2, state.gymA3, state.gymB].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_attendance", "gym_payments", "gym_enquiry_contacts", "gym_enquiries", "gym_catalog_items", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
    // areas: the gym admin may use every area (Role & Permission)
    assert.deepEqual(empty.json.gym, { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru", branchCount: 1, access: "owner", areas: ALL_AREAS, options: ALL_OPTIONS });
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

    // On the pay-by date itself: still only Due (the whole day to pay), not Overdue
    await connection.query("UPDATE gym_members SET due_by = ? WHERE id = ?", [today, state.asif]);
    assert.equal((await gym.get(`/api/gym/members/${state.asif}`)).json.member.overdue, false, "due today is not overdue");
    const dueToday = await gym.get("/api/gym/members?filter=overdue");
    assert.deepEqual(dueToday.json.members, [], "not on the Overdue filter yet");
    assert.equal(dueToday.json.counts.overdue, 0);
    assert.deepEqual((await gym.get("/api/gym/members?filter=due")).json.members.map((m) => m.id), [state.asif], "but on Due");
    // The day after the pay-by date: overdue, and on the Overdue filter
    await connection.query("UPDATE gym_members SET due_by = ? WHERE id = ?", [rules.addDays(today, -1), state.asif]);
    assert.equal((await gym.get(`/api/gym/members/${state.asif}`)).json.member.overdue, true);
    const overdue = await gym.get("/api/gym/members?filter=overdue");
    assert.deepEqual(overdue.json.members.map((m) => m.id), [state.asif]);
    // Every filter's count comes with the list, for the chips
    assert.equal(overdue.json.counts.overdue, 1, "the overdue count");
    assert.equal(overdue.json.counts.due >= 1, true, "the due count");
    assert.equal(typeof overdue.json.counts.all, "number", "the total");
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
    assert.deepEqual([pt.json.payments[0].kind, pt.json.payments[0].detail, pt.json.payments[0].amount], ["pt", "PT · 12 sessions · 1 Month", 6000]);
    assert.deepEqual(pt.json.member.pt, { label: "12 sessions", from: today, until: rules.planEnd(today, 1), active: true, trainer: null }, "the PT period (no trainer picked)");
    const again = await gym.post(`/api/gym/members/${state.asif}/pt`, { package: "8 sessions", amount: 1, method: "cash", duration: 1 });
    assert.deepEqual([again.json.member.pt.label, again.json.member.pt.from, again.json.member.pt.until], ["8 sessions", rules.addDays(rules.planEnd(today, 1), 1), rules.planEnd(rules.addDays(rules.planEnd(today, 1), 1), 1)], "a renewal follows on from the running period (unit left out: months)");
    assert.equal((await gym.post(`/api/gym/members/${state.asif}/pt`, { package: "8 sessions", amount: 1, method: "cash", unit: "days", duration: 10 })).status, 400, "PT in days is refused since 2026-11-07");
    // Start and end dates picked by hand: they replace the follow-on and the duration
    const picked = await gym.post(`/api/gym/members/${state.asif}/pt`, { package: "6 sessions", amount: 1, method: "cash", unit: "months", duration: 1, startsOn: rules.addDays(today, 3), endsOn: rules.addDays(today, 47) });
    assert.equal(picked.status, 200, JSON.stringify(picked.json));
    assert.deepEqual([picked.json.member.pt.from, picked.json.member.pt.until], [rules.addDays(today, 3), rules.addDays(today, 47)], "the picked dates are saved");
    assert.equal(picked.json.payments[0].detail, "PT · 6 sessions · 45 Days", "the payment line says how long the picked dates run");
    assert.equal((await gym.post(`/api/gym/members/${state.asif}/pt`, { package: "6 sessions", amount: 1, method: "cash", unit: "months", duration: 1, startsOn: rules.addDays(today, 3), endsOn: rules.addDays(today, 2) })).status, 400, "an end before the start");
    assert.equal((await gym.post(`/api/gym/members/${state.asif}/pt`, { package: "6 sessions", amount: 1, method: "cash", unit: "months", duration: 1, startsOn: rules.addDays(today, 61) })).status, 400, "a start too far ahead");
    assert.equal((await gym.post(`/api/gym/members/${state.asif}/pt`, { package: "6 sessions", amount: 1, method: "cash", unit: "months", duration: 1, startsOn: "2026-02-30' OR 1=1 --" })).status, 400, "not a date");
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
    assert.deepEqual(home.alerts, { dueMembers: 0, expiringToday: 0, attendance: 1, expiringSoon: 1, birthdays: 1, renewalRisk: 0, pauseRequests: 0 });
    assert.deepEqual(home.recent.map((p) => p.kind), ["admission", "pt", "sale", "due", "due"], "the newest five");

    const list = async (query) => (await gym.get(`/api/gym/members${query}`)).json.members.map((m) => m.id);
    // Pages and sorts (2026-11-07): 50 a page, a page past the end is empty, bad values are 400
    const first = (await gym.get("/api/gym/members")).json;
    assert.deepEqual([first.page, first.nextPage], [1, null]);
    assert.deepEqual(await list("?page=2"), []);
    for (const q of ["?page=0", "?sort=random", "?sort=full_name%20DESC"]) assert.equal((await gym.get(`/api/gym/members${q}`)).status, 400, q);
    const byDue = (await gym.get("/api/gym/members?sort=due")).json.members;
    assert.ok(byDue.length > 1 && byDue[0].due >= byDue[byDue.length - 1].due, "highest due first");
    assert.deepEqual(await list(""), [state.kavya, state.asif], "only this gym's members");
    assert.deepEqual(await list("?filter=birthday"), [state.kavya]);
    assert.deepEqual(await list("?filter=expiring_soon"), [state.kavya]);
    // Expiring soon's window follows the days asked for (Kavya's plan ends in 2 days, so she is
    // listed at the default 3 above but not within 1); the chip's count uses the same window and
    // the other counts are untouched. One call on gym A only: this account ends the suite a
    // couple of calls under its 180-a-minute budget. The bounds (1 to 90) are unit-tested.
    const soon = (await gym.get("/api/gym/members?filter=expiring_soon&days=1")).json;
    assert.deepEqual([soon.members, soon.counts.expiring_soon, soon.counts.birthday], [[], 0, 1], "not within 1 day");
    assert.equal((await as("gymB").get("/api/gym/members?filter=expiring_soon&days=91")).status, 400, "past 90 days");
    // "all" is every plan still running: gym B's one member has a month to go, so 3 days misses him
    const bAll = (await as("gymB").get("/api/gym/members?filter=expiring_soon&days=all")).json;
    assert.deepEqual([bAll.members.map((m) => m.id), bAll.counts.expiring_soon], [[state.bMember], 1]);
    assert.equal((await as("gymB").get("/api/gym/members?filter=expiring_soon")).json.counts.expiring_soon, 0, "not within the default 3 days");
    assert.deepEqual(await list("?filter=due"), []);
    assert.deepEqual(await list("?search=asif"), [state.asif]);
    assert.deepEqual(await list("?search=98765"), [state.asif], "by phone");
    assert.deepEqual(await list(`?search=${encodeURIComponent("%' OR 1=1 --")}`), [], "SQL and wildcards are just text");
    assert.equal((await gym.get("/api/gym/members?filter=everyone")).status, 400);

    const sales = (await gym.get("/api/gym/payments?kind=sale")).json;
    assert.deepEqual(sales.payments.map((p) => p.title), ["Whey Protein 1kg"]);
    assert.equal(sales.nextBefore, null);
    // Transactions by day (2026-11-07): today's sale is there, yesterday has none, bad days are 400
    assert.equal((await gym.get(`/api/gym/payments?kind=sale&day=${today}`)).json.payments.length, 1);
    assert.equal((await gym.get(`/api/gym/payments?kind=sale&day=${rules.addDays(today, -1)}`)).json.payments.length, 0);
    assert.equal((await gym.get("/api/gym/payments?kind=sale&today=1")).json.payments.length, 1, "older today=1 links still work");
    for (const day of [rules.addDays(today, 1), "2026-02-30", "today", "2026-11-07'%20OR%201=1"]) assert.equal((await gym.get(`/api/gym/payments?day=${day}`)).status, 400, day);
    assert.equal((await gym.get("/api/gym/enquiries")).json.enquiries[0].name, "Priya");

    const wallet = (await gym.get("/api/gym/wallet")).json;
    assert.deepEqual(wallet.today, { online: 10500, cash: 6200, total: 16700, byKind: { admission: 4500, renewal: 1000, due: 2000, pt: 6000, service: 0, sale: 3200 } });
    assert.deepEqual(wallet.due, { total: 0, members: 0 });
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

  it("7b. enquiry follow-up: lists and counts, the call-back day, status, Convert to member; another gym's are out of reach", run(async () => {
    const gym = as("gymA");
    assert.equal((await api("GET", "/api/gym/enquiries", null)).status, 401);
    assert.equal((await as("member").get("/api/gym/enquiries")).status, 403);

    const priya = (await gym.get("/api/gym/enquiries")).json.enquiries.find((e) => e.name === "Priya");
    assert.deepEqual([priya.status, priya.followUpOn, priya.interest, priya.source, priya.member], ["new", null, null, null, null], "an older enquiry starts as new");

    // A new enquiry with a call-back day starts as follow-up
    const added = await gym.post("/api/gym/enquiries", { name: "Rahul S", phone: "9988776655", interest: "pt", source: "instagram", note: "Mornings", followUpOn: today });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual([added.json.enquiry.status, added.json.enquiry.followUpOn, added.json.enquiry.phone], ["follow_up", today, "+919988776655"]);
    const rahul = added.json.enquiry.id;
    const late = await gym.post("/api/gym/enquiries", { name: "Late Caller", followUpOn: rules.addDays(today, 2) });
    await connection.query("UPDATE gym_enquiries SET follow_up_on = ? WHERE id = ?", [rules.addDays(today, -2), late.json.enquiry.id]);
    assert.equal((await gym.post("/api/gym/enquiries", { name: "Bad", followUpOn: rules.addDays(today, 400) })).status, 400);
    assert.equal((await gym.post("/api/gym/enquiries", { name: "Bad", status: "joined" })).status, 400, "can't be added as joined");

    const list = async (query) => (await gym.get(`/api/gym/enquiries${query}`)).json;
    const names = async (query) => (await list(query)).enquiries.map((e) => e.name);
    assert.deepEqual(await names("?view=today"), ["Rahul S"]);
    assert.deepEqual(await names("?view=overdue"), ["Late Caller"]);
    assert.deepEqual(await names("?view=open"), ["Late Caller", "Rahul S", "Priya"], "newest first");
    assert.deepEqual((await list("")).counts, { today: 1, overdue: 1, open: 3, joined: 0, lost: 0, all: 3 });
    assert.deepEqual(await names("?view=all&search=99887"), ["Rahul S"], "by phone");
    assert.deepEqual(await names(`?view=all&search=${encodeURIComponent("%' OR 1=1 --")}`), [], "SQL and wildcards are just text");
    assert.equal((await gym.get("/api/gym/enquiries?view=1%3D1")).status, 400);

    // Edits: the call-back day, the status
    const moved = await gym.patch(`/api/gym/enquiries/${priya.id}`, { followUpOn: rules.addDays(today, 3) });
    assert.deepEqual([moved.json.enquiry.status, moved.json.enquiry.followUpOn], ["follow_up", rules.addDays(today, 3)], "a date moves a new one to follow-up");
    assert.equal((await gym.patch(`/api/gym/enquiries/${late.json.enquiry.id}`, { status: "lost" })).json.enquiry.status, "lost");
    assert.equal((await gym.patch(`/api/gym/enquiries/${priya.id}`, { status: "joined" })).status, 400, "joined only with a member");
    assert.equal((await gym.patch(`/api/gym/enquiries/${priya.id}`, { gymId: state.gymB })).status, 400);

    // Convert to member: only a member of this branch can be linked
    assert.equal((await gym.patch(`/api/gym/enquiries/${rahul}`, { status: "joined", memberId: state.bMember })).status, 404, "another gym's member");
    assert.equal((await gym.patch(`/api/gym/enquiries/${rahul}`, { status: "joined", memberId: 99999999 })).status, 404);
    const won = await gym.patch(`/api/gym/enquiries/${rahul}`, { status: "joined", memberId: state.kavya });
    assert.equal(won.status, 200, JSON.stringify(won.json));
    assert.deepEqual([won.json.enquiry.status, won.json.enquiry.member?.id], ["joined", state.kavya]);
    assert.deepEqual((await list("?view=joined")).counts, { today: 0, overdue: 0, open: 1, joined: 1, lost: 1, all: 3 });
    // Reopened: no longer linked
    const reopened = await gym.patch(`/api/gym/enquiries/${rahul}`, { status: "follow_up" });
    assert.deepEqual([reopened.json.enquiry.status, reopened.json.enquiry.member], ["follow_up", null]);

    // Another gym's enquiry: not found, untouched
    const [bRow] = await connection.query("INSERT INTO gym_enquiries (gym_id, full_name, enquired_on) VALUES (?, 'B Lead', ?)", [state.gymB, today]);
    assert.equal((await gym.patch(`/api/gym/enquiries/${bRow.insertId}`, { status: "lost" })).status, 404);
    assert.equal((await connection.query("SELECT status FROM gym_enquiries WHERE id = ?", [bRow.insertId]))[0][0].status, "new");
    assert.equal((await names("?view=all")).includes("B Lead"), false, "only this gym's enquiries are listed");
    assert.equal((await gym.patch("/api/gym/enquiries/1%20OR%201=1", { status: "lost" })).status, 400);
  }));

  it("7c. a referral takes the referrer's number; a member of this branch with that number is named, never another gym's", run(async () => {
    const gym = as("gymA");
    assert.equal((await gym.post("/api/gym/enquiries", { name: "Ref Needed", source: "referral" })).status, 400, "a referral needs the number");
    assert.equal((await gym.post("/api/gym/enquiries", { name: "Ref Bad", source: "referral", referredBy: "12345" })).status, 400);
    assert.equal((await gym.post("/api/gym/enquiries", { name: "Ref Self", phone: "9111111111", source: "referral", referredBy: "9111111111" })).status, 400, "not their own number");

    // Mohammed Asif (9876543210) is a member at gym A; gym B has a member with the same number
    const byMember = await gym.post("/api/gym/enquiries", { name: "Sneha R", phone: "9111111112", source: "referral", referredBy: "+91 98765 43210" });
    assert.equal(byMember.status, 201, JSON.stringify(byMember.json));
    assert.deepEqual(byMember.json.enquiry.referredBy, { phone: "+919876543210", member: { id: state.asif, name: "Mohammed Asif K", code: byMember.json.enquiry.referredBy.member.code } }, "named as gym A's member");
    assert.notEqual(byMember.json.enquiry.referredBy.member.id, state.bMember, "never gym B's member with the same number");

    const byStranger = await gym.post("/api/gym/enquiries", { name: "Vikram", source: "referral", referredBy: "9000000001" });
    assert.equal(byStranger.status, 201);
    assert.deepEqual(byStranger.json.enquiry.referredBy, { phone: "+919000000001", member: null }, "a number that isn't a member is kept as a number");
    assert.equal((await gym.post("/api/gym/enquiries", { name: "Walk In", source: "walk_in", referredBy: "9000000001" })).json.enquiry.referredBy, null, "other sources carry no referrer");

    const id = byStranger.json.enquiry.id;
    assert.equal((await gym.patch(`/api/gym/enquiries/${id}`, { referredBy: "" })).status, 400, "a referral can't lose its number");
    assert.equal((await gym.patch(`/api/gym/enquiries/${id}`, { referredBy: "9876543210" })).json.enquiry.referredBy.member.id, state.asif, "changed to a member's number");
    assert.equal((await gym.patch(`/api/gym/enquiries/${id}`, { note: "Called back" })).status, 200, "other edits leave it");
    const moved = await gym.patch(`/api/gym/enquiries/${id}`, { source: "instagram" });
    assert.equal(moved.json.enquiry.referredBy, null, "another source clears it");
    assert.equal((await connection.query("SELECT referred_by_phone FROM gym_enquiries WHERE id = ?", [id]))[0][0].referred_by_phone, null);
    assert.equal((await gym.patch(`/api/gym/enquiries/${id}`, { source: "referral" })).status, 400, "back to referral needs the number again");
    assert.equal((await gym.patch(`/api/gym/enquiries/${id}`, { source: "referral", referredBy: "9000000002" })).json.enquiry.referredBy.phone, "+919000000002");

    // An older referral saved without a number can still be edited otherwise
    const [old] = await connection.query("INSERT INTO gym_enquiries (gym_id, full_name, source, enquired_on) VALUES (?, 'Old Referral', 'referral', ?)", [state.gymA, today]);
    assert.equal((await gym.patch(`/api/gym/enquiries/${old.insertId}`, { status: "lost" })).status, 200);
    assert.equal((await gym.patch(`/api/gym/enquiries/${old.insertId}`, { referredBy: "9000000003" })).json.enquiry.referredBy.phone, "+919000000003");
  }));

  it("9. a gym admin changes their branch's name and location (not their own name any more); the admin sees it", run(async () => {
    const gym = as("gymA");
    const r = await gym.patch("/api/gym/details", { branch: "Tumkur Main", area: "SIT Road", city: "Tumakuru" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { gym: { name: "Forma", branch: "Tumkur Main", area: "SIT Road", city: "Tumakuru", branchCount: 1, access: "owner", areas: ALL_AREAS, options: ALL_OPTIONS } });
    assert.equal((await gym.get("/api/gym/dashboard")).json.gym.area, "SIT Road");
    const detail = (await as("admin").get(`/api/admin/portal/gyms/${state.gymA}`)).json;
    assert.deepEqual([detail.gym.name, detail.gym.branch], ["Forma", "Tumkur Main"]);
    assert.deepEqual(detail.staff.map((s) => s.name), ["Arjun Kumar"], "their own name is untouched");
    assert.equal(await count("admin_audit_log", "admin_id = ? AND action = 'gym.edit' AND target_id = ?", [identities.gymA.id, String(state.gymA)]), 1);
    for (const body of [{}, { gymId: state.gymB, branch: "Taken" }, { name: "Renamed" }, { city: "X" }, { adminName: "Arjun K" }, { role: "admin" }]) {
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

  it("10b. the gym admin adds a branch themselves, with its location, and is its gym admin; Staff can't", run(async () => {
    const gym = as("gymA");
    const added = await gym.post("/api/gym/branches", { branch: "Gubbi", area: "Market Road", city: "Gubbi" });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.equal(added.json.currentId, state.gymA, "the open branch stays open");
    assert.equal(added.json.access, "owner");
    assert.deepEqual(added.json.branches.map((b) => [b.branch, b.area, b.city]), [["Gubbi", "Market Road", "Gubbi"], ["Kunigal", "Main Road", "Kunigal"], ["Tumkur Main", "SIT Road", "Tumakuru"]]);
    state.gymA3 = added.json.branches.find((b) => b.branch === "Gubbi").id;
    const [[link]] = await connection.query("SELECT kind FROM gym_staff WHERE user_id = ? AND gym_id = ?", [identities.gymA.id, state.gymA3]);
    assert.equal(link?.kind, "owner", "linked to the new branch as its gym admin");
    assert.equal((await connection.query("SELECT brand_id FROM gyms WHERE id = ?", [state.gymA3]))[0][0].brand_id, (await connection.query("SELECT brand_id FROM gyms WHERE id = ?", [state.gymA]))[0][0].brand_id, "a branch of the same gym");
    assert.equal(await count("admin_audit_log", "admin_id = ? AND action = 'gym.branch_add' AND target_id = ?", [identities.gymA.id, String(state.gymA3)]), 1);
    assert.equal((await gym.post("/api/gym/branch", { branchId: state.gymA3 })).json.currentId, state.gymA3, "and can open it");
    assert.equal((await gym.get("/api/gym/dashboard")).json.gym.branchCount, 3);
    assert.equal((await gym.post("/api/gym/branch", { branchId: state.gymA })).json.currentId, state.gymA, "back to Tumkur");
    // Refused: the same name again, a missing location, extra fields, an SQL payload, a member
    assert.equal((await gym.post("/api/gym/branches", { branch: "gubbi", area: "Elsewhere", city: "Gubbi" })).status, 409, "a name the gym already uses");
    for (const body of [{}, { branch: "Sira" }, { branch: "Sira", area: "Main Road" }, { branch: "Sira", area: "Main Road", city: "Sira", gymId: state.gymB }, { branch: "Sira", area: "Main Road", city: "Sira", name: "Other" }, { branch: "X", area: "A", city: "B" }]) {
      assert.equal((await gym.post("/api/gym/branches", body)).status, 400, JSON.stringify(body));
    }
    // An SQL payload is only text: the branch is saved under that odd name and the table is untouched
    const odd = await gym.post("/api/gym/branches", { branch: "Sira'); DROP TABLE gyms; --", area: "Main Road", city: "Sira" });
    assert.equal(odd.status, 201);
    const oddId = odd.json.branches.find((b) => b.branch.startsWith("Sira'")).id;
    assert.equal(await count("gyms", "id = ?", [oddId]), 1);
    await connection.query("DELETE FROM gym_staff WHERE gym_id = ?", [oddId]);
    await connection.query("DELETE FROM gyms WHERE id = ?", [oddId]);
    assert.equal((await as("member").post("/api/gym/branches", { branch: "Sira", area: "Main Road", city: "Sira" })).status, 403);
    // A Staff login (kind 'staff') at this branch is refused: flip the gym admin's own link for a moment
    await connection.query("UPDATE gym_staff SET kind = 'staff' WHERE user_id = ? AND gym_id = ?", [identities.gymA.id, state.gymA]);
    try {
      const refused = await gym.post("/api/gym/branches", { branch: "Sira", area: "Main Road", city: "Sira" });
      assert.equal(refused.status, 403);
      assert.equal(refused.json.error, "Only the gym admin can add a branch.");
    } finally {
      await connection.query("UPDATE gym_staff SET kind = 'owner' WHERE user_id = ? AND gym_id = ?", [identities.gymA.id, state.gymA]);
    }
    assert.equal(await count("gyms", "name = 'Sira'", []), 0, "nothing was added by a refused request");
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
    // Plans are in whole months only (day plans ended on 2026-11-07): a day pass is refused in
    // the catalogue and at admission; `unit` may be left out of a months plan
    for (const bad of [{ unit: "days", duration: 15 }, { unit: "days", duration: 366 }, { unit: "months", duration: 25 }, { unit: "weeks", duration: 2 }, { unit: "days" }]) {
      assert.equal((await gym.post("/api/gym/catalog", { kind: "plan", name: "Bad plan", price: 100, ...bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await gym.post("/api/gym/catalog", { kind: "plan", name: "Two months", duration: 2, price: 2800 })).status, 201, "unit left out: months");
    assert.equal((await gym.get("/api/gym/catalog")).json.items.find((i) => i.name === "Two months").unit, "months");
    const dayPass = await gym.post("/api/gym/members", { name: "Day Pass", unit: "days", duration: 15, fee: 900, paid: 900, method: "cash" });
    assert.equal(dayPass.status, 400, JSON.stringify(dayPass.json));
    assert.match(dayPass.json.error, /whole months now/);
    const pass = await gym.post("/api/gym/members", { name: "Two Months", duration: 2, fee: 2800, paid: 2800, method: "cash" });
    assert.equal(pass.status, 201, JSON.stringify(pass.json));
    assert.deepEqual(pass.json.member.planLength, { duration: 2, unit: "months" });
    assert.equal(pass.json.member.expiresOn, rules.planEnd(today, 2));
    assert.equal(pass.json.payments[0].detail, "2 Months");
    assert.equal((await gym.post(`/api/gym/members/${pass.json.member.id}/renew`, { unit: "days", duration: 7, fee: 500, paid: 500, method: "cash" })).status, 400, "a renewal in days is refused");
    const renewed = await gym.post(`/api/gym/members/${pass.json.member.id}/renew`, { unit: "months", duration: 1, fee: 1500, paid: 1500, method: "cash" });
    assert.deepEqual(renewed.json.member.planLength, { duration: 1, unit: "months" });
    assert.equal(renewed.json.member.expiresOn, rules.planEnd(rules.addDays(rules.planEnd(today, 2), 1), 1));
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

    // The plan's name on the member (2026-11-08): read from this branch's catalogue by its id
    const gold = (await gym.post("/api/gym/catalog", { kind: "plan", name: "Gold", duration: 3, price: 4500 })).json.items.find((i) => i.name === "Gold");
    const ptItem = (await gym.get("/api/gym/catalog")).json.items.find((i) => i.kind === "pt");
    const otherPlan = (await other.post("/api/gym/catalog", { kind: "plan", name: "Other gym's plan", duration: 3, price: 1 })).json.items.find((i) => i.kind === "plan");
    const before = await count("gym_members", "gym_id = ?", [state.gymA]);
    for (const planId of [otherPlan.id, ptItem.id, 999999999]) {
      const refused = await gym.post("/api/gym/members", { name: "Wrong Plan", duration: 3, planId, fee: 4500, paid: 4500, method: "cash" });
      assert.equal(refused.status, 400, `${planId}: ${JSON.stringify(refused.json)}`);
      assert.match(refused.json.error, /one of your plans/);
    }
    assert.equal(await count("gym_members", "gym_id = ?", [state.gymA]), before, "a refused plan writes no member");
    const goldie = await gym.post("/api/gym/members", { name: "Gold Member", duration: 3, planId: gold.id, fee: 4500, paid: 4500, method: "cash" });
    assert.equal(goldie.status, 201, JSON.stringify(goldie.json));
    assert.equal(goldie.json.member.planName, "Gold");
    assert.equal((await gym.get("/api/gym/members?filter=all&search=Gold%20Member")).json.members[0].planName, "Gold", "the list carries it");
    assert.equal(pass.json.member.planName, null, "a custom plan has no name");
    const custom = await gym.post(`/api/gym/members/${goldie.json.member.id}/renew`, { duration: 1, fee: 1500, paid: 1500, method: "cash" });
    assert.equal(custom.json.member.planName, null, "renewing onto a custom plan clears the name");
    assert.equal((await gym.post(`/api/gym/members/${goldie.json.member.id}/renew`, { duration: 3, planId: otherPlan.id, fee: 1, paid: 1, method: "cash" })).status, 400);
    const back = await gym.post(`/api/gym/members/${goldie.json.member.id}/renew`, { duration: 3, planId: gold.id, fee: 4500, paid: 4500, method: "cash" });
    assert.equal(back.json.member.planName, "Gold");
    // Renaming the plan later keeps what the member bought
    await gym.patch(`/api/gym/catalog/${gold.id}`, { name: "Gold Plus" });
    assert.equal((await gym.get(`/api/gym/members/${goldie.json.member.id}`)).json.member.planName, "Gold");
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
