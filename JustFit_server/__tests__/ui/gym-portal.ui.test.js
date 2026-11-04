// The gym admin portal (app/gym/) and Super Admin › Gyms in the real Expo web build against the
// isolated test server and the justfit_test database. A justFit admin's gym (created through the
// API) with a payment and a sale; its gym admin signs in onto Home showing those numbers, records
// an admission through the form, checks the member in, and reads Transactions, Wallet and
// the ☰ menu; Manage › Plan / Catalogue adds a plan the admission form then offers; the guards keep gym admins, members and admins in their own portals; the admin sees
// the gym's numbers on Gyms and the gym's page. Screenshots at three widths.
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

describe("ui gym portal: live gym data, the forms, the guards and the Super Admin view", () => {
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
  const clickLabel = async (label) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label") === ${JSON.stringify(label)})[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const hasLabel = (label) => page.evaluate(`!!document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`);
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
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Maya Ortiz", identities.admin.id]);
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency, profile_complete) VALUES (?, '1995-05-10', 'male', 'muscle_gain', 175, 70, '3-4', TRUE)", [identities.member.id]);
    // The admin's gym, its gym admin, a member who owes ₹1,500 and a shop sale
    const gym = await apiAs("admin", "POST", "/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "SIT Road", city: "Tumakuru" });
    assert.equal(gym.status, 201, JSON.stringify(gym.json));
    state.gym = gym.json.gym.id;
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/staff`, { phone: identities.gym.phone })).status, 201);
    // A second branch, so the gym admin can switch
    const second = await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/branches`, { branch: "Kunigal", area: "Main Road", city: "Kunigal" });
    state.branch2 = second.json.gym.id;
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.branch2}/staff`, { phone: identities.gym.phone })).status, 201);
    const asif = await apiAs("gym", "POST", "/api/gym/members", { name: "Mohammed Asif", phone: "9876543210", unit: "months", duration: 3, fee: 6000, paid: 4500, method: "online", dueBy: new Date(Date.now() + 8 * 86400000 + 19800000).toISOString().slice(0, 10) });
    assert.equal(asif.status, 201, JSON.stringify(asif.json));
    state.asif = asif.json.member.id;
    assert.equal((await apiAs("gym", "POST", "/api/gym/sales", { item: "Whey Protein 1kg", category: "supplement", amount: 3200, method: "cash" })).status, 201);
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
        const ids = [state.gym, state.branch2].filter(Boolean);
        const [[{ brand_id: brandId }]] = await connection.query("SELECT brand_id FROM gyms WHERE id = ?", [state.gym]);
        for (const table of ["gym_attendance", "gym_payments", "gym_enquiries", "gym_catalog_items", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [ids]);
        await connection.query("DELETE FROM gyms WHERE id IN (?)", [ids]);
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

  it("1. a gym admin lands on Home with the gym's own numbers", run("gym-home", async () => {
    await viewport(390, 844);
    await signIn(identities.gym, "/gym");
    await h.expectPath("/gym");
    await h.expectText("Arjun Kumar");
    await h.expectText("Tumkur branch");
    await h.expectText("FORMA");
    const revenue = JSON.stringify(`[aria-label^="Today's revenue ₹7,700"]`);
    await page.waitFor(`!!document.querySelector(${revenue})`, NAV_TIMEOUT, "today's revenue: 4,500 online + 3,200 cash");
    for (const label of ["1 Admission", "0 Renewal", "0 Enquiry", "0 Due Paid", "0 PT", "1 Product", "1 Due Members, Action", "0 Expiring Today, Urgent", "0 Attendance, Live", "0 Expiring in 1-3 days, Soon", "0 Birthdays Today, Wish"]) {
      assert.ok(await hasLabel(label), `${label} is shown`);
    }
    await h.expectText("Mohammed Asif");
    await h.expectText("Whey Protein 1kg");
    const tabs = await page.evaluate(`[...document.querySelectorAll('[role="tab"]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute("aria-label"))`);
    assert.deepEqual(tabs, ["Home", "Manage", "Wallet"]);
    assert.equal(await hasLabel("AI assistant"), false, "no AI button");
    await snapshotAllWidths("gym-home");
  }));

  it("2. + › Add Member: the profile with its automatic Member ID, then the plan, confirm, saved", run("gym-admission", async () => {
    await clickLabel("Add a member, plan, enquiry or payment");
    await h.expectText("Add Staff / Admin Login");
    await h.expectText("Biometric Attendance");
    await snapshotAllWidths("gym-add");
    await h.settle();
    await clickLabel("Add Member");
    await h.expectText("Add member profile.");
    await h.settle();
    await page.waitFor(`[...document.querySelectorAll("input")].some((i) => i.value === "FOR-TUM-0002")`, NAV_TIMEOUT, "the next Member ID, FOR-TUM-0002");
    await h.expectText("Member ID assigned automatically");
    await page.setInput(h.input("Name"), "Ravi Shankar");
    await page.setInput(h.input("Mobile Number"), "9123456789");
    await clickLabel("Male");
    await snapshotAllWidths("gym-add-member");
    await clickLabel("Proceed");
    await h.expectText("Optional fields");
    await page.setInput(h.input("Height (cm)"), "172");
    await page.setInput(h.input("Weight (kg)"), "70");
    await page.setInput(h.input("Notes"), "Knee injury");
    await snapshotAllWidths("gym-add-member-optional");
    await clickLabel("Proceed");
    await h.expectText("Joining Date");
    await h.expectText("Available Plans (0)");
    await clickLabel("Custom plan");
    await page.setInput(h.input("Duration (Eg. 6)"), "3");
    await page.setInput(h.input("Plan Fee (Eg. 1500)"), "4500");
    await page.setInput(h.input("Admission Amount"), "500");
    await page.setInput(h.input("Discount Amount"), "500");
    await clickLabel("CASH");
    await page.setInput(h.input("Amount Collected"), "4000");
    await page.waitFor(`!!document.querySelector('[aria-label="Due amount ₹500"]')`, NAV_TIMEOUT, "4500 + 500 − 500 payable, 4000 collected: ₹500 due");
    assert.ok(await page.evaluate(`!!document.querySelector('[aria-label="Amount payable ₹4,500"]')`));
    await h.expectText("Pay the rest by");
    await snapshotAllWidths("gym-admission");
    // The button is at the bottom of a scrolling sheet: bring it into view and let it settle first
    await page.evaluate(`document.querySelector('[aria-label="Add Member"]').scrollIntoView({ block: "center" })`);
    await h.settle();
    await clickLabel("Add Member");
    await h.expectText("Please confirm the details");
    await clickLabel("Confirm");
    await page.waitFor(`location.pathname.startsWith("/gym/members/")`, NAV_TIMEOUT, "the new member's page");
    await h.expectText("Owes ₹500");
    await h.expectText("FOR-TUM-0002");
    await h.expectText("Male");
    await h.expectText("172 cm · 70 kg");
    await h.expectText("Note: Knee injury");
    const [[row]] = await connection.query("SELECT COUNT(*) AS n FROM gym_payments WHERE gym_id = ? AND kind = 'admission' AND amount = 4000 AND method = 'cash'", [state.gym]);
    assert.equal(row.n, 1, "the payment was saved");
  }));

  it("3. checking the member in shows on their page and on Home", run("gym-checkin", async () => {
    await clickLabel("Check in for today");
    await h.expectText("Checked in for today.");
    assert.ok(await hasLabel("Checked in today"));
    await snapshotAllWidths("gym-member");
    await page.navigate(`${expo.baseUrl}/gym`);
    await page.waitFor(`!!document.querySelector('[aria-label="1 Attendance, Live"]')`, NAV_TIMEOUT, "attendance 1 on Home");
    assert.ok(await hasLabel("2 Admission"));
  }));

  it("4. Members, Transactions, Wallet and the ☰ menu", run("gym-lists", async () => {
    // Due Members opens the Payment Due Members sheet; a member's ⋯ opens their options; Collect Due
    await clickLabel("2 Due Members, Action");
    await h.expectText("Payment Due Members");
    await h.expectText("₹1,500 payment due");
    await h.expectText("₹500 payment due");
    await snapshotAllWidths("gym-due-members");
    await h.settle();
    await clickLabel("Ravi Shankar: options");
    await h.expectText("Send Due Reminder");
    await h.expectText("Collect Payment Due : ₹500");
    await h.expectText("Transaction History");
    await snapshotAllWidths("gym-member-options");
    await h.settle();
    await clickLabel("Collect Payment Due : ₹500");
    await h.expectText("Partial due amount collection is also supported");
    await h.settle();
    await snapshotAllWidths("gym-collect-due");
    await clickLabel("Collect Due");
    await page.waitFor(`!(document.body.innerText || "").includes("Partial due amount collection is also supported")`, NAV_TIMEOUT, "the Collect Due sheet closes");
    const [[ravi]] = await connection.query("SELECT due_amount, due_by FROM gym_members WHERE gym_id = ? AND full_name = 'Ravi Shankar'", [state.gym]);
    assert.deepEqual([ravi.due_amount, ravi.due_by], [0, null], "Ravi paid in full");
    await page.navigate(`${expo.baseUrl}/gym/members?filter=due`);
    await h.expectText("Mohammed Asif");
    await h.expectText("Owes ₹1,500");
    await snapshotAllWidths("gym-members");
    await page.navigate(`${expo.baseUrl}/gym/transactions`);
    await h.expectText("Ravi Shankar");
    await h.expectText("Whey Protein 1kg");
    await snapshotAllWidths("gym-transactions");
    await page.navigate(`${expo.baseUrl}/gym`);
    await clickTab("Wallet");
    await h.expectPath("/gym/wallet");
    await h.expectText("Owed by members");
    await h.expectText("₹12,200");
    await snapshotAllWidths("gym-wallet");
    await clickTab("Home");
    await clickLabel("Menu");
    await h.expectText("Forma · Tumkur branch");
    await h.expectText("Plans / Catalogue");
    await h.expectText("Sign out");
    await snapshotAllWidths("gym-menu");
    await clickLabel("Plans / Catalogue");
    await h.expectPath("/gym/manage");
  }));

  it("4c. Manage › Plan / Catalogue: add a plan, and the admission form offers it", run("gym-catalog", async () => {
    await h.expectText("Manager");
    await h.expectText("No membership plans yet");
    await clickLabel("Add a membership plan");
    await h.expectText("Add a membership plan for the outlet.");
    await page.setInput(h.input("Plan Name (Eg. 6 Months)"), "3 Months");
    await page.setInput(h.input("Duration (Eg. 6)"), "3");
    await page.setInput(h.input("Plan Amount (Eg. 500)"), "4000");
    await snapshotAllWidths("gym-add-plan");
    await clickLabel("Add Plan");
    await h.expectText("Please confirm the details");
    await h.expectText("₹4,000");
    await snapshotAllWidths("gym-confirm");
    await clickLabel("Confirm");
    await page.waitFor(`!!document.querySelector('[aria-label="3 Months, 3 Months, ₹4,000. Edit"]')`, NAV_TIMEOUT, "the new plan card");
    await snapshotAllWidths("gym-catalog");
    await page.navigate(`${expo.baseUrl}/gym/members`);
    await clickLabel("Add member");
    await h.expectText("Add member profile.");
    await h.settle();
    await page.setInput(h.input("Name"), "Plan Picker");
    await clickLabel("Proceed");
    await h.expectText("Optional fields");
    await clickLabel("Proceed");
    await h.expectText("Available Plans (1)");
    await clickLabel("3 Months, ₹4,000");
    await page.waitFor(`!!document.querySelector('[aria-label="Amount payable ₹4,000"]')`, NAV_TIMEOUT, "the plan's price is payable");
  }));

  it("4b. the branch switcher opens Kunigal's own numbers, then back to Tumkur", run("gym-branches", async () => {
    await page.navigate(`${expo.baseUrl}/gym`);
    await clickLabel("Tumkur branch, SIT Road, Tumakuru. Switch or edit branch");
    await h.expectPath("/gym/branches");
    await h.expectText("Kunigal branch");
    await snapshotAllWidths("gym-branches");
    await clickLabel("Kunigal branch, Main Road, Kunigal");
    await h.expectPath("/gym");
    await page.waitFor(`!!document.querySelector(${JSON.stringify('[aria-label^="Kunigal branch, Main Road, Kunigal. Switch"]')})`, NAV_TIMEOUT, "Kunigal open on Home");
    const empty = JSON.stringify(`[aria-label^="Today's revenue ₹0"]`);
    await page.waitFor(`!!document.querySelector(${empty})`, NAV_TIMEOUT, "Kunigal has no takings");
    await clickLabel("Kunigal branch, Main Road, Kunigal. Switch or edit branch");
    await clickLabel("Tumkur branch, SIT Road, Tumakuru");
    await h.expectText("Tumkur branch");
  }));

  it("5. a gym admin can't open the Super Admin portal or the member app", run("gym-guard", async () => {
    for (const route of ["/admin", "/home"]) {
      await page.navigate(`${expo.baseUrl}${route}`);
      await page.waitFor(`location.pathname.startsWith("/gym")`, NAV_TIMEOUT, `sent from ${route} back to the gym portal`);
    }
  }));

  it("6. the justFit admin sees the gym's numbers on Gyms and its page", run("admin-gyms", async () => {
    await signIn(identities.admin, "/admin");
    await clickTab("Gyms");
    await h.expectPath("/admin/gyms");
    await h.expectText("Tumkur branch · SIT Road, Tumakuru");
    await h.expectText("₹12,200 today");
    await snapshotAllWidths("admin-gyms");
    await clickLabel("Forma, Tumkur branch, SIT Road, Tumakuru. ₹12,200 today, 2 members, 1 in today");
    await page.waitFor(`location.pathname.startsWith("/admin/gyms/")`, NAV_TIMEOUT, "the gym's page");
    await h.expectText("Arjun Kumar");
    await h.expectText("Ravi Shankar");
    await h.expectText("Kunigal");
    await snapshotAllWidths("admin-gym");
  }));

  it("7. a member can't open the gym portal", run("member-guard", async () => {
    await signIn(identities.member, "/home");
    await page.navigate(`${expo.baseUrl}/gym`);
    await page.waitFor(`!location.pathname.startsWith("/gym")`, NAV_TIMEOUT, "sent away from /gym");
    assert.equal(await page.hasText("Today's Revenue"), false);
  }));
});
