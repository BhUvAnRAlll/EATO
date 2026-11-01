// Cold page loads straight onto a protected screen (a reloaded tab, a shared link), in the
// real Expo web build against the isolated test server and the justfit_test database. The root
// layout must wait for the saved session to be checked with the server before its role
// guards decide, so:
// a signed-in member lands on the member screen they opened, a signed-out visitor or a
// revoked session is sent to onboarding, and a member still can't open an admin screen.
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
const { helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;

describe("ui deep links: a cold load onto a protected screen waits for the session", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  // Every table's row count straight after the schema is rebuilt (some tables ship with seed rows)
  const countAll = async () => {
    const counts = {};
    const [tables] = await connection.query("SHOW TABLES");
    for (const row of tables) {
      const table = Object.values(row)[0];
      counts[table] = (await connection.query("SELECT COUNT(*) AS n FROM `" + table + "`"))[0][0].n;
    }
    return counts;
  };
  let baseline = null;

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
  const snapshot = async (name) => {
    if (!SCREENSHOT_DIR) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
  };
  // A full page load (no in-app navigation), then wait until the app has settled on a route
  const coldLoad = async (route, expectedPath) => {
    await page.navigate(`${expo.baseUrl}${route}`);
    await page.waitFor(`location.pathname === ${JSON.stringify(expectedPath)}`, NAV_TIMEOUT, `cold load of ${route} ending on ${expectedPath}`);
    await h.settle();
    assert.equal(await page.path(), expectedPath, `still on ${expectedPath} once the app has settled`);
  };
  // Member screens that need a session: the account's own profile and a workout setting
  const PROFILE = "/profile";
  const PREFERENCES = "/workout/preferences";

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    baseline = await countAll();
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, page.sessionId);
    h = helpers(page, expo.baseUrl);
    try {
      identities.a = await testAccounts.createIdentity(runId, "a");
      identities.admin = await testAccounts.createIdentity(runId, "admin", { role: "admin" });
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await testAccounts.setProfileComplete(identities.a.id, true);
    for (const tag of ["a", "admin"]) {
      const name = { a: "Priya Sharma", admin: "Admin Tester" }[tag];
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [identities[tag].id, identities[tag].emailAddress, name, tag === "admin" ? "admin" : "user"]);
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
        // The sign-in codes sent to these accounts' numbers (sessions go with the accounts)
        await connection.query("DELETE FROM otp_challenges WHERE phone IN (?)", [Object.values(identities).map((i) => i.phone)]);
        await db.deleteUsers(connection, ids);
      }
      // Nothing this file wrote may be left behind
      if (baseline) for (const [table, n] of Object.entries(await countAll())) if (n !== baseline[table]) problems.push(`${table}: ${baseline[table]} rows before, ${n} after`);
      await connection.end();
    });
    await step("identities", async () => { if (testAccounts) for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id); });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. a signed-out visitor opening a member screen is sent to onboarding", run("signed-out", async () => {
    await coldLoad(PROFILE, "/onboarding");
    assert.equal(await page.hasText("Priya Sharma"), false, "no member content was shown");
  }));

  it("2. a signed-in member reloading straight onto a member screen stays there", run("member-profile", async () => {
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await coldLoad(PROFILE, PROFILE);
    await h.expectText("Priya Sharma");
    await snapshot("deep-link-member-profile-390");
    // A second reload of the same address keeps it too (the session is restored each time)
    await coldLoad(PROFILE, PROFILE);
    await h.expectText("Priya Sharma");
    // And another member route, one level down
    await coldLoad(PREFERENCES, PREFERENCES);
    await h.expectText("Workout preferences");
  }));

  it("3. a member's cold load onto an admin screen is still refused (they land on Home)", run("member-admin", async () => {
    await coldLoad("/admin/app-usage", "/home");
    assert.equal(await page.hasText("App Usage"), false, "the admin screen never rendered");
  }));

  it("4. a session revoked on the server is signed out on the next cold load and sent to onboarding", run("revoked", async () => {
    assert.equal(await page.evaluate(`!!localStorage.getItem("justfit.session")`), true, "the member has a browser session");
    // Revoked on the server, as "Sign out of all devices" elsewhere would do it
    await connection.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", [identities.a.id]);
    await coldLoad(PROFILE, "/onboarding");
    assert.equal(await page.evaluate(`!!localStorage.getItem("justfit.session")`), false, "no session after the revocation");
    assert.equal(await page.hasText("Priya Sharma"), false, "no member content was shown");
  }));

  it("5. an admin reloading straight onto an admin screen stays there", run("admin", async () => {
    // The shared helper waits for a member's routes; an admin lands on /admin
    try { await signInAs(page, h, identities.admin); } catch (error) { if (!/route after|sign-in outcome/.test(error.message)) throw error; }
    await page.waitFor(`location.pathname === "/admin"`, 30000, "admin dashboard");
    await coldLoad("/admin/app-usage", "/admin/app-usage");
    await h.expectText("App Usage");
    await snapshot("deep-link-admin-app-usage-390");
    // An admin is not a member: a member route still sends them back to their dashboard
    await coldLoad(PREFERENCES, "/admin");
  }));
});
