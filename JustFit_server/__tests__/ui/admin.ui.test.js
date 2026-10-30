// The Super Admin portal in the real Expo web build against the isolated test server and the
// justfit_test database: an justFit admin signs in onto the Overview (counts, to-do list, recent admin
// activity), the Reports tab carries its badge, a to-do row opens the screen that resolves it,
// and a member can't reach /admin. Screenshots at three widths.
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
    // Something for each to-do: a reported post and a gym on a trial
    const [[{ id: postId }]] = await connection.query("SELECT UUID() AS id");
    state.post = postId;
    await connection.query("INSERT INTO community_posts (id, user_id, body) VALUES (?, ?, 'Buy followers cheap!!!')", [postId, identities.member.id]);
    await connection.query("INSERT INTO community_reports (reporter_id, post_id, reason) VALUES (?, ?, 'Spam')", [identities.coach.id, postId]);
    const created = await apiAs("admin", "POST", "/api/gyms", { name: "Velocity Fitness", tagline: "Move fast", location: "Austin", ownerEmail: identities.member.emailAddress });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    state.gym = created.json.gym.id;
    await connection.query("UPDATE gyms SET status = 'trial', trial_ends_at = DATE_ADD(CURDATE(), INTERVAL 12 DAY) WHERE id = ?", [state.gym]);
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
      await connection.query("DELETE FROM community_reports WHERE post_id = ?", [state.post ?? ""]);
      await connection.query("DELETE FROM community_posts WHERE id = ?", [state.post ?? ""]);
      const gymIds = [state.gym, state.newGym].filter(Boolean);
      if (gymIds.length) for (const table of ["gym_members", "whatsapp_agent_settings", "whatsapp_connections"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
      if (gymIds.length) await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
      await connection.query("DELETE FROM community_profiles WHERE user_id IN (?)", [ids]);
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

  it("1. an admin lands on the Overview: counts, the to-do list and the Reports badge", run("overview", async () => {
    await viewport(390, 844);
    await signIn(identities.admin, "/admin");
    await h.expectPath("/admin");
    await h.expectText("Overview");
    await page.waitFor(`!!document.querySelector('[aria-label="Open reports: 1"]')`, NAV_TIMEOUT, "the open reports tile");
    await h.expectText("1 reported post");
    assert.equal(await page.evaluate(`(document.body.innerText || "").includes("Verify ")`), false, "no trainer to-dos any more");
    assert.equal(await page.evaluate(`!!document.querySelector('[aria-label^="Unverified:"]')`), false, "no Unverified tile any more");
    await h.expectText("Velocity Fitness is on a trial");
    await h.expectText("Created gym Velocity Fitness", "the gym creation is in the activity log");
    await page.waitFor(`!!document.querySelector('[role="tab"][aria-label="Reports, 1 waiting"]')`, NAV_TIMEOUT, "the Reports badge");
    await snapshotAllWidths("admin-overview");
  }));

  it("2. a to-do row opens the screen that resolves it, and an action shows up in the activity", run("todo", async () => {
    await clickLabelStarting("1 reported post");
    await h.expectPath("/admin/reports");
    await h.expectText("Buy followers cheap!!!");
    await h.expectText("1 report: Spam (Marcus)");
    await snapshotAllWidths("admin-reports");
    // Suspend the post's author from the server side; the Overview shows it on the next visit
    assert.equal((await apiAs("admin", "POST", `/api/community/admin/members/${identities.member.id}/suspend`)).status, 200);
    await clickTab("Overview");
    await h.expectPath("/admin");
    await h.expectText("Suspended Daniel Kim");
    await page.waitFor(`!!document.querySelector('[aria-label="Suspended: 1"]')`, NAV_TIMEOUT, "the suspended tile");
    assert.equal((await apiAs("admin", "DELETE", `/api/community/admin/members/${identities.member.id}/suspend`)).status, 200);
  }));

  it("3. Users: filter to gym owners (no Trainers filter), then suspend and reinstate a member", run("users", async () => {
    await clickTab("Users");
    await h.expectPath("/admin/users");
    await page.waitFor(`!!document.querySelector('[aria-label="Marcus Johnson, Member"]')`, NAV_TIMEOUT, "Marcus as a plain member");
    await snapshotAllWidths("admin-users");
    assert.equal(await page.evaluate(`[...document.querySelectorAll('[role="tab"]')].some((e) => (e.getAttribute("aria-label") || e.innerText || "").startsWith("Trainers"))`), false, "no Trainers filter");
    await clickLabelStarting("Gym owners");
    await page.waitFor(`![...document.querySelectorAll('[aria-label^="Marcus Johnson,"]')].some((e) => e.getClientRects().length > 0)`, NAV_TIMEOUT, "non-owners filtered out");
    await page.waitFor(`!!document.querySelector('[aria-label="Daniel Kim, Gym owner"]')`, NAV_TIMEOUT, "the gym owner row");

    // A member: suspend behind a confirmation, then reinstate
    await clickLabelStarting("All");
    await clickLabelStarting("Daniel Kim,");
    await page.waitFor(`location.pathname.startsWith("/admin/users/")`, NAV_TIMEOUT, "the member's page");
    await h.expectText("Velocity Fitness");
    await clickLabelStarting("Suspend account");
    await h.expectText("Suspend Daniel Kim?");
    await snapshotAllWidths("admin-user-suspend");
    await page.clickText("Suspend");
    const status = async () => (await connection.query("SELECT status FROM community_profiles WHERE user_id = ?", [identities.member.id]))[0][0]?.status;
    const until = Date.now() + NAV_TIMEOUT;
    while ((await status()) !== "suspended" && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    assert.equal(await status(), "suspended");
    await clickLabelStarting("Reinstate account");
    const until2 = Date.now() + NAV_TIMEOUT;
    while ((await status()) !== "active" && Date.now() < until2) await new Promise((r) => setTimeout(r, 200));
    assert.equal(await status(), "active");
    await clickLabelStarting("Back");
  }));

  it("4. Gyms: the list, a gym's page (plan, suspend, reinstate) and Create gym", run("gyms", async () => {
    await clickTab("Gyms");
    await h.expectPath("/admin/gyms");
    await page.waitFor(`!!document.querySelector('[aria-label^="Velocity Fitness, 1 member · Starter · Daniel Kim, trial"]')`, NAV_TIMEOUT, "the trial gym's row");
    await snapshotAllWidths("admin-gyms");
    await clickLabelStarting("Velocity Fitness,");
    await page.waitFor(`location.pathname.startsWith("/admin/gyms/")`, NAV_TIMEOUT, "the gym's page");
    await h.expectText("Trial ends");
    await snapshotAllWidths("admin-gym-detail");
    const gymRow = async () => (await connection.query("SELECT plan, status FROM gyms WHERE id = ?", [state.gym]))[0][0];
    const waitFor = async (check, what) => {
      const deadline = Date.now() + NAV_TIMEOUT;
      while (!check(await gymRow()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      assert.ok(check(await gymRow()), what);
    };
    await clickLabelStarting("Pro plan");
    await waitFor((g) => g.plan === "pro", "the plan changed to Pro");
    await clickLabelStarting("Suspend gym");
    await h.expectText("Suspend Velocity Fitness?");
    await page.clickText("Suspend");
    await waitFor((g) => g.status === "suspended", "the gym is suspended");
    await clickLabelStarting("Reinstate gym");
    await waitFor((g) => g.status === "trial", "reinstated to its trial");
    await clickLabelStarting("Back");
    await h.expectPath("/admin/gyms");

    // Create gym: the owner comes from a search, and the gym starts a trial
    await clickLabelStarting("Create gym");
    await h.expectPath("/admin/gyms/new");
    // Expo web bundles this screen on its first visit ("Bundling..."): wait for the form
    await page.waitFor(`[...document.querySelectorAll('[aria-label="Gym name"]')].some((e) => e.getClientRects().length > 0)`, NAV_TIMEOUT, "the Create gym form");
    await page.setInput('[aria-label="Gym name"]', `Core Club ${runId}`);
    await page.setInput('[aria-label="Area"]', "Austin");
    await page.setInput('[aria-label="Search for the owner"]', "Marcus");
    await clickLabelStarting("Owner: Marcus Johnson");
    await h.expectText("Marcus Johnson will own this gym");
    await snapshotAllWidths("admin-gym-create");
    // The footer's Create gym (the last one on the page)
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll('[aria-label="Create gym"]')].filter((e) => e.getClientRects().length > 0); const el = els[els.length - 1]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, "the Create gym button");
    await page.clickAt(pos.x, pos.y);
    await page.waitFor(`location.pathname.startsWith("/admin/gyms/") && !location.pathname.endsWith("/new")`, NAV_TIMEOUT, "the new gym's page");
    const [[made]] = await connection.query("SELECT g.id, g.status, DATEDIFF(g.trial_ends_at, CURDATE()) AS days, m.user_id FROM gyms g JOIN gym_members m ON m.gym_id = g.id AND m.role = 'owner' WHERE g.name = ?", [`Core Club ${runId}`]);
    state.newGym = made.id;
    assert.deepEqual({ status: made.status, days: made.days, owner: made.user_id }, { status: "trial", days: 14, owner: identities.coach.id });
    await h.expectText("Marcus Johnson");
    await clickLabelStarting("Back");
  }));

  it("5. a member can't open the admin portal", run("guard", async () => {
    await signIn(identities.member, "/home");
    await page.navigate(`${expo.baseUrl}/admin`);
    await page.waitFor(`!location.pathname.startsWith("/admin")`, NAV_TIMEOUT, "sent away from /admin");
    assert.equal(await page.evaluate(`(document.body.innerText || "").includes("JUSTFIT ADMIN")`), false);
  }));
});
