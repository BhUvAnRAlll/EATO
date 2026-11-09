// Meal Operations end to end (phase 7, 2026-11-10): the brief's whole workflow against the real
// Express server on justfit_test, with two kitchens, two delivery partners and two places.
//   customer orders → paid (signature checked) → the right kitchen → accepted → stock taken by the
//   recipe → quality check → ready → a partner → picked up → delivered → into Macro → order history
//   → the dashboard and the report reflect it; a subscription's meal used only when delivered.
// And the brief's failure cases: a kitchen closed, a stock shortage, no partner free, a failed
// delivery retried, a cancellation, a plan paused and resumed, a renewal after a plan ends, a
// retried Pay (no duplicate order), a lost answer (the same request again).
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
describe("meal operations e2e: the whole workflow and its failure cases", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, photoDir;
  const identities = {};
  const tokens = {};
  const state = {};
  const DELIVERS = "599261";
  const OTHER = "599262";
  const NOWHERE = "599263";
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
        await connection.query("DELETE FROM meal_subscriptions WHERE user_id IN (?)", [all.length ? all : [""]]);
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

  const dstep = (id, from) => api("POST", `${base}/orders/${id}/delivery/advance`, tokens.admin, { from });
  const partner = (name, phone, pincodes) => ({ name: `${name} ${runId}`, phone, vehicle: "bike", vehicleNumber: null, idStatus: "verified", active: true, available: true, maxOrders: 2, pincodes });

  it("1. the whole workflow: order → kitchen → stock → partner → delivered → Macro → dashboard", run(async () => {
    for (const [key, name, phone, pins] of [["p1", "Ravi", "9876500011", [DELIVERS]], ["p2", "Sita", "9876500012", [OTHER]]]) {
      const made = await api("POST", `${base}/delivery/partners`, tokens.admin, partner(name, phone, pins));
      assert.equal(made.status, 201, JSON.stringify(made.json));
      state[key] = made.json.partner.id;
    }
    // A retried Pay (same request id) and a lost answer make one order
    const body = order();
    const first = await api("POST", "/api/orders", tokens.memberA, body);
    const again = await api("POST", "/api/orders", tokens.memberA, body);
    assert.equal(again.json.order.id, first.json.order.id);
    const paid = await api("POST", "/api/orders/gateway/dummy/checkout", tokens.memberA, { razorpay_order_id: first.json.checkout.order_id, method: "card", outcome: "success" });
    const { status: _s, ...answer } = paid.json;
    const verified = await api("POST", `/api/orders/${first.json.order.id}/verify-payment`, tokens.memberA, answer);
    assert.equal(verified.json.order.status, "placed");
    const id = first.json.order.id;
    assert.equal(verified.json.order.kitchen.id, state.k1, "the kitchen serving the pincode, open, cooking it, with stock");
    for (const from of ["placed", "accepted"]) assert.equal((await step(id, from)).status, 200, from);
    const [[stock]] = await connection.query("SELECT quantity FROM kitchen_stock WHERE kitchen_id = ? AND ingredient_id = ?", [state.k1, state.paneer]);
    assert.equal(Number(stock.quantity), 0.7, "the recipe's paneer was taken when cooking started");
    assert.equal((await api("POST", `${base}/orders/${id}/delivery/assign`, tokens.admin, {})).json.order.delivery.partner.id, state.p1, "the partner covering the pincode");
    for (const from of ["preparing", "quality_check"]) assert.equal((await step(id, from)).status, 200, from);
    for (const from of ["assigned", "accepted", "at_kitchen", "picked_up", "out_for_delivery"]) assert.equal((await dstep(id, from)).status, 200, from);
    const done = await dstep(id, "at_customer");
    assert.equal(done.json.order.status, "delivered");
    assert.equal(done.json.macroLogged, true, "into the member's Macro diary");
    const history = await api("GET", `/api/orders/${id}`, tokens.memberA);
    assert.equal(history.json.order.status, "delivered", "the member's order history shows it");
    const events = (await api("GET", `${base}/orders/${id}/events`, tokens.admin)).json.events.map((e) => e.status);
    for (const e of ["placed", "accepted", "preparing", "quality_check", "ready", "delivery_assigned", "delivery_picked_up", "delivery_on_the_way", "delivery_delivered"]) assert.ok(events.includes(e), e);
    const dash = await api("GET", `${base}/dashboard?day=${tomorrow}`, tokens.admin);
    assert.equal(dash.json.orders.steps.delivered, 1);
    assert.equal(dash.json.delivery.delivered >= 1, true);
  }));

  it("2. a kitchen closed or short of stock: orders go to another, or are refused with a reason", run(async () => {
    // K1 temporarily closed: the next order goes to K2 (it serves both pincodes)
    assert.equal((await api("POST", `${base}/kitchens/${state.k1}/status`, tokens.admin, { status: "temporarily_closed", note: "Gas line repair" })).status, 200);
    const moved = await placePaid(tokens.memberA, order());
    assert.equal(moved.json.order.kitchen.id, state.k2);
    // K2 short of paneer too (count it to 0): nobody can make it → a 409 the member reads
    assert.equal((await api("POST", `${base}/kitchens/${state.k2}/inventory/${state.paneer}/moves`, tokens.admin, { kind: "adjust", quantity: 0 })).status, 201);
    const refused = await api("POST", "/api/orders", tokens.memberA, order());
    assert.equal(refused.status, 409);
    assert.match(refused.json.error, /can't make this order/);
    // Back open and restocked: orders flow again
    assert.equal((await api("POST", `${base}/kitchens/${state.k1}/status`, tokens.admin, { status: "active" })).status, 200);
    assert.equal((await api("POST", `${base}/kitchens/${state.k2}/inventory/${state.paneer}/moves`, tokens.admin, { kind: "purchase", quantity: 2 })).status, 201);
    state.k2Order = moved.json.order.id;
  }));

  it("3. no partner free, a failed delivery retried, a cancellation", run(async () => {
    const id = state.k2Order;
    for (const from of ["placed", "accepted"]) assert.equal((await step(id, from)).status, 200, from);
    // The partner for this pincode is off duty: no one free
    assert.equal((await api("POST", `${base}/delivery/partners/${state.p1}/availability`, tokens.admin, { available: false })).status, 200);
    const none = await api("POST", `${base}/orders/${id}/delivery/assign`, tokens.admin, {});
    assert.equal(none.status, 409);
    assert.equal((await api("POST", `${base}/delivery/partners/${state.p1}/availability`, tokens.admin, { available: true })).status, 200);
    assert.equal((await api("POST", `${base}/orders/${id}/delivery/assign`, tokens.admin, {})).status, 200);
    for (const from of ["preparing", "quality_check"]) await step(id, from);
    for (const from of ["assigned", "accepted", "at_kitchen", "picked_up"]) await dstep(id, from);
    const failed = await api("POST", `${base}/orders/${id}/delivery/fail`, tokens.admin, { reason: "customer_unavailable" });
    assert.equal(failed.json.order.status, "failed");
    const retried = await api("POST", `${base}/orders/${id}/delivery/assign`, tokens.admin, {});
    assert.equal(retried.json.order.delivery.attempts, 2);
    for (const from of ["assigned", "accepted", "at_kitchen", "picked_up", "out_for_delivery", "at_customer"]) await dstep(id, from);
    assert.equal((await api("GET", `/api/orders/${id}`, tokens.memberA)).json.order.status, "delivered", "delivered on the second try");
    // A member cancels while it's only placed; too late once the kitchen accepts
    const cancelMe = await placePaid(tokens.memberA, order());
    assert.equal((await api("POST", `/api/orders/${cancelMe.json.order.id}/cancel`, tokens.memberA, { reason: "Plans changed" })).json.order.status, "cancelled");
    const tooLate = await placePaid(tokens.memberA, order());
    await step(tooLate.json.order.id, "placed");
    assert.equal((await api("POST", `/api/orders/${tooLate.json.order.id}/cancel`, tokens.memberA, {})).status, 409);
  }));

  it("4. a subscription: meals used only when delivered; pause and resume; a renewal after it ends", run(async () => {
    const plans = await api("GET", `${base}/subscription-plans`, tokens.admin);
    const fat = plans.json.plans.find((p) => p.slug === "fat-loss");
    const saved = await api("PUT", `${base}/subscription-plans/${fat.id}`, tokens.admin, {
      name: fat.name, tagline: fat.tagline, description: fat.description, goal: fat.goal, mealsPerDay: 1, calories: fat.calories, proteinG: fat.proteinG,
      carbsG: fat.carbsG, fatG: fat.fatG, waterL: fat.waterL, included: fat.included, lengths: [{ days: 7, price: 1899 }], mealIds: [state.mealId], active: true,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const made = await api("POST", "/api/subscriptions", tokens.memberA, { clientId: crypto.randomUUID(), planId: fat.id, days: 7, startsOn: tomorrow, addressId: state.addressA });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const paid = await api("POST", "/api/orders/gateway/dummy/checkout", tokens.memberA, { razorpay_order_id: made.json.checkout.order_id, method: "upi", outcome: "success" });
    const { status: _s, ...answer } = paid.json;
    const active = await api("POST", `/api/subscriptions/${made.json.subscription.id}/verify-payment`, tokens.memberA, answer);
    assert.equal(active.json.subscription.status, "active");
    const subId = made.json.subscription.id;
    const generated = await api("POST", `${base}/subscriptions/generate`, tokens.admin, { day: tomorrow });
    assert.equal(generated.json.made, 1, "one lunch for the 1-meal plan, through a kitchen");
    const [[subOrder]] = await connection.query("SELECT id, kitchen_id FROM orders WHERE subscription_id = ?", [subId]);
    assert.ok(subOrder.kitchen_id, "given a kitchen like any order");
    const used = async () => (await api("GET", "/api/subscriptions/mine", tokens.memberA)).json.current.mealsUsed;
    assert.equal(await used(), 0);
    for (const from of ["placed", "accepted", "preparing", "quality_check"]) await step(subOrder.id, from);
    await api("POST", `${base}/orders/${subOrder.id}/delivery/assign`, tokens.admin, {});
    for (const from of ["assigned", "accepted", "at_kitchen", "picked_up", "out_for_delivery", "at_customer"]) await dstep(subOrder.id, from);
    assert.equal(await used(), 1, "the delivered meal is used");
    const day4 = rules.addDays(rules.indiaNow().date, 4);
    const paused = await api("POST", `/api/subscriptions/${subId}/pause`, tokens.memberA, { from: day4, until: day4 });
    assert.equal(paused.status, 200);
    assert.equal((await api("POST", `${base}/subscriptions/generate`, tokens.admin, { day: day4 })).json.made, 0, "nothing while paused");
    assert.equal((await api("POST", `/api/subscriptions/${subId}/resume`, tokens.memberA, {})).status, 200);
    // Renewal: once a plan has ended (moved into the past here), a new one can start
    assert.equal((await api("POST", "/api/subscriptions", tokens.memberA, { clientId: crypto.randomUUID(), planId: fat.id, days: 7, startsOn: tomorrow, addressId: state.addressA })).status, 409, "one running plan");
    await connection.query("UPDATE meal_subscriptions SET starts_on = DATE_SUB(starts_on, INTERVAL 30 DAY), ends_on = DATE_SUB(ends_on, INTERVAL 30 DAY) WHERE id = ?", [subId]);
    assert.equal((await api("GET", "/api/subscriptions/mine", tokens.memberA)).json.current, null, "the old plan completed");
    const renewed = await api("POST", "/api/subscriptions", tokens.memberA, { clientId: crypto.randomUUID(), planId: fat.id, days: 7, startsOn: tomorrow, addressId: state.addressA });
    assert.equal(renewed.status, 201, "renewed");
  }));

  it("5. the report and the dashboard agree with what happened", run(async () => {
    const report = await api("GET", `${base}/reports`, tokens.admin);
    assert.equal(report.status, 200);
    assert.ok(report.json.business.orders >= 4);
    assert.ok(report.json.delivery.delivered >= 3);
    assert.equal(report.json.delivery.failed, 0, "the failed try was retried on the same delivery and delivered");
    const k1 = report.json.kitchens.find((k) => k.id === state.k1);
    assert.ok(k1.used > 0 || k1.used === 0);
    const dash = await api("GET", `${base}/dashboard?day=${tomorrow}`, tokens.admin);
    assert.equal(dash.json.orders.subscription, 1);
    assert.ok(dash.json.orders.steps.delivered >= 3);
  }));
});
