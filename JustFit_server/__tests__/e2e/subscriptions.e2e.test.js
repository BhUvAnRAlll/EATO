// Meal subscriptions end to end (Meal Operations phase 5, 2026-11-10; per meal since 2027-01-10):
// test accounts in justfit_test against the real Express server. A member subscribes to one meal
// (how many a day, a meal time, a length at its % off; paid the Razorpay way), the generator makes
// each delivery day's order (once), a meal counts as used only when delivered, skipping or pausing
// moves the end on, cancelling stops orders. The Super Admin sets the lengths and manages
// subscriptions. Attack paths: members on the admin routes, another member's address or
// subscription, prices from the app, starts out of range, a forged payment.
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
describe("subscriptions e2e: lengths, subscribing to a meal and paying, daily orders, skip, pause, cancel, admin", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const DELIVERS = "599241";
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
  const subscribeBody = (over = {}) => ({ clientId: crypto.randomUUID(), mealId: state.meals[0], lengthId: state.week, quantity: 2, slot: "lunch", startsOn: tomorrow, addressId: state.addressA, ...over });
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
          await connection.query("DELETE FROM meal_subscriptions WHERE user_id IN (?)", [all]);
        }
        await connection.query("DELETE FROM subscription_lengths");
        await connection.query("INSERT INTO subscription_lengths (label, days, percent_off, sort_order) VALUES ('3 Days', 3, 3, 1), ('7 Days', 7, 5, 2), ('15 Days', 15, 7, 3), ('1 Month', 26, 10, 4)");
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

  it("1. members see the lengths; the admin's routes are the admin's and the admin sets them", run(async () => {
    for (const [method, route, body] of [["GET", `${base}/subscription-lengths`], ["GET", `${base}/subscriptions`], ["POST", `${base}/subscriptions/generate`, { day: tomorrow }]]) {
      assert.equal((await api(method, route, null, body)).status, 401);
      assert.equal((await api(method, route, tokens.memberA, body)).status, 403);
    }
    assert.equal((await api("PUT", `${base}/subscription-lengths`, tokens.memberA, { lengths: [] })).status, 403);
    assert.equal((await api("GET", "/api/subscriptions/lengths", null)).status, 401);
    const lengths = await api("GET", "/api/subscriptions/lengths", tokens.memberA);
    assert.equal(lengths.status, 200);
    assert.deepEqual(lengths.json.lengths.map((l) => [l.label, l.days, l.percentOff]), [["3 Days", 3, 3], ["7 Days", 7, 5], ["15 Days", 15, 7], ["1 Month", 26, 10]]);
    assert.equal((await api("GET", "/api/subscriptions/plans", tokens.memberA)).status, 404, "the whole plans are gone");
    // The admin turns 3 days off and makes a week 8% off
    const next = lengths.json.lengths.map((l) => ({ label: l.label, days: l.days, percentOff: l.days === 7 ? 8 : l.percentOff, active: l.days !== 3 }));
    assert.equal((await api("PUT", `${base}/subscription-lengths`, tokens.admin, { lengths: next.map((l) => ({ ...l, percentOff: 80 })) })).status, 400);
    const saved = await api("PUT", `${base}/subscription-lengths`, tokens.admin, { lengths: next });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.lengths.length, 4, "the admin sees every length");
    const offered = (await api("GET", "/api/subscriptions/lengths", tokens.memberA)).json.lengths;
    assert.deepEqual(offered.map((l) => l.days), [7, 15, 26], "a length switched off isn't offered");
    state.week = offered.find((l) => l.days === 7).id;
    state.off = saved.json.lengths.find((l) => l.days === 3).id;
    const [[audit]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'meal.subscription_prices'");
    assert.ok(Number(audit.n) >= 1);
  }));

  it("2. subscribing to a meal: checked, priced by the server, waits for payment, then active", run(async () => {
    for (const bad of [subscribeBody({ startsOn: today }), subscribeBody({ startsOn: rules.addDays(today, 20) }), subscribeBody({ price: 1 }), subscribeBody({ clientId: "x" }),
      subscribeBody({ quantity: 4 }), subscribeBody({ slot: "snack" }), subscribeBody({ mealId: "x' OR 1=1" }), subscribeBody({ planId: 1 })]) {
      assert.equal((await api("POST", "/api/subscriptions", tokens.memberA, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await api("POST", "/api/subscriptions", tokens.memberA, subscribeBody({ lengthId: state.off }))).status, 409, "a length that's switched off");
    assert.equal((await api("POST", "/api/subscriptions", tokens.memberA, subscribeBody({ addressId: state.addressB }))).status, 404, "another member's address");
    assert.equal((await api("POST", "/api/subscriptions", tokens.memberA, subscribeBody({ mealId: "no-such-meal" }))).status, 404, "a meal that isn't on the menu");
    const body = subscribeBody();
    const made = await api("POST", "/api/subscriptions", tokens.memberA, body);
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.equal(made.json.subscription.status, "awaiting_payment");
    assert.equal(made.json.checkout.amount, Math.round((249 * 2 * 7 * 0.92)) * 100, "₹249 × 2 a day × 7 days, 8% off, in paise");
    assert.equal(made.json.subscription.endsOn, rules.addDays(tomorrow, 6));
    assert.deepEqual({ ...made.json.subscription.meal, imageUrl: undefined }, { id: state.meals[0], name: `Paneer Bowl ${runId}`, slot: "lunch", quantity: 2, unitPrice: 249, percentOff: 8, imageUrl: undefined });
    const again = await api("POST", "/api/subscriptions", tokens.memberA, body);
    assert.equal(again.json.subscription.id, made.json.subscription.id);
    assert.equal(again.json.checkout.order_id, made.json.checkout.order_id);
    const forged = await api("POST", `/api/subscriptions/${made.json.subscription.id}/verify-payment`, tokens.memberA, { razorpay_order_id: made.json.checkout.order_id, razorpay_payment_id: "pay_FORGEDFORGED01", razorpay_signature: "0".repeat(64) });
    assert.equal(forged.status, 400);
    assert.equal((await api("POST", "/api/orders/gateway/dummy/checkout", tokens.memberB, { razorpay_order_id: made.json.checkout.order_id, method: "upi", outcome: "success" })).status, 404, "another member can't pay it");
    const paid = await pay(tokens.memberA, made.json);
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    assert.equal(paid.json.subscription.status, "active");
    state.sub = made.json.subscription.id;
    assert.equal((await api("POST", "/api/subscriptions", tokens.memberA, subscribeBody())).status, 409, "the same meal at the same meal time twice");
    const dinner = await api("POST", "/api/subscriptions", tokens.memberA, subscribeBody({ slot: "dinner", quantity: 1 }));
    assert.equal(dinner.status, 201, "another meal time is a second subscription");
    const mine = await api("GET", "/api/subscriptions/mine", tokens.memberA);
    assert.deepEqual(mine.json.active.map((s) => ({ id: s.id, total: s.mealsTotal, used: s.mealsUsed })), [{ id: state.sub, total: 7, used: 0 }], "an unpaid one isn't listed");
    assert.deepEqual((await api("GET", "/api/subscriptions/mine", tokens.memberB)).json.active, []);
    assert.equal((await api("POST", `/api/subscriptions/${state.sub}/cancel`, tokens.memberB, {})).status, 404);
  }));

  it("3. the generator makes tomorrow's orders once; a meal is used only when delivered", run(async () => {
    const first = await api("POST", `${base}/subscriptions/generate`, tokens.admin, { day: tomorrow });
    assert.deepEqual({ made: first.json.made, unfilled: first.json.unfilled }, { made: 1, unfilled: 0 });
    assert.equal((await api("POST", `${base}/subscriptions/generate`, tokens.admin, { day: tomorrow })).json.made, 0, "running it again makes nothing new");
    assert.equal((await api("POST", `${base}/subscriptions/generate`, tokens.admin, { day: rules.addDays(today, 9) })).status, 400);
    const [orders] = await connection.query("SELECT o.id, o.meal_slot, o.total_paise, o.payment_method, i.meal_id, i.quantity FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.subscription_id = ?", [state.sub]);
    assert.deepEqual(orders.map((o) => [o.meal_slot, Number(o.total_paise), o.payment_method, o.meal_id, Number(o.quantity)]), [["lunch", 0, "subscription", state.meals[0], 2]]);
    const mine = (await api("GET", "/api/orders", tokens.memberA)).json.orders.filter((o) => orders.some((x) => x.id === o.id));
    assert.equal(mine.length, 1, "it's in My orders");
    for (const from of ["placed", "accepted", "preparing", "quality_check", "ready", "out_for_delivery"]) {
      assert.equal((await api("POST", `${base}/orders/${orders[0].id}/advance`, tokens.admin, { from })).status, 200, from);
    }
    let sub = (await api("GET", "/api/subscriptions/mine", tokens.memberA)).json.active[0];
    assert.deepEqual({ used: sub.mealsUsed, left: sub.mealsLeft }, { used: 1, left: 6 });
    assert.equal(sub.upcoming[0].day, tomorrow);
    // A day whose order is cancelled isn't used
    const day2 = rules.addDays(today, 2);
    assert.equal((await api("POST", `${base}/subscriptions/generate`, tokens.admin, { day: day2 })).json.made, 1);
    const [[second]] = await connection.query("SELECT id FROM orders WHERE subscription_id = ? AND delivery_date = ?", [state.sub, day2]);
    assert.equal((await api("POST", `${base}/orders/${second.id}/cancel`, tokens.admin, { reason: "Out of stock today" })).status, 200);
    sub = (await api("GET", "/api/subscriptions/mine", tokens.memberA)).json.active[0];
    assert.deepEqual({ used: sub.mealsUsed, left: sub.mealsLeft }, { used: 1, left: 6 }, "the cancelled meal isn't used");
  }));

  it("4. skipping a coming day and pausing move the end on; resuming gives the days back", run(async () => {
    const sub = () => api("GET", "/api/subscriptions/mine", tokens.memberA).then((r) => r.json.active.find((s) => s.id === state.sub));
    const current = (json) => json.active.find((s) => s.id === state.sub);
    const end = (await sub()).endsOn;
    const day3 = rules.addDays(today, 3);
    assert.equal((await api("POST", `/api/subscriptions/${state.sub}/skip`, tokens.memberA, { day: tomorrow })).status, 409, "tomorrow's meals are with the kitchen");
    const skipped = await api("POST", `/api/subscriptions/${state.sub}/skip`, tokens.memberA, { day: day3 });
    assert.equal(skipped.status, 200, JSON.stringify(skipped.json));
    assert.equal(current(skipped.json).endsOn, rules.addDays(end, 1));
    assert.ok(current(skipped.json).upcoming.find((d) => d.day === day3).slots.every((s) => s.status === "skipped"));
    assert.equal((await api("POST", `/api/subscriptions/${state.sub}/skip`, tokens.memberA, { day: day3 })).status, 409);
    assert.equal((await api("POST", `${base}/subscriptions/generate`, tokens.admin, { day: day3 })).json.made, 0, "a skipped day makes no orders");
    assert.equal(current((await api("POST", `/api/subscriptions/${state.sub}/unskip`, tokens.memberA, { day: day3 })).json).endsOn, end);

    const from = rules.addDays(today, 4);
    const until = rules.addDays(today, 5);
    const paused = await api("POST", `/api/subscriptions/${state.sub}/pause`, tokens.memberA, { from, until });
    assert.equal(current(paused.json).endsOn, rules.addDays(end, 2));
    assert.equal((await api("POST", `/api/subscriptions/${state.sub}/pause`, tokens.memberA, { from: rules.addDays(today, 6), until: rules.addDays(today, 6) })).status, 409, "one pause at a time");
    assert.equal((await api("POST", `${base}/subscriptions/generate`, tokens.admin, { day: from })).json.made, 0, "nothing while paused");
    assert.equal(current((await api("POST", `/api/subscriptions/${state.sub}/resume`, tokens.memberA, {})).json).endsOn, end, "the pause hadn't started: every day back");
    assert.equal((await api("POST", `/api/subscriptions/${state.sub}/pause`, tokens.memberA, { from: today, until: tomorrow })).status, 400, "from tomorrow at the earliest");
  }));

  it("5. the admin: list, extend, cancel (open orders cancelled too)", run(async () => {
    const list = await api("GET", `${base}/subscriptions?status=active`, tokens.admin);
    assert.ok(list.json.subscriptions.some((s) => s.id === state.sub && s.member.phone));
    assert.equal((await api("GET", `${base}/subscriptions?status=weird`, tokens.admin)).status, 400);
    const before = (await api("GET", `${base}/subscriptions/${state.sub}`, tokens.admin)).json.subscription;
    const extended = await api("POST", `${base}/subscriptions/${state.sub}/extend`, tokens.admin, { days: 7 });
    assert.equal(extended.json.subscription.endsOn, rules.addDays(before.endsOn, 7));
    assert.equal((await api("POST", `${base}/subscriptions/${state.sub}/extend`, tokens.admin, { days: 0 })).status, 400);
    assert.equal((await api("POST", `${base}/subscriptions/${state.sub}/plan`, tokens.admin, { planId: 1 })).status, 404, "no plan changes any more");
    assert.equal((await api("POST", `${base}/subscriptions/${state.sub}/cancel`, tokens.admin, {})).status, 400, "the admin gives a reason");
    const cancelled = await api("POST", `${base}/subscriptions/${state.sub}/cancel`, tokens.admin, { reason: "The member asked to cancel" });
    assert.equal(cancelled.json.subscription.status, "cancelled");
    const [[open]] = await connection.query("SELECT COUNT(*) AS n FROM orders WHERE subscription_id = ? AND status IN ('placed', 'accepted')", [state.sub]);
    assert.equal(Number(open.n), 0);
    const dash = await api("GET", `${base}/dashboard?day=${tomorrow}`, tokens.admin);
    assert.equal(typeof dash.json.subscriptions.active, "number");
    assert.equal(dash.json.orders.subscription, 1, "tomorrow's subscription order");
  }));
});
