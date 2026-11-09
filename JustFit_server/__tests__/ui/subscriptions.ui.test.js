// Meal subscriptions in the web build against the test server (Meal Operations phase 5, the user's
// design phones 2 and 3): Meal Subscription lists the plans, Subscribe Now opens Plan Details (stats,
// 7 / 28 / 90 days with savings, What's Included), Subscribe for ₹x → the checkout → the test payment
// → My meal plan, and the tab then shows the running plan's card. Widths 320/390/430 never overflow.
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

describe("ui subscriptions: plans, plan details, subscribing and the running plan", () => {
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
    const mealIds = [];
    for (const m of [
      { name: `Grilled Chicken Bowl ${runId}`, diet: "non-vegetarian", calories: 430, proteinG: 38, carbsG: 42, fatG: 12, price: 259 },
      { name: `Paneer Tikka Bowl ${runId}`, diet: "vegetarian", calories: 420, proteinG: 32, carbsG: 48, fatG: 10, price: 229 },
    ]) {
      const made = await apiAs("admin", "POST", "/api/admin/kitchen/meals", { ...m, photo });
      mealIds.push(made.json.meal.id);
    }
    const plans = await apiAs("admin", "GET", "/api/admin/kitchen/subscription-plans");
    const fat = plans.json.plans.find((p) => p.slug === "fat-loss");
    const saved = await apiAs("admin", "PUT", `/api/admin/kitchen/subscription-plans/${fat.id}`, {
      name: fat.name, tagline: fat.tagline, description: fat.description, goal: fat.goal, mealsPerDay: 3, calories: fat.calories, proteinG: fat.proteinG, carbsG: fat.carbsG,
      fatG: fat.fatG, waterL: fat.waterL, included: fat.included, lengths: fat.lengths.map((l) => ({ days: l.days, price: l.price })), mealIds, active: true,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
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
        await connection.query("DELETE FROM meal_subscriptions WHERE user_id IN (?)", [ids]);
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

  it("1. Meal Subscription lists the plans", run("subscription-tab", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.member);
    await page.waitFor(`location.pathname.startsWith("/home")`, 60000, "Home");
    await h.goto("/meals", "Popular Meals");
    await page.clickText("Meal Subscription");
    for (const text of ["Explore Meal Subscription Plans", "Fat Loss Plan", "Calorie deficit, high protein", "₹6,999", "/month", "Muscle Gain Plan", "Weight Maintain Plan", "Subscribe Now"]) await h.expectText(text);
    await snapshotAllWidths("subscription-plans");
  }));

  it("2. Plan Details: stats, durations with savings, what's included", run("plan-details", async () => {
    await page.clickText("Subscribe Now");
    await page.waitFor(`location.pathname === "/meals/plans/fat-loss"`, NAV_TIMEOUT, "Plan Details");
    for (const text of ["Plan Details", "Fat Loss Plan", "Meals / Day", "kcal / Day", "Protein", "Water", "Plan Duration", "7 Days", "28 Days", "90 Days", "What's Included", "Fresh & hygienic preparation", "Subscribe for ₹6,999"]) await h.expectText(text);
    await snapshotAllWidths("plan-details");
    await clickLabel("7 days, ₹1,899");
    await h.expectText("Subscribe for ₹1,899");
  }));

  it("3. subscribe, pay in the test checkout, and the tab shows the running plan", run("subscribe", async () => {
    await page.clickText("Subscribe for ₹1,899");
    await page.waitFor(`location.pathname === "/meals/subscribe"`, NAV_TIMEOUT, "the checkout");
    await h.expectText("Starts on");
    await h.expectText("21 meals in all");
    await page.clickText("Pay ₹1,899");
    await h.expectText("Test mode: no money is taken");
    await h.settle();
    await page.clickText("Pay ₹1,899", 1); // the sheet's button (the screen's own is under it)
    await page.waitFor(`location.pathname === "/meals/subscription"`, NAV_TIMEOUT, "My meal plan");
    for (const text of ["My meal plan", "Fat Loss Plan", "0 of 21 meals delivered", "Next deliveries", "Cancel plan"]) await h.expectText(text);
    await snapshotAllWidths("my-plan");
    await h.goto("/meals", "Popular Meals");
    await page.clickText("Meal Subscription");
    for (const text of ["Active", "0 of 21 meals used", "21 meals left", "Pause", "Change Plan", "Delivery", "Manage"]) await h.expectText(text);
    await snapshotAllWidths("subscription-active");
    const [[row]] = await connection.query("SELECT status, payment_method FROM meal_subscriptions WHERE user_id = ?", [identities.member.id]);
    assert.deepEqual({ ...row }, { status: "active", payment_method: "dummy" });
  }));
});
