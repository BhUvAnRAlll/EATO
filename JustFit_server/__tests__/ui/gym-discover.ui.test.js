// Gym Hub › Discover Gyms (phase 3) in the real Expo web build against the isolated test server and
// the justfit_test database. A member with no membership opens Gym Hub on Discover, sees both gyms,
// searches, filters by a facility, opens a gym's page (facilities, hours, the plans to compare with
// the best value and the saving, what a plan includes, the address), comes back, and finds My
// Memberships empty. No horizontal overflow at three widths.
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
//   JUSTFIT_SCREENSHOT_DIR=<dir> saves screenshots of each screen at three widths
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { identitiesFor, describeIdentityError } = require("../e2e/test-identities.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
// The web date picker is a real <input type="date"> inside the sheet

describe("ui discover gyms: a member finds a gym, filters, and compares its plans", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  const sessions = {};
  const tokens = {};
  const state = {};

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
  const signIn = async (identity, landing) => {
    await signInAs(page, h, identity);
    await page.waitFor(`location.pathname.startsWith(${JSON.stringify(landing)})`, 60000, `landing on ${landing}`);
    await h.settle();
  };
  const closed = () => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      for (const [tag, role] of [["forma", "gym_admin"], ["zen", "gym_admin"], ["member", undefined], ["admin", "admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        sessions[tag] = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Daniel Kim", identities.member.id]);
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency, profile_complete) VALUES (?, '1995-05-10', 'male', 'muscle_gain', 175, 70, '3-4', TRUE)", [identities.member.id]);
    for (const [key, name, branch, area, city] of [["forma", "Forma", "Tumkur", "SIT Road", "Tumakuru"], ["zen", "Zen Fitness", "Hebbal", "Hebbal", "Bengaluru"]]) {
      const gym = await apiAs("admin", "POST", "/api/admin/portal/gyms", { name, branch, area, city });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state[key]}/staff`, { phone: identities[key].phone })).status, 201);
    }
    const hours = { ...closed(), mon: [["05:30", "10:30"], ["16:30", "21:30"]], tue: [["05:30", "21:30"]] };
    assert.equal((await apiAs("forma", "PATCH", "/api/gym/profile", { about: "Two floors of equipment.", facilities: ["cardio", "parking"], hours })).status, 200);
    assert.equal((await apiAs("forma", "PATCH", "/api/gym/invoice-details", { address: "12, SIT Main Road", phone: "9876543210" })).status, 200);
    for (const item of [{ kind: "plan", name: "Monthly", duration: 1, price: 1500 }, { kind: "plan", name: "Annual", duration: 12, price: 12000, details: "Steam bath included." }]) {
      assert.equal((await apiAs("forma", "POST", "/api/gym/catalog", item)).status, 201);
    }
    assert.equal((await apiAs("zen", "PATCH", "/api/gym/profile", { facilities: ["parking"] })).status, 200);
    assert.equal((await apiAs("zen", "POST", "/api/gym/catalog", { kind: "plan", name: "Monthly", duration: 1, price: 2500 })).status, 201);
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
      const gymIds = [state.forma, state.zen].filter(Boolean);
      if (gymIds.length) {
        const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
        for (const table of ["gym_activity_log", "gym_photos", "gym_catalog_items", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
        await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
        if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((b) => b.brand_id)]);
      }
      const ids = Object.values(identities).map((i) => i.id);
      if (ids.length > 0) {
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [ids]);
        await connection.query("DELETE FROM profiles WHERE user_id IN (?)", [ids]);
        await db.deleteUsers(connection, ids);
      }
      await connection.end();
    });
    await step("identities", async () => {
      if (!testAccounts) return;
      for (const sessionId of Object.values(sessions)) await testAccounts.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. with no membership, Gym Hub opens on Discover with every gym", run("discover", async () => {
    await viewport(390, 844);
    await signIn(identities.member, "/home");
    await h.goto("/profile", "Gym Hub");
    await page.clickText("Gym Hub");
    await page.waitFor(`location.pathname === "/gym-hub"`, NAV_TIMEOUT, "Gym Hub");
    await h.expectText("2 gyms");
    for (const text of ["Forma", "Tumkur · SIT Road, Tumakuru", "From ₹1,000/month", "Cardio machines · Parking", "Zen Fitness", "From ₹2,500/month"]) await h.expectText(text);
    await snapshotAllWidths("discover");
  }));

  it("2. search and a facility filter narrow the list", run("discover-filter", async () => {
    await page.setInput('input[aria-label="Search gyms, areas or cities"]', "bengaluru");
    await h.expectText("1 gym");
    await h.expectText("Zen Fitness");
    assert.equal(await page.hasText("Tumkur · SIT Road"), false);
    await clickLabel("Clear the search");
    await h.expectText("2 gyms");
    await clickLabel("Filters");
    await h.expectText("Plans from");
    await h.settle(); // the sheet slides up
    await clickLabel("Cardio machines");
    await h.settle();
    await page.clickText("Show gyms");
    await h.expectText("1 gym");
    assert.equal(await page.hasText("Zen Fitness"), false, "Zen has no cardio machines");
    assert.ok(await page.hasText("Filters · 1"));
    await snapshotAllWidths("discover-filtered");
  }));

  it("3. a gym's page: facilities, hours, plans to compare and the address; no buying", run("gym-page", async () => {
    await page.clickText("Tumkur · SIT Road, Tumakuru");
    await page.waitFor(`location.pathname === "/gym-hub/gyms/${state.forma}"`, NAV_TIMEOUT, "the gym's page");
    for (const text of ["Two floors of equipment.", "Facilities", "Parking", "Opening hours", "Membership plans", "Best value", "Saves ₹500 a month", "Steam bath included.", "₹1,000 a month", "12, SIT Main Road, SIT Road, Tumakuru", "+91 9876543210", "To join, visit the gym's front desk."]) await h.expectText(text);
    for (const label of ["Call Forma", "Directions to Forma"]) assert.ok(await page.evaluate(`[...document.querySelectorAll('[aria-label]')].some((e) => e.getAttribute("aria-label") === ${JSON.stringify(label)})`), label);
    for (const word of ["Buy", "Checkout", "Pay now"]) assert.equal(await page.hasText(word), false, `no ${word}`);
    await snapshotAllWidths("gym-page");
  }));

  it("4. back to Discover; My Memberships is empty for this member", run("memberships-empty", async () => {
    await clickLabel("Back");
    await page.waitFor(`location.pathname === "/gym-hub"`, NAV_TIMEOUT, "back on Gym Hub");
    await clickLabel("My Memberships");
    await h.expectText("No gym membership on this number");
    await h.expectText("Check in or out");
    await snapshotAllWidths("memberships-empty");
  }));
});
