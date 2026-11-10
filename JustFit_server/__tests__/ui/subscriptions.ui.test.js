// Meal subscriptions in the web build against the test server (per meal since 2027-01-10, the user's
// meal page design): a meal's page has One-time Order | Meal Subscription, the lengths with their
// % off and the quantity, Add Subscription → the checkout (start, meal time, address, bill) → the
// test payment → Profile › My subscriptions, and a subscription's own page. Widths 320/390/430 never
// overflow.
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

describe("ui subscriptions: a meal's page, subscribing and My subscriptions", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h, photoDir;
  const mealIds = [];
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
      { name: `Grilled Chicken Bowl ${runId}`, diet: "non-vegetarian", calories: 430, proteinG: 38, carbsG: 42, fatG: 12, price: 259 },
      { name: `Paneer Tikka Bowl ${runId}`, diet: "vegetarian", calories: 420, proteinG: 32, carbsG: 48, fatG: 10, price: 229 },
    ]) {
      const made = await apiAs("admin", "POST", "/api/admin/kitchen/meals", { ...m, photo });
      mealIds.push(made.json.meal.id);
    }
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

  it("1. a meal's page: the lengths, the quantity, Add Subscription and the order-once link (no switch)", run("meal-subscription", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.member);
    await page.waitFor(`location.pathname.startsWith("/home")`, 60000, "Home");
    await h.goto(`/meals/${mealIds[0]}`, "Subscription Plans");
    for (const text of [`Grilled Chicken Bowl ${runId}`, "per meal", "Calories", "Or order just once", "Add to cart ₹259"]) await h.expectText(text);
    assert.equal(await page.evaluate(`(document.body.innerText || "").includes("One-time Order")`), false, "no One-time | Subscription switch");
    for (const text of ["Subscription Plans", "Save up to 10%", "3 Days", "7 Days", "15 Days", "1 Month", "26 meals", "₹6,061", "10% off", "Daily meal delivery for 26 days", "Add Subscription · ₹6,061"]) await h.expectText(text);
    await snapshotAllWidths("meal-subscription");
    await clickLabel("7 Days, 7 meals, ₹1,722, 5% off");
    await h.expectText("Add Subscription · ₹1,722");
    await clickLabel(`One more Grilled Chicken Bowl ${runId}`);
    await h.expectText("Add Subscription · ₹3,445");
    await h.expectText("14 meals");
  }));

  it("2. subscribe: start, meal time, address and bill, then pay in the test checkout", run("subscribe", async () => {
    await page.clickText("Add Subscription · ₹3,445");
    await page.waitFor(`location.pathname === "/meals/subscribe"`, NAV_TIMEOUT, "the checkout");
    for (const text of ["Your plan", "14 meals · 2 a day", "Daily meal delivery for 7 days", "Starts on", "Meal time", "Breakfast", "Lunch", "Dinner", "Delivered to", "Bill details", "7 Days · 5% off", "Pay ₹3,445"]) await h.expectText(text);
    await snapshotAllWidths("subscribe-checkout");
    await clickLabel("Pay ₹3,445");
    await h.expectText("Test mode: no money is taken");
    await h.settle();
    await page.clickText("Pay ₹3,445", 1); // the sheet's button (the screen's own is under it)
    await page.waitFor(`location.pathname === "/meals/subscriptions"`, NAV_TIMEOUT, "My subscriptions");
    for (const text of ["My subscriptions", `Grilled Chicken Bowl ${runId}`, "Lunch · 2 a day", "0 of 7 delivered", "Active"]) await h.expectText(text);
    await snapshotAllWidths("my-subscriptions");
    const [[row]] = await connection.query("SELECT status, payment_method, slot, quantity, percent_off, price_paise FROM meal_subscriptions WHERE user_id = ?", [identities.member.id]);
    assert.deepEqual({ ...row, price_paise: Number(row.price_paise) }, { status: "active", payment_method: "dummy", slot: "lunch", quantity: 2, percent_off: 5, price_paise: 344500 });
  }));

  it("3. a subscription's own page: pause, the next days, cancel; Profile links to it", run("manage", async () => {
    await clickLabel(`Grilled Chicken Bowl ${runId}, Lunch · 2 a day. Manage`);
    await page.waitFor(`location.pathname.startsWith("/meals/subscriptions/")`, NAV_TIMEOUT, "the subscription");
    for (const text of ["Delivered", "Last day", "14 meals · paid ₹3,445", "5% off", "Pause deliveries", "Tomorrow", "Next deliveries", "Skip day", "Cancel subscription"]) await h.expectText(text);
    await snapshotAllWidths("manage-subscription");
    await h.goto("/profile", "My subscriptions");
  }));
});
