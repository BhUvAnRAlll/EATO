// Meal ordering end to end (2026-11-09): test accounts in justfit_test against the real Express
// server. The Super Admin adds a meal with a photo and sets the delivery times; a member reads the
// menu, keeps a favourite and orders one meal time with a test payment; the admin moves the order
// to delivered and it lands in the member's Macro diary once. Attack paths: no session, a member
// on the admin's routes, another member's order and address, a price or user id in the body, SQL
// in ids, a fake photo, a closed or switched-off meal time, a retried Pay, double taps.
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

describe("meal ordering e2e: the admin's meals and times, a member's order, delivered into Macro", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, photoDir, authSecret;
  const identities = {};
  const tokens = {};
  const state = {};
  const DELIVERS = "599201";
  const ELSEWHERE = "599202";
  const tomorrow = rules.addDays(rules.indiaNow().date, 1);

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
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const photo = png(640, 480);
  const meal = (over = {}) => ({ name: `Paneer Bowl ${runId}`, description: "Paneer tikka, jeera rice, salad", diet: "vegetarian", calories: 520, proteinG: 32, carbsG: 48, fatG: 18, price: 249, ...over });
  const address = (pincode) => ({
    kind: "home", receiverName: "Ravi Kumar", receiverPhone: "9876543210", house: "Flat 4B", street: "MG Road", landmark: "SIT",
    city: "Tumakuru", pincode, formattedAddress: "MG Road, Tumakuru", latitude: 13.3392, longitude: 77.1017, instructions: "Ring the bell",
  });
  const order = (over = {}) => ({ clientId: crypto.randomUUID(), addressId: state.addressA, date: tomorrow, slot: "lunch", items: [{ mealId: state.mealId, quantity: 2 }], ...over });
  // Pay the Razorpay way: the order waits, the dummy gateway pays, the server checks the signature
  const checkoutPay = async (token, checkout, outcome = "success") => {
    const paid = await api("POST", "/api/orders/gateway/dummy/checkout", token, { razorpay_order_id: checkout.order_id, method: "upi", outcome });
    if (paid.status !== 200 || paid.json.status !== "captured") return paid;
    const { status: _captured, ...answer } = paid.json;
    return { status: 200, json: answer };
  };
  const placePaid = async (token, body) => {
    const placed = await api("POST", "/api/orders", token, body);
    if (placed.status !== 201 || !placed.json.checkout) return placed;
    assert.equal(placed.json.order.status, "awaiting_payment");
    const paid = await checkoutPay(token, placed.json.checkout);
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    const verified = await api("POST", `/api/orders/${placed.json.order.id}/verify-payment`, token, paid.json);
    assert.equal(verified.status, 200, JSON.stringify(verified.json));
    return { status: 201, json: { ...placed.json, order: verified.json.order } };
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-meal-photos-"));
    // Pinned here so a test can sign a payment the way the dummy gateway does
    authSecret = env.AUTH_SECRET || crypto.randomBytes(32).toString("base64url");
    server = await startTestServer({ ...env, AUTH_SECRET: authSecret, MEAL_PHOTO_DIR: photoDir });
    try {
      for (const [tag, role] of [["admin", "admin"], ["memberA", "user"], ["memberB", "user"], ["memberC", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("INSERT INTO delivery_pincodes (pincode, area) VALUES (?, 'Test area')", [DELIVERS]);
    for (const [tag, key, pincode] of [["memberA", "addressA", DELIVERS], ["memberA", "farAddressA", ELSEWHERE], ["memberB", "addressB", DELIVERS]]) {
      const saved = await api("POST", "/api/addresses", tokens[tag], address(pincode));
      assert.equal(saved.status, 201, JSON.stringify(saved.json));
      state[key] = saved.json.savedId;
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const all = Object.values(identities).map((i) => i.id);
        if (all.length) {
          await connection.query("DELETE FROM meal_referrals WHERE referrer_id IN (?) OR referred_id IN (?)", [all, all]);
          await connection.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))", [all]);
          await connection.query("DELETE FROM orders WHERE user_id IN (?)", [all]);
          await connection.query("DELETE FROM meal_coupons WHERE owner_user_id IN (?)", [all]);
          await connection.query("DELETE FROM user_addresses WHERE user_id IN (?)", [all]);
          await connection.query("DELETE FROM macro_meal_logs WHERE user_id IN (?)", [all]);
          await connection.query("UPDATE meal_delivery_slots SET updated_by = NULL WHERE updated_by IN (?)", [all]);
        }
        await connection.query("DELETE FROM meal_banners WHERE title LIKE ?", [`%${runId}%`]);
        await connection.query("DELETE FROM meal_categories WHERE name LIKE ?", [`%${runId}%`]);
        await connection.query("DELETE FROM meal_coupons WHERE title LIKE ?", [`%${runId}%`]);
        await connection.query("DELETE FROM meals WHERE name LIKE ?", [`%${runId}%`]);
        await connection.query("DELETE FROM delivery_pincodes WHERE pincode IN (?)", [[DELIVERS, ELSEWHERE]]);
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

  it("1. signed in only; the kitchen is the admin's only", run(async () => {
    for (const [method, route] of [["GET", "/api/meals"], ["GET", "/api/orders"], ["POST", "/api/orders"], ["GET", "/api/orders/options"], ["GET", "/api/admin/kitchen/meals"], ["GET", "/api/admin/kitchen/orders"]]) {
      assert.equal((await api(method, route, null)).status, 401, `${method} ${route}`);
      assert.equal((await api(method, route, "jfs_not-a-real-token")).status, 401);
    }
    for (const [method, route, body] of [
      ["GET", "/api/admin/kitchen/meals"], ["POST", "/api/admin/kitchen/meals", meal()], ["DELETE", "/api/admin/kitchen/meals/paneer-bowl"],
      ["PUT", "/api/admin/kitchen/slots", { slots: rules.DEFAULT_SLOTS }], ["GET", "/api/admin/kitchen/orders"],
      ["POST", `/api/admin/kitchen/orders/${crypto.randomUUID()}/advance`, { from: "placed" }],
    ]) assert.equal((await api(method, route, tokens.memberA, body)).status, 403, `${method} ${route}`);
  }));

  it("2. the admin adds a meal with a photo; bad meals and fake photos are refused", run(async () => {
    const fake = await api("POST", "/api/admin/kitchen/meals", tokens.admin, { ...meal(), photo: { data: Buffer.from("<script>alert(1)</script>").toString("base64"), mediaType: "image/png" } });
    assert.equal(fake.status, 415);
    assert.equal(fs.readdirSync(photoDir).length, 0, "a refused photo leaves no file");
    assert.equal((await api("POST", "/api/admin/kitchen/meals", tokens.admin, { ...meal(), photo: { data: png(100, 100).toString("base64"), mediaType: "image/png" } })).status, 400);
    for (const bad of [meal({ diet: "keto" }), meal({ price: 0 }), meal({ calories: "lots" }), { ...meal(), isAvailable: false }, { ...meal(), id: "../../etc" }]) {
      assert.equal((await api("POST", "/api/admin/kitchen/meals", tokens.admin, bad)).status, 400, JSON.stringify(bad));
    }
    const added = await api("POST", "/api/admin/kitchen/meals", tokens.admin, { ...meal(), photo: { data: photo.toString("base64"), mediaType: "image/png" } });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    state.mealId = added.json.meal.id;
    assert.match(state.mealId, new RegExp(`^paneer-bowl-${runId}-[0-9a-f]{6}$`));
    assert.equal(added.json.meal.price, 249);
    assert.match(added.json.meal.imageUrl, /^\/api\/meals\/.+\/photo\?v=/);
    assert.equal(fs.readdirSync(photoDir).length, 1);
    const plain = await api("POST", "/api/admin/kitchen/meals", tokens.admin, meal({ name: `Egg Bhurji ${runId}`, diet: "eggetarian", price: 149 }));
    assert.equal(plain.status, 201);
    state.plainMealId = plain.json.meal.id;
    assert.equal(plain.json.meal.imageUrl, null);
    const [[log]] = await connection.query("SELECT action, target_type FROM admin_audit_log WHERE target_id = ?", [state.mealId]);
    assert.deepEqual({ ...log }, { action: "meal.create", target_type: "meal" });
  }));

  it("3. members see the menu, the photo and keep favourites", run(async () => {
    const menu = await api("GET", "/api/meals", tokens.memberA);
    assert.equal(menu.status, 200);
    const mine = menu.json.meals.find((m) => m.id === state.mealId);
    assert.equal(mine.calories, 520);
    assert.equal(mine.favorite, false);
    assert.equal((await api("GET", "/api/meals?diet=eggetarian", tokens.memberA)).json.meals.some((m) => m.id === state.mealId), false);
    assert.ok((await api("GET", `/api/meals?search=${runId}`, tokens.memberA)).json.meals.length === 2);
    assert.equal((await api("GET", "/api/meals?search=%25' OR 1=1 --", tokens.memberA)).json.meals.length, 0);
    assert.equal((await api("GET", "/api/meals?diet=keto", tokens.memberA)).status, 400);
    const pic = await api("GET", mine.imageUrl, tokens.memberA);
    assert.equal(pic.status, 200);
    assert.equal(pic.type, "image/png");
    assert.ok(pic.bytes.equals(photo));
    assert.equal((await api("GET", `/api/meals/${state.plainMealId}/photo`, tokens.memberA)).status, 404);
    assert.equal((await api("GET", "/api/meals/..%2F..%2Fetc/photo", tokens.memberA)).status, 400);

    assert.equal((await api("PUT", `/api/meals/${state.mealId}/favorite`, tokens.memberA)).json.favorite, true);
    assert.equal((await api("PUT", `/api/meals/${state.mealId}/favorite`, tokens.memberA)).status, 200, "twice is fine");
    assert.equal((await api("GET", `/api/meals/${state.mealId}`, tokens.memberA)).json.meal.favorite, true);
    assert.equal((await api("GET", `/api/meals/${state.mealId}`, tokens.memberB)).json.meal.favorite, false, "favourites are each member's own");
    assert.equal((await api("DELETE", `/api/meals/${state.mealId}/favorite`, tokens.memberA)).json.favorite, false);
    assert.equal((await api("GET", "/api/meals/no-such-meal", tokens.memberA)).status, 404);
  }));

  it("4. the admin sets the delivery times; the cart sees 7 days", run(async () => {
    const slots = await api("GET", "/api/admin/kitchen/slots", tokens.admin);
    // Every meal time also carries its daily capacity since phase 3 (null: no limit)
    const withCapacity = (all) => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { capacity: null, ...v }]));
    assert.deepEqual(slots.json.slots, withCapacity(rules.DEFAULT_SLOTS));
    for (const bad of [{ slots: { ...rules.DEFAULT_SLOTS, lunch: { startsAt: "14:00", endsAt: "13:00", active: true } } }, { slots: { lunch: rules.DEFAULT_SLOTS.lunch } }]) {
      assert.equal((await api("PUT", "/api/admin/kitchen/slots", tokens.admin, bad)).status, 400);
    }
    const next = { ...rules.DEFAULT_SLOTS, lunch: { startsAt: "12:00", endsAt: "13:30", active: true }, dinner: { ...rules.DEFAULT_SLOTS.dinner, active: false } };
    const saved = await api("PUT", "/api/admin/kitchen/slots", tokens.admin, { slots: next });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.slots, withCapacity(next));
    const options = await api("GET", "/api/orders/options", tokens.memberA);
    assert.equal(options.json.days.length, 7);
    assert.equal(options.json.cutoffMinutes, 120);
    const day = options.json.days.find((d) => d.date === tomorrow);
    assert.deepEqual(day.slots.map((s) => [s.slot, s.open]), [["breakfast", true], ["lunch", true], ["dinner", false]]);
  }));

  it("5. a member orders: prices from the menu, their own deliverable address, an open meal time", run(async () => {
    assert.equal((await api("POST", "/api/orders", tokens.memberA, order({ slot: "dinner" }))).status, 409, "dinner is switched off");
    assert.equal((await api("POST", "/api/orders", tokens.memberA, order({ date: rules.addDays(tomorrow, 7) }))).status, 409, "too far ahead");
    assert.equal((await api("POST", "/api/orders", tokens.memberA, order({ addressId: state.farAddressA }))).status, 409, "not deliverable");
    assert.equal((await api("POST", "/api/orders", tokens.memberA, order({ addressId: state.addressB }))).status, 404, "another member's address");
    assert.equal((await api("POST", "/api/orders", tokens.memberA, order({ items: [{ mealId: "no-such-meal", quantity: 1 }] }))).status, 409);
    for (const bad of [order({ total: 1 }), order({ userId: identities.memberB.id }), order({ items: [{ mealId: state.mealId, quantity: 1, price: 1 }] }), order({ items: [{ mealId: "x' OR '1'='1", quantity: 1 }] }), order({ items: [{ mealId: state.mealId, quantity: 9 }] })]) {
      assert.equal((await api("POST", "/api/orders", tokens.memberA, bad)).status, 400, JSON.stringify(bad));
    }
    const body = order({ items: [{ mealId: state.mealId, quantity: 2 }, { mealId: state.plainMealId, quantity: 1 }] });
    const placed = await placePaid(tokens.memberA, body);
    assert.equal(placed.status, 201, JSON.stringify(placed.json));
    const o = placed.json.order;
    state.orderId = o.id;
    assert.equal(o.status, "placed");
    assert.equal(o.total, 249 * 2 + 149);
    assert.equal(o.slot, "lunch");
    assert.equal(o.slotStartsAt, "12:00");
    assert.equal(o.date, tomorrow);
    assert.equal(o.payment.method, "dummy");
    assert.match(o.payment.ref, /^pay_[A-Za-z0-9]{14}$/);
    assert.equal(o.address.line, `Flat 4B, MG Road, Near SIT, Tumakuru, ${DELIVERS}`);
    assert.equal(o.totals.calories, 520 * 3);
    // A retried Pay with the same request id places nothing new
    const again = await api("POST", "/api/orders", tokens.memberA, body);
    assert.equal(again.status, 200);
    assert.equal(again.json.order.id, o.id);
    assert.equal(again.json.repeated, true);
    assert.equal(again.json.checkout, null, "a paid order opens no checkout");
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM orders WHERE user_id = ?", [identities.memberA.id]);
    assert.equal(n, 1);
  }));

  it("6. each member sees only their own orders", run(async () => {
    assert.equal((await api("GET", "/api/orders", tokens.memberA)).json.orders.length, 1);
    assert.equal((await api("GET", "/api/orders", tokens.memberB)).json.orders.length, 0);
    assert.equal((await api("GET", `/api/orders/${state.orderId}`, tokens.memberB)).status, 404);
    assert.equal((await api("POST", `/api/orders/${state.orderId}/cancel`, tokens.memberB, {})).status, 404);
    assert.equal((await api("GET", "/api/orders/not-an-id", tokens.memberA)).status, 400);
  }));

  it("7. the admin moves the order one step at a time; delivered lands in Macro once", run(async () => {
    const day = await api("GET", `/api/admin/kitchen/orders?day=${tomorrow}`, tokens.admin);
    assert.equal(day.status, 200);
    const seen = day.json.orders.find((x) => x.id === state.orderId);
    assert.equal(seen.address.receiverPhone, "9876543210");
    assert.equal(day.json.counts.placed, 1);
    assert.equal((await api("GET", "/api/admin/kitchen/orders?day=2026-13-40", tokens.admin)).status, 400);

    const step = (from) => api("POST", `/api/admin/kitchen/orders/${state.orderId}/advance`, tokens.admin, { from });
    assert.equal((await step("preparing")).status, 409, "the admin's screen was out of date");
    assert.equal((await step("placed")).json.order.status, "accepted", "the kitchen's steps since phase 3");
    assert.equal((await step("placed")).status, 409, "a double tap moves it once");
    assert.equal((await api("POST", `/api/orders/${state.orderId}/cancel`, tokens.memberA, {})).status, 409, "too late for the member to cancel");
    for (const [from, to] of [["accepted", "preparing"], ["preparing", "quality_check"], ["quality_check", "ready"], ["ready", "out_for_delivery"]]) {
      assert.equal((await step(from)).json.order.status, to);
    }
    const delivered = await step("out_for_delivery");
    assert.equal(delivered.json.order.status, "delivered");
    assert.equal(delivered.json.macroLogged, true);
    assert.ok(delivered.json.order.deliveredAt);
    assert.equal((await step("delivered")).status, 400);
    assert.equal((await api("POST", `/api/admin/kitchen/orders/${state.orderId}/cancel`, tokens.admin, { reason: "Changed mind" })).status, 409);

    const [logs] = await connection.query("SELECT id, log_date, slot, source, plan_log_key FROM macro_meal_logs WHERE user_id = ?", [identities.memberA.id]);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].source, "order");
    assert.equal(logs[0].slot, "lunch");
    assert.equal(logs[0].plan_log_key, `order:${state.orderId}`);
    const [[sum]] = await connection.query("SELECT SUM(kcal) AS kcal, SUM(protein_g) AS p FROM macro_meal_items WHERE macro_meal_id = ?", [logs[0].id]);
    assert.equal(Number(sum.kcal), 520 * 3);
    assert.equal(Number(sum.p), 32 * 3);
  }));

  it("8. cancelling: the member while placed, the admin with a reason", run(async () => {
    const first = await placePaid(tokens.memberA, order({ slot: "breakfast" }));
    assert.equal(first.status, 201);
    const cancelled = await api("POST", `/api/orders/${first.json.order.id}/cancel`, tokens.memberA, { reason: "Plans changed" });
    assert.equal(cancelled.json.order.status, "cancelled");
    assert.equal(cancelled.json.order.cancelledBy, "member");
    assert.equal((await api("POST", `/api/orders/${first.json.order.id}/cancel`, tokens.memberA, {})).status, 409);

    const second = await placePaid(tokens.memberB, order({ addressId: state.addressB }));
    assert.equal(second.status, 201);
    const id = second.json.order.id;
    assert.equal((await api("POST", `/api/admin/kitchen/orders/${id}/cancel`, tokens.admin, {})).status, 400, "the admin gives a reason");
    const byAdmin = await api("POST", `/api/admin/kitchen/orders/${id}/cancel`, tokens.admin, { reason: "Out of paneer today" });
    assert.equal(byAdmin.json.order.status, "cancelled");
    const seen = await api("GET", `/api/orders/${id}`, tokens.memberB);
    assert.equal(seen.json.order.cancelReason, "Out of paneer today");
    assert.equal(seen.json.order.cancelledBy, "admin");
  }));

  it("10. the admin edits, hides and tags a meal; members only see what's shown", run(async () => {
    const base = meal({ name: `Dal Bowl ${runId}`, price: 99 });
    const files = fs.readdirSync(photoDir).length;
    const added = await api("POST", "/api/admin/kitchen/meals", tokens.admin, { ...base, photo: { data: photo.toString("base64"), mediaType: "image/png" } });
    assert.equal(added.status, 201);
    state.dalId = added.json.meal.id;
    const edited = await api("PUT", `/api/admin/kitchen/meals/${state.dalId}`, tokens.admin, { ...base, price: 89, mrp: 129, tags: ["special", "high_protein"], servingSize: "1 bowl · 400 g", ingredients: "Toor dal, rice, ghee", removePhoto: true });
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
    assert.equal(edited.json.meal.price, 89);
    assert.equal(edited.json.meal.mrp, 129);
    assert.deepEqual(edited.json.meal.tags, ["high_protein", "special"]);
    assert.equal(edited.json.meal.imageUrl, null);
    assert.equal(fs.readdirSync(photoDir).length, files, "the removed photo's file is gone");
    assert.equal((await api("PUT", `/api/admin/kitchen/meals/${state.dalId}`, tokens.admin, { ...base, mrp: 50 })).status, 400, "the original price must be more");
    assert.equal((await api("PUT", "/api/admin/kitchen/meals/no-such-meal", tokens.admin, base)).status, 404);
    assert.equal((await api("PUT", `/api/admin/kitchen/meals/${state.dalId}`, tokens.memberA, base)).status, 403);

    assert.equal((await api("PATCH", `/api/admin/kitchen/meals/${state.dalId}/visibility`, tokens.admin, { available: false })).json.meal.available, false);
    assert.equal((await api("GET", `/api/meals/${state.dalId}`, tokens.memberA)).status, 404, "a hidden meal isn't on the menu");
    assert.equal((await api("POST", "/api/orders", tokens.memberA, order({ items: [{ mealId: state.dalId, quantity: 1 }] }))).status, 409, "nor can it be ordered");
    assert.equal((await api("PATCH", `/api/admin/kitchen/meals/${state.dalId}/visibility`, tokens.admin, { available: true })).json.meal.available, true);
  }));

  it("11. categories and banners: the storefront shows what's on, today, with real targets", run(async () => {
    const tile = await api("POST", "/api/admin/kitchen/categories", tokens.admin, { kind: "tile", name: `Under 99 ${runId}`, maxPrice: 99, badge: "Deal", photo: { data: png(200, 200).toString("base64"), mediaType: "image/png" } });
    assert.equal(tile.status, 201, JSON.stringify(tile.json));
    state.tileId = tile.json.category.id;
    const bowls = await api("POST", "/api/admin/kitchen/categories", tokens.admin, { kind: "food", name: `Bowls ${runId}`, subtitle: "Chef-crafted bowls", mealIds: [state.plainMealId], featured: true });
    assert.equal(bowls.status, 201);
    state.bowlsId = bowls.json.category.id;
    const empty = await api("POST", "/api/admin/kitchen/categories", tokens.admin, { kind: "tile", name: `Gourmet ${runId}`, matchTag: "gourmet" });
    assert.equal(empty.status, 201);
    for (const bad of [{ kind: "tile", name: "Nothing" }, { kind: "food", name: "Ghost", mealIds: ["no-such-meal"] }]) {
      assert.ok([400, 409].includes((await api("POST", "/api/admin/kitchen/categories", tokens.admin, bad)).status), JSON.stringify(bad));
    }
    const today = rules.indiaNow().date;
    const live = await api("POST", "/api/admin/kitchen/banners", tokens.admin, { title: `Specials ${runId}`, badge: "This week", target: { kind: "category", ref: String(state.tileId) }, startsOn: today, endsOn: rules.addDays(today, 6) });
    assert.equal(live.status, 201, JSON.stringify(live.json));
    const later = await api("POST", "/api/admin/kitchen/banners", tokens.admin, { title: `Later ${runId}`, target: { kind: "tag", ref: "special" }, startsOn: rules.addDays(today, 3) });
    assert.equal(later.status, 201);
    assert.equal((await api("POST", "/api/admin/kitchen/banners", tokens.admin, { title: `Ghost ${runId}`, target: { kind: "meal", ref: "no-such-meal" } })).status, 404);
    assert.equal((await api("POST", "/api/admin/kitchen/banners", tokens.admin, { title: `Link ${runId}`, target: { kind: "url", ref: "https://example.com" } })).status, 400);

    const store = await api("GET", "/api/meals/storefront", tokens.memberA);
    assert.equal(store.status, 200);
    const tileSeen = store.json.categories.find((x) => x.id === state.tileId);
    assert.deepEqual(tileSeen.mealIds, [state.dalId], "only the ₹89 dal bowl is under ₹99");
    assert.match(tileSeen.imageUrl, /^\/api\/meals\/categories\/\d+\/photo\?v=/);
    assert.equal((await api("GET", tileSeen.imageUrl, tokens.memberA)).status, 200);
    assert.equal(store.json.categories.find((x) => x.id === state.bowlsId).featured, true);
    assert.equal(store.json.categories.some((x) => x.id === empty.json.category.id), false, "a category with no meals is left out");
    assert.ok(store.json.banners.some((b) => b.title === `Specials ${runId}`));
    assert.equal(store.json.banners.some((b) => b.title === `Later ${runId}`), false, "not before its start day");
    assert.ok(store.json.meals.some((m) => m.id === state.dalId && m.mrp === 129));

    await api("PUT", `/api/admin/kitchen/categories/${state.tileId}`, tokens.admin, { kind: "tile", name: `Under 99 ${runId}`, maxPrice: 99, active: false });
    const after = await api("GET", "/api/meals/storefront", tokens.memberA);
    assert.equal(after.json.categories.some((x) => x.id === state.tileId), false, "a switched-off category goes");
    assert.equal(after.json.banners.some((b) => b.title === `Specials ${runId}`), false, "and so does a banner pointing at it");
    assert.equal((await api("GET", "/api/admin/kitchen/categories", tokens.memberA)).status, 403);
    assert.equal((await api("DELETE", `/api/admin/kitchen/categories/${empty.json.category.id}`, tokens.admin)).status, 200);
    assert.equal((await api("DELETE", "/api/admin/kitchen/categories/0", tokens.admin)).status, 400);
  }));

  it("12. coupons: priced by the server, checked for days, minimum and uses, locked on order", run(async () => {
    const today = rules.indiaNow().date;
    const added = await api("POST", "/api/admin/kitchen/coupons", tokens.admin, { code: `S${runId}`.slice(0, 16), title: `Half off ${runId}`, kind: "percent", percentOff: 50, maxDiscount: 100, minOrder: 149 });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const code = added.json.coupon.code;
    assert.equal(added.json.coupon.state, "live");
    assert.equal((await api("POST", "/api/admin/kitchen/coupons", tokens.admin, { code, title: `Again ${runId}`, kind: "flat", flatOff: 10 })).status, 409, "codes are unique");
    const expired = await api("POST", "/api/admin/kitchen/coupons", tokens.admin, { code: `X${runId}`.slice(0, 16), title: `Old ${runId}`, kind: "flat", flatOff: 50, startsOn: rules.addDays(today, -10), endsOn: rules.addDays(today, -1) });
    assert.equal(expired.json.coupon.state, "expired");

    const store = await api("GET", "/api/meals/storefront", tokens.memberA);
    assert.ok(store.json.coupons.some((x) => x.code === code && x.off === "50% off up to ₹100" && x.above === "Above ₹149"));
    assert.equal(store.json.coupons.some((x) => x.code === expired.json.coupon.code), false, "an expired coupon isn't offered");

    const small = await api("POST", "/api/orders/quote", tokens.memberA, { items: [{ mealId: state.dalId, quantity: 1 }], couponCode: code.toLowerCase() });
    assert.equal(small.json.coupon.ok, false);
    assert.match(small.json.coupon.problem, /Add ₹60 more/);
    assert.equal(small.json.total, 89);
    const big = await api("POST", "/api/orders/quote", tokens.memberA, { items: [{ mealId: state.dalId, quantity: 3 }, { mealId: state.plainMealId, quantity: 1 }], couponCode: code });
    assert.deepEqual({ subtotal: big.json.subtotal, discount: big.json.discount, total: big.json.total, ok: big.json.coupon.ok }, { subtotal: 416, discount: 100, total: 316, ok: true });
    assert.match((await api("POST", "/api/orders/quote", tokens.memberA, { items: [{ mealId: state.dalId, quantity: 3 }], couponCode: expired.json.coupon.code })).json.coupon.problem, /expired/);
    assert.match((await api("POST", "/api/orders/quote", tokens.memberA, { items: [{ mealId: state.dalId, quantity: 3 }], couponCode: "NOPE123" })).json.coupon.problem, /isn't valid/);

    const placed = await placePaid(tokens.memberA, order({ slot: "breakfast", items: [{ mealId: state.dalId, quantity: 3 }, { mealId: state.plainMealId, quantity: 1 }], couponCode: code }));
    assert.equal(placed.status, 201, JSON.stringify(placed.json));
    assert.deepEqual({ subtotal: placed.json.order.subtotal, discount: placed.json.order.discount, total: placed.json.order.total, code: placed.json.order.couponCode }, { subtotal: 416, discount: 100, total: 316, code });
    const again = await api("POST", "/api/orders", tokens.memberA, order({ items: [{ mealId: state.dalId, quantity: 3 }], couponCode: code }));
    assert.equal(again.status, 409, "one use per member");
    assert.match(again.json.error, /already used/);
    assert.equal((await placePaid(tokens.memberB, order({ addressId: state.addressB, items: [{ mealId: state.dalId, quantity: 2 }], couponCode: code }))).status, 201, "another member can still use it");

    // A cancelled order gives the use back
    await api("POST", `/api/orders/${placed.json.order.id}/cancel`, tokens.memberA, {});
    assert.equal((await api("POST", "/api/orders/quote", tokens.memberA, { items: [{ mealId: state.dalId, quantity: 2 }], couponCode: code })).json.coupon.ok, true);
    const list = await api("GET", "/api/admin/kitchen/coupons", tokens.admin);
    assert.equal(list.json.coupons.find((x) => x.code === code).uses, 1);
    assert.equal((await api("DELETE", `/api/admin/kitchen/coupons/${added.json.coupon.id}`, tokens.admin)).status, 200);
    const kept = await api("GET", `/api/orders/${placed.json.order.id}`, tokens.memberA);
    assert.equal(kept.json.order.couponCode, code, "a deleted coupon's code stays on the order");
  }));

  it("12b. a first-order coupon: offered and accepted only before a member's first order", run(async () => {
    const [[column]] = await connection.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meal_coupons' AND COLUMN_NAME = 'first_order_only'");
    assert.equal(Number(column.n), 1, "schema.sql has meal_coupons.first_order_only");
    const added = await api("POST", "/api/admin/kitchen/coupons", tokens.admin, { code: `W${runId}`.slice(0, 16), title: `Welcome ${runId}`, kind: "flat", flatOff: 40, firstOrderOnly: true });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.equal(added.json.coupon.firstOrderOnly, true);
    const code = added.json.coupon.code;
    const offered = async (tag) => (await api("GET", "/api/meals/storefront", tokens[tag])).json.coupons.some((x) => x.code === code);
    assert.equal(await offered("memberC"), true, "a member who never ordered sees it");
    assert.equal(await offered("memberA"), false, "a member who has ordered doesn't");
    const quote = (tag) => api("POST", "/api/orders/quote", tokens[tag], { items: [{ mealId: state.dalId, quantity: 3 }], couponCode: code });
    assert.equal((await quote("memberC")).json.coupon.ok, true);
    assert.equal((await quote("memberA")).json.coupon.problem, "That coupon is for your first order.");
    const refused = await api("POST", "/api/orders", tokens.memberA, order({ items: [{ mealId: state.dalId, quantity: 3 }], couponCode: code }));
    assert.equal(refused.status, 409, "the order's own check refuses it too");
    assert.match(refused.json.error, /first order/);
    assert.equal((await api("POST", "/api/admin/kitchen/coupons", tokens.admin, { code: `V${runId}`.slice(0, 16), title: `Bad ${runId}`, kind: "flat", flatOff: 40, firstOrderOnly: 1 })).status, 400, "a boolean only");
    assert.equal((await api("POST", "/api/admin/kitchen/coupons", tokens.memberC, { code: `U${runId}`.slice(0, 16), title: `Mine ${runId}`, kind: "flat", flatOff: 40, firstOrderOnly: true })).status, 403, "members can't make coupons");
    assert.equal((await api("DELETE", `/api/admin/kitchen/coupons/${added.json.coupon.id}`, tokens.admin)).status, 200);
  }));

  it("12c. offer notices: the admin tells members about a live coupon, once each", run(async () => {
    const added = await api("POST", "/api/admin/kitchen/coupons", tokens.admin, { code: `N${runId}`.slice(0, 16), title: `Notice ${runId}`, kind: "flat", flatOff: 30, firstOrderOnly: true });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const id = added.json.coupon.id;
    const told = async (tag) => (await api("GET", "/api/notifications", tokens[tag])).json.notifications.filter((n) => n.kind === "meal.offer" && n.title === `Notice ${runId}`);
    assert.equal((await api("POST", `/api/admin/kitchen/coupons/${id}/announce`, tokens.memberC)).status, 403, "members can't announce");
    assert.equal((await api("POST", "/api/admin/kitchen/coupons/1%20OR%201=1/announce", tokens.admin)).status, 400);
    const first = await api("POST", `/api/admin/kitchen/coupons/${id}/announce`, tokens.admin);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.ok(first.json.sent >= 1);
    const [note] = await told("memberC");
    assert.ok(note, "a member who never ordered is told");
    assert.equal(note.link, "/meals");
    assert.match(note.body, new RegExp(added.json.coupon.code));
    assert.equal((await told("memberA")).length, 0, "a first-order offer skips members who have ordered");
    const again = await api("POST", `/api/admin/kitchen/coupons/${id}/announce`, tokens.admin);
    assert.equal(again.json.sent, 0, "never twice");
    assert.equal((await told("memberC")).length, 1);
    await api("PUT", `/api/admin/kitchen/coupons/${id}`, tokens.admin, { code: added.json.coupon.code, title: `Notice ${runId}`, kind: "flat", flatOff: 30, firstOrderOnly: true, active: false });
    assert.equal((await api("POST", `/api/admin/kitchen/coupons/${id}/announce`, tokens.admin)).status, 409, "a switched-off coupon can't be announced");
    assert.equal((await api("DELETE", `/api/admin/kitchen/coupons/${id}`, tokens.admin)).status, 200);
    assert.equal((await api("POST", `/api/admin/kitchen/coupons/${id}/announce`, tokens.admin)).status, 404);
  }));

  it("12d. referrals: a friend's code gives a personal first-order coupon, the sharer is rewarded once", run(async () => {
    assert.equal((await api("GET", "/api/referrals", null)).status, 401);
    const b = await api("GET", "/api/referrals", tokens.memberB);
    assert.equal(b.status, 200, JSON.stringify(b.json));
    assert.match(b.json.code, /^JF[A-Z0-9]{6}$/);
    assert.equal((await api("GET", "/api/referrals", tokens.memberB)).json.code, b.json.code, "the same code every time");
    const claim = (tag, code) => api("POST", "/api/referrals/claim", tokens[tag], { code });
    assert.equal((await claim("memberB", b.json.code)).status, 409, "not your own code");
    assert.equal((await claim("memberC", "JF' OR 1")).status, 400);
    assert.equal((await api("POST", "/api/referrals/claim", tokens.memberC, { code: b.json.code, userId: identities.memberA.id })).status, 400, "no extra fields");
    assert.equal((await claim("memberC", "JFZZZZZZ")).status, 404);
    assert.equal((await claim("memberA", b.json.code)).status, 409, "a member who has ordered can't");
    const got = await claim("memberC", b.json.code);
    assert.equal(got.status, 201, JSON.stringify(got.json));
    const code = got.json.coupon.code;
    assert.equal((await claim("memberC", b.json.code)).status, 409, "once");
    const sees = async (tag) => (await api("GET", "/api/meals/storefront", tokens[tag])).json.coupons.some((c) => c.code === code);
    assert.equal(await sees("memberC"), true, "the friend sees their coupon");
    assert.equal(await sees("memberA"), false, "nobody else does");
    const quote = (tag) => api("POST", "/api/orders/quote", tokens[tag], { items: [{ mealId: state.dalId, quantity: 3 }], couponCode: code });
    assert.equal((await quote("memberC")).json.coupon.ok, true);
    assert.equal((await quote("memberA")).json.coupon.problem, "That coupon code isn't valid.", "another member's coupon is no coupon");
    assert.equal((await api("GET", "/api/admin/kitchen/coupons", tokens.admin)).json.coupons.some((c) => c.code === code), false, "not in the admin's list");
    // The friend's first order delivered → the sharer gets one reward coupon and a notice
    const pool = { query: (...a) => connection.query(...a), getConnection: async () => Object.assign(connection, { release() {} }) };
    const referrals = require("../../referrals/service");
    await referrals.onDelivered(pool, identities.memberC.id);
    await referrals.onDelivered(pool, identities.memberC.id);
    const after = await api("GET", "/api/referrals", tokens.memberB);
    assert.equal(after.json.joined, 1);
    assert.equal(after.json.rewarded, 1);
    const notes = (await api("GET", "/api/notifications", tokens.memberB)).json.notifications.filter((n) => n.kind === "meal.referral");
    assert.equal(notes.length, 1, "rewarded once");
    const reward = notes[0].body.match(/code (R[A-Z0-9]{7})/)[1];
    assert.equal((await api("POST", "/api/orders/quote", tokens.memberB, { items: [{ mealId: state.dalId, quantity: 3 }], couponCode: reward })).json.coupon.ok, true);
  }));

  it("8b. payments the Razorpay way: only a checked signature places the order", run(async () => {
    const firstBody = order({ slot: "breakfast" });
    const placed = await api("POST", "/api/orders", tokens.memberA, firstBody);
    assert.equal(placed.status, 201, JSON.stringify(placed.json));
    const { order: waiting, checkout } = placed.json;
    assert.equal(waiting.status, "awaiting_payment");
    assert.equal(checkout.provider, "dummy");
    assert.match(checkout.order_id, /^order_[A-Za-z0-9]{14}$/);
    assert.equal(checkout.amount, waiting.total * 100, "the amount is the order's, in paise");
    assert.equal(JSON.stringify(checkout).includes("secret"), false);
    const listed = async () => (await api("GET", "/api/orders", tokens.memberA)).json.orders.some((o) => o.id === waiting.id);
    assert.equal(await listed(), false, "an unpaid order isn't in My orders");
    const kitchen = await api("GET", `/api/admin/kitchen/orders?day=${tomorrow}`, tokens.admin);
    assert.equal(kitchen.json.orders.some((o) => o.id === waiting.id), false, "nor in the kitchen");
    const verify = (token, body, id = waiting.id) => api("POST", `/api/orders/${id}/verify-payment`, token, body);

    // Another member can't pay, fail or verify this payment
    assert.equal((await checkoutPay(tokens.memberB, checkout)).status, 404);
    assert.equal((await api("POST", `/api/orders/${waiting.id}/payment-failed`, tokens.memberB, { razorpay_order_id: checkout.order_id })).status, 404);
    // Unsigned, forged or malformed answers never place it
    const fakePay = "pay_ABCDEFGHIJKLMN";
    assert.equal((await verify(tokens.memberA, { razorpay_order_id: checkout.order_id, razorpay_payment_id: fakePay, razorpay_signature: "0".repeat(64) })).status, 400, "a forged signature");
    assert.equal((await verify(tokens.memberA, { razorpay_order_id: checkout.order_id, razorpay_payment_id: fakePay, razorpay_signature: crypto.createHmac("sha256", "guess").update(`${checkout.order_id}|${fakePay}`).digest("hex") })).status, 400, "signed with the wrong secret");
    assert.equal((await verify(tokens.memberA, { razorpay_order_id: "order_1' OR '1'='1", razorpay_payment_id: fakePay, razorpay_signature: "0".repeat(64) })).status, 400);
    assert.equal((await verify(tokens.memberA, { razorpay_order_id: checkout.order_id, razorpay_payment_id: fakePay, razorpay_signature: "0".repeat(64), paid: true })).status, 400);
    assert.equal((await verify(null, {})).status, 401);
    assert.equal((await api("GET", `/api/orders/${waiting.id}`, tokens.memberA)).json.order.status, "awaiting_payment");

    // A failed payment and a closed checkout are kept; the order keeps waiting
    const failed = await checkoutPay(tokens.memberA, checkout, "failure");
    assert.equal(failed.json.status, "failed");
    assert.equal(failed.json.error.reason, "payment_failed");
    assert.equal((await api("POST", `/api/orders/${waiting.id}/payment-failed`, tokens.memberA, { razorpay_order_id: checkout.order_id, reason: "Checkout closed" })).status, 200);
    const [[row]] = await connection.query("SELECT status, attempts, failure_reason FROM meal_payments WHERE provider_order_id = ?", [checkout.order_id]);
    assert.deepEqual({ status: row.status, attempts: row.attempts, reason: row.failure_reason }, { status: "failed", attempts: 2, reason: "Checkout closed" });

    // Pay again with the same request id: the same order and gateway order; then a good signature places it
    const retry = await api("POST", "/api/orders", tokens.memberA, firstBody);
    assert.equal(retry.status, 200);
    assert.equal(retry.json.order.id, waiting.id);
    assert.equal(retry.json.checkout.order_id, checkout.order_id, "the same gateway order");
    const paid = await checkoutPay(tokens.memberA, checkout);
    assert.equal(paid.status, 200);
    assert.equal((await verify(tokens.memberB, paid.json)).status, 404, "another member's verify");
    const done = await verify(tokens.memberA, paid.json);
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.order.status, "placed");
    assert.equal(done.json.order.payment.ref, paid.json.razorpay_payment_id);
    assert.equal((await verify(tokens.memberA, paid.json)).json.alreadyPaid, true, "a retried verify answers the same");
    assert.equal((await checkoutPay(tokens.memberA, checkout)).status, 409, "a paid order can't be paid again");
    assert.equal(await listed(), true, "now it's in My orders");

    // Unpaid for 15 minutes: the system cancels it, and the next order isn't held up
    const slowBody = order({ slot: "breakfast" });
    const slow = await api("POST", "/api/orders", tokens.memberA, slowBody);
    await connection.query("UPDATE orders SET created_at = NOW() - INTERVAL 20 MINUTE WHERE id = ?", [slow.json.order.id]);
    const next = await api("POST", "/api/orders", tokens.memberA, order({ slot: "breakfast" }));
    assert.equal(next.status, 201);
    const [[expired]] = await connection.query("SELECT status, cancelled_by FROM orders WHERE id = ?", [slow.json.order.id]);
    assert.deepEqual({ ...expired }, { status: "cancelled", cancelled_by: "system" });
    assert.equal((await api("POST", "/api/orders", tokens.memberA, slowBody)).status, 409, "a retried Pay for an expired checkout starts over");
    assert.equal((await checkoutPay(tokens.memberA, slow.json.checkout)).status, 409, "the dummy gateway won't take a payment for a closed order");
    // A payment the gateway confirms late (as Razorpay may) still places it while the meal time is open
    const latePay = "pay_LATEPAYMENT001";
    const lateSig = crypto.createHmac("sha256", paymentRules.dummySecret(authSecret)).update(`${slow.json.checkout.order_id}|${latePay}`).digest("hex");
    const late = await verify(tokens.memberA, { razorpay_order_id: slow.json.checkout.order_id, razorpay_payment_id: latePay, razorpay_signature: lateSig }, slow.json.order.id);
    assert.equal(late.status, 200, JSON.stringify(late.json));
    assert.equal(late.json.order.status, "placed");
    assert.equal(late.json.order.cancelledBy, null);
    // Only one order waits at a time: a new Pay cancels the member's other unpaid order
    const third = await api("POST", "/api/orders", tokens.memberA, order({ slot: "breakfast" }));
    const [[superseded]] = await connection.query("SELECT status, cancelled_by FROM orders WHERE id = ?", [next.json.order.id]);
    assert.deepEqual({ ...superseded }, { status: "cancelled", cancelled_by: "system" });
    assert.equal((await api("POST", `/api/orders/${third.json.order.id}/cancel`, tokens.memberA, {})).json.order.status, "cancelled", "the member may cancel an unpaid order");
  }));

  it("9. deleting a meal keeps past orders and removes the photo", run(async () => {
    const files = fs.readdirSync(photoDir).length;
    const del = await api("DELETE", `/api/admin/kitchen/meals/${state.mealId}`, tokens.admin);
    assert.equal(del.status, 200);
    assert.equal(fs.readdirSync(photoDir).length, files - 1, "the photo file is gone");
    assert.equal((await api("DELETE", `/api/admin/kitchen/meals/${state.mealId}`, tokens.admin)).status, 404);
    assert.equal((await api("GET", "/api/meals", tokens.memberA)).json.meals.some((m) => m.id === state.mealId), false);
    const past = await api("GET", `/api/orders/${state.orderId}`, tokens.memberA);
    const item = past.json.order.items.find((i) => i.name === `Paneer Bowl ${runId}`);
    assert.equal(item.quantity, 2);
    assert.equal(item.price, 249);
    assert.equal(item.mealId, null);
    assert.equal((await api("POST", "/api/orders", tokens.memberA, order())).status, 409, "a deleted meal can't be ordered");
  }));
});
