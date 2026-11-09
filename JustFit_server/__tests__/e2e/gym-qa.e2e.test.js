// Gym portal QA probes (2026-11-04): edge cases the other gym suites don't cover, against the real
// Express server and justfit_test. Bad and hostile input (wrong types, broken JSON, oversized
// bodies, SQL and markup in text, LIKE wildcards), empty edits, money that can't add up, dates out
// of range, another gym's ids on every member route and in the attendance history, a branch of
// another gym, and the payments' "today" filter.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("gym portal QA probes: hostile input, scoping and money rules", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();

  const raw = async (method, route, token, body, contentType = "application/json") => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = contentType;
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const api = (method, route, token, body) => raw(method, route, token, body === undefined ? undefined : JSON.stringify(body));
  const as = (tag) => ({
    get: (route) => api("GET", route, tokens[tag]),
    post: (route, body) => api("POST", route, tokens[tag], body ?? {}),
    patch: (route, body) => api("PATCH", route, tokens[tag], body),
    put: (route, body) => api("PUT", route, tokens[tag], body),
    del: (route) => api("DELETE", route, tokens[tag]),
  });
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const admission = (name, phone, extra = {}) => ({ name, phone, unit: "months", duration: 1, fee: 1500, paid: 1500, method: "cash", ...extra });

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Iron House", branch: "Mysuru", area: "Kuvempunagar", city: "Mysuru" });
    state.gymA = a.json.gym.id;
    state.gymB = b.json.gym.id;
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.gymA.phone })).status, 201);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/staff`, { phone: identities.gymB.phone })).status, 201);
    state.memberA = (await as("gymA").post("/api/gym/members", admission("Ravi Kumar", "9876500001", { paid: 1000, dueBy: rules.addDays(today, 7) }))).json.member.id;
    state.memberB = (await as("gymB").post("/api/gym/members", admission("Meena Rao", "9876500002"))).json.member.id;
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const gymIds = [state.gymA, state.gymB].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_attendance", "gym_payments", "gym_enquiries", "gym_catalog_items", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((r) => r.brand_id)]);
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

  it("1. broken JSON, oversized bodies and the wrong content type answer 4xx, never 500", run(async () => {
    const broken = await raw("POST", "/api/gym/enquiries", tokens.gymA, "{\"name\": \"Ravi\",");
    assert.equal(broken.status, 400, JSON.stringify(broken.json));
    assert.ok(broken.json?.error, "a friendly line");
    const big = await api("POST", "/api/gym/enquiries", tokens.gymA, { name: "Ravi", note: "x".repeat(6000) });
    assert.equal(big.status, 413, JSON.stringify(big.json));
    const text = await raw("POST", "/api/gym/enquiries", tokens.gymA, "name=Ravi", "application/x-www-form-urlencoded");
    assert.equal(text.status, 400, "a form body reads as no JSON");
    for (const body of [null, [], "Ravi", 5]) assert.equal((await api("POST", "/api/gym/enquiries", tokens.gymA, body)).status, 400, `body ${JSON.stringify(body)}`);
  }));

  it("2. text fields refuse other types and lose markup; SQL in text is stored as plain text", run(async () => {
    for (const note of [{ a: 1 }, ["x"], 42, true]) {
      const r = await as("gymA").post("/api/gym/enquiries", { name: "Probe Person", note });
      assert.equal(r.status, 400, `note ${JSON.stringify(note)}: ${JSON.stringify(r.json)}`);
    }
    const xss = await as("gymA").post("/api/gym/enquiries", { name: "<script>alert(1)</script> Asha", note: "<img src=x onerror=alert(1)>" });
    assert.equal(xss.status, 201, JSON.stringify(xss.json));
    assert.doesNotMatch(xss.json.enquiry.name, /[<>]/);
    assert.doesNotMatch(xss.json.enquiry.note ?? "", /[<>=]/);
    const sql = await as("gymA").post("/api/gym/enquiries", { name: "Robert'); DROP TABLE gym_members;--", phone: "9876500003" });
    assert.equal(sql.status, 201);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM gym_members");
    assert.ok(n >= 2, "the table is still there");
  }));

  it("3. member search: SQL and LIKE wildcards are literal, and only this gym's members come back", run(async () => {
    for (const search of ["' OR 1=1 --", "%", "_", "\\", "Meena"]) {
      const r = await as("gymA").get(`/api/gym/members?search=${encodeURIComponent(search)}`);
      assert.equal(r.status, 200, `${search}: ${JSON.stringify(r.json)}`);
      assert.equal(r.json.members.length, 0, `${search} finds nothing at gym A`);
    }
    const found = await as("gymA").get("/api/gym/members?search=Ravi");
    assert.deepEqual(found.json.members.map((m) => m.id), [state.memberA]);
    // Phones as shown (+91) or typed with the country code find the member
    for (const search of ["+91 98765", "+919876500001", "919876500001", "98765 00001", "500001"]) {
      const r = await as("gymA").get(`/api/gym/members?search=${encodeURIComponent(search)}`);
      assert.deepEqual(r.json.members.map((m) => m.id), [state.memberA], `search ${search}`);
    }
    assert.equal((await as("gymA").get("/api/gym/members?filter=everyone")).status, 400);
    assert.equal((await as("gymA").get(`/api/gym/members?search=${"a".repeat(61)}`)).status, 400);
  }));

  it("4. every member route refuses another gym's member with 404 and writes nothing", run(async () => {
    const other = state.memberB;
    const before = await connection.query("SELECT due_amount, expires_on, full_name FROM gym_members WHERE id = ?", [other]);
    const probes = [
      ["GET", `/api/gym/members/${other}`],
      ["PATCH", `/api/gym/members/${other}`, { name: "Hijacked" }],
      ["POST", `/api/gym/members/${other}/renew`, { unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash" }],
      ["POST", `/api/gym/members/${other}/due`, { amount: 1, method: "cash" }],
      ["POST", `/api/gym/members/${other}/pt`, { package: "12 sessions", amount: 3000, method: "cash", unit: "months", duration: 1 }],
      ["POST", `/api/gym/members/${other}/check-in`],
      ["POST", `/api/gym/members/${other}/check-out`],
      ["DELETE", `/api/gym/members/${other}/photo`],
      ["GET", `/api/gym/members/${other}/photo`],
    ];
    for (const [method, route, body] of probes) {
      const r = await api(method, route, tokens.gymA, body);
      assert.equal(r.status, 404, `${method} ${route}: ${r.status} ${JSON.stringify(r.json)}`);
    }
    const after = await connection.query("SELECT due_amount, expires_on, full_name FROM gym_members WHERE id = ?", [other]);
    assert.deepEqual(after[0], before[0]);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM gym_attendance WHERE member_id = ?", [other]);
    assert.equal(n, 0);
    for (const bad of ["0", "-1", "1.5", "abc", "99999999999"]) assert.equal((await as("gymA").get(`/api/gym/members/${bad}`)).status, 400, `id ${bad}`);
  }));

  it("5. empty edits and unknown fields are refused", run(async () => {
    assert.equal((await as("gymA").patch(`/api/gym/members/${state.memberA}`, {})).status, 400);
    assert.equal((await as("gymA").patch(`/api/gym/members/${state.memberA}`, { gym_id: state.gymB })).status, 400);
    assert.equal((await as("gymA").patch(`/api/gym/members/${state.memberA}`, { dueAmount: 0 })).status, 400, "the due can't be edited away");
    const plan = await as("gymA").post("/api/gym/catalog", { kind: "plan", name: "Monthly", unit: "months", duration: 1, price: 1500 });
    assert.equal(plan.status, 201);
    const itemId = plan.json.items[0].id;
    assert.equal((await as("gymA").patch(`/api/gym/catalog/${itemId}`, {})).status, 400);
    assert.equal((await as("gymA").patch(`/api/gym/catalog/${itemId}`, { unit: "months", duration: 25 })).status, 400);
    assert.equal((await as("gymA").patch(`/api/gym/catalog/${itemId}`, { stock: 5 })).status, 400, "plans have no stock");
    assert.equal((await as("gymB").patch(`/api/gym/catalog/${itemId}`, { price: 1 })).status, 404, "another gym's item");
    assert.equal((await as("gymB").del(`/api/gym/catalog/${itemId}`)).status, 404);
    assert.equal((await as("gymA").patch("/api/gym/details", {})).status, 400);
  }));

  it("6. money that can't add up is refused and leaves nothing behind", run(async () => {
    const count = async () => (await connection.query("SELECT COUNT(*) AS n FROM gym_payments WHERE gym_id = ?", [state.gymA]))[0][0].n;
    const payments = await count();
    const bad = [
      admission("Zero Payable", "9876500010", { fee: 1000, discount: 1000, paid: 1 }),
      admission("Over Paid", "9876500011", { paid: 1600 }),
      admission("Negative", "9876500012", { fee: -5 }),
      admission("Fraction", "9876500013", { fee: 1500.5, paid: 1500.5 }),
      admission("String Fee", "9876500014", { fee: "1500", paid: "1500" }),
      admission("No Due Date", "9876500015", { paid: 500 }),
      admission("Past Due Date", "9876500016", { paid: 500, dueBy: rules.addDays(today, -1) }),
      admission("Future Payment", "9876500017", { paidOn: rules.addDays(today, 1) }),
      admission("Long Plan", "9876500018", { duration: 25 }),
      admission("Bad Method", "9876500019", { method: "card" }),
      admission("Bad Phone", "12345"),
    ];
    for (const body of bad) {
      const r = await as("gymA").post("/api/gym/members", body);
      assert.equal(r.status, 400, `${body.name}: ${r.status} ${JSON.stringify(r.json)}`);
    }
    // A due can't be overpaid, paid in the future or paid when nothing is owed
    assert.equal((await as("gymA").post(`/api/gym/members/${state.memberA}/due`, { amount: 501, method: "cash" })).status, 400);
    assert.equal((await as("gymA").post(`/api/gym/members/${state.memberA}/due`, { amount: 100, method: "cash", paidOn: rules.addDays(today, 1) })).status, 400);
    assert.equal(await count(), payments, "no payment was written");
    const [[row]] = await connection.query("SELECT due_amount FROM gym_members WHERE id = ?", [state.memberA]);
    assert.equal(row.due_amount, 500);
  }));

  it("7. attendance: another gym's member reads as no visits; bad history queries are refused", run(async () => {
    assert.equal((await as("gymB").post(`/api/gym/members/${state.memberB}/check-in`)).status, 200);
    const leak = await as("gymA").get(`/api/gym/attendance/visits?memberId=${state.memberB}`);
    assert.equal(leak.status, 200);
    assert.equal(leak.json.total, 0, "gym B's visit isn't in gym A's history");
    const csv = await fetch(`${server.baseUrl}/api/gym/attendance/export?memberId=${state.memberB}`, { headers: { Authorization: `Bearer ${tokens.gymA}` } });
    assert.equal(csv.status, 200);
    assert.doesNotMatch(await csv.text(), /Meena/);
    for (const q of ["from=2026-13-01", `from=${today}&to=${rules.addDays(today, -1)}`, "status=gone", "page=0", "memberId=abc", "sort=name", `from=${rules.addDays(today, -400)}`]) {
      assert.equal((await as("gymA").get(`/api/gym/attendance/visits?${q}`)).status, 400, q);
    }
    const sqlSearch = await as("gymA").get(`/api/gym/attendance/visits?search=${encodeURIComponent("' OR 1=1 --")}`);
    assert.equal(sqlSearch.status, 200);
    assert.equal(sqlSearch.json.total, 0);
    // Location settings: out of range and the null island are refused
    for (const body of [{ latitude: 91, longitude: 77, radiusM: 100 }, { latitude: 0, longitude: 0, radiusM: 100 }, { latitude: 13, longitude: 77, radiusM: 5 }, { latitude: "13", longitude: 77, radiusM: 100 }]) {
      assert.equal((await as("gymA").put("/api/gym/attendance/location", body)).status, 400, JSON.stringify(body));
    }
  }));

  it("8. a gym admin can't switch to a branch of another gym", run(async () => {
    const r = await as("gymA").post("/api/gym/branch", { branchId: state.gymB });
    assert.equal(r.status, 404);
    const [[row]] = await connection.query("SELECT COUNT(*) AS n FROM gym_staff WHERE user_id = ? AND gym_id = ?", [identities.gymA.id, state.gymB]);
    assert.equal(row.n, 0);
    assert.equal((await as("gymA").get("/api/gym/dashboard")).json.gym.branch, "Tumkur");
  }));

  it("9. Transactions: the today filter and kind filter, and paging cursors that don't leak", run(async () => {
    const all = await as("gymA").get("/api/gym/payments?today=1");
    assert.equal(all.status, 200);
    assert.ok(all.json.payments.every((p) => p.paidOn === today));
    assert.ok(all.json.payments.length >= 1);
    assert.equal((await as("gymA").get("/api/gym/payments?kind=refund")).status, 400);
    assert.equal((await as("gymA").get("/api/gym/payments?before=abc")).status, 400);
    const cursor = await as("gymA").get("/api/gym/payments?before=999999999");
    assert.ok(cursor.json.payments.every((p) => p.memberId === null || p.memberId !== state.memberB), "never gym B's payments");
  }));

  it("10. part due payments: an overdue member keeps their date; an amount owed always has one", run(async () => {
    // Overdue: the app no longer re-sends the past date, and the server keeps it
    await connection.query("UPDATE gym_members SET due_by = ? WHERE id = ?", [rules.addDays(today, -3), state.memberA]);
    const kept = await as("gymA").post(`/api/gym/members/${state.memberA}/due`, { amount: 100, method: "cash" });
    assert.equal(kept.status, 200, JSON.stringify(kept.json));
    assert.deepEqual([kept.json.member.due, kept.json.member.dueBy, kept.json.member.overdue], [400, rules.addDays(today, -3), true]);
    assert.equal((await as("gymA").post(`/api/gym/members/${state.memberA}/due`, { amount: 100, method: "cash", dueBy: rules.addDays(today, -3) })).status, 400, "sending the past date is refused");
    // A member owing with no date on record (from before due dates): a part payment must give one
    await connection.query("UPDATE gym_members SET due_by = NULL WHERE id = ?", [state.memberA]);
    const payments = (await connection.query("SELECT COUNT(*) AS n FROM gym_payments WHERE member_id = ?", [state.memberA]))[0][0].n;
    const noDate = await as("gymA").post(`/api/gym/members/${state.memberA}/due`, { amount: 100, method: "cash" });
    assert.equal(noDate.status, 400, JSON.stringify(noDate.json));
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM gym_payments WHERE member_id = ?", [state.memberA]))[0][0].n, payments, "nothing written");
    const dated = await as("gymA").post(`/api/gym/members/${state.memberA}/due`, { amount: 100, method: "cash", dueBy: rules.addDays(today, 5) });
    assert.deepEqual([dated.status, dated.json.member.due, dated.json.member.dueBy], [200, 300, rules.addDays(today, 5)]);
    const full = await as("gymA").post(`/api/gym/members/${state.memberA}/due`, { amount: 300, method: "online" });
    assert.deepEqual([full.status, full.json.member.due, full.json.member.dueBy], [200, 0, null], "paid in full needs no date");
  }));
});
