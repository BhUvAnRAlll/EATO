// ☰ › Settings in the real Expo web build against the isolated test server and the justfit_test
// database. The gym admin sees every group (Branch, Attendance, Messages, Team, Account), each
// row opens its screen, and SMS & auto reminders opens the Bulk SMS sheet in place. A Staff login
// given only Members sees no gym-admin rows, no Attendance and no SMS. Sign out leaves the portal.
// Screenshots at three widths.
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

describe("ui gym settings: every group for the gym admin, rows open their screens, Staff see only theirs", () => {
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
        for (const table of ["gym_activity_log", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
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

  const ADMIN_ROWS = [
    "Branch details, Name, area and city",
    "Invoice details & logo, Address, phone, GSTIN and your logo",
    "Outlets, Switch branch or add one",
    "Location & Attendance, Gym location and check-in radius",
    "Attendance QR code, Show, print or regenerate",
    "SMS & auto reminders, Credits, reminders and message logs",
    "Reminder Templates, The wording of your reminders",
    "Staff / Admin Login, Who can sign in to your gym",
    "Role & Permission, What each Staff login can open",
    "Activity, Who added, edited or deleted what",
  ];
  const openSettings = async () => {
    await clickLabel("Menu");
    await h.expectText("Sign out");
    await h.settle(); // the menu slides in
    await clickLabel("Settings");
    await page.waitFor(`location.pathname === "/gym/settings"`, NAV_TIMEOUT, "the Settings screen");
    await h.expectText("Account");
  };
  const backToSettings = async () => {
    await clickLabel("Back");
    await page.waitFor(`location.pathname === "/gym/settings"`, NAV_TIMEOUT, "back on Settings");
    await h.settle();
  };

  it("1. ☰ › Settings lists every group and row for the gym admin, with the account", run("settings-owner", async () => {
    await viewport(390, 844);
    await signIn(identities.owner, "/gym");
    await h.expectText("Tumkur branch");
    await openSettings();
    for (const text of ["Branch", "Attendance", "Messages", "Team", "Forma · Gym admin"]) await h.expectText(text);
    for (const label of ADMIN_ROWS) assert.ok(await hasLabel(label), label);
    assert.ok(await hasLabel("Sign out"), "Sign out");
    await snapshotAllWidths("gym-settings");
  }));

  it("2. each row opens its screen, and Back returns to Settings", run("settings-rows", async () => {
    for (const [label, route] of [
      ["Branch details, Name, area and city", "/gym/details"],
      ["Outlets, Switch branch or add one", "/gym/branches"],
      ["Location & Attendance, Gym location and check-in radius", "/gym/attendance/settings"],
      ["Attendance QR code, Show, print or regenerate", "/gym/attendance/qr"],
      ["Staff / Admin Login, Who can sign in to your gym", "/gym/staff"],
      ["Role & Permission, What each Staff login can open", "/gym/permissions"],
      ["Activity, Who added, edited or deleted what", "/gym/activity"],
    ]) {
      await clickLabel(label);
      await page.waitFor(`location.pathname === ${JSON.stringify(route)}`, NAV_TIMEOUT, `${label} opens ${route}`);
      await h.settle();
      await backToSettings();
    }
  }));

  it("3. SMS & auto reminders opens the Bulk SMS sheet over Settings", run("settings-sms", async () => {
    await clickLabel("SMS & auto reminders, Credits, reminders and message logs");
    await h.expectText("Available Credits");
    assert.equal(await page.path(), "/gym/settings", "the sheet opens in place");
    await snapshotAllWidths("gym-settings-sms");
  }));

  it("4. a Staff login with only Members sees no gym-admin, Attendance, SMS or Reminder Templates rows", run("settings-staff", async () => {
    const set = await apiAs("owner", "PUT", `/api/gym/staff/${state.staffId}/permissions`, { areas: ["members"] });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    await signIn(identities.staff, "/gym");
    await h.settle(); // Home reads which areas this login has
    await openSettings();
    await h.expectText("Forma · Staff");
    assert.ok(await hasLabel("Outlets, Switch branch or add one"), "Outlets");
    // Reminder Templates is an option of its own since 2026-11-08 (templates.view): Members alone doesn't include it
    for (const label of ADMIN_ROWS.filter((l) => !l.startsWith("Outlets"))) assert.equal(await hasLabel(label), false, `${label} is hidden`);
    for (const title of ["Attendance", "Team"]) assert.equal(await page.evaluate(`[...document.querySelectorAll("div")].some((e) => e.children.length === 0 && e.textContent === ${JSON.stringify(title)})`), false, `${title} group hidden`);
    await snapshotAllWidths("gym-settings-staff");
  }));

  it("5. Sign out from Settings leaves the portal", run("settings-signout", async () => {
    await clickLabel("Sign out");
    await page.waitFor(`!location.pathname.startsWith("/gym")`, 60000, "out of the gym portal");
    await h.expectText("Log in");
  }));
  it("6. ☰ › Activity shows the gym admin who changed what (here, their own Role & Permission change)", run("settings-activity", async () => {
    await signIn(identities.owner, "/gym");
    await h.expectText("Tumkur branch");
    await clickLabel("Menu");
    await h.expectText("Sign out");
    await h.settle();
    await clickLabel("Activity");
    await page.waitFor(`location.pathname === "/gym/activity"`, NAV_TIMEOUT, "the Activity screen");
    await h.expectText("Changed Role & Permission");
    await h.expectText("Gym admin");
    await snapshotAllWidths("gym-activity");
    await page.clickText("Deleted");
    await h.expectText("Nothing matches these filters on this day.");
  }));
});
