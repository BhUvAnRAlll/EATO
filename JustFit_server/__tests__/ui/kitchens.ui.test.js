// The Super Admin's kitchens (Meal Operations phases 1-2) in the web build against the test server:
// the meal-operations dashboard, the kitchens list, a kitchen's page, its inventory with the stock
// sheet (a purchase), and its menu. Widths 320/390/430 never overflow.
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

describe("ui kitchens: the Super Admin's dashboard, kitchens, inventory and menu", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h, photoDir;
  const state = {};
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
    photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-ui-kitchen-photos-"));
    server = await startTestServer({ ...env, MEAL_PHOTO_DIR: photoDir });
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      identities.admin = await testAccounts.createIdentity(runId, "admin", { role: "admin" });
      const minted = await testAccounts.mintToken(identities.admin.id);
      sessions.admin = minted.sessionId;
      tokens.admin = minted.jwt;
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    const week = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [["06:00", "22:00"]]]));
    const kitchen = await apiAs("admin", "POST", "/api/admin/kitchen/kitchens", {
      name: `Koramangala Kitchen ${runId}`, contactName: "Suresh Rao", phone: "9876543210", email: null, address: "12, 5th Block, 80 Feet Road",
      area: "Koramangala", city: "Bengaluru", pincode: "560095", latitude: null, longitude: null, hours: { ...week, sun: [] }, pincodes: ["560095", "560034"],
      maxDailyOrders: 400, prepCapacity: 120, radiusKm: 6,
    });
    assert.equal(kitchen.status, 201, JSON.stringify(kitchen.json));
    state.kitchen = kitchen.json.kitchen.id;
    const paneer = await apiAs("admin", "POST", "/api/admin/kitchen/ingredients", { name: `Paneer ${runId}`, category: "dairy", unit: "kg" });
    state.paneer = paneer.json.ingredient.id;
    assert.equal((await apiAs("admin", "PUT", `/api/admin/kitchen/kitchens/${state.kitchen}/inventory/${state.paneer}`, { minQuantity: 2, unitPrice: 380, supplier: "Nandini", expiresOn: null, storage: null })).status, 200);
    assert.equal((await apiAs("admin", "POST", "/api/admin/kitchen/meals", { name: `Paneer Bowl ${runId}`, diet: "vegetarian", calories: 520, proteinG: 32, carbsG: 48, fatG: 18, price: 249 })).status, 201);
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
      await connection.query("DELETE FROM stock_moves WHERE kitchen_id IN (SELECT id FROM kitchens WHERE name LIKE ?)", [`%${runId}%`]);
      await connection.query("DELETE FROM kitchens WHERE name LIKE ?", [`%${runId}%`]);
      await connection.query("DELETE FROM meals WHERE name LIKE ?", [`%${runId}%`]);
      await connection.query("DELETE FROM ingredients WHERE name LIKE ?", [`%${runId}%`]);
      const ids = Object.values(identities).map((i) => i.id);
      if (ids.length > 0) {
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [ids]);
        await db.deleteUsers(connection, ids);
      }
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

  it("1. the meal-operations dashboard", run("meal-ops", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.admin);
    await page.waitFor(`location.pathname.startsWith("/admin")`, 60000, "the admin portal");
    await h.goto("/admin/meal-ops", "Meal operations");
    for (const text of ["Today", "Revenue (paid that day)", "Delayed", "Active kitchens", "By meal time", "Stock across kitchens", "Coming up", "Export"]) await h.expectText(text);
    await snapshotAllWidths("meal-ops");
  }));

  it("2. the kitchens list and a kitchen's page", run("kitchens", async () => {
    await h.goto("/admin/kitchens", `Koramangala Kitchen ${runId}`);
    for (const text of ["Active · 1", "2 pincodes · 0 staff · 400 orders a day"]) await h.expectText(text);
    await snapshotAllWidths("kitchens");
    await page.clickText(`Koramangala Kitchen ${runId}`);
    await page.waitFor(`location.pathname === "/admin/kitchens/${state.kitchen}"`, NAV_TIMEOUT, "the kitchen's page");
    for (const text of ["Change status", "Suresh Rao · +91 9876543210", "6:00 am – 10:00 pm · closed Sun", "Delivers to 2 pincodes", "Menu", "Inventory", "No staff listed"]) await h.expectText(text);
    await snapshotAllWidths("kitchen");
  }));

  it("3. inventory: buy stock in the item sheet", run("inventory", async () => {
    await page.clickText("Inventory");
    await page.waitFor(`location.pathname === "/admin/kitchens/${state.kitchen}/inventory"`, NAV_TIMEOUT, "the inventory");
    await h.expectText(`Paneer ${runId}`);
    await h.expectText("Out of stock · 1");
    await clickLabel(`Paneer ${runId}, 0 kg, Out`);
    await h.expectText("History");
    await h.settle();
    await page.setInput(h.input("How much"), "5");
    await page.setInput(h.input("Optional"), "400");
    await page.clickText("Record purchase");
    await h.expectText("Bought 5 kg");
    await snapshotAllWidths("stock-sheet");
    const [[row]] = await connection.query("SELECT quantity, unit_price_paise FROM kitchen_stock WHERE kitchen_id = ? AND ingredient_id = ?", [state.kitchen, state.paneer]);
    assert.deepEqual({ quantity: Number(row.quantity), price: Number(row.unit_price_paise) }, { quantity: 5, price: 40000 });
  }));

  it("4. the kitchen's menu: assign a meal", run("menu", async () => {
    await h.goto(`/admin/kitchens/${state.kitchen}/menu`, `Paneer Bowl ${runId}`);
    await h.expectText("Cooks 0 of");
    await clickLabel(`Paneer Bowl ${runId}: cooks here`);
    await h.expectText("Cooks 1 of");
    await snapshotAllWidths("kitchen-menu");
  }));
});
