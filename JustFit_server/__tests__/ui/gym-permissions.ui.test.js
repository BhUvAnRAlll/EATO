// Role & Permission in the real Expo web build against the isolated test server and the
// justfit_test database. The gym admin opens it from the ☰ menu, sees their Staff with "All
// areas", switches Payments and SMS off for one of them and saves. That Staff login then signs in:
// Home has no Wallet link, no Send Bulk SMS card and no Wallet tab, the ☰ menu has no SMS items,
// and opening the Wallet by its address gets the server's refusal. Screenshots at three widths.
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

describe("ui gym permissions: Role & Permission for Staff logins", () => {
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
    const labels = await page.evaluate(`JSON.stringify([...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute("aria-label")).filter((l) => /permission|wallet|sms|save|menu/i.test(l)))`).catch(() => "?");
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
    await h.settle(); // the layout moves back before anything is clicked
  };
  // Flips a Switch (a checkbox on the web) and waits until it reports the new state
  const toggle = async (label, on) => {
    await clickLabel(label);
    await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute("aria-label") === ${JSON.stringify(label)}); const box = el && (el.matches("input") ? el : el.querySelector("input")); return !!box && box.checked === ${on}; })()`, NAV_TIMEOUT, `${label} switched ${on ? "on" : "off"}`);
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
  const savedAreas = async (userId) => {
    const [[row]] = await connection.query("SELECT permissions FROM gym_staff WHERE user_id = ? AND gym_id = ?", [userId, state.gym]);
    return typeof row?.permissions === "string" ? JSON.parse(row.permissions) : row?.permissions ?? null;
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
    // Priya is Staff already (Staff / Admin Login has its own UI test)
    assert.equal((await apiAs("owner", "POST", "/api/gym/staff", { phone: identities.priya.phone, kind: "staff" })).status, 201);
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
        for (const table of ["gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
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

  it("1. the gym admin opens Role & Permission from the ☰ menu: their Staff, with every area so far", run("permissions-list", async () => {
    await viewport(390, 844);
    await signIn(identities.owner, "/gym");
    await h.expectText("Tumkur branch");
    await clickLabel("Menu");
    await h.expectText("Sign out");
    await h.settle(); // the menu slides in
    await clickLabel("Role & Permission");
    await page.waitFor(`location.pathname === "/gym/permissions"`, NAV_TIMEOUT, "Role & Permission");
    await h.expectText("Choose what each Staff login can open at the Tumkur branch");
    await h.expectText("STAFF (1)"); // the section title is set in capitals
    assert.ok(await hasLabel("Priya Sharma: All areas. Change permissions"), "Priya with every area");
    await snapshotAllWidths("gym-permissions-list");
  }));

  it("2. switching Payments and SMS off for Priya and saving", run("permissions-edit", async () => {
    await clickLabel("Priya Sharma: All areas. Change permissions");
    await h.expectText("What they can open in the gym portal. Home always stays.");
    await h.settle(); // the sheet slides up
    assert.equal(await page.evaluate(`document.querySelector('[aria-label="Save"]').getAttribute("aria-disabled")`), "true", "Save waits for a change");
    await snapshotAllWidths("gym-permissions-sheet");
    await toggle("Payments for Priya Sharma", false);
    await toggle("SMS for Priya Sharma", false);
    await page.waitFor(`document.querySelector('[aria-label="Save"]').getAttribute("aria-disabled") !== "true"`, NAV_TIMEOUT, "Save enabled");
    await clickLabel("Save");
    await h.expectText("Saved. Priya Sharma can open: Members, Enquiries, Plans / Catalogue, Attendance, Predictions.");
    assert.ok(await hasLabel("Priya Sharma: Members, Enquiries, Plans / Catalogue, Attendance, Predictions. Change permissions"), "the row says what's left");
    assert.deepEqual(await savedAreas(identities.priya.id), ["members", "enquiries", "catalog", "attendance", "predictions"]);
    await snapshotAllWidths("gym-permissions-saved");

    // Staff / Admin Login shows it too
    await page.navigate(`${expo.baseUrl}/gym/staff`);
    await h.expectText("Can open: Members, Enquiries, Plans / Catalogue, Attendance, Predictions");
  }));

  it("3. Priya's portal: no Wallet, no SMS; the Wallet by its address is refused by the server", run("permissions-staff-home", async () => {
    await signIn(identities.priya, "/gym");
    await h.expectText("Tumkur branch");
    await h.expectText("STAFF");
    await h.expectText("Today's counts");
    assert.equal(await hasLabel("Wallet"), false, "no Wallet link on the revenue card, no Wallet tab");
    assert.equal(await hasLabel("Send Bulk SMS. Auto reminders, alerts and wishes"), false, "no Send Bulk SMS card");
    assert.equal(await hasLabel("View all transactions"), false, "no Recent Transactions");
    assert.ok(await hasLabel("Search members"), "Members stays");
    assert.ok(await hasLabel("Manage"), "Manage stays (Members, Enquiries and the catalogue are on)");
    await snapshotAllWidths("gym-permissions-staff-home");

    await clickLabel("Menu");
    await h.expectText("Sign out");
    await h.settle();
    assert.equal(await hasLabel("Send Bulk SMS"), false, "no SMS in the menu");
    assert.equal(await hasLabel("Role & Permission"), false, "Staff don't set permissions");
    assert.ok(await hasLabel("Attendance"), "Attendance stays");
    await snapshotAllWidths("gym-permissions-staff-menu");
    await clickLabel("Close menu");
    await h.settle(); // the menu slides out before the page is reloaded

    await page.navigate(`${expo.baseUrl}/gym/wallet`);
    await h.expectText("Your login doesn't include Payments. Ask your gym admin.");
    await snapshotAllWidths("gym-permissions-refused");
    assert.equal((await apiAs("priya", "GET", "/api/gym/wallet")).status, 403);
    assert.equal((await apiAs("priya", "PUT", `/api/gym/staff/${identities.priya.id}/permissions`, { areas: [] })).status, 403, "Staff can't change permissions");
  }));
});
