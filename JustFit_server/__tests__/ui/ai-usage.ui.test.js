// Super Admin › Profile › AI Usage in the real Expo web build against the test server and the
// justfit_test database: an admin opens Profile, then AI Usage (cards, budget, period filter,
// charts, breakdowns, sections), the usage history (search and filters) and Budget & alerts
// (saving a limit fires the alerts, acknowledging one). Screenshots at three widths.
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

describe("ui ai usage: the admin's AI Usage screens", () => {
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
  // Text in a rendered element (a navigation stack keeps earlier screens mounted but hidden)
  const visible = (text) => page.evaluate(`(() => !![...document.querySelectorAll("body *")].find((e) => e.childElementCount === 0 && (e.textContent || "").includes(${JSON.stringify(text)}) && e.getClientRects().length > 0))()`);

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
      for (const [tag, role] of [["admin", "admin"], ["member", undefined]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        sessions[tag] = (await testAccounts.mintToken(identities[tag].id)).sessionId;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = 'Maya Ortiz' WHERE id = ?", [identities.admin.id]);
    await connection.query("UPDATE users SET full_name = 'Daniel Kim' WHERE id = ?", [identities.member.id]);
    // Some calls to look at: today, for the member (two coach chats, a failed scan) and a WhatsApp contact
    const insert = (feature, status, input, output, cost, user, provider = "openai", model = "gpt-4o", gymId = null) =>
      connection.query(
        "INSERT INTO ai_usage (user_id, gym_id, feature, provider, model, input_tokens, output_tokens, cost_inr, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [user, gymId, feature, provider, model, input, output, cost, status],
      );
    await insert("coach_chat", "ok", 1000, 500, 50, identities.member.id);
    await insert("coach_chat", "ok", 1000, 500, 50, identities.member.id);
    await insert("food_scan", "failed", 0, 0, 0, identities.member.id);
    await insert("gym_assistant", "ok", 500, 100, 25, null, "openai", "gpt-4o-mini", crypto.randomUUID()); // a WhatsApp contact: a gym, no account
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
      await connection.query("DELETE FROM ai_usage");
      await connection.query("DELETE FROM ai_budget_alerts");
      await connection.query("UPDATE ai_budget SET monthly_limit_inr = 4000, usd_to_inr = 84, alert_50 = 1, alert_75 = 1, alert_90 = 1, alert_100 = 1, spike_alerts = 1, updated_by = NULL WHERE id = 1");
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

  it("1. Profile opens from the Overview and leads to AI Usage", run("profile", async () => {
    await signInAs(page, h, identities.admin);
    await page.waitFor(`location.pathname.startsWith("/admin")`, 60000, "landing on /admin");
    await h.settle();
    await clickLabel("Profile");
    await h.expectPath("/admin/profile");
    await h.expectText("Maya Ortiz");
    await h.expectText("AI Usage");
    await h.expectText("Sign out");
    await snapshotAllWidths("admin-profile");
    await clickLabel("AI Usage");
    await h.expectPath("/admin/ai-usage");
  }));

  it("2. AI Usage: the cards, the budget, the period filter, the breakdowns and every section", run("ai-usage", async () => {
    await h.expectText("Total AI requests");
    await h.expectText("Cost this month");
    await h.expectText("₹125.00");
    await h.expectText("Monthly budget");
    await h.expectText("Cost trend");
    await h.expectText("By feature");
    await h.expectText("Coach chat");
    await h.expectText("gpt-4o-mini · OpenAI");
    for (const section of ["AI Chatbot", "AI Coach", "Food & Nutrition AI", "Body Fat Prediction AI", "Other AI services"]) await h.expectText(section);
    await h.expectText("Coaching messages");
    await h.expectText("Usage history");
    await snapshotAllWidths("admin-ai-usage");
    await page.clickText("Today");
    await h.expectText("nothing yesterday");
    await page.clickText("30 days");
    await h.expectText("nothing in the 30 days before");
  }));

  it("3. the history lists every call and a search narrows it to one member", run("history", async () => {
    await clickLabel("Usage history");
    await h.expectPath("/admin/ai-usage/history");
    await h.expectText("4 calls");
    await h.expectText("Daniel Kim");
    await h.expectText("WhatsApp contact");
    await snapshotAllWidths("admin-ai-history");
    await page.setInput('input[aria-label="Search usage"]', "Daniel");
    await page.waitFor(`(document.body.innerText || "").includes("3 calls")`, NAV_TIMEOUT, "the search to narrow the list");
    assert.equal(await visible("WhatsApp contact"), false, "the contact's call is not Daniel's");
    await clickLabel("Status: Failed");
    await page.waitFor(`(document.body.innerText || "").includes("1 call ")`, NAV_TIMEOUT, "one failed call");
    await h.expectText("Food scan");
    await clickLabel("Back");
    await h.expectPath("/admin/ai-usage");
  }));

  it("4. Budget & alerts: a lower limit fires the threshold and spike alerts; one is acknowledged", run("budget", async () => {
    await clickLabel("Budget and alerts");
    await h.expectPath("/admin/ai-usage/budget");
    await h.expectText("Monthly AI spending limit");
    await h.expectText("No alerts");
    await page.setInput('input[aria-label="Monthly limit"]', "200");
    await clickLabel("Save budget");
    await h.expectText("Saved.");
    await h.expectText("AI spending reached 50%");
    await h.expectText("more than double the daily average");
    await h.expectText("Last changed by Maya Ortiz");
    const [[row]] = await connection.query("SELECT monthly_limit_inr FROM ai_budget WHERE id = 1");
    assert.equal(Number(row.monthly_limit_inr), 200);
    await snapshotAllWidths("admin-ai-budget");
    await clickLabel("Acknowledge: AI spending reached 50%");
    await page.waitFor(`(document.body.innerText || "").includes("acknowledged")`, NAV_TIMEOUT, "the alert to show as acknowledged");
    const [[open]] = await connection.query("SELECT COUNT(*) AS n FROM ai_budget_alerts WHERE acknowledged_at IS NULL");
    assert.equal(Number(open.n), 1);
  }));
});
