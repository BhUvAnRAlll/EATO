// Signing out clears everything the app holds for the account. Two test accounts with different
// calorie targets (seeded in justfit_test) sign in through the real phone sign-in screens, one after
// the other in the same tab, without reloading the page (so the app's in-memory stores carry
// over exactly as on a phone):
//   - signing out ends the session on the server and opens onboarding;
//   - the next account's Home shows its own targets, never the previous account's cached ones;
//   - an answer to a request the previous account started before signing out is dropped;
//   - offline, this device still signs out, Log in says the server couldn't confirm it, and
//     Sign out of all devices ends the session left behind;
//   - Sign out of all devices while offline signs nothing out and says so.
// Requests are held or failed inside the page only (fetch replaced for one route each).
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree, latestCode } = require("../e2e/server.js");
const { identitiesFor, describeIdentityError } = require("../e2e/test-identities.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, signInAs, fillSignInForm, codeFor, hasSession, sessionTokenExpression } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const TARGETS = { a: 2345, b: 1678 };
const NOTICE = "couldn't reach justFit to end the session on our side";

describe("ui sign-out: nothing of one account reaches the next", () => {
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

  // Home's nutrition card names the target in its label ("…: 0 of 2345 kcal eaten. Open Macro")
  const homeShowsTarget = (kcal) => page.evaluate(`!!document.querySelector('[aria-label*=${JSON.stringify(` of ${kcal} kcal eaten`)}]')`);
  const expectHomeTarget = (kcal) => page.waitFor(`!!document.querySelector('[aria-label*=${JSON.stringify(` of ${kcal} kcal eaten`)}]')`, 30000, `Home showing ${kcal} kcal`);
  const liveSessions = async (userId) => {
    const [[row]] = await connection.query("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()", [userId]);
    return Number(row.n);
  };

  // Signs in on the Log in screen that is already open, without loading the page again
  const signInHere = async (identity) => {
    await h.expectPath("/sign-in");
    const before = latestCode(identity.phone);
    await fillSignInForm(page, h, identity);
    await page.clickText("Send code");
    await h.expectText("Check your messages");
    await page.setInput('input[maxlength="6"]', await codeFor(identity.phone, before));
    await h.expectPath("/home");
  };
  // Home → Profile → Sign out, all inside the app
  const signOutFromHome = async () => {
    await page.clickLabel("Profile");
    await h.expectPath("/profile");
    await page.clickText("Sign out");
  };

  // Replaces the page's fetch for one route. mode "hold": the server answers at once, but the
  // app only receives the answer when window.__release() is called (for requests carrying
  // `token`, or every request when it is null), as a slow network would deliver it;
  // "network": the route fails as if offline; "off": restored.
  const stubRoute = (route, mode, token = null) => page.evaluate(`(() => {
    if (!window.__realFetch) window.__realFetch = window.fetch;
    const real = window.__realFetch;
    if (${JSON.stringify(mode)} === "off") { window.fetch = real; return "restored"; }
    window.__held = [];
    window.__release = () => { const held = window.__held; window.__held = []; held.forEach((go) => go()); return held.length; };
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (!url.includes(${JSON.stringify(route)})) return real(input, init);
      if (${JSON.stringify(mode)} === "network") return Promise.reject(new TypeError("Failed to fetch"));
      const auth = (init && init.headers && (init.headers.Authorization || init.headers.authorization)) || "";
      if (${JSON.stringify(token)} !== null && auth !== "Bearer " + ${JSON.stringify(token)}) return real(input, init);
      return real(input, init).then((response) => new Promise((resolve) => { window.__held.push(() => resolve(response)); }));
    };
    return "stubbed";
  })()`);

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
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    client.on((m) => { if (m.sessionId !== page.sessionId) return; if (m.method === "Runtime.exceptionThrown") consoleLines.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200)); if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) consoleLines.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200)); });
    h = helpers(page, expo.baseUrl);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    // Two members who finished setup, each with their own calorie target
    for (const tag of ["a", "b"]) {
      try { identities[tag] = await testAccounts.createIdentity(runId, tag, { email: null }); } catch (error) { throw new Error(`could not create test identity ${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
      await testAccounts.setProfileComplete(identities[tag].id, true);
      await connection.query(
        `INSERT INTO nutrition_targets (user_id, formula, config_version, inputs, calculated_at, calories, protein_g, carbs_g, fat_g)
         VALUES (?, 'ui-test', 'test', JSON_OBJECT(), NOW(), ?, 120, 200, 60)`,
        [identities[tag].id, TARGETS[tag]],
      );
    }
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

  it("1. Sign out ends the session on the server, forgets it here and opens onboarding with no notice", run("sign-out", async () => {
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await expectHomeTarget(TARGETS.a);
    assert.equal(await liveSessions(identities.a.id), 1);
    await signOutFromHome();
    await h.expectPath("/onboarding");
    assert.equal(await hasSession(page), false, "the token is gone from this browser");
    assert.equal(await liveSessions(identities.a.id), 0, "the server ended the session");
    assert.equal(await page.hasText(NOTICE), false, "a confirmed sign-out needs no notice");
  }));

  it("2. switching accounts: the next account's Home shows its own target, never the previous account's cached one", run("switch", async () => {
    // Within Home's one-minute freshness window, and with B's own diary answers held back so
    // whatever Home kept in memory stays on screen: before the fix, that was A's target
    await stubRoute("/api/macro/day", "hold");
    try {
      await page.clickText("Log in");
      await signInHere(identities.b);
      await page.waitFor("window.__held.length > 0", 15000, "B's diary answers held");
      await h.settle();
      assert.equal(await homeShowsTarget(TARGETS.a), false, "nothing of account A is on B's Home");
      await page.evaluate("window.__release()");
      await expectHomeTarget(TARGETS.b);
    } finally {
      await stubRoute("/api/macro/day", "off");
    }
  }));

  it("3. an answer to a request the previous account started is dropped when it arrives after the sign-out", run("late-answer", async () => {
    const tokenB = await page.evaluate(sessionTokenExpression);
    assert.ok(tokenB, "B is signed in");
    assert.equal(await stubRoute("/api/macro/day", "hold", tokenB), "stubbed");
    try {
      // Coming back to Home re-reads today's diary (refreshIntake) with B's token: held on its way
      await page.clickLabel("Meals");
      await h.expectPath("/meals");
      await page.clickLabel("Home");
      await h.expectPath("/home");
      await page.waitFor("window.__held.length > 0", 15000, "B's diary request held");

      await signOutFromHome();
      await h.expectPath("/onboarding");
      await page.clickText("Log in");
      await signInHere(identities.a);
      await expectHomeTarget(TARGETS.a);

      // B's answer (the server sent it while B was still signed in) arrives now, while A is on Home
      assert.ok((await page.evaluate("window.__release()")) > 0, "B's request was released");
      await new Promise((r) => setTimeout(r, 2000));
      assert.equal(await homeShowsTarget(TARGETS.b), false, "B's late answer was not written into A's Home");
      assert.equal(await homeShowsTarget(TARGETS.a), true, "A's own numbers are still shown");
    } finally {
      await stubRoute("/api/macro/day", "off");
    }
  }));

  it("4. offline: this device signs out, Log in says the server couldn't confirm, and Sign out of all devices ends what was left", run("offline-sign-out", async () => {
    assert.equal(await liveSessions(identities.a.id), 1);
    await stubRoute("/api/auth/logout", "network");
    try {
      await signOutFromHome();
      await h.expectPath("/sign-in");
      await h.expectText(NOTICE);
    } finally {
      await stubRoute("/api/auth/logout", "off");
    }
    assert.equal(await hasSession(page), false, "the token and the account's data are gone from this browser anyway");
    assert.equal(await liveSessions(identities.a.id), 1, "the server never heard: that session is still live (as the notice says)");

    // The way out the notice offers: sign in again, then Sign out of all devices
    await signInHere(identities.a);
    assert.equal(await liveSessions(identities.a.id), 2);
    await page.clickLabel("Profile");
    await h.expectPath("/profile");
    await page.evaluate("window.confirm = () => true");
    await page.clickText("Sign out of all devices");
    await h.expectPath("/onboarding");
    assert.equal(await liveSessions(identities.a.id), 0, "both sessions ended, the one left behind included");
    assert.equal(await page.hasText(NOTICE), false, "the notice went with the next sign-in");
  }));

  it("5. Sign out of all devices while offline signs nothing out and says so", run("offline-everywhere", async () => {
    await page.clickText("Log in");
    await signInHere(identities.b);
    await page.clickLabel("Profile");
    await h.expectPath("/profile");
    await page.evaluate("window.confirm = () => true; window.__alerts = []; window.alert = (text) => window.__alerts.push(String(text))");
    await stubRoute("/api/auth/logout-all", "network");
    try {
      await page.clickText("Sign out of all devices");
      await page.waitFor("window.__alerts.length > 0", 15000, "the failure is shown");
    } finally {
      await stubRoute("/api/auth/logout-all", "off");
    }
    assert.match(await page.evaluate("window.__alerts[0]"), /Couldn't reach the server/);
    assert.equal(await page.path(), "/profile", "still signed in here");
    assert.equal(await hasSession(page), true);
    assert.equal(await liveSessions(identities.b.id), 1, "nothing was signed out anywhere");
  }));
});
