// Cold page loads straight onto a protected screen (a reloaded tab, a shared link), in the
// real Expo web build against the isolated test server and the eato_test database. The root
// layout must wait for Clerk to restore the session before its role guards decide, so:
// a signed-in member lands on the member screen they opened, a signed-out visitor or a
// revoked session is sent to onboarding, and a member still can't open an admin screen.
//
//   yarn test:ui      (needs Eato_server/.env.test and Google Chrome; otherwise skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { clerkFor, describeClerkError } = require("../e2e/clerk-identities.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.EATO_SCREENSHOT_DIR || null;

describe("ui deep links: a cold load onto a protected screen waits for the session", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, clerk, h;
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
  const profileOf = (tag) => `/community/profile/${identities[tag].id}`;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    baseline = await countAll();
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, page.sessionId);
    h = helpers(page, expo.baseUrl);
    try {
      identities.a = await clerk.createIdentity(runId, "a", { withPassword: true });
      identities.b = await clerk.createIdentity(runId, "b");
      identities.admin = await clerk.createIdentity(runId, "admin", { withPassword: true, role: "admin" });
    } catch (error) {
      throw new Error(`Clerk could not create a test identity: ${JSON.stringify(describeClerkError(error))}`);
    }
    await clerk.setUnsafeMetadata(identities.a.id, { profileComplete: true });
    for (const tag of ["a", "b", "admin"]) {
      const name = { a: "Priya Sharma", b: "Rohan Mehta", admin: "Admin Tester" }[tag];
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [identities[tag].id, identities[tag].emailAddress, name, tag === "admin" ? "admin" : "user"]);
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
        await connection.query("DELETE FROM community_follows WHERE follower_id IN (?) OR following_id IN (?)", [ids, ids]);
        await connection.query("DELETE FROM community_profiles WHERE user_id IN (?)", [ids]);
        await db.deleteUsers(connection, ids);
      }
      // Nothing this file wrote may be left behind
      if (baseline) for (const [table, n] of Object.entries(await countAll())) if (n !== baseline[table]) problems.push(`${table}: ${baseline[table]} rows before, ${n} after`);
      await connection.end();
    });
    await step("identities", async () => { if (clerk) for (const identity of Object.values(identities)) await clerk.deleteUser(identity.id); });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. a signed-out visitor opening a member's profile is sent to onboarding", run("signed-out", async () => {
    await coldLoad(profileOf("b"), "/onboarding");
    assert.equal(await page.hasText("Rohan Mehta"), false, "no member content was shown");
  }));

  it("2. a signed-in member reloading straight onto a profile stays on that profile", run("member-profile", async () => {
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await coldLoad(profileOf("b"), profileOf("b"));
    await h.expectText("Rohan Mehta");
    await page.waitFor(`!!document.querySelector('[aria-label="Profile options"]')`, NAV_TIMEOUT, "the profile screen itself");
    await snapshot("deep-link-member-profile-390");
    // A second reload of the same address keeps it too (the session is restored each time)
    await coldLoad(profileOf("b"), profileOf("b"));
    await h.expectText("Rohan Mehta");
    // And another member route, their own profile
    await coldLoad(profileOf("a"), profileOf("a"));
    await h.expectText("Priya Sharma");
  }));

  it("3. a member's cold load onto an admin screen is still refused (they land on Home)", run("member-admin", async () => {
    await coldLoad("/admin/moderation", "/home");
    assert.equal(await page.hasText("Open reports"), false, "the moderation screen never rendered");
  }));

  it("4. a session revoked on the server is signed out on the next cold load and sent to onboarding", run("revoked", async () => {
    const sessionId = await page.evaluate(`window.Clerk && window.Clerk.session ? window.Clerk.session.id : null`);
    assert.ok(sessionId, "the member has a browser session");
    await clerk.revokeSession(sessionId);
    await coldLoad(profileOf("b"), "/onboarding");
    assert.equal(await page.evaluate(`!!(window.Clerk && window.Clerk.session)`), false, "no session after the revocation");
    assert.equal(await page.hasText("Rohan Mehta"), false, "no member content was shown");
  }));

  it("5. an admin reloading straight onto the moderation screen stays there", run("admin", async () => {
    // The shared helper waits for a member's routes; an admin lands on /admin
    try { await signInAs(page, h, identities.admin); } catch (error) { if (!/route after|sign-in outcome/.test(error.message)) throw error; }
    await page.waitFor(`location.pathname === "/admin"`, 30000, "admin dashboard");
    await coldLoad("/admin/moderation", "/admin/moderation");
    await h.expectText("Open reports");
    await snapshot("deep-link-admin-moderation-390");
    // An admin is not a member: a member route still sends them back to their dashboard
    await coldLoad(profileOf("b"), "/admin");
  }));
});
