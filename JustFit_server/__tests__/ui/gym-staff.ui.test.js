// Staff / Admin Login in the real Expo web build against the isolated test server and the
// justfit_test database. The gym admin opens it from the ☰ menu, adds a member as Staff through the
// sheet and its confirm step, invites a number that has never signed in as a Trainer, and cancels
// that invite from its ⋯. A member signed in on the member app is made Staff while the app is open:
// coming back to the front switches them to the gym portal (without Staff / Admin Login), and
// being removed switches them back. Screenshots at three widths.
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

describe("ui gym staff: Staff / Admin Login and the live role switch", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  const sessions = {};
  const tokens = {};
  const state = {};
  const invited = "8" + String(crypto.randomInt(0, 1_000_000_000)).padStart(9, "0");

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 400).replace(/\s+/g, " ");
    const labels = await page.evaluate(`JSON.stringify([...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute("aria-label")).filter((l) => /staff|add|trainer/i.test(l)))`).catch(() => "?");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | labels: ${labels} | visible text: "${text}"`;
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
  const apiAs = async (tag, method, route, body) => {
    const headers = { Authorization: `Bearer ${tokens[tag]}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  const clickLabel = async (label) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label") === ${JSON.stringify(label)})[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const hasLabel = (label) => page.evaluate(`[...document.querySelectorAll('[aria-label]')].some((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label") === ${JSON.stringify(label)})`);
  const roleOf = async (userId) => (await connection.query("SELECT role FROM users WHERE id = ?", [userId]))[0][0]?.role;
  // What the app does when it comes back to the front (React Native Web's AppState listens to this)
  const backToFront = () => page.evaluate(`document.dispatchEvent(new Event("visibilitychange"))`);
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
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      for (const [tag, role] of [["owner", "gym_admin"], ["priya", undefined], ["admin", "admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        sessions[tag] = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Arjun Kumar", identities.owner.id]);
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Priya Sharma", identities.priya.id]);
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency, profile_complete) VALUES (?, '1997-03-14', 'female', 'fat_loss', 162, 60, '3-4', TRUE)", [identities.priya.id]);
    const gym = await apiAs("admin", "POST", "/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "SIT Road", city: "Tumakuru" });
    assert.equal(gym.status, 201, JSON.stringify(gym.json));
    state.gym = gym.json.gym.id;
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/staff`, { phone: identities.owner.phone })).status, 201);
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
      if (state.gym) {
        const [[{ brand_id: brandId }]] = await connection.query("SELECT brand_id FROM gyms WHERE id = ?", [state.gym]);
        for (const table of ["gym_activity_log", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
        await connection.query("DELETE FROM gyms WHERE id = ?", [state.gym]);
        await connection.query("DELETE FROM gym_brands WHERE id = ?", [brandId]);
      }
      const ids = Object.values(identities).map((i) => i.id);
      if (ids.length > 0) {
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [ids]);
        await connection.query("DELETE FROM profiles WHERE user_id IN (?)", [ids]);
        await db.deleteUsers(connection, ids);
      }
      await connection.end();
    });
    await step("identities", async () => {
      if (!testAccounts) return;
      for (const sessionId of Object.values(sessions)) await testAccounts.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the gym admin opens Staff / Admin Login from the ☰ menu: just them so far", run("staff-empty", async () => {
    await viewport(390, 844);
    await signIn(identities.owner, "/gym");
    await h.expectText("Tumkur branch");
    await clickLabel("Menu");
    await h.expectText("Sign out");
    await h.settle(); // the menu slides in
    await clickLabel("Staff / Admin Login");
    await page.waitFor(`location.pathname === "/gym/staff"`, NAV_TIMEOUT, "Staff / Admin Login");
    await h.expectText("No Staff or Trainers yet");
    assert.ok(await hasLabel("You, Gym admin"), "the gym admin's own row");
    assert.equal(await hasLabel("You: options"), false, "no ⋯ on your own row");
    await snapshotAllWidths("gym-staff-empty");
  }));

  it("2. adding a member as Staff: the sheet, the confirm step, and their role changes", run("staff-add", async () => {
    await clickLabel("Add Staff or a Trainer");
    await h.expectText("Add Staff / Trainer");
    await h.expectText("They'll open this gym portal for the branch");
    assert.equal(await page.evaluate(`document.querySelector('[aria-label="Continue"]').getAttribute("aria-disabled")`), "true", "Continue waits for 10 digits");
    await snapshotAllWidths("gym-staff-add");
    await page.setInput(`input[placeholder="Mobile Number (10 digits)"]`, identities.priya.phone.replace(/^\+91/, ""));
    await clickLabel("Continue");
    await h.expectText("Please confirm the details");
    await h.expectText("Forma, Tumkur");
    await snapshotAllWidths("gym-staff-confirm");
    await clickLabel("Add");
    await h.expectText("Added as Staff.");
    await h.expectText("Priya Sharma");
    assert.equal(await roleOf(identities.priya.id), "gym_admin");
  }));

  it("3. a number that has never signed in is invited as a Trainer, then the invite is cancelled", run("staff-invite", async () => {
    await clickLabel("Add Staff or a Trainer");
    await h.expectText("Add someone to your team");
    await h.settle(); // the sheet slides up
    await page.setInput(`input[placeholder="Mobile Number (10 digits)"]`, invited);
    await clickLabel("Trainer");
    await h.expectText("AI Coach and Fitness will be hidden for them");
    await clickLabel("Continue");
    await h.expectText("Please confirm the details");
    await h.settle(); // the dialog fades in
    await clickLabel("Add");
    await h.expectText("Invited as a Trainer.");
    await h.expectText("Waiting for first sign-in");
    await snapshotAllWidths("gym-staff-list");

    const masked = `+91 ••••• ••${invited.slice(7)}`;
    await clickLabel(`Invite to ${masked}: options`);
    await h.settle();
    await h.expectText("won't join your team when it signs in");
    await snapshotAllWidths("gym-staff-cancel");
    await clickLabel("Cancel invite");
    await h.expectText("Cancel this invite?");
    await h.settle();
    await clickLabel("Yes, cancel it");
    await h.expectNoText("Waiting for first sign-in");
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM gym_staff_invites WHERE gym_id = ?", [state.gym]))[0][0].n, 0);
  }));

  it("4. a member made Staff while signed in switches to the portal when the app comes back, and back again when removed", run("staff-switch", async () => {
    // Priya is Staff from step 2; start her as a member again for this step
    assert.equal((await apiAs("owner", "DELETE", `/api/gym/staff/${identities.priya.id}`)).status, 200);
    await signIn(identities.priya, "/home");

    const added = await apiAs("owner", "POST", "/api/gym/staff", { phone: identities.priya.phone, kind: "staff" });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    await h.settle();
    await h.settle();
    await h.settle();
    await backToFront();
    await page.waitFor(`location.pathname === "/gym"`, NAV_TIMEOUT, "the switch to the gym portal");
    await h.expectText("Tumkur branch");
    await h.expectText("STAFF");
    await clickLabel("Menu");
    await h.expectText("Sign out");
    await h.settle();
    await h.expectText("Plans / Catalogue");
    assert.equal(await hasLabel("Staff / Admin Login"), false, "Staff don't manage the team");
    await snapshotAllWidths("gym-staff-portal-menu");
    // The backdrop fills the screen under the menu panel, so its centre is a menu row (for a Staff
    // login, Expenses: a "coming soon" alert that froze this suite on 2026-11-07); the harness's
    // own click finds a point of the backdrop the panel doesn't cover
    await page.clickLabel("Close menu");

    // Opening the team by its address anyway: the server says no
    await page.navigate(`${expo.baseUrl}/gym/staff`);
    await h.expectText("Only the gym admin can manage the team.");

    // Removed: back to the member app the next time the app comes to the front
    assert.equal((await apiAs("owner", "DELETE", `/api/gym/staff/${identities.priya.id}`)).status, 200);
    await h.settle();
    await h.settle();
    await h.settle();
    await backToFront();
    await page.waitFor(`location.pathname === "/home"`, NAV_TIMEOUT, "back to the member app");
    assert.equal(await roleOf(identities.priya.id), "user");
  }));
});
