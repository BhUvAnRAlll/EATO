// The Meals tab (rebuilt 2026-11-10 from the user's design) and Pay the Razorpay way, in the web
// build against the test server: the header, Order Meals | Meal Subscription, Deliver to, the quick
// tiles, Popular Meals, Add to cart, the filter sheet, then the cart's Pay → the test checkout →
// a placed order. Widths 320/390/430 never overflow.
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { identitiesFor, describeIdentityError } = require("../e2e/test-identities.js");
const { png } = require("../e2e/images.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const DELIVERS = "599211";

describe("ui meals: the Meals tab from the design, and paying the Razorpay way", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h, photoDir;
  const identities = {};
  const sessions = {};
  const tokens = {};

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 400).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | server log: ${(server?.logs ?? []).slice(-3).join(" | ")} | visible text: "${text}"`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  const viewport = (width, height) => client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true }, page.sessionId);
  const noOverflow = async (label) => assert.equal(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, `${label}: the page must not overflow horizontally`);
  const snapshotAllWidths = async (name) => {
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await h.settle();
      await noOverflow(`${name} at ${w}`);
      if (SCREENSHOT_DIR) { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); await page.screenshot(path.join(SCREENSHOT_DIR, `${name}-${w}.png`)); }
    }
    await viewport(390, 844);
    await h.settle();
  };
  const apiAs = async (tag, method, route, body) => {
    const headers = { Authorization: `Bearer ${tokens[tag]}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  const clickLabel = async (label) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label") === ${JSON.stringify(label)})[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-ui-meal-photos-"));
    server = await startTestServer({ ...env, MEAL_PHOTO_DIR: photoDir });
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      for (const [tag, role] of [["member", undefined], ["admin", "admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        sessions[tag] = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Asha Rao", identities.member.id]);
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency, profile_complete) VALUES (?, '1995-05-10', 'female', 'fat_loss', 162, 60, '3-4', TRUE)", [identities.member.id]);
    await connection.query("INSERT INTO delivery_pincodes (pincode, area) VALUES (?, 'Koramangala')", [DELIVERS]);
    const address = await apiAs("member", "POST", "/api/addresses", {
      kind: "home", receiverName: "Asha Rao", receiverPhone: "9876543210", house: "Flat 2A", street: "80 Feet Road", landmark: null, city: "Bengaluru",
      pincode: DELIVERS, formattedAddress: "80 Feet Road, Bengaluru", latitude: 12.9352, longitude: 77.6245, instructions: null, makeDefault: true,
    });
    assert.equal(address.status, 201, JSON.stringify(address.json));
    const photo = { data: png(640, 480).toString("base64"), mediaType: "image/png" };
    for (const m of [
      { name: `Grilled Chicken Bowl ${runId}`, diet: "non-vegetarian", calories: 430, proteinG: 38, carbsG: 42, fatG: 12, price: 259, tags: ["bestseller"] },
      { name: `Paneer Tikka Bowl ${runId}`, diet: "vegetarian", calories: 420, proteinG: 32, carbsG: 48, fatG: 10, price: 229 },
    ]) assert.equal((await apiAs("admin", "POST", "/api/admin/kitchen/meals", { ...m, photo })).status, 201);
    // Every meal time open: tomorrow's lunch is always orderable
    assert.equal((await apiAs("admin", "PUT", "/api/admin/kitchen/slots", { slots: { breakfast: { startsAt: "07:00", endsAt: "09:00", active: true }, lunch: { startsAt: "12:30", endsAt: "14:00", active: true }, dinner: { startsAt: "19:00", endsAt: "21:00", active: true } } })).status, 200);
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    await step("rows", async () => {
      if (!connection) return;
      const ids = Object.values(identities).map((i) => i.id);
      if (ids.length > 0) {
        await connection.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (?))", [ids]);
        await connection.query("DELETE FROM orders WHERE user_id IN (?)", [ids]);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [ids]);
        await connection.query("DELETE FROM profiles WHERE user_id IN (?)", [ids]);
        await db.deleteUsers(connection, ids);
      }
      await connection.query("DELETE FROM meals WHERE name LIKE ?", [`%${runId}%`]);
      await connection.query("DELETE FROM delivery_pincodes WHERE pincode = ?", [DELIVERS]);
      await connection.end();
    });
    await step("identities", async () => {
      if (!testAccounts) return;
      for (const sessionId of Object.values(sessions)) await testAccounts.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id);
    });
    if (photoDir) fs.rmSync(photoDir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the Meals tab: header, the switch, Deliver to, quick tiles, Popular Meals", run("meals-tab", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.member);
    await page.waitFor(`location.pathname.startsWith("/home")`, 60000, "Home");
    await h.goto("/meals", "Popular Meals");
    for (const text of ["Nutritious meals for your fitness goals", "Order Meals", "Meal Subscription", "Deliver to", "Home · Koramangala, Bengaluru", "High Protein", "Low Calorie", "Non-Veg", "Combos", "Popular Meals", `Grilled Chicken Bowl ${runId}`, "430 kcal | P 38g C 42g F 12g", "₹259", "Bestseller"]) {
      await h.expectText(text);
    }
    await snapshotAllWidths("meals-tab");
  }));

  it("2. Add puts a meal in the cart; the cart's badge counts it", run("meals-add", async () => {
    await clickLabel(`Add Grilled Chicken Bowl ${runId} to cart`);
    await page.waitFor(`[...document.querySelectorAll('[aria-label]')].some((e) => e.getAttribute("aria-label") === "Cart, 1 meals")`, NAV_TIMEOUT, "the cart's count");
    await clickLabel(`One more Grilled Chicken Bowl ${runId}`);
    await page.waitFor(`[...document.querySelectorAll('[aria-label]')].some((e) => e.getAttribute("aria-label") === "Cart, 2 meals")`, NAV_TIMEOUT, "two in the cart");
  }));

  it("3. the filter sheet narrows the tab to one diet; Meal Subscription says what's coming", run("meals-filter", async () => {
    await clickLabel("Filters");
    await h.expectText("Sort by");
    await h.settle(); // the sheet has finished sliding up
    await clickLabel("Diet: Veg");
    await page.clickText("Show meals");
    await page.waitFor(`!(document.body.innerText || "").includes("Sort by")`, NAV_TIMEOUT, "the sheet closed");
    await page.waitFor(`!(document.body.innerText || "").includes(${JSON.stringify(`Grilled Chicken Bowl ${runId}`)})`, NAV_TIMEOUT, "non-veg meals hidden");
    await h.expectText(`Paneer Tikka Bowl ${runId}`);
    await clickLabel("Filters, some on");
    await h.expectText("Sort by");
    await h.settle();
    await page.clickText("Clear filters");
    await page.clickText("Show meals");
    await page.waitFor(`!(document.body.innerText || "").includes("Sort by")`, NAV_TIMEOUT, "the sheet closed");
    await h.expectText(`Grilled Chicken Bowl ${runId}`);
    await page.clickText("Meal Subscription");
    await h.expectText("Meal subscriptions are coming");
    await snapshotAllWidths("meals-subscription");
    await page.clickText("Order Meals");
    await h.expectText("Popular Meals");
  }));

  it("4. Pay opens the test checkout; paying places the order", run("meals-pay", async () => {
    await clickLabel("Cart, 2 meals");
    await page.waitFor(`location.pathname === "/meals/cart"`, NAV_TIMEOUT, "the cart");
    await h.expectText("Payments are in test mode");
    await page.clickText("Pay ₹518");
    await h.expectText("Test mode: no money is taken");
    for (const text of ["UPI", "Card", "Netbanking", "Wallet"]) await h.expectText(text);
    await snapshotAllWidths("meals-checkout");
    await page.clickText("Try a failed payment (test)");
    await h.expectText("Your payment didn't go through");
    await clickLabel("Pay ₹518");
    await page.waitFor(`location.pathname.startsWith("/orders/")`, NAV_TIMEOUT, "the order's page");
    await h.expectText("Order placed");
    const [[row]] = await connection.query("SELECT o.status, o.payment_method, p.status AS paid FROM orders o JOIN meal_payments p ON p.order_id = o.id WHERE o.user_id = ?", [identities.member.id]);
    assert.deepEqual({ ...row }, { status: "placed", payment_method: "dummy", paid: "paid" });
  }));
});
