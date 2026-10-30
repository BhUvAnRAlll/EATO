// Regression tests for expired-session recovery. A test account signs in through the real
// phone sign-in screens; the server's answers to the app's own requests are then simulated
// inside the page (fetch replaced for /api/profile only) to produce 401, 500 and network
// failures. Two more cases at launch: a session revoked on the server (for real, in
// eato_test) is forgotten, and an unreachable server keeps the saved session and offers
// Try again (fetch replaced for /api/auth/me before the app loads).
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
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { fillSetup, helpers, signInAs: signInThroughScreen, hasSession: pageHasSession } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

describe("ui session recovery: 401 offers sign-in, other failures keep the session", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};

  const consoleLines = [];
  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | visible text: "${text}" | console: ${JSON.stringify(consoleLines.slice(-4))}`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  const apiUrl = () => `http://localhost:${env.PORT}`;
  // Replace the page's fetch for /api/profile only; every other request is untouched.
  // mode: "401" | "500" | "network" | "off"
  const stubApi = (mode) => page.evaluate(`(() => {
    if (!window.__realFetch) window.__realFetch = window.fetch;
    const mode = ${JSON.stringify(mode)};
    if (mode === "off") { window.fetch = window.__realFetch; return "restored"; }
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (!/\\/api\\/profile\\b/.test(url)) return window.__realFetch(input, init);
      if (mode === "network") return Promise.reject(new TypeError("Failed to fetch"));
      const body = mode === "401" ? { error: "Please sign in again." } : { error: "Something went wrong. Please try again." };
      return Promise.resolve(new Response(JSON.stringify(body), { status: Number(mode), headers: { "content-type": "application/json" } }));
    };
    return "stubbed " + mode;
  })()`);
  const hasSession = () => pageHasSession(page);
  const alertText = () => page.evaluate(`(() => { const a = document.querySelector('[role="alert"]'); return a ? a.innerText.trim() : ""; })()`);
  const signInAs = (identity) => signInThroughScreen(page, h, identity);
  const toTargets = async () => {
    await h.goto("/setup/personal", "Let's get to know you");
    await fillSetup(page, expo.baseUrl, { fullName: "Session Tester" });
  };
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
    client.on((m) => { if (m.sessionId !== page.sessionId) return; if (m.method === "Runtime.exceptionThrown") consoleLines.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200)); if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) consoleLines.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200)); });
    h = helpers(page, expo.baseUrl);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, page.sessionId);
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

  it("1. a 401 on Finish shows the sign-in-again message and a button that reaches sign-in with the session ended", run("targets-401", async () => {
    await signInAs(identities.a);
    await toTargets();
    assert.equal(await stubApi("401"), "stubbed 401");
    await page.clickText("Finish");
    await h.expectText(EXPIRED_MESSAGE);
    assert.ok((await alertText()).includes(EXPIRED_MESSAGE), "the alert carries the sign-in-again message");
    assert.equal(await page.path(), "/setup/targets", "no automatic navigation on the failure itself");
    assert.ok(await page.hasText("Sign in again"));
    await page.clickText("Sign in again");
    await h.expectPath("/sign-in");
    await page.waitFor(`!localStorage.getItem("justfit.session")`, 15000, "session ended");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 }, "nothing was saved (only the account row sign-in made)");
  }));

  it("2. a 500 on Finish shows the generic error, keeps the session and offers no sign-out", run("targets-500", async () => {
    await signInAs(identities.a);
    await toTargets();
    await stubApi("500");
    await page.clickText("Finish");
    await h.expectText("Something went wrong. Please try again.");
    assert.equal(await page.path(), "/setup/targets");
    assert.equal(await page.hasText("Sign in again"), false, "a server error must not offer sign-out");
    assert.equal(await hasSession(), true, "the session must survive a server error");
  }));

  it("3. a network failure on Finish keeps the retry behaviour: message, same screen, session intact, Finish still usable", run("targets-network", async () => {
    await stubApi("network");
    await page.clickText("Finish");
    await h.expectText("Couldn't reach the server. Check your connection and try again.");
    assert.equal(await page.path(), "/setup/targets");
    assert.equal(await page.hasText("Sign in again"), false);
    assert.equal(await hasSession(), true);
    assert.notEqual(await page.evaluate(`(() => { const t = [...document.querySelectorAll("body *")].find((e) => e.childElementCount === 0 && (e.textContent || "").trim() === "Finish"); let el = t; for (let i = 0; i < 5 && el; i++) { if (el.getAttribute("aria-disabled") !== null) return el.getAttribute("aria-disabled"); el = el.parentElement; } return null; })()`), "true", "Finish is enabled again for a retry");
  }));

  it("4. with the stub removed, Finish succeeds and saves the profile as before", run("targets-ok", async () => {
    assert.equal(await stubApi("off"), "restored");
    await page.clickText("Finish");
    await h.expectPath("/home");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 });
  }));

  it("5. a session revoked on the server (logged out elsewhere) is forgotten at the next launch", run("launch-revoked", async () => {
    assert.equal(await hasSession(), true);
    await connection.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [identities.a.id]);
    await h.goto("/home", "Get Started"); // a deep link: the launch check sends a refused session to onboarding
    assert.equal(await hasSession(), false, "the refused token is removed from the browser");
  }));

  it("6. offline at launch: the saved session is kept and Try again signs straight back in", run("launch-offline", async () => {
    await signInAs(identities.a);
    await h.expectPath("/home");
    // Before the app's scripts run on the next load, /api/auth/me fails as if offline (until switched back)
    const { identifier } = await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const real = window.fetch.bind(window);
      window.__justfitOffline = true;
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        if (window.__justfitOffline && /\\/api\\/auth\\/me\\b/.test(url)) return Promise.reject(new TypeError("Failed to fetch"));
        return real(input, init);
      };
    })()` }, page.sessionId);
    try {
      await h.goto("/home", "We couldn't reach justFit");
      assert.ok(await page.hasText("Try again"));
      assert.equal(await hasSession(), true, "a session that may still be valid is never deleted for being offline");
      await page.evaluate(`window.__justfitOffline = false`);
      await page.clickText("Try again");
      await h.expectPath("/home");
    } finally {
      await client.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }, page.sessionId);
    }
  }));
});
