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
const rules = require("../../meals/rules");

describe("meal ordering e2e: the admin's meals and times, a member's order, delivered into Macro", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, photoDir;
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

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-meal-photos-"));
    server = await startTestServer({ ...env, MEAL_PHOTO_DIR: photoDir });
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
          await connection.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))", [all]);
          await connection.query("DELETE FROM orders WHERE user_id IN (?)", [all]);
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
    assert.deepEqual(slots.json.slots, rules.DEFAULT_SLOTS);
    for (const bad of [{ slots: { ...rules.DEFAULT_SLOTS, lunch: { startsAt: "14:00", endsAt: "13:00", active: true } } }, { slots: { lunch: rules.DEFAULT_SLOTS.lunch } }]) {
      assert.equal((await api("PUT", "/api/admin/kitchen/slots", tokens.admin, bad)).status, 400);
    }
    const next = { ...rules.DEFAULT_SLOTS, lunch: { startsAt: "12:00", endsAt: "13:30", active: true }, dinner: { ...rules.DEFAULT_SLOTS.dinner, active: false } };
    const saved = await api("PUT", "/api/admin/kitchen/slots", tokens.admin, { slots: next });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.slots, next);
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
    const placed = await api("POST", "/api/orders", tokens.memberA, body);
    assert.equal(placed.status, 201, JSON.stringify(placed.json));
    const o = placed.json.order;
    state.orderId = o.id;
    assert.equal(o.status, "placed");
    assert.equal(o.total, 249 * 2 + 149);
    assert.equal(o.slot, "lunch");
    assert.equal(o.slotStartsAt, "12:00");
    assert.equal(o.date, tomorrow);
    assert.equal(o.payment.method, "test");
    assert.match(o.payment.ref, /^TEST-/);
    assert.equal(o.address.line, `Flat 4B, MG Road, Near SIT, Tumakuru, ${DELIVERS}`);
    assert.equal(o.totals.calories, 520 * 3);
    // A retried Pay with the same request id places nothing new
    const again = await api("POST", "/api/orders", tokens.memberA, body);
    assert.equal(again.status, 200);
    assert.equal(again.json.order.id, o.id);
    assert.equal(again.json.repeated, true);
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
    assert.equal((await step("placed")).json.order.status, "preparing");
    assert.equal((await step("placed")).status, 409, "a double tap moves it once");
    assert.equal((await api("POST", `/api/orders/${state.orderId}/cancel`, tokens.memberA, {})).status, 409, "too late for the member to cancel");
    assert.equal((await step("preparing")).json.order.status, "out_for_delivery");
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
    const first = await api("POST", "/api/orders", tokens.memberA, order({ slot: "breakfast" }));
    assert.equal(first.status, 201);
    const cancelled = await api("POST", `/api/orders/${first.json.order.id}/cancel`, tokens.memberA, { reason: "Plans changed" });
    assert.equal(cancelled.json.order.status, "cancelled");
    assert.equal(cancelled.json.order.cancelledBy, "member");
    assert.equal((await api("POST", `/api/orders/${first.json.order.id}/cancel`, tokens.memberA, {})).status, 409);

    const second = await api("POST", "/api/orders", tokens.memberB, order({ addressId: state.addressB }));
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

    const placed = await api("POST", "/api/orders", tokens.memberA, order({ slot: "breakfast", items: [{ mealId: state.dalId, quantity: 3 }, { mealId: state.plainMealId, quantity: 1 }], couponCode: code }));
    assert.equal(placed.status, 201, JSON.stringify(placed.json));
    assert.deepEqual({ subtotal: placed.json.order.subtotal, discount: placed.json.order.discount, total: placed.json.order.total, code: placed.json.order.couponCode }, { subtotal: 416, discount: 100, total: 316, code });
    const again = await api("POST", "/api/orders", tokens.memberA, order({ items: [{ mealId: state.dalId, quantity: 3 }], couponCode: code }));
    assert.equal(again.status, 409, "one use per member");
    assert.match(again.json.error, /already used/);
    assert.equal((await api("POST", "/api/orders", tokens.memberB, order({ addressId: state.addressB, items: [{ mealId: state.dalId, quantity: 2 }], couponCode: code }))).status, 201, "another member can still use it");

    // A cancelled order gives the use back
    await api("POST", `/api/orders/${placed.json.order.id}/cancel`, tokens.memberA, {});
    assert.equal((await api("POST", "/api/orders/quote", tokens.memberA, { items: [{ mealId: state.dalId, quantity: 2 }], couponCode: code })).json.coupon.ok, true);
    const list = await api("GET", "/api/admin/kitchen/coupons", tokens.admin);
    assert.equal(list.json.coupons.find((x) => x.code === code).uses, 1);
    assert.equal((await api("DELETE", `/api/admin/kitchen/coupons/${added.json.coupon.id}`, tokens.admin)).status, 200);
    const kept = await api("GET", `/api/orders/${placed.json.order.id}`, tokens.memberA);
    assert.equal(kept.json.order.couponCode, code, "a deleted coupon's code stays on the order");
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
