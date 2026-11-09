// Orders through kitchens end to end (Meal Operations phase 3, 2026-11-10): test accounts in
// justfit_test against the real Express server. An order is given the kitchen that serves its
// pincode, is open, cooks its meals, has the recipes' stock and room; none able → a 409 the member
// reads. The admin moves it New → Accepted → Preparing (stock taken by the recipe; short → 409
// unless overridden with a reason) → Quality check → Ready → Out for delivery → Delivered, each step
// on its timeline; changes its kitchen before cooking; filters by kitchen; adds a holiday and a
// meal time's daily capacity. Attack paths: members on the admin routes, bad bodies and ids.
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
describe("kitchen orders e2e: assignment, kitchen steps with stock, timeline, holidays and capacity", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, photoDir;
  const identities = {};
  const tokens = {};
  const state = {};
  const DELIVERS = "599221";
  const OTHER = "599222";
  const NOWHERE = "599223";
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
        await connection.query("DELETE FROM meal_holidays");
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

  it("1. an order goes to a kitchen that can make it; none able is a 409", run(async () => {
    const first = await placePaid(tokens.memberA, order());
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.equal(first.json.order.kitchen.id, state.k1, "both serve the pincode and are equal: the lower id");
    state.orderId = first.json.order.id;
    const other = await placePaid(tokens.memberA, order({ addressId: state.addressOther }));
    assert.equal(other.json.order.kitchen.id, state.k2, "only Indiranagar serves this pincode");
    const nowhere = await api("POST", "/api/orders", tokens.memberA, order({ addressId: state.addressNowhere }));
    assert.equal(nowhere.status, 409);
    assert.match(nowhere.json.error, /don't deliver to this pincode/);
    // K2 off for this meal: the other pincode has no kitchen able
    assert.equal((await api("PUT", `${base}/kitchens/${state.k2}/menu/${state.mealId}`, tokens.admin, { cooks: true, available: false })).status, 200);
    const off = await api("POST", "/api/orders", tokens.memberA, order({ addressId: state.addressOther }));
    assert.equal(off.status, 409);
    assert.match(off.json.error, /can't make this order/);
    assert.equal((await api("PUT", `${base}/kitchens/${state.k2}/menu/${state.mealId}`, tokens.admin, { cooks: true, available: true })).status, 200);
    assert.equal((await api("POST", "/api/orders", tokens.memberA, order({ items: [{ mealId: state.mealId, quantity: 3 }] }))).status, 201, "3 × 0.15 = 0.45 kg of the 1 kg fits");
  }));

  it("2. the kitchen's steps; cooking takes the recipe's stock, short needs an override", run(async () => {
    const id = state.orderId;
    assert.equal((await step(id, "placed")).json.order.status, "accepted");
    const prep = await step(id, "accepted");
    assert.equal(prep.status, 200, JSON.stringify(prep.json));
    assert.equal(prep.json.order.stockTaken, true);
    const [[k1]] = await connection.query("SELECT quantity FROM kitchen_stock WHERE kitchen_id = ? AND ingredient_id = ?", [state.k1, state.paneer]);
    assert.equal(Number(k1.quantity), 0.7, "1 kg less 2 × 0.15");
    const [[move]] = await connection.query("SELECT kind, quantity, order_id FROM stock_moves WHERE order_id = ?", [id]);
    assert.deepEqual({ kind: move.kind, quantity: Number(move.quantity) }, { kind: "use", quantity: -0.3 });
    for (const [from, to] of [["preparing", "quality_check"], ["quality_check", "ready"], ["ready", "out_for_delivery"], ["out_for_delivery", "delivered"]]) {
      assert.equal((await step(id, from)).json.order.status, to);
    }
    const timeline = await api("GET", `${base}/orders/${id}/events`, tokens.admin);
    assert.deepEqual(timeline.json.events.map((e) => e.status), ["placed", "accepted", "preparing", "quality_check", "ready", "out_for_delivery", "delivered"]);
    assert.equal((await api("GET", `${base}/orders/${id}/events`, tokens.memberA)).status, 403);

    // Count K1's paneer down to 0.1 kg: the next order can't start cooking without an override
    assert.equal((await api("POST", `${base}/kitchens/${state.k1}/inventory/${state.paneer}/moves`, tokens.admin, { kind: "adjust", quantity: 1 })).status, 201);
    // K2 pauses the meal, so the next order goes to K1
    assert.equal((await api("PUT", `${base}/kitchens/${state.k2}/menu/${state.mealId}`, tokens.admin, { cooks: true, available: false })).status, 200);
    const next = await placePaid(tokens.memberA, order());
    assert.equal(next.json.order.kitchen.id, state.k1);
    assert.equal((await api("PUT", `${base}/kitchens/${state.k2}/menu/${state.mealId}`, tokens.admin, { cooks: true, available: true })).status, 200);
    assert.equal((await api("POST", `${base}/kitchens/${state.k1}/inventory/${state.paneer}/moves`, tokens.admin, { kind: "adjust", quantity: 0.1 })).status, 201);
    await step(next.json.order.id, "placed");
    const short = await step(next.json.order.id, "accepted");
    assert.equal(short.status, 409);
    assert.match(short.json.error, /Not enough Paneer/);
    assert.equal((await step(next.json.order.id, "accepted", { override: true })).status, 400, "an override needs a reason");
    const forced = await step(next.json.order.id, "accepted", { override: true, note: "Paneer arriving at 11" });
    assert.equal(forced.json.order.status, "preparing");
    const [[left]] = await connection.query("SELECT quantity FROM kitchen_stock WHERE kitchen_id = ? AND ingredient_id = ?", [state.k1, state.paneer]);
    assert.equal(Number(left.quantity), 0, "never below 0");
    state.cooking = next.json.order.id;
  }));

  it("3. changing an order's kitchen: before cooking only, and only to one that can make it", run(async () => {
    const fresh = await placePaid(tokens.memberA, order());
    const id = fresh.json.order.id;
    assert.equal(fresh.json.order.kitchen.id, state.k2, "K1 is out of paneer, so K2");
    const moveTo = (orderId, kitchenId, token = tokens.admin) => api("POST", `${base}/orders/${orderId}/kitchen`, token, { kitchenId });
    const toK1 = await moveTo(id, state.k1);
    assert.equal(toK1.status, 409);
    assert.match(toK1.json.error, /short of an ingredient/);
    assert.equal((await api("POST", `${base}/kitchens/${state.k1}/inventory/${state.paneer}/moves`, tokens.admin, { kind: "purchase", quantity: 2 })).status, 201);
    const moved = await moveTo(id, state.k1);
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(moved.json.order.kitchen.id, state.k1);
    assert.equal((await moveTo(id, state.k1)).status, 409, "already there");
    assert.equal((await moveTo(state.cooking, state.k2)).status, 409, "cooking has started");
    assert.equal((await moveTo(id, 999999)).status, 404);
    assert.equal((await api("POST", `${base}/orders/${id}/kitchen`, tokens.admin, { kitchenId: "1" })).status, 400);
    assert.equal((await moveTo(id, state.k2, tokens.memberA)).status, 403);
    const events = (await api("GET", `${base}/orders/${id}/events`, tokens.admin)).json.events;
    assert.equal(events.at(-1).status, "kitchen_changed");

    const byKitchen = await api("GET", `${base}/orders?day=${tomorrow}&kitchen=${state.k2}`, tokens.admin);
    assert.ok(byKitchen.json.orders.every((o) => o.kitchen?.id === state.k2));
    assert.equal(byKitchen.json.kitchens, true);
    assert.deepEqual(byKitchen.json.steps, ["placed", "accepted", "preparing", "quality_check", "ready", "out_for_delivery", "delivered"]);
    assert.equal((await api("GET", `${base}/orders?day=${tomorrow}&kitchen=abc`, tokens.admin)).status, 400);
  }));

  it("4. holidays close a day; a meal time's capacity closes it once booked", run(async () => {
    const dayAfter = rules.addDays(tomorrow, 1);
    assert.equal((await api("POST", `${base}/holidays`, tokens.admin, { day: dayAfter, note: "x" })).status, 400);
    assert.equal((await api("POST", `${base}/holidays`, tokens.memberA, { day: dayAfter, note: "Diwali" })).status, 403);
    const added = await api("POST", `${base}/holidays`, tokens.admin, { day: dayAfter, note: "Diwali" });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const options = await api("GET", "/api/orders/options", tokens.memberA);
    const day = options.json.days.find((d) => d.date === dayAfter);
    assert.equal(day.holiday, "Diwali");
    assert.ok(day.slots.every((x) => !x.open));
    const refused = await api("POST", "/api/orders", tokens.memberA, order({ date: dayAfter }));
    assert.equal(refused.status, 409);
    assert.match(refused.json.error, /No deliveries that day: Diwali/);
    assert.equal((await api("DELETE", `${base}/holidays/${dayAfter}`, tokens.admin)).status, 200);
    assert.equal((await api("DELETE", `${base}/holidays/${dayAfter}`, tokens.admin)).status, 404);

    const booked = (await api("GET", "/api/orders/options", tokens.memberA)).json.days;
    const lunchTomorrow = (await connection.query("SELECT COUNT(*) AS n FROM orders WHERE delivery_date = ? AND meal_slot = 'lunch' AND status <> 'cancelled'", [tomorrow]))[0][0].n;
    assert.equal((await api("PUT", `${base}/slots`, tokens.admin, { slots: { ...state.slots, lunch: { ...state.slots.lunch, capacity: Number(lunchTomorrow) } } })).status, 200);
    const full = (await api("GET", "/api/orders/options", tokens.memberA)).json.days.find((d) => d.date === tomorrow).slots.find((x) => x.slot === "lunch");
    assert.equal(full.full, true);
    assert.equal(full.open, false);
    const over = await api("POST", "/api/orders", tokens.memberA, order());
    assert.equal(over.status, 409);
    assert.match(over.json.error, /fully booked/);
    assert.ok(booked.length === 7);
    assert.equal((await api("PUT", `${base}/slots`, tokens.admin, { slots: state.slots })).status, 200, "capacity off again");
  }));
});
