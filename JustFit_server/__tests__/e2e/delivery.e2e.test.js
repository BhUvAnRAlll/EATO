// Deliveries end to end (Meal Operations phase 4, 2026-11-10): test accounts in justfit_test against
// the real Express server. The Super Admin registers delivery partners, gives an order to the best
// free one (or picks one), records each delivery step (the order follows: out for delivery,
// delivered into Macro), marks a failure with a reason, then retries or cancels. Attack paths:
// members on the admin routes, unverified or busy partners, steps out of order, bad bodies.
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
const { png } = require("./images.js");

const paymentRules = require("../../payments/rules");
const rules = require("../../meals/rules");
describe("delivery e2e: partners, assigning, delivery steps, failures and retries", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, photoDir;
  const identities = {};
  const tokens = {};
  const state = {};
  const DELIVERS = "599231";
  const OTHER = "599232";
  const NOWHERE = "599233";
  const tomorrow = rules.addDays(rules.indiaNow().date, 1);
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
  const week = (sessions) => Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, sessions]));
  const kitchen = (name, pincodes) => ({
    name: `${name} ${runId}`, contactName: "Suresh Rao", phone: "9876543210", email: null, address: "12, 5th Block, 80 Feet Road", area: null,
    city: "Bengaluru", pincode: "560095", latitude: null, longitude: null, hours: week([["06:00", "22:00"]]), pincodes, maxDailyOrders: 400, prepCapacity: 120, radiusKm: 6,
  });
  const address = (pincode) => ({
    kind: "home", receiverName: "Asha Rao", receiverPhone: "9876543210", house: "Flat 2A", street: "80 Feet Road", landmark: null, city: "Bengaluru",
    pincode, formattedAddress: "80 Feet Road, Bengaluru", latitude: 12.9352, longitude: 77.6245, instructions: null, makeDefault: false,
  });
  const order = (over = {}) => ({ clientId: crypto.randomUUID(), addressId: state.addressA, date: tomorrow, slot: "lunch", items: [{ mealId: state.mealId, quantity: 2 }], ...over });
  // Pay the Razorpay way and come back with the placed order
  const placePaid = async (token, body) => {
    const placed = await api("POST", "/api/orders", token, body);
    if (placed.status !== 201 || !placed.json.checkout) return placed;
    const paid = await api("POST", "/api/orders/gateway/dummy/checkout", token, { razorpay_order_id: placed.json.checkout.order_id, method: "upi", outcome: "success" });
    const { status: _s, ...answer } = paid.json;
    const verified = await api("POST", `/api/orders/${placed.json.order.id}/verify-payment`, token, answer);
    assert.equal(verified.status, 200, JSON.stringify(verified.json));
    return { status: 201, json: { order: verified.json.order } };
  };
  const step = (id, from, extra = {}) => api("POST", `${base}/orders/${id}/advance`, tokens.admin, { from, ...extra });

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-kitchen-order-photos-"));
    server = await startTestServer({ ...env, MEAL_PHOTO_DIR: photoDir });
    try {
      for (const [tag, role] of [["admin", "admin"], ["memberA", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("INSERT INTO delivery_pincodes (pincode, area) VALUES (?, 'Koramangala'), (?, 'Indiranagar'), (?, 'Hebbal')", [DELIVERS, OTHER, NOWHERE]);
    for (const [key, pincode] of [["addressA", DELIVERS], ["addressOther", OTHER], ["addressNowhere", NOWHERE]]) {
      const saved = await api("POST", "/api/addresses", tokens.memberA, address(pincode));
      assert.equal(saved.status, 201, JSON.stringify(saved.json));
      state[key] = saved.json.savedId;
    }
    const slots = { breakfast: { startsAt: "07:00", endsAt: "09:00", active: true }, lunch: { startsAt: "12:30", endsAt: "14:00", active: true }, dinner: { startsAt: "19:00", endsAt: "21:00", active: true } };
    assert.equal((await api("PUT", `${base}/slots`, tokens.admin, { slots })).status, 200);
    state.slots = slots;
    const meal = await api("POST", `${base}/meals`, tokens.admin, { name: `Paneer Bowl ${runId}`, diet: "vegetarian", calories: 520, proteinG: 32, carbsG: 48, fatG: 18, price: 249 });
    state.mealId = meal.json.meal.id;
    for (const [key, name, pins] of [["k1", "Koramangala Kitchen", [DELIVERS]], ["k2", "Indiranagar Kitchen", [DELIVERS, OTHER]]]) {
      const k = await api("POST", `${base}/kitchens`, tokens.admin, kitchen(name, pins));
      assert.equal(k.status, 201, JSON.stringify(k.json));
      state[key] = k.json.kitchen.id;
    }
    const paneer = await api("POST", `${base}/ingredients`, tokens.admin, { name: `Paneer ${runId}`, category: "dairy", unit: "kg" });
    state.paneer = paneer.json.ingredient.id;
    assert.equal((await api("PUT", `${base}/meals/${state.mealId}/recipe`, tokens.admin, { prepMinutes: 20, items: [{ ingredientId: state.paneer, quantity: 0.15 }] })).status, 200);
    for (const k of [state.k1, state.k2]) {
      assert.equal((await api("PUT", `${base}/kitchens/${k}/menu/${state.mealId}`, tokens.admin, { cooks: true })).status, 200);
      assert.equal((await api("PUT", `${base}/kitchens/${k}/inventory/${state.paneer}`, tokens.admin, { minQuantity: 0 })).status, 200);
      assert.equal((await api("POST", `${base}/kitchens/${k}/inventory/${state.paneer}/moves`, tokens.admin, { kind: "purchase", quantity: 1 })).status, 201);
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
        }
        await connection.query("DELETE FROM delivery_partners WHERE name LIKE ?", [`%${runId}%`]);
        await connection.query("DELETE FROM stock_moves WHERE kitchen_id IN (SELECT id FROM kitchens WHERE name LIKE ?)", [`%${runId}%`]);
        await connection.query("DELETE FROM kitchens WHERE name LIKE ?", [`%${runId}%`]);
        await connection.query("DELETE FROM meals WHERE name LIKE ?", [`%${runId}%`]);
        await connection.query("DELETE FROM ingredients WHERE name LIKE ?", [`%${runId}%`]);
        await connection.query("DELETE FROM delivery_pincodes WHERE pincode IN (?)", [[DELIVERS, OTHER, NOWHERE]]);
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
    if (photoDir) fs.rmSync(photoDir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  const dbase = `${base}/delivery`;
  const partner = (over = {}) => ({ name: `Ravi ${runId}`, phone: "9876500001", vehicle: "bike", vehicleNumber: "KA 01 AB 1234", idStatus: "verified", active: true, available: true, maxOrders: 1, pincodes: [DELIVERS], ...over });
  const dstep = (id, from) => api("POST", `${base}/orders/${id}/delivery/advance`, tokens.admin, { from });

  it("1. delivery routes are the admin's; partners are checked", run(async () => {
    for (const [method, route, body] of [["GET", `${dbase}/board`], ["GET", `${dbase}/partners`], ["POST", `${dbase}/partners`, partner()], ["POST", `${base}/orders/${crypto.randomUUID()}/delivery/assign`, {}]]) {
      assert.equal((await api(method, route, null, body)).status, 401, `${method} ${route}`);
      assert.equal((await api(method, route, tokens.memberA, body)).status, 403, `${method} ${route}`);
    }
    for (const bad of [partner({ vehicle: "truck" }), partner({ maxOrders: 0 }), partner({ pincodes: [] }), partner({ phone: "12" }), partner({ idStatus: "ok" })]) {
      assert.equal((await api("POST", `${dbase}/partners`, tokens.admin, bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    }
    const p1 = await api("POST", `${dbase}/partners`, tokens.admin, partner());
    assert.equal(p1.status, 201, JSON.stringify(p1.json));
    state.p1 = p1.json.partner.id;
    assert.equal(p1.json.partner.carrying, 0);
    assert.equal((await api("POST", `${dbase}/partners`, tokens.admin, partner({ name: `Again ${runId}` }))).status, 409, "the number is taken");
    const p2 = await api("POST", `${dbase}/partners`, tokens.admin, partner({ name: `Sita ${runId}`, phone: "9876500002", idStatus: "pending", maxOrders: 3 }));
    state.p2 = p2.json.partner.id;
    assert.equal((await api("GET", `${dbase}/partners/abc`, tokens.admin)).status, 400);
    assert.equal((await api("GET", `${dbase}/partners/999999`, tokens.admin)).status, 404);
  }));

  it("2. giving an order to a partner: not before cooking, only a verified, free one", run(async () => {
    const placed = await placePaid(tokens.memberA, order());
    const id = placed.json.order.id;
    state.order = id;
    const assign = (body) => api("POST", `${base}/orders/${id}/delivery/assign`, tokens.admin, body);
    assert.equal((await assign({})).status, 409, "not while it's only placed");
    await step(id, "placed");
    await step(id, "accepted");
    assert.equal((await assign({ partnerId: state.p2 })).status, 409, "ID not verified");
    assert.equal((await assign({ partnerId: "1" })).status, 400);
    const given = await assign({});
    assert.equal(given.status, 200, JSON.stringify(given.json));
    assert.deepEqual({ partner: given.json.order.delivery.partner.id, status: given.json.order.delivery.status }, { partner: state.p1, status: "assigned" });
    assert.equal((await assign({ partnerId: state.p1 })).status, 409, "already theirs");
    const busy = await placePaid(tokens.memberA, order());
    state.second = busy.json.order.id;
    await step(state.second, "placed");
    await step(state.second, "accepted");
    const none = await api("POST", `${base}/orders/${state.second}/delivery/assign`, tokens.admin, {});
    assert.equal(none.status, 409, "Ravi carries one at a time");
    assert.match(none.json.error, /No delivery partner is free/);
  }));

  it("3. delivery steps; the order follows them and lands in Macro once delivered", run(async () => {
    const id = state.order;
    for (const from of ["assigned", "accepted", "at_kitchen"]) assert.equal((await dstep(id, from)).status, 200, from);
    assert.equal((await dstep(id, "assigned")).status, 409, "the screen was out of date");
    assert.equal((await dstep(id, "picked_up")).status, 409, "the order isn't ready yet");
    for (const from of ["preparing", "quality_check"]) assert.equal((await step(id, from)).status, 200);
    const out = await dstep(id, "picked_up");
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal(out.json.order.status, "out_for_delivery");
    assert.equal((await step(id, "out_for_delivery")).status, 409, "the partner's steps, not the kitchen's");
    assert.equal((await dstep(id, "out_for_delivery")).json.order.delivery.status, "at_customer");
    const done = await dstep(id, "at_customer");
    assert.equal(done.json.order.status, "delivered");
    assert.equal(done.json.macroLogged, true);
    assert.equal((await dstep(id, "delivered")).status, 400);
    const events = (await api("GET", `${base}/orders/${id}/events`, tokens.admin)).json.events.map((e) => e.status);
    assert.ok(events.includes("delivery_assigned") && events.includes("delivery_delivered"));
  }));

  it("4. a failed delivery: a reason, then a retry (a new try) or a cancel", run(async () => {
    const id = state.second;
    assert.equal((await api("POST", `${base}/orders/${id}/delivery/assign`, tokens.admin, {})).status, 200, "Ravi is free again");
    assert.equal((await api("POST", `${base}/orders/${id}/delivery/fail`, tokens.admin, { reason: "other" })).status, 400, "other needs a note");
    const failed = await api("POST", `${base}/orders/${id}/delivery/fail`, tokens.admin, { reason: "customer_unavailable" });
    assert.equal(failed.json.order.status, "failed");
    assert.equal(failed.json.order.delivery.failureReason, "customer_unavailable");
    assert.equal((await api("POST", `${base}/orders/${id}/delivery/fail`, tokens.admin, { reason: "customer_unavailable" })).status, 409);
    const retried = await api("POST", `${base}/orders/${id}/delivery/assign`, tokens.admin, {});
    assert.equal(retried.status, 200, JSON.stringify(retried.json));
    assert.equal(retried.json.order.status, "ready");
    assert.deepEqual({ status: retried.json.order.delivery.status, attempts: retried.json.order.delivery.attempts }, { status: "assigned", attempts: 2 });
    await api("POST", `${base}/orders/${id}/delivery/fail`, tokens.admin, { reason: "wrong_address" });
    const cancelled = await api("POST", `${base}/orders/${id}/cancel`, tokens.admin, { reason: "Address could not be found" });
    assert.equal(cancelled.json.order.status, "cancelled");
  }));

  it("5. the board, availability and the dashboard", run(async () => {
    const off = await api("POST", `${dbase}/partners/${state.p1}/availability`, tokens.admin, { available: false });
    assert.equal(off.json.partner.available, false);
    assert.equal((await api("POST", `${dbase}/partners/${state.p1}/availability`, tokens.admin, { available: "no" })).status, 400);
    const board = await api("GET", `${dbase}/board`, tokens.admin);
    assert.equal(board.status, 200);
    assert.equal(board.json.counts.free, 0, "Ravi is off and Sita isn't verified");
    assert.equal(board.json.counts.delivered >= 1, true);
    assert.equal(board.json.partners.find((p) => p.id === state.p1).deliveredToday >= 1, true);
    const dash = await api("GET", `${base}/dashboard`, tokens.admin);
    assert.equal(typeof dash.json.delivery.free, "number");
  }));
});
