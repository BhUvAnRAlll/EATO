// Super Admin › Profile › App Usage in the real Expo web build against the test server and the
// justfit_test database: an admin opens Profile, then App Usage (the range row, the member
// cards, the active-members chart, Most used, Least used, every area, and what isn't tracked),
// switches ranges, and types a custom one. Rows are seeded the way the features write them, for
// two members and a demo account whose activity must never count. Screenshots at three widths.
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

describe("ui app usage: the admin's App Usage screen", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  const sessions = {};

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 400).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | visible text: "${text}"`;
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
  };
  const clickLabel = async (label) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label").startsWith(${JSON.stringify(label)}))[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}…`);
    await page.clickAt(pos.x, pos.y);
  };
  // The accessibility label of the first element whose label starts with `prefix` (how a row reads)
  const labelOf = (prefix) => page.evaluate(`(() => { const el = [...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute("aria-label").startsWith(${JSON.stringify(prefix)})); return el ? el.getAttribute("aria-label") : null; })()`);
  // A timestamp N days ago at 10:00
  const at = (daysAgo) => `DATE_SUB(CURDATE(), INTERVAL ${daysAgo} DAY) + INTERVAL 10 HOUR`;

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
      for (const [tag, role, email] of [["admin", "admin"], ["a", undefined], ["b", undefined], ["demo", undefined, `demo-${runId}@demo.justfit.test`]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role, ...(email ? { email } : {}) });
        sessions[tag] = (await testAccounts.mintToken(identities[tag].id)).sessionId;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = 'Maya Ortiz' WHERE id = ?", [identities.admin.id]);
    // Everyone registered and last used the app well before the range, so activity comes from the rows below
    await connection.query(`UPDATE users SET created_at = ${at(40)} WHERE id IN (?, ?, ?, ?)`, Object.values(identities).map((i) => i.id));
    await connection.query(`UPDATE auth_sessions SET created_at = ${at(40)}, last_used_at = ${at(40)}`);
    const q = (sql, params) => connection.query(sql, params);
    // a: three meals this week, a completed workout today; b: a weigh-in today, one meal 20 days ago; demo: a meal today (never counts)
    await q(`INSERT INTO macro_meal_logs (user_id, log_date, slot, title, logged_at, created_at) VALUES (?, CURDATE(), 'breakfast', 'Poha', ${at(0)}, ${at(0)}), (?, CURDATE() - INTERVAL 1 DAY, 'lunch', 'Dal', ${at(1)}, ${at(1)}), (?, CURDATE() - INTERVAL 2 DAY, 'dinner', 'Roti', ${at(2)}, ${at(2)}), (?, CURDATE() - INTERVAL 20 DAY, 'lunch', 'Rice', ${at(20)}, ${at(20)}), (?, CURDATE(), 'lunch', 'Demo', ${at(0)}, ${at(0)})`, [identities.a.id, identities.a.id, identities.a.id, identities.b.id, identities.demo.id]);
    await q(`INSERT INTO workout_logs (user_id, on_date, started_at, completed_at, status) VALUES (?, CURDATE(), ${at(0)}, ${at(0)} + INTERVAL 30 MINUTE, 'completed')`, [identities.a.id]);
    await q("INSERT INTO weigh_ins (user_id, logged_on, weight_kg) VALUES (?, CURDATE(), 72.0)", [identities.b.id]);
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
      await connection.query("DELETE FROM weigh_ins");
      await db.deleteUsers(connection, Object.values(identities).map((i) => i.id));
      await connection.end();
    });
    await step("identities", async () => {
      if (!testAccounts) return;
      for (const sessionId of Object.values(sessions)) await testAccounts.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. Profile leads to App Usage, beside AI Usage", run("profile", async () => {
    await signInAs(page, h, identities.admin);
    await page.waitFor(`location.pathname.startsWith("/admin")`, 60000, "landing on /admin");
    await h.settle();
    await clickLabel("Profile");
    await h.expectPath("/admin/profile");
    await h.expectText("AI Usage");
    await h.expectText("App Usage");
    await clickLabel("App Usage");
    await h.expectPath("/admin/app-usage");
  }));

  it("2. the last 7 days: members, the chart, Most used, Least used, every area, and what isn't tracked", run("app-usage", async () => {
    await h.expectText("Registered members");
    await h.expectText("Active members per day");
    await h.expectText("Most used");
    await h.expectText("Least used");
    await h.expectText("By area");
    await h.expectText("Not tracked yet");
    // a and b: the admin and the demo account never count as members
    assert.equal(await labelOf("Registered members:"), "Registered members: 2");
    assert.match(await labelOf("Active in range:"), /^Active in range: 2, 100% of members/, "a logged meals and trained, b weighed in");
    // a's 3 meals, a's workout (started and completed), b's weigh-in; b's 20-day-old meal and the demo's meal are not in it
    assert.match(await labelOf("Feature uses:"), /^Feature uses: 6, 3 per active member/);
    assert.match(await labelOf("1. Meals logged:"), /^1\. Meals logged: 1 member \(50% of active\), 3 uses, 3 per member/, "ranked first by members then uses");
    assert.match(await labelOf("Meals & Macro:"), /^Meals & Macro: 1 member, 3 uses/);
    assert.match(await labelOf("Workout:"), /^Workout: 1 member, 2 uses/);
    assert.match(await labelOf("Progress:"), /^Progress: 1 member, 1 uses/);
    await h.expectText("Sessions and screens"); // the event tables exist here, so engagement shows (and "not tracked" doesn't list it)
    await snapshotAllWidths("admin-app-usage");
  }));

  it("3. other ranges: today narrows to today's rows; 30 days takes in the older meal", run("ranges", async () => {
    await page.clickText("Today");
    await h.expectText("Registered members");
    await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute("aria-label").startsWith("Feature uses:")); return el && el.getAttribute("aria-label").startsWith("Feature uses: 4,"); })()`, NAV_TIMEOUT, "today's uses: a's meal, a's workout twice, b's weigh-in");
    await page.clickText("30 days");
    await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute("aria-label").startsWith("Feature uses:")); return el && el.getAttribute("aria-label").startsWith("Feature uses: 7,"); })()`, NAV_TIMEOUT, "30 days adds b's older meal");
    assert.match(await labelOf("1. Meals logged:"), /^1\. Meals logged: 2 members/, "both members logged a meal within 30 days");
  }));

  it("3b. a feature row opens its detail; Retention and Members open from the links", run("detail", async () => {
    await clickLabel("1. Meals logged:");
    await h.expectPath("/admin/app-usage/feature/meal_log");
    await h.expectText("Meals logged");
    await h.expectText("Used most by");
    await snapshotAllWidths("admin-app-usage-feature");
    await clickLabel("Back");
    await h.expectPath("/admin/app-usage");
    await clickLabel("Retention.");
    await h.expectPath("/admin/app-usage/retention");
    await h.expectText("By week joined");
    await h.expectText("Day 7");
    await snapshotAllWidths("admin-app-usage-retention");
    await clickLabel("Back");
    await h.expectPath("/admin/app-usage");
    await clickLabel("Members.");
    await h.expectPath("/admin/app-usage/members");
    await h.expectText("Last active");
    await h.expectText("interactions");
    await snapshotAllWidths("admin-app-usage-members");
    await clickLabel("Back");
    await h.expectPath("/admin/app-usage");
  }));

  it("4. a custom range needs both dates, then shows that window", run("custom", async () => {
    await page.clickText("Custom");
    await h.expectText("Custom range");
    await h.expectText("Type both dates");
    const [[d]] = await connection.query("SELECT DATE_FORMAT(CURDATE() - INTERVAL 2 DAY, '%Y-%m-%d') AS f, DATE_FORMAT(CURDATE() - INTERVAL 1 DAY, '%Y-%m-%d') AS t");
    await page.setInput('input[aria-label="From date"]', d.f);
    await page.setInput('input[aria-label="To date"]', d.t);
    await page.clickText("Show");
    await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute("aria-label").startsWith("Feature uses:")); return el && el.getAttribute("aria-label").startsWith("Feature uses: 2,"); })()`, NAV_TIMEOUT, "the two days before today hold a's two meals");
    await snapshotAllWidths("admin-app-usage-custom");
  }));
});
