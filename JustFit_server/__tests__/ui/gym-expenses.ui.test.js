// Manage › Expense in the real Expo web build against the isolated test server and the
// justfit_test database. The gym admin opens Expenses from the ☰ menu (empty month), adds rent
// through the sheet (category, amount, mode, confirm), sees the card and the month's total, opens
// it to edit (Delete is offered to the gym admin), and Wallet shows Expenses and the Net. Home's
// + › Add Expense opens the sheet straight away. Screenshots at three widths.
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

describe("ui gym expenses: Manage › Expense, the Add Expense sheet and Wallet's net", () => {
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
    const labels = await page.evaluate(`JSON.stringify([...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute("aria-label")).filter((l) => /expense|rent|wallet|net|confirm|menu/i.test(l)))`).catch(() => "?");
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
  const hasLabelStarting = (start) => page.evaluate(`[...document.querySelectorAll('[aria-label]')].some((e) => e.getClientRects().length > 0 && (e.getAttribute("aria-label") || "").startsWith(${JSON.stringify(start)}))`);

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
      for (const [tag, role] of [["owner", "gym_admin"], ["admin", "admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        sessions[tag] = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Arjun Kumar", identities.owner.id]);
    const gym = await apiAs("admin", "POST", "/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "SIT Road", city: "Tumakuru" });
    assert.equal(gym.status, 201, JSON.stringify(gym.json));
    state.gym = gym.json.gym.id;
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/staff`, { phone: identities.owner.phone })).status, 201);
    // One member's payment, so Wallet has takings to net the expense against
    assert.equal((await apiAs("owner", "POST", "/api/gym/members", { name: "Ravi Shankar", duration: 3, fee: 40000, paid: 40000, method: "online" })).status, 201);
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
        for (const table of ["gym_expenses", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
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

  it("1. the ☰ menu's Expenses opens the month's empty list", run("expenses-empty", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.owner);
    await page.waitFor(`location.pathname.startsWith("/gym")`, 60000, "the gym portal");
    await h.expectText("Tumkur branch");
    await clickLabel("Menu");
    await h.expectText("Sign out");
    await h.settle();
    await clickLabel("Expenses");
    await page.waitFor(`location.pathname === "/gym/expenses"`, NAV_TIMEOUT, "Expenses, over Home");
    await h.expectText("Nothing spent in");
    await h.expectText("Spent in");
    assert.ok(await hasLabel("Next month"), "the month picker");
    assert.ok(await hasLabel("Rent, 0"), "category chips with their counts");
    await snapshotAllWidths("gym-expenses-empty");
    // Its own screen over Home (like Likely to leave): Back returns to Home, then reopen it
    await clickLabel("Back");
    await page.waitFor(`location.pathname === "/gym"`, NAV_TIMEOUT, "back on Home");
    await h.expectText("Tumkur branch");
    await clickLabel("Menu");
    await h.expectText("Sign out");
    await h.settle();
    await clickLabel("Expenses");
    await page.waitFor(`location.pathname === "/gym/expenses"`, NAV_TIMEOUT, "Expenses again");
    await h.expectText("Nothing spent in");
  }));

  it("2. Add Expense: pick Rent, the amount and the mode, confirm; the card and the total follow", run("expenses-add", async () => {
    await clickLabel("Add an expense");
    await h.expectText("Record money the outlet spent.");
    await h.settle(); // the sheet slides up
    assert.equal(await page.evaluate(`document.querySelector('[aria-label="Add Expense"]').getAttribute("aria-disabled")`), "true", "Add waits for the category, amount and mode");
    await clickLabel("Rent");
    await page.setInput(h.input("What it was for (Eg. November rent, optional)"), "November rent");
    await page.setInput(h.input("Paid to (Eg. Landlord, Ravi, optional)"), "Landlord");
    await page.setInput(h.input("Amount (Eg. 25000)"), "25000");
    await clickLabel("ONLINE");
    await snapshotAllWidths("gym-expenses-sheet");
    await page.evaluate(`document.querySelector('[aria-label="Add Expense"]').scrollIntoView({ block: "center" })`);
    await h.settle();
    await clickLabel("Add Expense");
    await h.expectText("Please confirm the details");
    await snapshotAllWidths("gym-expenses-confirm");
    await clickLabel("Confirm");
    await h.expectNoText("Please confirm the details");
    await h.expectText("November rent");
    await h.expectText("Paid to Landlord");
    await h.expectText("−₹25,000");
    assert.ok(await hasLabel("Rent, 1"), "the Rent chip counts it");
    const [[row]] = await connection.query("SELECT category, title, paid_to, method, amount FROM gym_expenses WHERE gym_id = ?", [state.gym]);
    assert.deepEqual({ ...row }, { category: "rent", title: "November rent", paid_to: "Landlord", method: "online", amount: 25000 });
    await snapshotAllWidths("gym-expenses-list");
  }));

  it("3. the card opens Edit Expense with Delete for the gym admin", run("expenses-edit", async () => {
    assert.ok(await hasLabelStarting("November rent, Rent, ₹25,000, online"), "the card's label");
    await page.evaluate(`[...document.querySelectorAll('[aria-label]')].find((e) => (e.getAttribute("aria-label") || "").startsWith("November rent, Rent")).scrollIntoView({ block: "center" })`);
    await h.settle();
    const label = await page.evaluate(`[...document.querySelectorAll('[aria-label]')].find((e) => (e.getAttribute("aria-label") || "").startsWith("November rent, Rent")).getAttribute("aria-label")`);
    await clickLabel(label);
    await h.expectText("Change what was spent.");
    await h.settle();
    assert.ok(await hasLabel("Delete this expense"), "the gym admin may delete");
    await snapshotAllWidths("gym-expenses-edit");
    await clickLabel("Close");
    await h.expectNoText("Change what was spent.");
  }));

  it("4. Wallet's month shows the expenses and the net", run("expenses-wallet", async () => {
    await h.goto("/gym/wallet", "Admission"); // the card titles are set in capitals
    await h.expectText("Expenses");
    await h.expectText("−₹25,000");
    assert.ok(await hasLabel("Net after expenses: ₹15,000"), "₹40,000 collected − ₹25,000 spent");
    await snapshotAllWidths("gym-expenses-wallet");
  }));

  it("5. Home's + › Add Expense opens the sheet straight away", run("expenses-plus", async () => {
    await h.goto("/gym", "Tumkur branch");
    await clickLabel("Add a member, plan, enquiry or payment");
    await h.settle(); // the + sheet slides up
    await clickLabel("Add Expense");
    await page.waitFor(`location.pathname === "/gym/expenses"`, NAV_TIMEOUT, "Expenses, over Home");
    await h.expectText("Record money the outlet spent.");
  }));
});
