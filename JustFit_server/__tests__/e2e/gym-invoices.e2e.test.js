// Invoices end to end: test accounts in justfit_test against the real Express server. Two gyms,
// each with a gym admin; one adds Staff. Every payment saved gets the branch's next invoice
// number; the invoice reads by payment and by member (the latest payment), a counter sale is
// billed to a walk-in customer, an older payment with no number is numbered the first time its
// invoice opens and keeps it, and Invoice details (address, phone, GSTIN) are the gym admin's
// alone and print on the next invoice. Attack paths: no session, a member account, another gym's
// payment and member ids (404), Staff without the Members area (403), SQL in the ids, bad GSTINs
// and unexpected fields (400). The gym's logo (gym/logos.js): the gym admin uploads, replaces and
// removes it, the invoice carries it as a data URL, Staff and members can't change it.
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
const rules = require("../../gym/rules.js");
const { png, body } = require("./images.js");

describe("gym invoices e2e: numbers, reads, Invoice details, and only at the payment's gym", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, logoDir;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();

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
  const logoFiles = () => fs.readdirSync(logoDir).filter((f) => !f.startsWith("."));
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    logoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-gym-logos-e2e-"));
    server = await startTestServer({ ...env, GYM_LOGO_DIR: logoDir });
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["staffA", "user"], ["member", "user"]]) {
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
          for (const table of ["gym_activity_log", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
        if (identities[tag].sessionId) await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${error.message}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (logoDir) fs.rmSync(logoDir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms with their gym admins and Staff; an admission, a counter sale and a paid-up admission", run(async () => {
    for (const [key, name, branch, tag] of [["gymA", "Forma", "Tumkur", "gymA"], ["gymB", "Just Fit", "Indiranagar", "gymB"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[tag].phone })).status, 201);
    }
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.staffA.phone, kind: "staff" })).status, 201, "Staff at gym A");

    const ravi = await api("POST", "/api/gym/members", tokens.gymA, { name: "Ravi Kumar", phone: "9123456789", email: "ravi@example.com", duration: 3, fee: 4500, paid: 4000, method: "cash", dueBy: "2027-01-15" });
    assert.equal(ravi.status, 201, JSON.stringify(ravi.json));
    state.ravi = ravi.json.member.id;
    state.raviCode = ravi.json.member.code;
    state.raviAdmission = ravi.json.payments.find((p) => p.kind === "admission").id;

    const sale = await api("POST", "/api/gym/sales", tokens.gymA, { item: "Whey 1 kg", category: "supplement", amount: 2500, method: "online" });
    assert.equal(sale.status, 201, JSON.stringify(sale.json));
    state.sale = sale.json.payment.id;

    const bhavana = await api("POST", "/api/gym/members", tokens.gymB, { name: "Bhavana", duration: 1, fee: 1500, paid: 1500, method: "online" });
    assert.equal(bhavana.status, 201, JSON.stringify(bhavana.json));
    state.bhavana = bhavana.json.member.id;
    state.bhavanaAdmission = bhavana.json.payments[0].id;

    const [rows] = await connection.query("SELECT invoice_no FROM gym_payments WHERE gym_id = ? ORDER BY id", [state.gymA]);
    assert.deepEqual(rows.map((r) => r.invoice_no), [1, 2], "gym A's payments are numbered as they are saved");
    const [[counter]] = await connection.query("SELECT next_invoice_no FROM gyms WHERE id = ?", [state.gymA]);
    assert.equal(counter.next_invoice_no, 3);
  }));

  it("2. the invoice by payment and by member: the number, Bill to, the item, the balance and the standing today", run(async () => {
    const byPayment = await api("GET", `/api/gym/payments/${state.raviAdmission}/invoice`, tokens.gymA);
    assert.equal(byPayment.status, 200, JSON.stringify(byPayment.json));
    assert.deepEqual(byPayment.json, {
      number: "INV-FOR-TUM-0001",
      date: today,
      gym: { name: "Forma", branch: "Tumkur", area: "Tumkur", city: "Bengaluru", address: null, phone: null, gstin: null, logoDataUrl: null },
      billTo: { id: state.ravi, name: "Ravi Kumar", code: state.raviCode, phone: "9123456789", email: "ravi@example.com" },
      item: { kind: "admission", label: "Membership", detail: "3 Months", title: "Ravi Kumar" },
      amount: 4000,
      method: "cash",
      paymentId: state.raviAdmission,
      membership: { plan: "3 Months", until: rules.planEnd(today, 3), active: true },
      balance: { due: 500, dueBy: "2027-01-15" },
    });
    const byMember = await api("GET", `/api/gym/members/${state.ravi}/invoice`, tokens.gymA);
    assert.equal(byMember.status, 200);
    assert.deepEqual(byMember.json, byPayment.json, "the member's latest payment is the admission");

    const sale = await api("GET", `/api/gym/payments/${state.sale}/invoice`, tokens.gymA);
    assert.equal(sale.status, 200, JSON.stringify(sale.json));
    assert.equal(sale.json.number, "INV-FOR-TUM-0002");
    assert.equal(sale.json.billTo, null, "a counter sale is billed to a walk-in customer");
    assert.equal(sale.json.membership, null);
    assert.equal(sale.json.balance, null);
    assert.deepEqual(sale.json.item, { kind: "sale", label: "Product", detail: "Supplement", title: "Whey 1 kg" });

    const b = await api("GET", `/api/gym/payments/${state.bhavanaAdmission}/invoice`, tokens.gymB);
    assert.equal(b.status, 200);
    assert.equal(b.json.number, "INV-JUS-IND-0001", "each branch counts from 1");
    assert.equal(b.json.balance, null, "paid in full");
    assert.equal(b.json.membership.active, true);
  }));

  it("3. a later payment takes the next number; the first keeps its own; an unnumbered older payment is numbered once", run(async () => {
    const due = await api("POST", `/api/gym/members/${state.ravi}/due`, tokens.gymA, { amount: 500, method: "online" });
    assert.equal(due.status, 200, JSON.stringify(due.json));
    const latest = await api("GET", `/api/gym/members/${state.ravi}/invoice`, tokens.gymA);
    assert.equal(latest.json.number, "INV-FOR-TUM-0003");
    assert.equal(latest.json.item.label, "Due payment");
    assert.equal(latest.json.balance, null, "nothing owed now");
    assert.equal((await api("GET", `/api/gym/payments/${state.raviAdmission}/invoice`, tokens.gymA)).json.number, "INV-FOR-TUM-0001", "numbers never change");

    // A payment saved before the migration has no number: the first read numbers it
    await connection.query("UPDATE gym_payments SET invoice_no = NULL WHERE id = ?", [state.sale]);
    const first = await api("GET", `/api/gym/payments/${state.sale}/invoice`, tokens.gymA);
    assert.equal(first.json.number, "INV-FOR-TUM-0004", "the branch's next number, never a reused one");
    const second = await api("GET", `/api/gym/payments/${state.sale}/invoice`, tokens.gymA);
    assert.equal(second.json.number, "INV-FOR-TUM-0004", "and it keeps it");
    const [[row]] = await connection.query("SELECT invoice_no FROM gym_payments WHERE id = ?", [state.sale]);
    assert.equal(row.invoice_no, 4);
  }));

  it("4. Invoice details: the gym admin's alone, cleaned, cleared by an empty field, printed on the next invoice", run(async () => {
    const empty = await api("GET", "/api/gym/invoice-details", tokens.gymA);
    assert.deepEqual(empty.json, { address: null, phone: null, gstin: null, logoUrl: null });
    const set = await api("PATCH", "/api/gym/invoice-details", tokens.gymA, { address: " 12, 1st Main Road,  SS Puram ", phone: "+91 98765 43210", gstin: "29abcde1234f1z5" });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual(set.json, { address: "12, 1st Main Road, SS Puram", phone: "9876543210", gstin: "29ABCDE1234F1Z5", logoUrl: null });
    const invoice = await api("GET", `/api/gym/payments/${state.raviAdmission}/invoice`, tokens.gymA);
    assert.deepEqual(invoice.json.gym, { name: "Forma", branch: "Tumkur", area: "Tumkur", city: "Bengaluru", address: "12, 1st Main Road, SS Puram", phone: "9876543210", gstin: "29ABCDE1234F1Z5", logoDataUrl: null });
    assert.equal((await api("GET", `/api/gym/payments/${state.bhavanaAdmission}/invoice`, tokens.gymB)).json.gym.gstin, null, "another branch's invoices are untouched");
    const cleared = await api("PATCH", "/api/gym/invoice-details", tokens.gymA, { gstin: "" });
    assert.deepEqual(cleared.json, { address: "12, 1st Main Road, SS Puram", phone: "9876543210", gstin: null, logoUrl: null });
    const [[audit]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE admin_id = ? AND action = 'gym.edit'", [identities.gymA.id]);
    assert.equal(audit.n, 2, "each change is in the activity log");

    assert.equal((await api("PATCH", "/api/gym/invoice-details", tokens.gymA, { gstin: "29ABCDE1234F1X5" })).status, 400, "a bad GSTIN");
    assert.equal((await api("PATCH", "/api/gym/invoice-details", tokens.gymA, { phone: "12345" })).status, 400, "a bad phone");
    assert.equal((await api("PATCH", "/api/gym/invoice-details", tokens.gymA, {})).status, 400, "nothing to change");
    assert.equal((await api("PATCH", "/api/gym/invoice-details", tokens.gymA, { gymId: state.gymB, address: "x" })).status, 400, "an unexpected field");
    assert.equal((await api("PATCH", "/api/gym/invoice-details", tokens.staffA, { address: "Staff" })).status, 403, "Staff can't change them");
    assert.equal((await api("GET", "/api/gym/invoice-details", tokens.staffA)).status, 200, "but can read them");
    assert.equal((await api("PATCH", "/api/gym/invoice-details", tokens.member, { address: "x" })).status, 403);
  }));

  it("4b. the gym's logo: the gym admin uploads, replaces and removes it; the invoice carries it; Staff and members can't change it", run(async () => {
    assert.deepEqual(logoFiles(), [], "no file before an upload");
    const refusedStaff = await api("PUT", "/api/gym/logo", tokens.staffA, body(png(200, 80), "image/png"));
    assert.equal(refusedStaff.status, 403, "Staff can't set the logo");
    assert.equal((await api("PUT", "/api/gym/logo", tokens.member, body(png(200, 80), "image/png"))).status, 403);
    assert.equal((await api("PUT", "/api/gym/logo", null, body(png(200, 80), "image/png"))).status, 401);
    assert.equal((await api("GET", "/api/gym/logo", tokens.gymA)).status, 404, "no logo yet");

    assert.equal((await api("PUT", "/api/gym/logo", tokens.gymA, body(png(20, 20), "image/png"))).status, 400, "too small");
    assert.equal((await api("PUT", "/api/gym/logo", tokens.gymA, body(Buffer.from("not an image at all, just text"), "image/png"))).status, 415, "not an image");
    assert.equal((await api("PUT", "/api/gym/logo", tokens.gymA, body(png(200, 80), "image/jpeg"))).status, 415, "the label must match the bytes");
    assert.equal((await api("PUT", "/api/gym/logo", tokens.gymA, { data: body(png(200, 80), "image/png").data, mediaType: "image/png", gymId: state.gymB })).status, 400, "an unexpected field");
    assert.deepEqual(logoFiles(), [], "a refused upload leaves no file");

    const set = await api("PUT", "/api/gym/logo", tokens.gymA, body(png(200, 80), "image/png"));
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.logoUrl, "/api/gym/logo", "Invoice details say there is a logo");
    assert.equal(logoFiles().length, 1);
    const read = await api("GET", "/api/gym/logo", tokens.gymA);
    assert.equal(read.status, 200);
    assert.equal(read.type, "image/png");
    assert.equal(read.bytes.length, png(200, 80).length, "the bytes come back as uploaded");
    assert.equal((await api("GET", "/api/gym/logo", tokens.staffA)).status, 200, "Staff read it for the preview");
    assert.equal((await api("GET", "/api/gym/logo", tokens.gymB)).status, 404, "another gym has no logo");
    assert.equal((await api("GET", "/api/gym/logo", tokens.member)).status, 403);

    const invoice = await api("GET", `/api/gym/payments/${state.raviAdmission}/invoice`, tokens.gymA);
    assert.equal(invoice.json.gym.logoDataUrl, `data:image/png;base64,${png(200, 80).toString("base64")}`, "the invoice carries the logo as a data URL");
    assert.equal((await api("GET", `/api/gym/payments/${state.bhavanaAdmission}/invoice`, tokens.gymB)).json.gym.logoDataUrl, null, "another gym's invoices have none");

    const replaced = await api("PUT", "/api/gym/logo", tokens.gymA, body(png(120, 120), "image/png"));
    assert.equal(replaced.status, 200);
    assert.equal(logoFiles().length, 1, "the old file is deleted after a replace");
    assert.equal((await api("GET", "/api/gym/logo", tokens.gymA)).bytes.length, png(120, 120).length);

    assert.equal((await api("DELETE", "/api/gym/logo", tokens.staffA)).status, 403, "Staff can't remove it");
    const removed = await api("DELETE", "/api/gym/logo", tokens.gymA);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.logoUrl, null);
    assert.deepEqual(logoFiles(), [], "the file is gone");
    assert.equal((await api("GET", "/api/gym/logo", tokens.gymA)).status, 404);
    assert.equal((await api("GET", `/api/gym/payments/${state.raviAdmission}/invoice`, tokens.gymA)).json.gym.logoDataUrl, null);
    assert.equal((await api("DELETE", "/api/gym/logo", tokens.gymA)).status, 200, "removing twice is fine");
    const [[audit]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE admin_id = ? AND action = 'gym.edit' AND summary LIKE '%logo%'", [identities.gymA.id]);
    assert.equal(audit.n, 3, "added, replaced and removed are in the activity log");
  }));

  it("5. no session, a member and another gym get nothing; Staff need the Members area; SQL in the ids is a 400", run(async () => {
    for (const token of [null, "jfs_not-a-token"]) {
      assert.equal((await api("GET", `/api/gym/payments/${state.raviAdmission}/invoice`, token)).status, 401);
      assert.equal((await api("GET", "/api/gym/invoice-details", token)).status, 401);
    }
    assert.equal((await api("GET", `/api/gym/payments/${state.raviAdmission}/invoice`, tokens.member)).status, 403);
    assert.equal((await api("GET", `/api/gym/payments/${state.raviAdmission}/invoice`, tokens.gymB)).status, 404, "another gym can't read it");
    assert.equal((await api("GET", `/api/gym/members/${state.ravi}/invoice`, tokens.gymB)).status, 404, "nor the member's");
    assert.equal((await api("GET", `/api/gym/payments/${state.bhavanaAdmission}/invoice`, tokens.gymA)).status, 404);
    for (const bad of ["1%20OR%201=1", "0", "abc", "1;DROP%20TABLE%20gym_payments"]) {
      assert.equal((await api("GET", `/api/gym/payments/${bad}/invoice`, tokens.gymA)).status, 400, bad);
      assert.equal((await api("GET", `/api/gym/members/${bad}/invoice`, tokens.gymA)).status, 400, bad);
    }
    const [[still]] = await connection.query("SELECT COUNT(*) AS n FROM gym_payments WHERE gym_id = ?", [state.gymA]);
    assert.equal(still.n, 3);

    assert.equal((await api("GET", `/api/gym/payments/${state.raviAdmission}/invoice`, tokens.staffA)).status, 200, "Staff with every area read invoices");
    assert.equal((await api("PUT", `/api/gym/staff/${encodeURIComponent(identities.staffA.id)}/permissions`, tokens.gymA, { areas: ["payments"] })).status, 200);
    const refused = await api("GET", `/api/gym/payments/${state.raviAdmission}/invoice`, tokens.staffA);
    assert.equal(refused.status, 403);
    assert.match(refused.json.error, /Members/);
    assert.equal((await api("GET", `/api/gym/members/${state.ravi}/invoice`, tokens.staffA)).status, 403);
  }));
});
