// Phase 9, step 3: the complete onboarding workflow through the real Expo web UI with a test
// account in eato_test, against the isolated Express test server. The browser signs in
// through the real phone sign-in screen with the code from the test server's fake SMS
// outbox (nothing is sent). Nothing here touches the application database.
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
const { fillSetup, helpers, signInAs: signInThroughScreen, hasSession, sessionTokenExpression, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");

describe("ui authenticated: sign in → onboarding → save → reload → update → sign out → isolation", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, testAccounts, h;
  const identities = {}; // tag → { id, emailAddress, phone }

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    // Visible text only; the screens never show tokens or passwords, and the code field renders as digits only
    const text = (await page.bodyText().catch(() => "")).slice(0, 400).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | visible text: "${text}"`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  const apiUrl = () => `http://localhost:${env.PORT}`;
  // The header's round avatar button (an icon, so it is found by its accessible name)
  const clickProfile = async () => {
    const pos = await page.waitFor(`(() => { const el = document.querySelector('[aria-label="Profile"]'); if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, "profile button");
    await page.clickAt(pos.x, pos.y);
  };

  // Signs in through the real phone sign-in screen (shared helper)
  const signInAs = (identity) => signInThroughScreen(page, h, identity);
  // A server route called from inside the page with the browser's own session (the token never leaves the page)
  const fromPage = (route, token = sessionTokenExpression) => page.evaluate(`(async () => { const token = ${token}; const r = await fetch(${JSON.stringify(apiUrl())} + ${JSON.stringify(route)}, { headers: token ? { Authorization: "Bearer " + token } : {} }); return { status: r.status, body: await r.json().catch(() => null) }; })()`);
  const profileFromPage = () => page.evaluate(`(async () => { const token = ${sessionTokenExpression}; const r = await fetch(${JSON.stringify(apiUrl())} + "/api/profile", { headers: token ? { Authorization: "Bearer " + token } : {} }); return { status: r.status, body: await r.json().catch(() => null) }; })()`);
  const newIdentity = async (tag) => { identities[tag] = await testAccounts.createIdentity(runId, tag); return identities[tag]; };
  const cleanupIdentity = async (tag) => {
    const identity = identities[tag];
    if (!identity) return;
    await db.deleteUsers(connection, [identity.id]);
    await testAccounts.deleteUser(identity.id); // also ends its sessions
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
    const swept = await testAccounts.sweepOrphans();
    if (swept.length > 0) console.log(`swept ${swept.length} orphaned test identities from earlier runs`);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: apiUrl() });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    try { await newIdentity("a"); } catch (error) { throw new Error(`could not create the test identity: ${JSON.stringify(describeIdentityError(error))}`); }
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    if (connection && testAccounts) {
      for (const tag of Object.keys(identities)) {
        await step(`cleanup identity ${tag} (${identities[tag]?.id})`, () => cleanupIdentity(tag));
      }
      await step("row counts back to baseline", async () => { assert.deepEqual(await db.rowCounts(connection), countsBefore); });
      await step("test identities gone", async () => { for (const tag of Object.keys(identities)) assert.equal(await testAccounts.userExists(identities[tag].id), false, `identity ${tag} still exists`); });
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
    if (problems.length > 0) {
      console.error("CLEANUP INCOMPLETE; orphaned test identifiers:", Object.values(identities).map((i) => i.id).join(", ") || "none");
      throw new Error("teardown problems: " + problems.join("; "));
    }
  });

  it("1. the real sign-in screen authenticates the test identity and routes a new user to setup", run("sign-in", async () => {
    await signInAs(identities.a);
    await h.expectPath("/setup/personal");
    await h.expectText("1/7");
    assert.ok(page.requests.some((u) => u === `${apiUrl()}/api/auth/verify-otp`), "the code should have been checked by the test server");
    assert.deepEqual(page.requests.filter((u) => /\/\/(localhost|127\.0\.0\.1):4000\b/.test(u)), [], "no request to the development server");
    assert.equal(await hasSession(page), true, "the browser must hold a session after signing in");
    const me = await fromPage("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, identities.a.id, "the browser session must belong to the test identity");
    assert.equal(me.body.user.role, "user");
  }));

  it("2. completing onboarding and pressing Finish saves the profile and opens home", run("finish", async () => {
    await fillSetup(page, expo.baseUrl, { fullName: "E2E Tester" });
    const before = page.requests.length;
    await page.clickText("Finish");
    await h.expectPath("/home");
    await h.expectText("Today's Macros");
    // The greeting and sign-out live on the Profile screen, opened from the header's avatar button
    await clickProfile();
    await h.expectPath("/profile");
    await h.expectText("Sign out");
    await h.expectText("E2E Tester"); // the member card shows the account's full name
    assert.ok(page.requests.slice(before).some((u) => u === `${apiUrl()}/api/profile`), "Finish must call the test server's profile route");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 });
    const [[user]] = await connection.query("SELECT email, full_name FROM users WHERE id = ?", [identities.a.id]);
    assert.equal(user.email, identities.a.emailAddress);
    assert.equal(user.full_name, "E2E Tester");
    const [[profile]] = await connection.query("SELECT diet, goal, profile_complete FROM profiles WHERE user_id = ?", [identities.a.id]);
    assert.deepEqual({ diet: profile.diet, goal: profile.goal, complete: profile.profile_complete }, { diet: "vegan", goal: "fat_loss", complete: 1 });
  }));

  it("3. after a reload the saved profile is retrieved and the user lands on home again", run("reload", async () => {
    await h.goto("/", "Today's Macros");
    assert.equal(await page.path(), "/home");
    // Where the app opens is the server's answer at launch, nothing stored in the browser: with
    // setup marked unfinished on the server a reload goes to setup, and back to home once it isn't
    const before = page.requests.length;
    await testAccounts.setProfileComplete(identities.a.id, false);
    await h.goto("/", "Let's get to know you");
    assert.equal(await page.path(), "/setup/personal");
    assert.ok(page.requests.slice(before).some((u) => u === `${apiUrl()}/api/auth/me`), "the app should have asked the test server who is signed in");
    await testAccounts.setProfileComplete(identities.a.id, true);
    await h.goto("/", "Today's Macros");
    assert.equal(await page.path(), "/home");
  }));

  it("4. the saved profile belongs to the signed-in account", run("ownership", async () => {
    const [[row]] = await connection.query("SELECT id, email FROM users WHERE id = ?", [identities.a.id]);
    assert.equal(row.id, identities.a.id);
    assert.equal(row.email, identities.a.emailAddress);
    const { status, body } = await profileFromPage(); // the browser's own session token, used inside the page only
    assert.equal(status, 200, "the signed-in browser must be able to read its own profile");
    assert.equal(body.profile.email, identities.a.emailAddress);
    assert.equal(body.profile.fullName, "E2E Tester");
    assert.equal(body.profile.profileComplete, true);
  }));

  it("5. running setup again updates the profile in place with no duplicate rows", run("update", async () => {
    await h.goto("/setup/personal", "Let's get to know you");
    await fillSetup(page, expo.baseUrl, { fullName: "E2E Updated", diet: "Vegetarian", goal: "Maintain weight" });
    await page.clickText("Finish");
    await h.expectPath("/home");
    await h.expectText("Today's Macros");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 });
    const [[user]] = await connection.query("SELECT full_name FROM users WHERE id = ?", [identities.a.id]);
    assert.equal(user.full_name, "E2E Updated");
    const [[profile]] = await connection.query("SELECT diet, goal FROM profiles WHERE user_id = ?", [identities.a.id]);
    assert.deepEqual({ diet: profile.diet, goal: profile.goal }, { diet: "vegetarian", goal: "maintenance" });
    assert.deepEqual(await db.rowCounts(connection), { ...countsBefore, nutrition_targets: countsBefore.nutrition_targets + 1, profiles: countsBefore.profiles + 1, users: countsBefore.users + 1 });
  }));

  it("6. signing out returns to onboarding, ends the session on the server, and the browser holds none", run("sign-out", async () => {
    const oldToken = await page.evaluate(sessionTokenExpression); // kept in this process only, never logged
    await clickProfile();
    await h.expectText("Sign out");
    await page.clickText("Sign out");
    await h.expectText("Get Started");
    await h.settle();
    const { status } = await profileFromPage(); // no session → no token → no Authorization header
    assert.equal(status, 401, "an unauthenticated browser request must be rejected");
    assert.equal(await hasSession(page), false, "no session should remain in the browser after signing out");
    assert.equal((await fromPage("/api/auth/me", JSON.stringify(oldToken))).status, 401, "the old token is revoked on the server, not just forgotten");
  }));

  it("7. a second test user signs in, is sent to setup, and sees nothing of the first user's profile", run("isolation", async () => {
    await newIdentity("b");
    await signInAs(identities.b);
    await h.expectPath("/setup/personal");
    const { status, body } = await profileFromPage();
    assert.equal(status, 200, "the second user's own session must be accepted");
    assert.deepEqual(body, { profile: null, nutrition: null }, "the second user must not see the first user's profile");
    assert.deepEqual(await db.rowsForUser(connection, identities.b.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 }, "only the account row sign-in made");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 }, "the first user's rows are untouched");
  }));
});
