// Gym trainers (phase 2 of Staff / Admin Login) in the real Expo web build against the isolated
// test server and the justfit_test database. The gym admin picks a trainer on the PT form and
// changes a member's trainer from their ⋯; the trainer signs in to the member app with Home, Meals,
// Macro and My Clients (no AI Coach or Fitness, and their addresses send them Home), finds their
// clients (active and recently ended), searches, and opens one: PT dates, Call, WhatsApp and visits.
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

describe("ui gym trainers: the PT trainer picker and My Clients", () => {
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
  const signIn = async (identity, landing) => {
    await signInAs(page, h, identity);
    await page.waitFor(`location.pathname.startsWith(${JSON.stringify(landing)})`, 60000, `landing on ${landing}`);
    await h.settle();
  };

  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[role="tab"]')].filter((e) => e.getClientRects().length > 0 && (e.getAttribute("aria-label") || "").startsWith(${JSON.stringify(label)}))[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `the ${label} tab`);
    await page.clickAt(pos.x, pos.y);
  };
  const tabLabels = () => page.evaluate(`JSON.stringify([...document.querySelectorAll('[role="tab"]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute("aria-label")))`).then(JSON.parse);
  const admit = async (name, phone) => {
    const r = await apiAs("owner", "POST", "/api/gym/members", { name, phone, unit: "months", duration: 3, fee: 3000, paid: 3000, method: "cash" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.member.id;
  };
  const ptFor = (id, trainerId) => apiAs("owner", "POST", `/api/gym/members/${id}/pt`, { package: "1 Month PT", amount: 2500, method: "online", unit: "months", duration: 1, ...(trainerId === undefined ? {} : { trainerId }) });

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
      for (const [tag, role] of [["owner", "gym_admin"], ["ravi", undefined], ["admin", "admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        sessions[tag] = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Arjun Kumar", identities.owner.id]);
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Ravi Shetty", identities.ravi.id]);
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency, profile_complete) VALUES (?, '1994-08-02', 'male', 'muscle_gain', 178, 76, '5-6', TRUE)", [identities.ravi.id]);
    const gym = await apiAs("admin", "POST", "/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "SIT Road", city: "Tumakuru" });
    assert.equal(gym.status, 201, JSON.stringify(gym.json));
    state.gym = gym.json.gym.id;
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/staff`, { phone: identities.owner.phone })).status, 201);
    assert.equal((await apiAs("owner", "POST", "/api/gym/staff", { phone: identities.ravi.phone, kind: "trainer" })).status, 201);
    // Arjun's PT is with Ravi; Sneha's ended 5 days ago (with Ravi); Kiran has PT with no trainer
    state.arjun = await admit("Arjun Mehta", "9123456780");
    state.sneha = await admit("Sneha Rao", "9123456781");
    state.kiran = await admit("Kiran Patil", "9123456782");
    assert.equal((await ptFor(state.arjun, identities.ravi.id)).status, 200);
    assert.equal((await ptFor(state.sneha, identities.ravi.id)).status, 200);
    assert.equal((await ptFor(state.kiran)).status, 200);
    await connection.query("UPDATE gym_members SET pt_from = CURDATE() - INTERVAL 35 DAY, pt_until = CURDATE() - INTERVAL 5 DAY WHERE id = ?", [state.sneha]);
    assert.equal((await apiAs("owner", "POST", `/api/gym/members/${state.arjun}/check-in`)).status, 200);
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
        for (const table of ["gym_activity_log", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
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

  it("1. the PT form offers the branch's trainers, with the member's current one picked", run("trainer-pt", async () => {
    await viewport(390, 844);
    await signIn(identities.owner, "/gym");
    // The member's page shows the PT they bought: the package, its dates and the trainer
    await page.navigate(`${expo.baseUrl}/gym/members/${state.arjun}`);
    await h.expectText("PT · 1 Month PT");
    await h.expectText("Trainer: Ravi Shetty");
    await snapshotAllWidths("gym-trainer-member");
    await page.navigate(`${expo.baseUrl}/gym/members/${state.arjun}/pt`);
    await h.expectText("Personal training payment");
    await h.expectText("No trainer");
    await page.waitFor(`[...document.querySelectorAll('[aria-label="Ravi Shetty"]')].filter((e) => e.getClientRects().length > 0).some((e) => e.getAttribute("aria-checked") === "true")`, NAV_TIMEOUT, "Ravi picked already");
    await snapshotAllWidths("gym-trainer-pt");
  }));

  it("2. a member's ⋯ › Change Trainer gives Kiran a trainer", run("trainer-change", async () => {
    await page.navigate(`${expo.baseUrl}/gym/members/${state.kiran}`);
    await clickLabel("Kiran Patil: options");
    await h.expectText("SALES");
    await h.settle();
    await clickLabel("Change Trainer");
    await h.expectText("Their trainer sees them in My Clients");
    await h.settle();
    await clickLabel("Ravi Shetty");
    await snapshotAllWidths("gym-trainer-change");
    await clickLabel("Save trainer");
    // Saved: the sheets close; the member's ⋯ now names the trainer
    await page.waitFor(`!document.querySelector('[aria-label="Save trainer"]')`, NAV_TIMEOUT, "the sheet closes");
    assert.equal((await connection.query("SELECT pt_trainer_id FROM gym_members WHERE id = ?", [state.kiran]))[0][0].pt_trainer_id, identities.ravi.id);
    await h.settle();
    await clickLabel("Kiran Patil: options");
    await h.expectText("Change Trainer : Ravi Shetty");
    await h.expectText("1 Month PT · Ravi Shetty");
    await clickLabel("Close");
  }));

  it("3. the trainer's app: Home, Meals, Macro and My Clients; no AI Coach or Fitness", run("trainer-tabs", async () => {
    await signIn(identities.ravi, "/home");
    await page.waitFor(`[...document.querySelectorAll('[role="tab"]')].some((e) => e.getAttribute("aria-label") === "My Clients")`, NAV_TIMEOUT, "the My Clients tab");
    assert.deepEqual(await tabLabels(), ["Home", "Meals", "Macro", "My Clients"]);
    await snapshotAllWidths("trainer-home");
    for (const route of ["/workout", "/coach", "/coach/chat", "/fitness/search"]) {
      await page.navigate(`${expo.baseUrl}${route}`);
      await page.waitFor(`location.pathname === "/home"`, NAV_TIMEOUT, `${route} sends a trainer Home`);
    }
  }));

  it("4. My Clients: active first, ended in the last 30 days, search, and a client's page", run("trainer-clients", async () => {
    await clickTab("My Clients");
    await page.waitFor(`location.pathname === "/clients"`, NAV_TIMEOUT, "My Clients");
    await h.expectText("Forma · Tumkur");
    await h.expectText("ACTIVE PT (2)");
    await h.expectText("PT ENDED, LAST 30 DAYS (1)");
    await h.expectText("Ended 5 days ago");
    await h.expectText("✓ In today");
    await snapshotAllWidths("trainer-clients");
    await page.setInput(`input[aria-label="Search clients"]`, "sneha");
    await h.expectNoText("Arjun Mehta");
    await h.expectText("Sneha Rao");
    await page.setInput(`input[aria-label="Search clients"]`, "");
    await h.expectText("Arjun Mehta");

    await page.waitFor(`!!document.querySelector('[aria-label^="Arjun Mehta, "]')`, NAV_TIMEOUT, "Arjun's row");
    const label = await page.evaluate(`document.querySelector('[aria-label^="Arjun Mehta, "]').getAttribute("aria-label")`);
    await clickLabel(label);
    await page.waitFor(`location.pathname === "/clients/${state.arjun}"`, NAV_TIMEOUT, "Arjun's page");
    await h.expectText("PERSONAL TRAINING");
    await h.expectText("1 Month PT");
    await h.expectText("✓ Checked in today");
    assert.ok(await hasLabel("Call"));
    assert.ok(await hasLabel("WhatsApp"));
    assert.equal((await page.bodyText()).includes("₹"), false, "no money on a client's page");
    await snapshotAllWidths("trainer-client");
  }));
});
