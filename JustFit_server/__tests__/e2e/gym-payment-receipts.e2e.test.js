// Payment bills end to end: test accounts in justfit_test against the real Express server, the
// files in a throwaway folder (PAYMENT_RECEIPT_DIR). A gym admin admits a member, attaches the
// plan payment's bill, reads, replaces and removes it, and the member's page carries it. Attack
// paths: no session, a member account, a gym admin of another gym (their payment ids are 404s and
// leave no file), bad and oversized images, and SQL in the payment id.
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

describe("payment bills e2e: attach, read, replace, remove, and only at the payment's gym", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, receiptDir;
  const identities = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const type = response.headers.get("content-type") ?? "";
    if (type.startsWith("image/")) return { status: response.status, type, bytes: Buffer.from(await response.arrayBuffer()), cache: response.headers.get("cache-control") };
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const files = () => fs.readdirSync(receiptDir).filter((f) => !f.startsWith("."));
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    receiptDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-payment-receipts-e2e-"));
    server = await startTestServer({ ...env, PAYMENT_RECEIPT_DIR: receiptDir });
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["member", "user"]]) {
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
          for (const table of ["gym_activity_log", "gym_payments", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
    if (receiptDir) fs.rmSync(receiptDir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms, each with a gym admin and an admitted member; the admission payment has no bill", run(async () => {
    for (const [key, name, branch, tag] of [["gymA", "Forma", "Tumkur", "gymA"], ["gymB", "Just Fit", "Indiranagar", "gymB"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[tag].phone })).status, 201);
      const admitted = await api("POST", "/api/gym/members", tokens[tag], { name: `Bill ${branch}`, duration: 3, fee: 4500, paid: 4000, method: "cash", dueBy: "2027-01-15" });
      assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
      const payment = admitted.json.payments.find((p) => p.kind === "admission");
      assert.ok(payment, "the admission payment comes back with the member");
      assert.equal(payment.receiptUrl, null, "no bill yet");
      state[`${key}Member`] = admitted.json.member.id;
      state[`${key}Payment`] = payment.id;
    }
  }));

  it("2. the gym admin attaches, reads and replaces the bill; the member's page carries it; the old file goes", run(async () => {
    const id = state.gymAPayment;
    const first = png(300, 800, [240, 240, 240]); // a till slip is tall, not square
    const put = await api("PUT", `/api/gym/payments/${id}/receipt`, tokens.gymA, body(first, "image/png"));
    assert.equal(put.status, 200, JSON.stringify(put.json));
    assert.equal(put.json.payment.id, id);
    const url = put.json.payment.receiptUrl;
    assert.match(url, new RegExp(`^/api/gym/payments/${id}/receipt\\?v=[0-9a-f]{8}$`));
    assert.equal(files().length, 1, "one file on disk");

    const read = await api("GET", url, tokens.gymA);
    assert.equal(read.status, 200);
    assert.equal(read.type, "image/png");
    assert.ok(read.bytes.equals(first), "the bytes come back as uploaded");
    assert.match(read.cache ?? "", /private/, "never cached by a shared cache");

    const detail = await api("GET", `/api/gym/members/${state.gymAMember}`, tokens.gymA);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.payments.find((p) => p.id === id).receiptUrl, url, "the member's page carries it");

    const replaced = await api("PUT", `/api/gym/payments/${id}/receipt`, tokens.gymA, body(png(300, 300), "image/png"));
    assert.equal(replaced.status, 200);
    assert.notEqual(replaced.json.payment.receiptUrl, url, "a new bill, a new URL");
    assert.equal(files().length, 1, "the old file went");
    state.url = replaced.json.payment.receiptUrl;
  }));

  it("3. no session, a member, and another gym's admin get nothing; SQL in the id is a 400", run(async () => {
    const id = state.gymAPayment;
    const image = body(png(200, 200), "image/png");
    for (const token of [null, "jfs_not-a-token"]) {
      assert.equal((await api("PUT", `/api/gym/payments/${id}/receipt`, token, image)).status, 401);
      assert.equal((await api("GET", state.url, token)).status, 401);
    }
    assert.equal((await api("PUT", `/api/gym/payments/${id}/receipt`, tokens.member, image)).status, 403);
    assert.equal((await api("GET", state.url, tokens.gymB)).status, 404, "another gym can't read it");
    assert.equal((await api("PUT", `/api/gym/payments/${id}/receipt`, tokens.gymB, image)).status, 404, "or replace it");
    assert.equal((await api("DELETE", `/api/gym/payments/${id}/receipt`, tokens.gymB)).status, 404, "or remove it");
    assert.equal(files().length, 1, "a refused upload leaves no file");
    for (const bad of ["1%20OR%201=1", "0", "abc"]) assert.equal((await api("GET", `/api/gym/payments/${bad}/receipt`, tokens.gymA)).status, 400, bad);
  }));

  it("4. bad images are refused before anything is written", run(async () => {
    const id = state.gymBPayment;
    const cases = [
      [{ data: "x", mediaType: "image/png", paymentId: state.gymAPayment }, 400],
      [body(Buffer.from("%PDF-1.4 ..............."), "application/pdf"), 415],
      [body(png(200, 200), "image/jpeg"), 415],
      [body(png(40, 400), "image/png"), 400],
    ];
    for (const [payload, status] of cases) assert.equal((await api("PUT", `/api/gym/payments/${id}/receipt`, tokens.gymB, payload)).status, status, JSON.stringify(payload).slice(0, 60));
    const huge = await api("PUT", `/api/gym/payments/${id}/receipt`, tokens.gymB, body(png(200, 200, undefined, 4.5 * 1024 * 1024), "image/png"));
    assert.equal(huge.status, 413);
    assert.equal(files().length, 1);
    const detail = await api("GET", `/api/gym/members/${state.gymBMember}`, tokens.gymB);
    assert.equal(detail.json.payments.find((p) => p.id === id).receiptUrl, null);
  }));

  it("5. removing the bill deletes its file", run(async () => {
    const id = state.gymAPayment;
    const removed = await api("DELETE", `/api/gym/payments/${id}/receipt`, tokens.gymA);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.payment.receiptUrl, null);
    assert.equal(files().length, 0);
    assert.equal((await api("GET", state.url, tokens.gymA)).status, 404);
    assert.equal((await api("DELETE", `/api/gym/payments/${id}/receipt`, tokens.gymA)).status, 200, "removing none is fine");
    const [[row]] = await connection.query("SELECT receipt_key FROM gym_payments WHERE id = ?", [id]);
    assert.equal(row.receipt_key, null);
  }));
});
