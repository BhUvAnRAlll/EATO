// Gym expenses end to end: test accounts in justfit_test against the real Express server, bill
// photos in a throwaway folder (EXPENSE_BILL_DIR). A gym admin adds, lists, edits and deletes
// expenses, attaches a bill, and Wallet shows what was spent and the net. Attack paths: no
// session, a member account, another gym's admin (their ids are 404s and leave no file), a Staff
// login without the Expenses area (also through /Expenses and a trailing slash), Staff deleting,
// bad input, SQL in the id, the search and the month, and oversized bills.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const { png, body } = require("./images.js");
const { todayInIndia, addDays } = require("../../gym/rules.js");

describe("gym expenses e2e: add, list, edit, bill, delete, Wallet's net, and only at the expense's branch", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, billDir;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = todayInIndia();
  const month = today.slice(0, 7);

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const type = response.headers.get("content-type") ?? "";
    if (type.startsWith("image/")) return { status: response.status, type, bytes: Buffer.from(await response.arrayBuffer()) };
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const files = () => fs.readdirSync(billDir).filter((f) => !f.startsWith("."));
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const rent = { category: "rent", title: "November rent", paidTo: "Landlord", method: "online", amount: 25000, spentOn: today, note: "" };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    billDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-expense-bills-e2e-"));
    server = await startTestServer({ ...env, EXPENSE_BILL_DIR: billDir });
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["staffAll", "user"], ["staffNone", "user"], ["member", "user"]]) {
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
          for (const table of ["gym_expenses", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
    if (billDir) fs.rmSync(billDir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms with their admins; gym A adds two Staff, one without Expenses; nothing spent yet", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Just Fit", "Indiranagar"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    for (const tag of ["staffAll", "staffNone"]) {
      const added = await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities[tag].phone, kind: "staff" });
      assert.equal(added.status, 201, JSON.stringify(added.json));
    }
    const limited = await api("PUT", `/api/gym/staff/${identities.staffNone.id}/permissions`, tokens.gymA, { areas: ["members", "payments"] });
    assert.equal(limited.status, 200, JSON.stringify(limited.json));

    const empty = await api("GET", "/api/gym/expenses", tokens.gymA);
    assert.equal(empty.status, 200, JSON.stringify(empty.json));
    assert.equal(empty.json.month, month);
    assert.deepEqual(empty.json.summary, { total: 0, online: 0, cash: 0, count: 0 });
    assert.equal(empty.json.counts.all, 0);
    assert.deepEqual(empty.json.expenses, []);
    assert.equal(empty.json.canDelete, true, "the gym admin may delete");
  }));

  it("2. the gym admin adds expenses; the list, totals, counts, filter and search follow", run(async () => {
    const added = await api("POST", "/api/gym/expenses", tokens.gymA, rent);
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual({ ...added.json.expense, id: 0 }, { id: 0, category: "rent", title: "November rent", paidTo: "Landlord", method: "online", amount: 25000, spentOn: today, note: null, billUrl: null });
    state.rent = added.json.expense.id;
    const salary = await api("POST", "/api/gym/expenses", tokens.gymA, { category: "salary", paidTo: "Ravi", method: "cash", amount: 12000 });
    assert.equal(salary.status, 201, JSON.stringify(salary.json));
    assert.equal(salary.json.expense.spentOn, today, "the day defaults to today");
    state.salary = salary.json.expense.id;
    // Gym B's own expense, never seen by gym A
    const other = await api("POST", "/api/gym/expenses", tokens.gymB, { category: "electricity", method: "online", amount: 3000 });
    assert.equal(other.status, 201);
    state.gymBExpense = other.json.expense.id;

    const list = await api("GET", `/api/gym/expenses?month=${month}`, tokens.gymA);
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.summary, { total: 37000, online: 25000, cash: 12000, count: 2 });
    assert.deepEqual(list.json.expenses.map((e) => e.id).sort(), [state.rent, state.salary].sort(), "only gym A's");
    assert.equal(list.json.counts.rent, 1);
    assert.equal(list.json.counts.salary, 1);
    assert.equal(list.json.counts.electricity, 0);
    assert.equal(list.json.totals.all, 37000);

    const onlySalary = await api("GET", "/api/gym/expenses?category=salary", tokens.gymA);
    assert.deepEqual(onlySalary.json.expenses.map((e) => e.id), [state.salary]);
    assert.equal(onlySalary.json.summary.total, 37000, "the month's total ignores the filter");
    const searched = await api("GET", `/api/gym/expenses?search=${encodeURIComponent("landlord")}`, tokens.gymA);
    assert.deepEqual(searched.json.expenses.map((e) => e.id), [state.rent]);
    assert.equal(searched.json.counts.all, 1, "the chips' counts follow the search");
    for (const search of ["' OR 1=1 --", "%", "_"]) {
      const injected = await api("GET", `/api/gym/expenses?search=${encodeURIComponent(search)}`, tokens.gymA);
      assert.equal(injected.status, 200, search);
      assert.deepEqual(injected.json.expenses, [], `${search} matches nothing`);
    }
    const lastMonth = await api("GET", `/api/gym/expenses?month=${addDays(`${month}-01`, -1).slice(0, 7)}`, tokens.gymA);
    assert.equal(lastMonth.status, 200);
    assert.deepEqual(lastMonth.json.expenses, [], "another month is its own list");
  }));

  it("3. bad expenses and bad list queries are a 400, and nothing is written", run(async () => {
    const before_ = await api("GET", "/api/gym/expenses", tokens.gymA);
    const bad = [
      { ...rent, gymId: state.gymB },
      { ...rent, category: "party" },
      { ...rent, category: "other", title: "" },
      { ...rent, method: "card" },
      { ...rent, amount: 0 },
      { ...rent, amount: "25000" },
      { ...rent, amount: 1_000_001 },
      { ...rent, spentOn: addDays(today, 1) },
      { ...rent, spentOn: addDays(today, -366) },
      { ...rent, note: "x".repeat(201) },
    ];
    for (const payload of bad) assert.equal((await api("POST", "/api/gym/expenses", tokens.gymA, payload)).status, 400, JSON.stringify(payload).slice(0, 80));
    for (const query of ["month=2026-13", "month=1999-01", `month=${encodeURIComponent("2026-11' OR '1'='1")}`, "category=bogus", "page=0", `search=${"x".repeat(61)}`]) {
      assert.equal((await api("GET", `/api/gym/expenses?${query}`, tokens.gymA)).status, 400, query);
    }
    for (const id of ["0", "abc", "1%20OR%201=1"]) assert.equal((await api("PUT", `/api/gym/expenses/${id}`, tokens.gymA, rent)).status, 400, id);
    const after_ = await api("GET", "/api/gym/expenses", tokens.gymA);
    assert.equal(after_.json.summary.count, before_.json.summary.count);
  }));

  it("4. editing replaces every field and is audited; another gym's expense is a 404", run(async () => {
    const edited = await api("PUT", `/api/gym/expenses/${state.salary}`, tokens.gymA, { category: "salary", title: "Ravi November", paidTo: "Ravi", method: "online", amount: 15000, spentOn: today, note: "Bonus included" });
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
    assert.equal(edited.json.expense.amount, 15000);
    assert.equal(edited.json.expense.method, "online");
    assert.equal(edited.json.expense.note, "Bonus included");
    const [[audit]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE admin_id = ? AND action = 'gym.expense_edit'", [identities.gymA.id]);
    assert.equal(audit.n, 1);
    assert.equal((await api("PUT", `/api/gym/expenses/${state.gymBExpense}`, tokens.gymA, rent)).status, 404, "gym A can't edit gym B's");
    assert.equal((await api("DELETE", `/api/gym/expenses/${state.gymBExpense}`, tokens.gymA)).status, 404, "or delete it");
    const [[untouched]] = await connection.query("SELECT amount FROM gym_expenses WHERE id = ?", [state.gymBExpense]);
    assert.equal(untouched.amount, 3000);
  }));

  it("5. a bill: attached, read, replaced and removed; another gym gets nothing; bad images refused", run(async () => {
    const id = state.rent;
    const first = png(300, 800, [240, 240, 240]);
    const put = await api("PUT", `/api/gym/expenses/${id}/bill`, tokens.gymA, body(first, "image/png"));
    assert.equal(put.status, 200, JSON.stringify(put.json));
    const url = put.json.expense.billUrl;
    assert.match(url, new RegExp(`^/api/gym/expenses/${id}/bill\\?v=[0-9a-f]{8}$`));
    assert.equal(files().length, 1);
    const read = await api("GET", url, tokens.gymA);
    assert.equal(read.status, 200);
    assert.ok(read.bytes.equals(first));

    assert.equal((await api("GET", url, tokens.gymB)).status, 404, "another gym can't read it");
    assert.equal((await api("PUT", `/api/gym/expenses/${id}/bill`, tokens.gymB, body(png(200, 200), "image/png"))).status, 404, "or replace it");
    assert.equal(files().length, 1, "a refused upload leaves no file");
    assert.equal((await api("PUT", `/api/gym/expenses/${id}/bill`, tokens.gymA, body(Buffer.from("%PDF-1.4 ..............."), "application/pdf"))).status, 415);
    assert.equal((await api("PUT", `/api/gym/expenses/${id}/bill`, tokens.gymA, body(png(200, 200, undefined, 4.5 * 1024 * 1024), "image/png"))).status, 413);

    const replaced = await api("PUT", `/api/gym/expenses/${id}/bill`, tokens.gymA, body(png(300, 300), "image/png"));
    assert.equal(replaced.status, 200);
    assert.notEqual(replaced.json.expense.billUrl, url);
    assert.equal(files().length, 1, "the old file went");
    const removed = await api("DELETE", `/api/gym/expenses/${state.rent}/bill`, tokens.gymA);
    assert.equal(removed.json.expense.billUrl, null);
    assert.equal(files().length, 0);
    // Put one back for the delete test
    assert.equal((await api("PUT", `/api/gym/expenses/${id}/bill`, tokens.gymA, body(png(200, 200), "image/png"))).status, 200);
    assert.equal(files().length, 1);
  }));

  it("6. Staff with Expenses add and edit but can't delete; Staff without it are refused everywhere", run(async () => {
    const list = await api("GET", "/api/gym/expenses", tokens.staffAll);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.equal(list.json.canDelete, false);
    const added = await api("POST", "/api/gym/expenses", tokens.staffAll, { category: "cleaning", method: "cash", amount: 800 });
    assert.equal(added.status, 201);
    state.cleaning = added.json.expense.id;
    assert.equal((await api("PUT", `/api/gym/expenses/${state.cleaning}`, tokens.staffAll, { category: "cleaning", method: "cash", amount: 900 })).status, 200);
    assert.equal((await api("DELETE", `/api/gym/expenses/${state.cleaning}`, tokens.staffAll)).status, 403, "only the gym admin deletes");

    for (const route of ["/api/gym/expenses", "/api/gym/Expenses", "/api/gym/expenses/", `/api/gym/expenses/${state.rent}/bill`]) {
      const refused = await api("GET", route, tokens.staffNone);
      assert.ok([403, 404].includes(refused.status), `${route} → ${refused.status}`);
      if (refused.status === 403) assert.match(refused.json.error, /Expenses/);
    }
    assert.equal((await api("POST", "/api/gym/expenses", tokens.staffNone, rent)).status, 403);
    const wallet = await api("GET", "/api/gym/wallet", tokens.staffNone);
    assert.equal(wallet.status, 200, "Wallet is still theirs (Payments)");
    assert.equal(wallet.json.expenses, undefined, "without what was spent");
    assert.equal(wallet.json.net, undefined);
  }));

  it("7. Wallet shows what was spent and the net for the gym admin", run(async () => {
    const admitted = await api("POST", "/api/gym/members", tokens.gymA, { name: "Net Test", duration: 1, fee: 50000, paid: 50000, method: "cash" });
    assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
    const wallet = await api("GET", "/api/gym/wallet", tokens.gymA);
    assert.equal(wallet.status, 200);
    const spent = 25000 + 15000 + 900;
    assert.deepEqual(wallet.json.expenses, { today: spent, month: spent });
    assert.deepEqual(wallet.json.net, { today: wallet.json.today.total - spent, month: wallet.json.month.total - spent });
    assert.equal(wallet.json.month.total, 50000);
  }));

  it("8. the gym admin deletes an expense: its bill file goes, it's audited, and it's gone", run(async () => {
    const deleted = await api("DELETE", `/api/gym/expenses/${state.rent}`, tokens.gymA);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
    assert.equal(files().length, 0, "the bill's file went with it");
    const [[audit]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE admin_id = ? AND action = 'gym.expense_delete'", [identities.gymA.id]);
    assert.equal(audit.n, 1);
    assert.equal((await api("DELETE", `/api/gym/expenses/${state.rent}`, tokens.gymA)).status, 404);
    assert.equal((await api("GET", `/api/gym/expenses/${state.rent}/bill`, tokens.gymA)).status, 404);
  }));

  it("9. no session is a 401 and a member account a 403", run(async () => {
    for (const token of [null, "jfs_not-a-token"]) {
      assert.equal((await api("GET", "/api/gym/expenses", token)).status, 401);
      assert.equal((await api("POST", "/api/gym/expenses", token, rent)).status, 401);
    }
    assert.equal((await api("GET", "/api/gym/expenses", tokens.member)).status, 403);
    assert.equal((await api("POST", "/api/gym/expenses", tokens.member, rent)).status, 403);
  }));
});
