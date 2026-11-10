// Members' meal problems, customers and reports end to end (Meal Operations phase 6, 2026-11-10):
// test accounts in justfit_test against the real Express server. A member reports a problem on
// their own order (with a photo); the Super Admin takes it, resolves it with a refund (within what
// was paid) or closes it, reopens it; every step is in the trail. The customer page and the report
// read it all. Attack paths: another member's order, a fake photo, members on admin routes, refunds
// above what was paid, unknown actions, bad ranges.
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

const rules = require("../../meals/rules");
const { png } = require("./images.js");
describe("meal issues e2e: reports, working them, customers and the reports screen", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const DELIVERS = "599251";
  const today = rules.indiaNow().date;
  const tomorrow = rules.addDays(today, 1);
  const base = "/api/admin/kitchen";

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const address = (pincode) => ({
    kind: "home", receiverName: "Asha Rao", receiverPhone: "9876543210", house: "Flat 2A", street: "80 Feet Road", landmark: null, city: "Bengaluru",
    pincode, formattedAddress: "80 Feet Road, Bengaluru", latitude: 12.9352, longitude: 77.6245, instructions: null, makeDefault: false,
  });
  const pay = async (token, made) => {
    const paid = await api("POST", "/api/orders/gateway/dummy/checkout", token, { razorpay_order_id: made.checkout.order_id, method: "upi", outcome: "success" });
    const { status: _s, ...answer } = paid.json;
    return api("POST", `/api/subscriptions/${made.subscription.id}/verify-payment`, token, answer);
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
      for (const [tag, role] of [["admin", "admin"], ["memberA", "user"], ["memberB", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("INSERT INTO delivery_pincodes (pincode, area) VALUES (?, 'Koramangala')", [DELIVERS]);
    for (const [tag, key] of [["memberA", "addressA"], ["memberB", "addressB"]]) {
      const saved = await api("POST", "/api/addresses", tokens[tag], address(DELIVERS));
      assert.equal(saved.status, 201, JSON.stringify(saved.json));
      state[key] = saved.json.savedId;
    }
    const slots = { breakfast: { startsAt: "07:00", endsAt: "09:00", active: true }, lunch: { startsAt: "12:30", endsAt: "14:00", active: true }, dinner: { startsAt: "19:00", endsAt: "21:00", active: true } };
    assert.equal((await api("PUT", `${base}/slots`, tokens.admin, { slots })).status, 200);
    state.meals = [];
    for (const name of [`Paneer Bowl ${runId}`, `Chicken Bowl ${runId}`]) {
      const meal = await api("POST", `${base}/meals`, tokens.admin, { name, diet: "vegetarian", calories: 520, proteinG: 32, carbsG: 48, fatG: 18, price: 249 });
      state.meals.push(meal.json.meal.id);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const all = Object.values(identities).map((i) => i.id);
        if (all.length) {
          await connection.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))", [all]);
          await connection.query("DELETE FROM orders WHERE user_id IN (?)", [all]);
          await connection.query("DELETE FROM meal_issues WHERE user_id IN (?)", [all]);
          await connection.query("DELETE FROM meal_subscriptions WHERE user_id IN (?)", [all]);
        }
        await connection.query("DELETE FROM meal_plans WHERE name LIKE ?", [`%${runId}%`]);
        await connection.query("DELETE FROM meals WHERE name LIKE ?", [`%${runId}%`]);
        await connection.query("DELETE FROM delivery_pincodes WHERE pincode = ?", [DELIVERS]);
        if (all.length) await db.deleteUsers(connection, all);
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

  const order = () => ({ clientId: crypto.randomUUID(), addressId: state.addressA, date: tomorrow, slot: "lunch", items: [{ mealId: state.meals[0], quantity: 2 }] });
  const placePaid = async (token, body) => {
    const placed = await api("POST", "/api/orders", token, body);
    if (placed.status !== 201 || !placed.json.checkout) return placed;
    const paid = await api("POST", "/api/orders/gateway/dummy/checkout", token, { razorpay_order_id: placed.json.checkout.order_id, method: "upi", outcome: "success" });
    const { status: _s, ...answer } = paid.json;
    const verified = await api("POST", `/api/orders/${placed.json.order.id}/verify-payment`, token, answer);
    return { status: verified.status, json: verified.json };
  };

  it("1. a member reports a problem on their own order, with a photo", run(async () => {
    const placed = await placePaid(tokens.memberA, order());
    assert.equal(placed.status, 200, JSON.stringify(placed.json));
    state.order = placed.json.order.id;
    assert.equal(placed.json.order.total, 498);
    const report = (token, body) => api("POST", "/api/meal-issues", token, body);
    const good = { orderId: state.order, category: "missing_meal", description: "One of the two bowls was missing" };
    assert.equal((await report(null, good)).status, 401);
    assert.equal((await report(tokens.memberB, good)).status, 404, "another member's order");
    for (const bad of [{ ...good, category: "rude" }, { ...good, description: "short" }, { ...good, subscriptionId: state.order }, { ...good, userId: "x" }]) {
      assert.equal((await report(tokens.memberA, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await report(tokens.memberA, { ...good, photo: { data: Buffer.from("not an image").toString("base64"), mediaType: "image/png" } })).status, 415);
    const sent = await report(tokens.memberA, { ...good, photo: { data: png(640, 480).toString("base64"), mediaType: "image/png" } });
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    state.issue = sent.json.issue.id;
    assert.match(sent.json.issue.code, /^ISS-\d{4}$/);
    assert.equal(sent.json.issue.status, "open");
    assert.equal(sent.json.issue.photoUrl, undefined, "members never get the photo link");
    assert.equal((await report(tokens.memberA, good)).status, 409, "one open report per order");
    const mine = await api("GET", "/api/meal-issues", tokens.memberA);
    assert.deepEqual(mine.json.issues.map((i) => i.id), [state.issue]);
    assert.equal((await api("GET", "/api/meal-issues", tokens.memberB)).json.issues.length, 0);
  }));

  it("2. the admin works it: take, refund within what was paid, resolve, reopen, close", run(async () => {
    const base2 = `${base}/issues`;
    assert.equal((await api("GET", base2, tokens.memberA)).status, 403);
    const list = await api("GET", `${base2}?status=open`, tokens.admin);
    assert.equal(list.json.counts.open, 1);
    const one = await api("GET", `${base2}/${state.issue}`, tokens.admin);
    assert.equal(one.json.issue.member.id, identities.memberA.id);
    const photo = await fetch(`${server.baseUrl}${one.json.issue.photoUrl}`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
    assert.equal(photo.status, 200);
    assert.equal((await fetch(`${server.baseUrl}${one.json.issue.photoUrl}`, { headers: { Authorization: `Bearer ${tokens.memberA}` } })).status, 403);
    const act = (action, body = {}) => api("POST", `${base2}/${state.issue}/${action}`, tokens.admin, body);
    assert.equal((await act("assign")).json.issue.status, "in_progress");
    assert.equal((await act("delete")).status, 404);
    assert.equal((await act("resolve", { note: "Refunded", refund: 600 })).status, 400, "more than the ₹498 paid");
    assert.equal((await act("resolve", {})).status, 400, "a note is needed");
    const resolved = await act("resolve", { note: "Sorry! Refunded one bowl", refund: 249 });
    assert.deepEqual({ status: resolved.json.issue.status, refund: resolved.json.issue.refund }, { status: "resolved", refund: 249 });
    assert.equal((await act("note", { note: "late note" })).status, 400, "closed: reopen first");
    const member = (await api("GET", "/api/meal-issues", tokens.memberA)).json.issues[0];
    assert.deepEqual({ note: member.resolutionNote, refund: member.refund }, { note: "Sorry! Refunded one bowl", refund: 249 });
    assert.equal((await act("reopen", { note: "Member called back" })).json.issue.status, "open");
    const closed = await act("reject", { note: "Second bowl was in a separate bag" });
    assert.equal(closed.json.issue.status, "rejected");
    assert.deepEqual(closed.json.issue.events.map((e) => e.action), ["opened", "assign", "resolve", "reopen", "reject"]);
    const [[audit]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action LIKE 'order.issue_%'");
    assert.equal(Number(audit.n), 4);
  }));

  it("3. the customer page and the reports", run(async () => {
    assert.equal((await api("GET", `${base}/customers/${identities.memberA.id}`, tokens.memberA)).status, 403);
    assert.equal((await api("GET", `${base}/customers/nobody-here`, tokens.admin)).status, 404);
    assert.equal((await api("GET", `${base}/customers/${encodeURIComponent("x' OR 1=1")}`, tokens.admin)).status, 400);
    const c = (await api("GET", `${base}/customers/${identities.memberA.id}`, tokens.admin)).json.customer;
    assert.equal(c.orders[0].id, state.order);
    assert.equal(c.addresses.length, 1);
    assert.equal(c.issues[0].id, state.issue);
    const report = await api("GET", `${base}/reports`, tokens.admin);
    assert.equal(report.status, 200, JSON.stringify(report.json));
    assert.equal(report.json.business.revenue, 498);
    assert.equal(report.json.business.individualOrders, 1);
    assert.equal(report.json.business.averageOrder, 498);
    assert.equal(typeof report.json.subscriptions.started, "number");
    assert.equal((await api("GET", `${base}/reports`, tokens.memberA)).status, 403);
    for (const bad of ["from=2026-12-01&to=2026-11-01", "to=2099-01-01", "format=pdf", "from=nope"]) assert.equal((await api("GET", `${base}/reports?${bad}`, tokens.admin)).status, 400, bad);
    const file = await fetch(`${server.baseUrl}${base}/reports?format=xlsx`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
    assert.equal(file.status, 200);
    assert.equal(Buffer.from(await file.arrayBuffer()).subarray(0, 2).toString(), "PK");
  }));
});
