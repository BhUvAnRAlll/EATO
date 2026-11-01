// The Super Admin portal in the real Expo web build against the isolated test server and the
// justfit_test database: an justFit admin signs in onto the Overview (counts and recent admin
// activity), with only Overview, Users and Content as tabs; Users filters and opens an account's
// page; and a member can't reach /admin. Screenshots at three widths.
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

describe("ui admin: the Super Admin Overview and its tabs", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  const tokens = {};
  const sessions = {};
  const state = {};

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
  const clickLabelStarting = async (prefix) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label").startsWith(${JSON.stringify(prefix)}))[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${prefix}…`);
    await page.clickAt(pos.x, pos.y);
  };
  // A bottom-bar tab, by its role (stat tiles and rows can share a tab's words)
  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[role="tab"]')].filter((e) => e.getClientRects().length > 0 && (e.getAttribute("aria-label") || "").startsWith(${JSON.stringify(label)}))[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `the ${label} tab`);
    await page.clickAt(pos.x, pos.y);
  };
  const apiAs = async (tag, method, route, body) => {
    const headers = { Authorization: `Bearer ${tokens[tag]}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  // The real phone sign-in (shared helper), then the account's own landing page
  const signIn = async (identity, landing) => {
    await signInAs(page, h, identity);
    await page.waitFor(`location.pathname.startsWith(${JSON.stringify(landing)})`, 60000, `landing on ${landing}`);
    await h.settle();
  };

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
    // The first web bundle can take a while: load the sign-in screen once before any test
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      for (const [tag, role] of [["admin", "admin"], ["member", undefined], ["coach", undefined]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        tokens[tag] = minted.jwt;
        sessions[tag] = minted.sessionId;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    const names = { admin: "Maya Ortiz", member: "Daniel Kim", coach: "Marcus Johnson" };
    for (const tag of Object.keys(identities)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [identities[tag].id, identities[tag].emailAddress, names[tag], tag === "admin" ? "admin" : "user"]);
    }
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency, profile_complete) VALUES (?, '1995-05-10', 'male', 'muscle_gain', 175, 70, '3-4', TRUE)", [identities.member.id]);
    // Something for the counts and the activity log: a finished workout and a published promotion
    await connection.query("INSERT INTO workout_logs (user_id, on_date, status, completed_at) VALUES (?, CURDATE(), 'completed', NOW())", [identities.member.id]);
    const promo = await apiAs("admin", "POST", "/api/admin/promotions", {
      title: "Train at home", eyebrow: "NEW", headline: "Train at home", description: "Plans that fit your space", imageUrl: "asset:hero-meals", ctaLabel: "See plans", ctaDestination: "fitness", status: "draft",
    });
    assert.equal(promo.status, 201, JSON.stringify(promo.json));
    state.promotion = promo.json.promotion.id;
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
      await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [ids]);
      if (state.promotion) await connection.query("DELETE FROM promotions WHERE id = ?", [state.promotion]);
      await connection.query("DELETE FROM workout_logs WHERE user_id IN (?)", [ids]);
      await connection.query("DELETE FROM profiles WHERE user_id IN (?)", [ids]);
      await db.deleteUsers(connection, ids);
      await connection.end();
    });
    await step("identities", async () => {
      if (!testAccounts) return;
      for (const sessionId of Object.values(sessions)) await testAccounts.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. an admin lands on the Overview: counts, recent activity, and only Overview, Users and Content as tabs", run("overview", async () => {
    await viewport(390, 844);
    await signIn(identities.admin, "/admin");
    await h.expectPath("/admin");
    await h.expectText("Overview");
    await page.waitFor(`!!document.querySelector('[aria-label="Users: 3"]')`, NAV_TIMEOUT, "the users tile");
    await page.waitFor(`!!document.querySelector('[aria-label="Workouts this week: 1"]')`, NAV_TIMEOUT, "the workouts tile");
    await h.expectText("Created promotion “Train at home”", "the promotion is in the activity log");
    const tabs = await page.evaluate(`[...document.querySelectorAll('[role="tab"]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute("aria-label"))`);
    assert.deepEqual(tabs, ["Overview", "Users", "Content"], "no Gyms or Reports tab");
    for (const gone of ["Open reports", "Gym members", "Suspended", "To do"]) assert.equal(await page.hasText(gone), false, `${gone} is gone`);
    await snapshotAllWidths("admin-overview");
  }));

  it("2. Users: filter to admins, then open a member's page", run("users", async () => {
    await clickTab("Users");
    await h.expectPath("/admin/users");
    await page.waitFor(`!!document.querySelector('[aria-label="Marcus Johnson, Member"]')`, NAV_TIMEOUT, "Marcus as a plain member");
    await snapshotAllWidths("admin-users");
    for (const gone of ["Trainers", "Gym owners", "Suspended"]) {
      assert.equal(await page.evaluate(`[...document.querySelectorAll('[role="tab"]')].some((e) => (e.getAttribute("aria-label") || e.innerText || "").startsWith(${JSON.stringify(gone)}))`), false, `no ${gone} filter`);
    }
    await clickLabelStarting("Admins");
    await page.waitFor(`![...document.querySelectorAll('[aria-label^="Marcus Johnson,"]')].some((e) => e.getClientRects().length > 0)`, NAV_TIMEOUT, "members filtered out");
    await page.waitFor(`!!document.querySelector('[aria-label="Maya Ortiz, Admin"]')`, NAV_TIMEOUT, "the admin row");

    await clickLabelStarting("All");
    await clickLabelStarting("Daniel Kim,");
    await page.waitFor(`location.pathname.startsWith("/admin/users/")`, NAV_TIMEOUT, "the member's page");
    await page.waitFor(`!!document.querySelector('[aria-label="Workouts: 1"]')`, NAV_TIMEOUT, "the finished workout");
    await h.expectText("Joined");
    for (const gone of ["Suspend account", "Public profile", "Posts"]) assert.equal(await page.hasText(gone), false, `${gone} is gone`);
    await snapshotAllWidths("admin-user-detail");
    await clickLabelStarting("Back");
  }));

  it("3. a member can't open the admin portal", run("guard", async () => {
    await signIn(identities.member, "/home");
    await page.navigate(`${expo.baseUrl}/admin`);
    await page.waitFor(`!location.pathname.startsWith("/admin")`, NAV_TIMEOUT, "sent away from /admin");
    assert.equal(await page.evaluate(`(document.body.innerText || "").includes("JUSTFIT ADMIN")`), false);
  }));
});
