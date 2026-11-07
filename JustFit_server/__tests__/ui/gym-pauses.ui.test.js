// Pause Membership in the real Expo web build against the isolated test server and justfit_test:
// a member opens Profile › Gym membership, asks for a pause with dates and a reason (Option A);
// the gym admin sees it on Home › Needs attention › Pause requests and approves it, which moves
// the plan's end out by the paused days; the member then sees the pause on their card.
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
const rules = require("../../gym/rules.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
// The web date picker is a real <input type="date"> inside the sheet
const DATE_INPUT = "[aria-modal] input";
const pretty = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

describe("ui pause membership: the member's request, the gym's approval, the member's card", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  const sessions = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();
  const from = rules.addDays(today, 2);
  const until = rules.addDays(today, 8); // 7 days

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 400).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | server log: ${(server?.logs ?? []).slice(-3).join(" | ")} | visible text: "${text}"`;
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
  const signIn = async (identity, landing) => {
    await signInAs(page, h, identity);
    await page.waitFor(`location.pathname.startsWith(${JSON.stringify(landing)})`, 60000, `landing on ${landing}`);
    await h.settle();
  };
  // Opens a date field, types the date into the sheet's input and closes it with Done
  const pickDate = async (fieldText, iso) => {
    await page.clickText(fieldText);
    await page.waitFor(`!!document.querySelector(${JSON.stringify(DATE_INPUT)})`, NAV_TIMEOUT, "the date sheet");
    await page.setInput(DATE_INPUT, iso);
    await page.clickText("Done");
    await h.expectNoText("Done");
    await h.settle();
  };
  const expiresOn = async () => (await connection.query("SELECT DATE_FORMAT(expires_on, '%Y-%m-%d') AS d FROM gym_members WHERE id = ?", [state.member]))[0][0].d;

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
      for (const [tag, role] of [["gym", "gym_admin"], ["member", undefined], ["admin", "admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        sessions[tag] = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Arjun Kumar", identities.gym.id]);
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Daniel Kim", identities.member.id]);
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency, profile_complete) VALUES (?, '1995-05-10', 'male', 'muscle_gain', 175, 70, '3-4', TRUE)", [identities.member.id]);
    const gym = await apiAs("admin", "POST", "/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "SIT Road", city: "Tumakuru" });
    assert.equal(gym.status, 201, JSON.stringify(gym.json));
    state.gym = gym.json.gym.id;
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/staff`, { phone: identities.gym.phone })).status, 201);
    const member = await apiAs("gym", "POST", "/api/gym/members", { name: "Daniel Kim", phone: identities.member.phone, duration: 3, fee: 3000, paid: 3000, method: "cash" });
    assert.equal(member.status, 201, JSON.stringify(member.json));
    state.member = member.json.member.id;
    state.until = member.json.member.expiresOn;
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
        for (const table of ["gym_membership_pauses", "gym_attendance", "gym_payments", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
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

  it("1. the member's Gym membership: the plan, its dates and Pause Membership", run("membership", async () => {
    await viewport(390, 844);
    await signIn(identities.member, "/home");
    await h.goto("/profile", "Gym membership");
    await page.clickText("Gym membership");
    await page.waitFor(`location.pathname === "/membership"`, NAV_TIMEOUT, "Gym membership");
    await h.expectText("Forma");
    await h.expectText("Tumkur · SIT Road, Tumakuru");
    await h.expectText("3 months plan");
    await h.expectText(`to ${pretty(state.until)}`);
    await h.expectText("Pause Membership");
    await snapshotAllWidths("membership");
  }));

  it("2. asking for a pause: the dates, the reason, the new end date, then the request waits", run("membership-pause", async () => {
    await page.clickText("Pause Membership");
    await page.waitFor(`location.pathname === "/membership/pause"`, NAV_TIMEOUT, "Pause Membership");
    await h.expectText(`Your plan ends on ${pretty(state.until)}`);
    await pickDate("Pause from", from);
    await h.expectText(pretty(from));
    await pickDate("Pause until", until);
    await page.setInput('textarea[placeholder="Travelling, unwell, exams…"]', "Travelling for work");
    await h.expectText(`7 days paused. Your plan would then end on ${pretty(rules.addDays(state.until, 7))}.`);
    await snapshotAllWidths("membership-pause");
    await page.clickText("Send pause request");
    await page.waitFor(`location.pathname === "/membership"`, NAV_TIMEOUT, "back to Gym membership");
    await h.expectText(`Pause requested for ${pretty(from)} to ${pretty(until)} (7 days). Waiting for Forma to approve.`);
    await h.expectText("Reason: Travelling for work");
    await h.expectText("Cancel request");
    assert.equal(await expiresOn(), state.until, "nothing changes until the gym approves");
    await snapshotAllWidths("membership-requested");
  }));

  it("3. the gym admin: Home counts the request, Pause requests approves it, the plan moves out", run("gym-pauses", async () => {
    await signIn(identities.gym, "/gym");
    await h.expectText("Tumkur branch");
    await clickLabel("1 Pause requests, Review");
    await page.waitFor(`location.pathname === "/gym/pauses"`, NAV_TIMEOUT, "Pause requests");
    await h.expectText("Daniel Kim");
    await h.expectText("Reason: Travelling for work");
    await h.expectText(`Plan ends on ${pretty(state.until)} now; ${pretty(rules.addDays(state.until, 7))} once approved.`);
    await snapshotAllWidths("gym-pauses");
    await clickLabel("Approve Daniel Kim's pause");
    await h.expectText("Tap again to approve");
    await clickLabel("Confirm: approve Daniel Kim's pause");
    await h.expectText("No requests waiting");
    assert.equal(await expiresOn(), rules.addDays(state.until, 7), "7 days added to the plan");
    await snapshotAllWidths("gym-pauses-approved");
    // The member's page says so
    await page.navigate(`${expo.baseUrl}/gym/members/${state.member}`);
    await h.expectText(`Pause ${pretty(from)} to ${pretty(until)} (7 days added to the plan)`);
    await h.expectText(`Until ${pretty(rules.addDays(state.until, 7))}`);
    await snapshotAllWidths("gym-member-paused");
  }));

  it("4. the member sees the approved pause and the later end date", run("membership-paused", async () => {
    await signIn(identities.member, "/home");
    await h.goto("/membership", "Gym membership");
    await h.expectText(`Paused from ${pretty(from)} to ${pretty(until)} (7 days). Those days are added to your plan.`);
    await h.expectText(`to ${pretty(rules.addDays(state.until, 7))}`);
    assert.equal(await page.hasText("Pause Membership"), false, "no second request while one is open");
    await snapshotAllWidths("membership-paused");
  }));
});
