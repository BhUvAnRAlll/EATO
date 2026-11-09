// Settings › Public profile (Gym Hub phase 2) in the real Expo web build against the isolated test
// server and the justfit_test database. The gym admin picks facilities, adds opening hours (Sunday
// closed, a second Monday session), writes the description and saves; the server holds it. Staff
// open the same screen read-only, with no Save and no photo buttons. No horizontal overflow at
// three widths.
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

describe("ui gym public profile: the gym admin fills it in, Staff only read it", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  const sessions = {};
  const tokens = {};
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
    await h.settle();
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
      for (const [tag, role] of [["owner", "gym_admin"], ["admin", "admin"], ["staff", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        sessions[tag] = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    const gym = await apiAs("admin", "POST", "/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "SIT Road", city: "Tumakuru" });
    assert.equal(gym.status, 201, JSON.stringify(gym.json));
    state.gym = gym.json.gym.id;
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/staff`, { phone: identities.owner.phone })).status, 201);
    assert.equal((await apiAs("owner", "POST", "/api/gym/staff", { phone: identities.staff.phone, kind: "staff" })).status, 201);
    const team = await apiAs("owner", "GET", "/api/gym/staff");
    assert.equal(team.status, 200, JSON.stringify(team.json));
    state.staffId = identities.staff.id;
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
        for (const table of ["gym_activity_log", "gym_photos", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
        await connection.query("DELETE FROM gyms WHERE id = ?", [state.gym]);
        await connection.query("DELETE FROM gym_brands WHERE id = ?", [brandId]);
      }
      const ids = Object.values(identities).map((i) => i.id);
      if (ids.length > 0) {
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [ids]);
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

  const openProfile = async () => {
    await clickLabel("Menu");
    await h.expectText("Sign out");
    await h.settle(); // the menu slides in
    await clickLabel("Settings");
    await page.waitFor(`location.pathname === "/gym/settings"`, NAV_TIMEOUT, "the Settings screen");
    await clickLabel("Public profile, Photos, facilities and hours members see");
    await page.waitFor(`location.pathname === "/gym/profile"`, NAV_TIMEOUT, "the Public profile screen");
    await h.expectText("Opening hours");
  };

  it("1. the gym admin opens an empty profile from Settings", run("profile-empty", async () => {
    await viewport(390, 844);
    await signIn(identities.owner, "/gym");
    await h.expectText("Tumkur branch");
    await openProfile();
    for (const text of ["Photos (0 of 8)", "Not added yet. Members will see when you are open.", "Also shown to members"]) await h.expectText(text);
    assert.ok(await hasLabel("Add a photo from the gallery"), "photo buttons for the gym admin");
    assert.ok(await hasLabel("Save profile"), "Save");
    await snapshotAllWidths("gym-profile-empty");
  }));

  it("2. facilities, hours and the description save together", run("profile-save", async () => {
    await clickLabel("Parking");
    await clickLabel("Cardio machines");
    await page.setInput('textarea[placeholder="Eg. Two floors of equipment, certified trainers, open since 2012."]', "Two floors, open since 2012.");
    await clickLabel("Add opening hours");
    await h.expectText("Same as Monday for every day");
    await clickLabel("Sunday closed");
    // Monday's first session opens at 6 am instead of 5:30
    await clickLabel("Monday, first session opens at 5:30 am. Change");
    await h.expectText("Opens at");
    await h.settle();
    await clickLabel("6 am");
    await h.expectNoText("Opens at");
    await snapshotAllWidths("gym-profile-filled");
    await clickLabel("Save profile");
    await h.expectText("Public profile saved");
    const saved = await apiAs("owner", "GET", "/api/gym/profile");
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.about, "Two floors, open since 2012.");
    assert.deepEqual(saved.json.facilities, ["cardio", "parking"]);
    assert.deepEqual(saved.json.hours.sun, []);
    assert.deepEqual(saved.json.hours.mon, [["06:00", "10:30"], ["16:30", "21:30"]]);
  }));

  it("3. Staff read the profile but can't change it", run("profile-staff", async () => {
    // Back to Settings, which has Sign out under the account
    await clickLabel("Back");
    await page.waitFor(`location.pathname === "/gym/settings"`, NAV_TIMEOUT, "back on Settings");
    await h.settle();
    await clickLabel("Sign out");
    await page.waitFor(`!location.pathname.startsWith("/gym")`, 60000, "out of the gym portal");
    await signIn(identities.staff, "/gym");
    await h.settle();
    await openProfile();
    await h.expectText("Only the gym admin can change it.");
    // The description is the text box's value (page text leaves it out), and Staff can't type in it
    const box = await page.waitFor(`(() => { const el = document.querySelector('textarea[placeholder^="Eg. Two floors"]'); return el && el.value ? { value: el.value, readOnly: el.readOnly } : null; })()`, NAV_TIMEOUT, "the saved description");
    assert.deepEqual(box, { value: "Two floors, open since 2012.", readOnly: true });
    assert.equal(await hasLabel("Save profile"), false, "no Save");
    assert.equal(await hasLabel("Add a photo from the gallery"), false, "no photo buttons");
    await snapshotAllWidths("gym-profile-staff");
  }));
});
