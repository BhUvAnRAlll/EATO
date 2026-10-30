// Regression tests for the signed-out sign-in screens: Log in and Sign up reach each other, a
// number that isn't a mobile number is refused before anything is sent, and the code sheet
// shows the server's resend countdown, the server's answer to a wrong code, and keeps the
// typed number when it is closed. Real browser navigation against a test server with the
// production 60 s resend cooldown; codes go to its fake SMS outbox. No account is created.
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, codeFor, PHONE_INPUT } = require("./onboarding-steps.js");
const { randomPhone } = require("../e2e/test-identities.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");

describe("ui navigation: the phone sign-in screens", () => {
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
  let sentTo = null; // the number test 3 asked a code for
  const challenges = async () => (await connection.query("SELECT COUNT(*) AS n FROM otp_challenges"))[0][0].n;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    countsBefore = await db.rowCounts(connection);
    server = await startTestServer({ ...env, OTP_COOLDOWN_SECONDS: "60" }); // the production cooldown, for the countdown
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

  it("1. Log in and Sign up reach each other", run("switch", async () => {
    await h.goto("/sign-in", "Log in with your mobile number");
    await page.clickText("Sign up");
    await h.expectPath("/sign-up");
    await h.expectText("Create your");
    await page.clickText("Log in");
    await h.expectPath("/sign-in");
    await h.expectText("Log in with your mobile number");
  }));

  it("2. a number that isn't an Indian mobile number is refused on the screen and nothing is sent", run("bad-number", async () => {
    const before = await challenges();
    for (const typed of ["12345", "5876543210"]) {
      await page.setInput(PHONE_INPUT, typed);
      await page.clickText("Send code");
      await h.expectText("Enter a valid 10-digit mobile number.");
    }
    assert.equal(await challenges(), before, "no code was requested");
    assert.equal(await page.hasText("Check your messages"), false);
  }));

  it("3. a code is sent: the sheet names the number and counts down to Resend from the server's answer", run("code-sheet", async () => {
    const phone = randomPhone();
    sentTo = phone;
    await page.setInput(PHONE_INPUT, phone);
    await page.clickText("Send code");
    await h.expectText("Check your messages");
    await h.expectText(`+91 ${phone.slice(0, 5)} ${phone.slice(5)}`);
    await codeFor(phone); // the server "sent" one
    await page.waitFor(`/Resend in (5[0-9]|60)s/.test(document.body.innerText || "")`, 10000, "the 60 s countdown");
  }));

  it("4. a wrong code shows the server's answer and keeps the sheet open; closing it keeps the number", run("wrong-code", async () => {
    const typed = await page.inputValue(PHONE_INPUT);
    const wrong = String((Number(await codeFor(sentTo)) + 1) % 1_000_000).padStart(6, "0");
    await page.setInput('input[maxlength="6"]', wrong);
    await h.expectText("That code isn't right. 4 tries left.");
    assert.equal(await page.hasText("Check your messages"), true, "still in the code sheet");
    assert.equal(await page.path(), "/sign-in");
    assert.equal(await page.evaluate(`!!localStorage.getItem("justfit.session")`), false, "not signed in");
    await page.clickLabel("Close");
    await h.expectNoText("Check your messages");
    assert.equal(await page.inputValue(PHONE_INPUT), typed, "the typed number is still there");
  }));
});
