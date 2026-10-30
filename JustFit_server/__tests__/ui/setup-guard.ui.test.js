// Regression tests for the setup session guard (JustFit_client/src/app/setup/_layout.tsx).
// Real browser navigation in the Expo web build: a signed-out visitor opening any setup
// route lands on Log in; a signed-in account reaches setup; a page reload while signed in
// never passes through Log in while the saved session is checked; and a session revoked on
// the server (for real, in justfit_test) while the targets step is open is refused on the next
// request (Finish), which offers Log in and forgets the answers.
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
//   JUSTFIT_SCREENSHOT_DIR=<dir> additionally saves the Log in landing at three widths
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
const { fillSetup, helpers, signInAs } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const SETUP_ROUTES = ["/setup/personal", "/setup/body-composition", "/setup/goal", "/setup/activity", "/setup/food", "/setup/lifestyle", "/setup/targets"];
const WIDTHS = [[320, 568], [390, 844], [430, 932]];

describe("ui setup guard: setup needs a session, loading never redirects, a lost session leaves setup", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | visited: ${JSON.stringify(await visited().catch(() => null))} | screenshot: ${shot} | visible text: "${text}"`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  const apiUrl = () => `http://localhost:${env.PORT}`;
  const hasSession = () => page.evaluate(`!!localStorage.getItem("justfit.session")`);
  // Every path the document has shown since it loaded (recorded by the script installed below)
  const visited = () => page.evaluate(`JSON.stringify(window.__visited || [])`).then(JSON.parse);
  const setWidth = (width, height) => client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, page.sessionId);
  const cleanupIdentity = async (tag) => {
    const identity = identities[tag]; if (!identity) return;
    await db.deleteUsers(connection, [identity.id]);
    await testAccounts.deleteUser(identity.id);
    delete identities[tag];
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    countsBefore = await db.rowCounts(connection);
    testAccounts = identitiesFor(env);
    await testAccounts.sweepOrphans();
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: apiUrl() });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    await setWidth(390, 844);
    // Record every client-side route change of each new document, so a redirect that was
    // only shown for a moment (a flash of Log in) is still visible to the assertions
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const record = () => { (window.__visited = window.__visited || []).push(location.pathname); };
      record();
      for (const method of ["pushState", "replaceState"]) { const original = history[method]; history[method] = function (...args) { const result = original.apply(this, args); record(); return result; }; }
      window.addEventListener("popstate", record);
    })();` }, page.sessionId);
    try { identities.a = await testAccounts.createIdentity(runId, "a"); } catch (error) { throw new Error(`could not create the test identity: ${JSON.stringify(describeIdentityError(error))}`); }
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    if (connection && testAccounts) {
      for (const tag of Object.keys(identities)) await step(`cleanup identity ${tag} (${identities[tag]?.id})`, () => cleanupIdentity(tag));
      await step("row counts back to baseline", async () => { assert.deepEqual(await db.rowCounts(connection), countsBefore); });
    }
    await step("close database", async () => { if (connection) await connection.end(); });
    await step("ports released", async () => {
      for (const port of [env ? Number(env.PORT) : 4100, EXPO_PORT]) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !(await portFree(port))) await new Promise((r) => setTimeout(r, 250));
        assert.ok(await portFree(port), `port ${port} was not released`);
      }
    });
    await step("profile removed", async () => { if (chrome) assert.ok(!fs.existsSync(chrome.profile), "temporary Chrome profile was not removed"); });
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE; orphaned test identifiers:", Object.values(identities).map((i) => i.id).join(", ") || "none"); throw new Error("teardown problems: " + problems.join("; ")); }
  });

  it("1. signed out, every setup route lands on Log in and sends no profile request", run("signed-out", async () => {
    for (const route of SETUP_ROUTES) {
      await page.navigate(`${expo.baseUrl}${route}`);
      await h.expectPath("/sign-in");
      await h.expectText("Log in");
      assert.equal(await hasSession(), false, "the fresh browser profile must hold no session");
      assert.equal(await page.hasText("Let's get to know you"), false, `${route}: no setup content may show`);
    }
    assert.deepEqual(page.requests.filter((u) => u.includes("/api/profile")), [], "a signed-out visitor triggers no profile request");
    assert.deepEqual(page.requests.filter((u) => /\/\/(localhost|127\.0\.0\.1):4000\b/.test(u)), [], "no request to the development server");
    if (SCREENSHOT_DIR) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      for (const [width, height] of WIDTHS) {
        await setWidth(width, height);
        await page.navigate(`${expo.baseUrl}/setup/personal`);
        await h.expectPath("/sign-in");
        await h.expectText("Log in");
        await page.screenshot(path.join(SCREENSHOT_DIR, `setup-personal-signed-out-lands-on-sign-in-${width}.png`));
      }
      await setWidth(390, 844);
    }
  }));

  it("2. signed in, the start screen opens setup and a setup route opened directly stays open", run("signed-in", async () => {
    await signInAs(page, h, identities.a);
    assert.equal(await page.path(), "/setup/personal", "a new account is routed to the first setup step");
    await h.expectText("1/7");
    await h.goto("/setup/goal", "3/7");
    assert.equal(await page.path(), "/setup/goal");
    assert.ok(!(await visited()).includes("/sign-in"), `opening a setup route while signed in must not pass through Log in (visited: ${JSON.stringify(await visited())})`);
  }));

  it("3. while the saved session is checked on a reload, setup shows no premature redirect and no loop", run("loading", async () => {
    await page.navigate(`${expo.baseUrl}/setup/personal`);
    await h.expectText("Let's get to know you");
    await new Promise((r) => setTimeout(r, 3000)); // long enough for any redirect loop to show up
    const paths = await visited();
    assert.deepEqual(paths.filter((p) => p !== "/setup/personal"), [], `the document must only ever show /setup/personal (visited: ${JSON.stringify(paths)})`);
    assert.equal(await page.path(), "/setup/personal");
    assert.equal(await hasSession(), true, "the restored session must still be there");
  }));

  it("4. a session revoked on the server while the targets step is open is refused on Finish, offers Log in and clears the answers", run("revoked", async () => {
    await h.goto("/setup/personal", "Let's get to know you");
    await fillSetup(page, expo.baseUrl, { fullName: "Guard Tester" });
    assert.equal(await page.path(), "/setup/targets");

    // A real revocation in justfit_test, as "Sign out of all devices" on another phone would do it.
    // The app isn't told; its next request is refused (401) and it offers Log in.
    await connection.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [identities.a.id]);
    await page.clickText("Finish");
    await h.expectText("Your session has expired. Please sign in again.");
    await page.clickText("Sign in again");
    await h.expectPath("/sign-in");
    assert.equal(await hasSession(), false, "no session may remain in the browser");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 }, "nothing was saved (only the account row sign-in made)");

    // Signing in again starts setup afresh: the previous answers were cleared
    await signInAs(page, h, identities.a);
    await h.goto("/setup/personal", "Let's get to know you");
    assert.equal(await page.inputValue(h.input("Your full name")), "", "the name typed before the revocation must be gone");
  }));

  it("5. the ordinary signed-in save still works: Finish saves the profile and opens home", run("save", async () => {
    await h.goto("/setup/personal", "Let's get to know you");
    await fillSetup(page, expo.baseUrl, { fullName: "Guard Tester" });
    await page.clickText("Finish");
    await h.expectPath("/home");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 });
  }));
});
