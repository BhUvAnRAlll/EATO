// Phase 9, step 3: the complete onboarding workflow through the real Expo web UI with a
// genuine Clerk development identity, against the isolated Express test server and the
// eato_test database. The identity is created through Clerk's Backend API with a password
// that lives only in this process; the browser signs in through the real sign-in screen.
// Nothing here touches the application database or any non-test Clerk account.
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
const { fillSetup, helpers, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "eato-ui-evidence");
const CLERK_TEST_CODE = "424242"; // Clerk's fixed verification code for +clerk_test addresses on development instances

describe("ui authenticated: sign in → onboarding → save → reload → update → sign out → isolation", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, clerk, h;
  const identities = {}; // tag → { id, emailAddress, password }
  // The web build exposes Clerk on window; the in-page checks below depend on it, so its absence is a failure
  const requireClerkGlobal = async () => assert.equal(await page.evaluate(`typeof window.Clerk === "object" && window.Clerk !== null`), true, "window.Clerk must be exposed by the web build for in-page session checks");

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

  // Signs in through the real screen; handles the emailed-code step if Clerk asks for it
  const signInAs = async (identity) => {
    await h.goto("/sign-in", "Log in");
    await page.setInput(h.input("Email address"), identity.emailAddress);
    await page.setInput(h.input("Password"), identity.password);
    await page.clickText("Log in");
    const outcome = await page.waitFor(
      `(() => { const t = document.body.innerText || ""; if (location.pathname.startsWith("/setup") || location.pathname === "/home") return "routed"; if (t.includes("Check your email")) return "code"; const alert = document.querySelector('[role="alert"]'); if (alert && alert.innerText.trim()) return "error:" + alert.innerText.trim().slice(0, 120); return ""; })()`,
      60000, "sign-in outcome",
    );
    if (outcome === "code") {
      await page.setInput('input[maxlength="6"]', CLERK_TEST_CODE);
      await page.waitFor(`location.pathname.startsWith("/setup") || location.pathname === "/home"`, 60000, "route after the emailed code");
    } else if (outcome.startsWith("error:")) {
      throw new Error(`sign-in screen showed an error: ${outcome.slice(6)}`);
    }
    await h.settle();
  };
  // GET /api/profile from inside the page with the browser's own Clerk session (the token never leaves the page)
  const profileFromPage = () => page.evaluate(`(async () => { const token = window.Clerk && window.Clerk.session ? await window.Clerk.session.getToken() : null; const r = await fetch(${JSON.stringify(apiUrl())} + "/api/profile", { headers: token ? { Authorization: "Bearer " + token } : {} }); return { status: r.status, body: await r.json().catch(() => null) }; })()`);
  const newIdentity = async (tag) => { identities[tag] = await clerk.createIdentity(runId, tag, { withPassword: true }); return identities[tag]; };
  const cleanupIdentity = async (tag) => {
    const identity = identities[tag];
    if (!identity) return;
    await db.deleteUsers(connection, [identity.id]);
    await clerk.deleteUser(identity.id); // also ends its sessions
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
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    const swept = await clerk.sweepOrphans();
    if (swept.length > 0) console.log(`swept ${swept.length} orphaned test identities from earlier runs`);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: apiUrl() });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    try { await newIdentity("a"); } catch (error) { throw new Error(`Clerk could not create the test identity: ${JSON.stringify(describeClerkError(error))}`); }
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    if (connection && clerk) {
      for (const tag of Object.keys(identities)) {
        await step(`cleanup identity ${tag} (${identities[tag]?.id})`, () => cleanupIdentity(tag));
      }
      await step("row counts back to baseline", async () => { assert.deepEqual(await db.rowCounts(connection), countsBefore); });
      await step("test identities gone", async () => { for (const tag of Object.keys(identities)) assert.equal(await clerk.userExists(identities[tag].id), false, `identity ${tag} still exists`); });
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
    await h.expectPath("/setup/body-composition");
    await h.expectText("1/7");
    assert.ok(page.requests.some((u) => u.startsWith(`${apiUrl()}/api/profile`)), "the start screen should have asked the test server for the profile");
    assert.deepEqual(page.requests.filter((u) => /\/\/(localhost|127\.0\.0\.1):4000\b/.test(u)), [], "no request to the development server");
    await requireClerkGlobal();
    assert.equal(await page.evaluate(`!!window.Clerk.session`), true, "the browser must hold a Clerk session after signing in");
    const who = await page.evaluate(`window.Clerk.user ? window.Clerk.user.id : null`);
    assert.equal(who, identities.a.id, "the browser session must belong to the test identity");
  }));

  it("2. completing onboarding and pressing Finish saves the profile and opens home", run("finish", async () => {
    await page.clickText("Skip, I'll enter manually");
    await h.expectPath("/setup/personal");
    await fillSetup(page, expo.baseUrl, { fullName: "E2E Tester" });
    const before = page.requests.length;
    await page.clickText("Finish");
    await h.expectPath("/home");
    await h.expectText("Today's Nutrition");
    // The greeting and sign-out live on the Profile screen, opened from the header's avatar button
    await clickProfile();
    await h.expectPath("/profile");
    await h.expectText("Sign out");
    await h.expectText("Hi, E2E!");
    assert.ok(page.requests.slice(before).some((u) => u === `${apiUrl()}/api/profile`), "Finish must call the test server's profile route");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 });
    const [[user]] = await connection.query("SELECT email, full_name FROM users WHERE id = ?", [identities.a.id]);
    assert.equal(user.email, identities.a.emailAddress);
    assert.equal(user.full_name, "E2E Tester");
    const [[profile]] = await connection.query("SELECT diet, goal, profile_complete FROM profiles WHERE user_id = ?", [identities.a.id]);
    assert.deepEqual({ diet: profile.diet, goal: profile.goal, complete: profile.profile_complete }, { diet: "vegan", goal: "fat_loss", complete: 1 });
  }));

  it("3. after a reload the saved profile is retrieved and the user lands on home again", run("reload", async () => {
    await h.goto("/", "Today's Nutrition");
    assert.equal(await page.path(), "/home");
    // Returned-user path: with the account flag cleared, the app must ask the server and still reach home
    await clerk.setUnsafeMetadata(identities.a.id, { profileComplete: null });
    const before = page.requests.length;
    await h.goto("/", "Today's Nutrition");
    assert.equal(await page.path(), "/home");
    assert.ok(page.requests.slice(before).some((u) => u === `${apiUrl()}/api/profile`), "the app should have fetched the profile from the test server");
    const deadline = Date.now() + 15000;
    let restored = false;
    while (Date.now() < deadline && !restored) { restored = (await clerk.getUnsafeMetadata(identities.a.id)).profileComplete === true; if (!restored) await new Promise((r) => setTimeout(r, 500)); }
    assert.ok(restored, "the app should write the profileComplete flag back to the account");
  }));

  it("4. the saved profile belongs to the authenticated Clerk user", run("ownership", async () => {
    const [[row]] = await connection.query("SELECT id, email FROM users WHERE id = ?", [identities.a.id]);
    assert.equal(row.id, identities.a.id);
    assert.equal(row.email, identities.a.emailAddress);
    await requireClerkGlobal();
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
    await h.expectText("Today's Nutrition");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 });
    const [[user]] = await connection.query("SELECT full_name FROM users WHERE id = ?", [identities.a.id]);
    assert.equal(user.full_name, "E2E Updated");
    const [[profile]] = await connection.query("SELECT diet, goal FROM profiles WHERE user_id = ?", [identities.a.id]);
    assert.deepEqual({ diet: profile.diet, goal: profile.goal }, { diet: "vegetarian", goal: "maintenance" });
    assert.deepEqual(await db.rowCounts(connection), { ...countsBefore, nutrition_targets: countsBefore.nutrition_targets + 1, profiles: countsBefore.profiles + 1, users: countsBefore.users + 1 });
  }));

  it("6. signing out returns to onboarding and the profile route rejects the browser without a session", run("sign-out", async () => {
    await clickProfile();
    await h.expectText("Sign out");
    await page.clickText("Sign out");
    await h.expectText("Get Started");
    await h.settle();
    const { status } = await profileFromPage(); // no session → no token → no Authorization header
    assert.equal(status, 401, "an unauthenticated browser request must be rejected");
    await requireClerkGlobal();
    assert.equal(await page.evaluate(`!!window.Clerk.session`), false, "no Clerk session should remain after signing out");
  }));

  it("7. a second test user signs in, is sent to setup, and sees nothing of the first user's profile", run("isolation", async () => {
    await newIdentity("b");
    await signInAs(identities.b);
    await h.expectPath("/setup/body-composition");
    await requireClerkGlobal();
    const { status, body } = await profileFromPage();
    assert.equal(status, 200, "the second user's own session must be accepted");
    assert.deepEqual(body, { profile: null, nutrition: null }, "the second user must not see the first user's profile");
    assert.deepEqual(await db.rowsForUser(connection, identities.b.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 0 });
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 }, "the first user's rows are untouched");
  }));
});
