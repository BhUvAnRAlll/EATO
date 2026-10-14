// Regression tests for navigation dead ends. First case: the forgot-password screen must
// return to sign-in both when it was opened from sign-in (history exists) and when it was
// opened directly (no history). Real browser navigation, signed out, nothing written.
//
//   yarn test:ui      (needs Eato_server/.env.test and Google Chrome; otherwise skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "eato-ui-evidence");

describe("ui navigation: forgot-password always returns to sign-in", () => {
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, h;

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | visible text: "${text}"`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  // The back arrow is icon-only: it is the first pressable in the screen's scroll content
  const clickBackArrow = async () => {
    const spot = await page.evaluate(`(() => { const el = [...document.querySelectorAll('[tabindex="0"]')].find((e) => e.getClientRects().length > 0 && e.className.toString().includes("self-start")); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    assert.ok(spot, "back arrow not found");
    await page.clickAt(spot.x, spot.y);
  };
  const openFromSignIn = async () => {
    await h.goto("/sign-in", "Log in");
    await page.setInput('input[placeholder="Email address"]', "someone@example.com");
    await page.clickText("Forgot password?");
    await h.expectPath("/forgot-password");
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    countsBefore = await db.rowCounts(connection);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, page.sessionId);
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    await step("row counts unchanged", async () => {
      if (!connection) return;
      try { assert.deepEqual(await db.rowCounts(connection), countsBefore, "rows changed during a signed-out UI test"); }
      finally { await connection.end(); }
    });
    await step("ports released", async () => {
      for (const port of [env ? Number(env.PORT) : 4100, EXPO_PORT]) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !(await portFree(port))) await new Promise((r) => setTimeout(r, 250));
        assert.ok(await portFree(port), `port ${port} was not released`);
      }
    });
    await step("profile removed", async () => { if (chrome) assert.ok(!fs.existsSync(chrome.profile), "temporary Chrome profile was not removed"); });
    if (problems.length > 0) throw new Error("teardown problems: " + problems.join("; "));
  });

  it("1. opened directly, the footer 'Log in' reaches sign-in", run("direct-footer", async () => {
    await h.goto("/forgot-password", "Send code");
    await page.clickText("Log in");
    await h.expectPath("/sign-in");
    await h.expectText("Welcome back");
  }));

  it("2. opened from sign-in, the footer 'Log in' returns to sign-in with the typed email still there", run("history-footer", async () => {
    await openFromSignIn();
    assert.equal(await page.inputValue('input[placeholder="aarav.sharma@email.com"]'), "someone@example.com", "the email typed on sign-in should carry over");
    await page.clickText("Log in");
    await h.expectPath("/sign-in");
    assert.equal(await page.inputValue('input[placeholder="Email address"]'), "someone@example.com", "returning by history keeps the sign-in screen's state");
  }));

  it("3. the back arrow works with history and without it", run("back-arrow", async () => {
    await openFromSignIn();
    await clickBackArrow();
    await h.expectPath("/sign-in");
    await h.goto("/forgot-password", "Send code");
    await clickBackArrow();
    await h.expectPath("/sign-in");
  }));

  it("4. the reset flow itself still works: an unknown email gets Clerk's error, the button recovers", run("reset-flow", async () => {
    await h.goto("/forgot-password", "Send code");
    await page.setInput('input[placeholder="aarav.sharma@email.com"]', "nobody-e2e+clerk_test@example.com");
    await page.clickText("Send code");
    const alert = await page.waitFor(`(() => { const a = document.querySelector('[role="alert"]'); return a ? a.innerText.trim() : ""; })()`, 20000, "an error alert");
    assert.ok(alert.length > 0, "an error message is shown");
    assert.equal(await page.path(), "/forgot-password");
    assert.ok(await page.hasText("Send code"), "the Send code button is back after the attempt");
  }));
});
