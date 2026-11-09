// The gym admin portal (app/gym/) and Super Admin › Gyms in the real Expo web build against the
// isolated test server and the justfit_test database. A justFit admin's gym (created through the
// API) with a payment and a sale; its gym admin signs in onto Home showing those numbers, records
// an admission through the form, checks the member in, and reads Transactions, Wallet and
// the ☰ menu; Manage › Plans / Catalogue adds a plan the admission form then offers; Manage ›
// Member sends a reminder SMS and Send Bulk SMS runs Auto Reminders, Manual Send and Message Logs
// on the fake SMS provider; the guards keep gym admins, members and admins in their own portals; the admin sees
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
const { png, body: imageBody } = require("../e2e/images.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];

describe("ui gym portal: live gym data, the forms, the guards and the Super Admin view", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h, imageDir;
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
  // The element must hold still between two reads (a viewport change for the screenshots, or a
  // sheet still sliding in, moves it: a click at the first position then landed beside it, so
  // Female and Close Send Reminder went unheard, QA 2026-11-07)
  const clickLabel = async (label) => {
    const locate = `(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label") === ${JSON.stringify(label)})[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;
    let pos = await page.waitFor(locate, NAV_TIMEOUT, `element labelled ${label}`);
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((r) => setTimeout(r, 150));
      const again = await page.evaluate(locate);
      if (again && Math.abs(again.x - pos.x) < 1 && Math.abs(again.y - pos.y) < 1) break;
      pos = again ?? pos;
    }
    await page.clickAt(pos.x, pos.y);
  };
  const hasLabel = (label) => page.evaluate(`!!document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`);
  // For a label that settles after a fetch (the Send via sheet's "Checking credits…" → "No credits left")
  const waitLabel = (label) => page.waitFor(`!!document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`, NAV_TIMEOUT, `element labelled ${label}`);
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
    // Catalogue item images go to a throwaway folder, never the repo's uploads/
    imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-gym-ui-images-"));
    server = await startTestServer({ ...env, CATALOG_IMAGE_DIR: imageDir });
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
    await step("remove the image folder", () => { if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true }); });
    await step("rows", async () => {
      if (!connection) return;
      if (state.gym) {
        const ids = [state.gym, state.branch2].filter(Boolean);
        const [[{ brand_id: brandId }]] = await connection.query("SELECT brand_id FROM gyms WHERE id = ?", [state.gym]);
        for (const table of ["gym_activity_log", "gym_sms_log", "gym_sms_settings", "gym_attendance", "gym_payments", "gym_enquiry_contacts", "gym_enquiries", "gym_catalog_items", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [ids]);
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
    // Home's header shows the gym's name; the admin is the account badge's initials (Arjun Kumar)
    await h.expectText("AK");
    await h.expectText("Tumkur branch");
    await h.expectText("FORMA");
    const revenue = JSON.stringify(`[aria-label^="Today's revenue ₹7,700"]`);
    await page.waitFor(`!!document.querySelector(${revenue})`, NAV_TIMEOUT, "today's revenue: 4,500 online + 3,200 cash");
    for (const label of ["1 Admission", "0 Renewal", "0 Enquiry", "0 Due Paid", "0 PT", "1 Product", "1 Due Members, Action", "0 Expiring Today, Urgent", "0 Attendance, Live", "0 Expiring soon, Soon", "0 Birthdays Today, Wish"]) {
      assert.ok(await hasLabel(label), `${label} is shown`);
    }
    await h.expectText("Mohammed Asif");
    await h.expectText("Whey Protein 1kg");
    const tabs = await page.evaluate(`[...document.querySelectorAll('[role="tab"]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute("aria-label"))`);
    assert.deepEqual(tabs, ["Home", "Manage", "Wallet"]);
    assert.equal(await hasLabel("AI assistant"), false, "no AI button");
    // QA 2026-11-04: on the web the gradient painted over the icons on it (the active tab, +), and
    // the icons' native-only props raised a React error whose toast covered the Wallet tab
    // Painted over the gradient: the icon's box is positioned and comes after the gradient's
    const iconOnTop = (selector) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return "missing"; const grad = el.querySelector('rect[fill^="url"]'); if (!grad) return "no gradient"; const gradBox = grad.closest("svg").parentElement; const svgs = [...el.querySelectorAll("svg")]; const box = svgs[svgs.length - 1].parentElement; const ok = box !== gradBox && getComputedStyle(box).position !== "static" && Boolean(gradBox.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING); return ok || JSON.stringify({ svgs: svgs.length, same: box === gradBox, pos: getComputedStyle(box).position, rel: gradBox.compareDocumentPosition(box), boxHtml: box.outerHTML.slice(0, 300), gradHtml: gradBox.outerHTML.slice(0, 200) }); })()`);
    assert.equal(await iconOnTop('[role="tab"][aria-label="Home"]'), true, "the active tab's icon is drawn over its gradient");
    assert.equal(await iconOnTop('[aria-label="Add a member, plan, enquiry or payment"]'), true, "the + icon is drawn over its gradient");
    assert.equal(await page.evaluate(`[...document.querySelectorAll("*")].some((e) => /React does not recognize/.test(e.textContent || "") && e.children.length < 6)`), false, "no React prop error on Home");
    await snapshotAllWidths("gym-home");
  }));

  it("2. + › Add Member: the profile with its automatic Member ID, then the plan, confirm, saved", run("gym-admission", async () => {
    await clickLabel("Add a member, plan, enquiry or payment");
    await h.expectText("Add Staff / Admin Login");
    await h.expectText("Attendance");
    assert.equal(await page.hasText("Biometric"), false, "no biometric attendance");
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
    await clickLabel("CASH");
    await page.setInput(h.input("Amount Collected"), "4000");
    await page.waitFor(`!!document.querySelector('[aria-label="Due amount ₹500"]')`, NAV_TIMEOUT, "4500 payable, 4000 collected: ₹500 due");
    assert.ok(await page.evaluate(`!!document.querySelector('[aria-label="Amount payable ₹4,500"]')`));
    await h.expectText("Pay the rest by");
    await h.expectText("Attach the payment bill");
    await snapshotAllWidths("gym-admission");
    // The button is at the bottom of a scrolling sheet: bring it into view and let it settle first
    await page.evaluate(`document.querySelector('[aria-label="Add Member"]').scrollIntoView({ block: "center" })`);
    await h.settle();
    await clickLabel("Add Member");
    await h.expectText("Please confirm the details");
    await clickLabel("Confirm");
    await page.waitFor(`location.pathname.startsWith("/gym/members/")`, NAV_TIMEOUT, "the new member's page");
    await h.expectText("Due ₹500");
    await h.expectText("FOR-TUM-0002");
    await h.expectText("Male");
    await h.expectText("172 cm · 70 kg");
    await h.expectText("Note: Knee injury");
    const [[row]] = await connection.query("SELECT COUNT(*) AS n FROM gym_payments WHERE gym_id = ? AND kind = 'admission' AND amount = 4000 AND method = 'cash'", [state.gym]);
    assert.equal(row.n, 1, "the payment was saved");
  }));

  it("3. checking the member in shows on their page and on Home", run("gym-checkin", async () => {
    await clickLabel("Check in");
    await h.expectText("Checked in.");
    assert.ok(await hasLabel("Check out"), "the button turns into Check out");
    await snapshotAllWidths("gym-member");
    await page.navigate(`${expo.baseUrl}/gym`);
    await page.waitFor(`!!document.querySelector('[aria-label="1 Attendance, Live"]')`, NAV_TIMEOUT, "attendance 1 on Home");
    assert.ok(await hasLabel("2 Admission"));
  }));

  it("3b. Attendance: the dashboard, location and radius, the QR code, a staff check-out and history", run("gym-attendance", async () => {
    await page.navigate(`${expo.baseUrl}/gym/attendance`);
    await h.expectText("INSIDE NOW (1)");
    await h.expectText("Ravi Shankar");
    await h.expectText("Set your gym's location and attendance radius first");
    // Statistics: Today / Last 7 days / Last 30 days, the chart following the period (2026-11-07)
    await h.expectText("Check-ins by hour, today");
    await page.clickText("Last 7 days");
    await h.expectText("Visits, last 7 days");
    await page.clickText("Last 30 days");
    await h.expectText("Visits, last 30 days");
    await snapshotAllWidths("gym-attendance-stats-30-days");
    await page.clickText("Today");
    assert.ok(await hasLabel("1 Inside now"));
    assert.ok(await hasLabel("1 Check-ins today"));
    await snapshotAllWidths("gym-attendance");

    // Settings: the coordinates (the web build has no map), a 150 m radius, saved
    await clickLabel("Gym location and attendance settings");
    await page.waitFor(`location.pathname === "/gym/attendance/settings"`, NAV_TIMEOUT, "the settings screen");
    await h.expectText("No location saved yet");
    await h.expectText("Attendance radius: 100 m");
    await page.setInput(h.input("13.339200"), "13.3392");
    await page.setInput(h.input("77.101200"), "77.1012");
    await page.setInput(h.input("100"), "5000");
    await h.expectText("Enter 20 to 1000 metres.");
    await page.setInput(h.input("100"), "150");
    await h.expectText("Members must be within 150 m of the pin");
    await snapshotAllWidths("gym-attendance-settings");
    await clickLabel("Save Location & Settings");
    await h.expectText("Saved: 13.339200, 77.101200 · 150 m radius");
    const [[place]] = await connection.query("SELECT latitude, longitude, attendance_radius_m FROM gyms WHERE id = ?", [state.gym]);
    assert.deepEqual([Number(place.latitude), Number(place.longitude), place.attendance_radius_m], [13.3392, 77.1012, 150]);

    // The QR code: none yet, then created
    await page.navigate(`${expo.baseUrl}/gym/attendance/qr`);
    await h.expectText("No QR code yet");
    await clickLabel("Create QR code");
    await h.expectText("Scan with the justFit app to check in and check out");
    await h.expectText("Code 1");
    assert.ok(await hasLabel("Regenerate QR code"));
    const [[qr]] = await connection.query("SELECT qr_version FROM gyms WHERE id = ?", [state.gym]);
    assert.equal(qr.qr_version, 1);
    await snapshotAllWidths("gym-attendance-qr");

    // Back on the dashboard: set up, and the front desk checks Ravi out
    await page.navigate(`${expo.baseUrl}/gym/attendance`);
    await h.expectText("INSIDE NOW (1)");
    assert.equal(await page.hasText("Set your gym's location"), false);
    await clickLabel("Check out Ravi Shankar");
    await h.expectText("Nobody is checked in right now.");
    await h.expectText("INSIDE NOW (0)");
    await page.waitFor(`!!document.querySelector('[aria-label^="Ravi Shankar, FOR-TUM-0002. Completed."]')`, NAV_TIMEOUT, "the completed visit in the history");
    assert.ok(await hasLabel("Export to Excel"));
    await clickLabel("Completed");
    await h.expectText("1 visit");
    // Inside selects Today and locks the other ranges (2026-11-07, the user's rule)
    await clickLabel("7 days");
    await page.waitFor(`document.querySelector('[aria-label="7 days"]').getAttribute("aria-checked") === "true"`, NAV_TIMEOUT, "7 days picked");
    await clickLabel("Inside");
    await page.waitFor(`document.querySelector('[aria-label="Today"]').getAttribute("aria-checked") === "true"`, NAV_TIMEOUT, "Inside switches the range to Today");
    for (const label of ["7 days", "30 days", "Custom"]) {
      assert.equal(await page.evaluate(`document.querySelector('[aria-label="${label}"]').getAttribute("aria-disabled")`), "true", `${label} can't be picked while Inside is`);
    }
    await h.expectText("No check-ins match these filters.");
    await clickLabel("Completed");
    // The web build drops aria-disabled when it's false, so it reads null here
    assert.notEqual(await page.evaluate(`document.querySelector('[aria-label="7 days"]').getAttribute("aria-disabled")`), "true", "the ranges are back");
    await h.expectText("1 visit");
    await page.setInput(`input[placeholder="Search a member by name or ID"]`, "nobody-like-this");
    await h.expectText("No check-ins match these filters.");
    const [[visit]] = await connection.query("SELECT status, in_source, out_source, duration_min FROM gym_attendance WHERE gym_id = ?", [state.gym]);
    assert.deepEqual([visit.status, visit.in_source, visit.out_source], ["completed", "staff", "staff"]);

    // The member's own attendance history
    await page.navigate(`${expo.baseUrl}/gym/members`);
    await h.expectText("Ravi Shankar");
    const [[ravi]] = await connection.query("SELECT id FROM gym_members WHERE gym_id = ? AND full_name = 'Ravi Shankar'", [state.gym]);
    await page.navigate(`${expo.baseUrl}/gym/members/${ravi.id}`);
    await clickLabel("Attendance history");
    await page.waitFor(`location.pathname === "/gym/attendance/member/${ravi.id}"`, NAV_TIMEOUT, "the member's attendance history");
    await h.expectText("Ravi Shankar: attendance");
    await h.expectText("1 visit");
    await snapshotAllWidths("gym-attendance-member");
    // Back to Home for the next steps; the visit still counts as today's attendance
    await page.navigate(`${expo.baseUrl}/gym`);
    await page.waitFor(`!!document.querySelector('[aria-label="1 Attendance, Live"]')`, NAV_TIMEOUT, "attendance 1 on Home");
    assert.ok(await hasLabel("2 Admission"));
    await h.settle();
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
    // Send Due Reminder opens Send Reminder: the member's card, the channels (WhatsApp picked;
    // SMS goes from the phone while there are no credits; Notification coming soon) and the
    // message filled from the Payment due template
    await clickLabel("Send Due Reminder");
    await h.expectText("Notify member about payment or membership");
    await h.settle(); // the sheet slides in before its tiles can be tapped
    await h.expectText("Payment Due");
    await h.expectText("Select one or more channels");
    assert.match(await page.evaluate(`document.querySelector('[aria-label="Message"]').value`), /A payment of ₹500 is due/);
    assert.ok(await hasLabel("Notification, coming soon"));
    await clickLabel("Send by SMS");
    await h.expectText("No credits left: opens your phone's Messages app");
    await clickLabel("Use Template");
    await h.expectText("Membership expiry");
    await snapshotAllWidths("gym-send-via");
    await clickLabel("Close Send Reminder");
    await page.waitFor(`!(document.body.innerText || "").includes("Notify member about payment or membership")`, NAV_TIMEOUT, "the Send Reminder sheet closes");
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
    await h.expectText("₹1,500 due"); // the compact card's pill (2026-11-07)
    await snapshotAllWidths("gym-members");
    // Expiring soon: the window follows the day chips (Asif's plan is moved to end in 10 days,
    // so he is outside the 3-day window Home opens and inside 30 days), then put back
    const [[asifRow]] = await connection.query("SELECT id, DATE_FORMAT(expires_on, '%Y-%m-%d') AS expires_on FROM gym_members WHERE gym_id = ? AND full_name = 'Mohammed Asif'", [state.gym]);
    const todayInIndia = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
    await connection.query("UPDATE gym_members SET expires_on = DATE_ADD(?, INTERVAL 10 DAY) WHERE id = ?", [todayInIndia, asifRow.id]);
    await page.navigate(`${expo.baseUrl}/gym/members?filter=expiring_soon&days=3`);
    await h.expectText("Ending in");
    assert.ok(await hasLabel("Expiring soon, in the next 3 days"));
    await h.expectText("No plans end in the next 3 days");
    await clickLabel("Next 30 days");
    await page.waitFor(`!!document.querySelector('[aria-label="Expiring soon, in the next 30 days"]')`, NAV_TIMEOUT, "the chip follows the pick");
    await h.expectText("Mohammed Asif");
    await snapshotAllWidths("gym-members-expiring-soon");
    // All: every plan still running (Ravi's too)
    await clickLabel("All plans still running");
    await page.waitFor(`!!document.querySelector('[aria-label="Expiring soon, every plan still running"]')`, NAV_TIMEOUT, "the chip follows All");
    await h.expectText("Ravi Shankar");
    await h.expectText("Mohammed Asif");
    await connection.query("UPDATE gym_members SET expires_on = ? WHERE id = ?", [asifRow.expires_on, asifRow.id]);
    await page.navigate(`${expo.baseUrl}/gym/transactions`);
    await h.expectText("Ravi Shankar");
    await h.expectText("Whey Protein 1kg");
    await snapshotAllWidths("gym-transactions");
    await page.navigate(`${expo.baseUrl}/gym`);
    await clickTab("Wallet");
    // The tab shows Wallet (the web address can stay /gym after a tab switch)
    await h.expectText("Due from members");
    await h.expectText("₹12,200");
    await snapshotAllWidths("gym-wallet");
    await clickTab("Home");
    await clickLabel("Menu");
    await h.expectText("Forma · Tumkur branch");
    await h.expectText("Plans / Catalogue");
    await h.expectText("Sign out");
    await snapshotAllWidths("gym-menu");
    await clickLabel("Plans / Catalogue");
    await h.expectPath("/gym/catalog");
  }));

  it("4c. Manage › Plan / Catalogue: add a plan, and the admission form offers it", run("gym-catalog", async () => {
    await h.expectText("Plans / Catalogue"); // the section's title (Manage has no top tabs)
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

  it("4d. PT, Service and Product cards, then a member's ⋯ › Sell Product takes one out of stock", run("gym-sell", async () => {
    for (const item of [
      { kind: "pt", name: "1 Month PT", unit: "months", duration: 1, price: 5000 },
      { kind: "service", name: "Diet Consultation", price: 1000 },
      { kind: "product", name: "Whey Protein 1kg", price: 3200, stock: 18 },
      { kind: "product", name: "Shaker Bottle", price: 350, stock: 40 },
    ]) assert.equal((await apiAs("gym", "POST", "/api/gym/catalog", item)).status, 201, JSON.stringify(item));
    // The PT package gets a brochure photo (the sheet's picker can't be driven here, so by the API)
    const ptItem = (await apiAs("gym", "GET", "/api/gym/catalog")).json.items.find((i) => i.name === "1 Month PT");
    assert.equal((await apiAs("gym", "PUT", `/api/gym/catalog/${ptItem.id}/image`, imageBody(png(400, 240, [79, 70, 229]), "image/png"))).status, 200);
    await page.navigate(`${expo.baseUrl}/gym/manage?tab=catalog`);
    await h.expectText("Plans / Catalogue"); // the section's title (Manage has no top tabs)
    await clickLabel("PT");
    await page.waitFor(`!!document.querySelector('[aria-label="1 Month PT, 1 Month, ₹5,000, with image. Edit"]')`, NAV_TIMEOUT, "the PT card with its length and its image");
    await snapshotAllWidths("gym-catalog-pt");
    // Edit shows the image with Retake, Gallery and Remove; Remove then Save takes it off
    await clickLabel("1 Month PT, 1 Month, ₹5,000, with image. Edit");
    await h.expectText("Image or brochure (optional)");
    assert.ok(await hasLabel("Item image, chosen"), "the saved image shows on the sheet");
    assert.ok(await hasLabel("Remove the image"));
    await snapshotAllWidths("gym-edit-pt-image");
    await clickLabel("Remove the image");
    assert.ok(await hasLabel("Item image, none yet"), "removed on the sheet, not saved yet");
    await clickLabel("Save changes");
    await h.expectText("Please confirm the details");
    await h.expectText("Removed");
    await clickLabel("Confirm");
    await page.waitFor(`!!document.querySelector('[aria-label="1 Month PT, 1 Month, ₹5,000. Edit"]')`, NAV_TIMEOUT, "the PT card without its image");
    assert.equal((await apiAs("gym", "GET", "/api/gym/catalog")).json.items.find((i) => i.id === ptItem.id).imageUrl, null, "the image is gone on the server");
    assert.equal(fs.readdirSync(imageDir).filter((f) => !f.startsWith(".")).length, 0, "and its file was deleted");
    await clickLabel("Service");
    await page.waitFor(`!!document.querySelector('[aria-label="Diet Consultation, ₹1,000. Edit"]')`, NAV_TIMEOUT, "the service card, no pill");
    await snapshotAllWidths("gym-catalog-service");
    await clickLabel("Product");
    await page.waitFor(`!!document.querySelector('[aria-label="Whey Protein 1kg, 18 in stock, ₹3,200. Edit"]')`, NAV_TIMEOUT, "the product card with its stock");
    await h.expectText("40 in stock");
    await snapshotAllWidths("gym-catalog-product");

    // The member's ⋯ › Sales › Sell Product
    await page.navigate(`${expo.baseUrl}/gym/members/${state.asif}`);
    await clickLabel("Mohammed Asif: options");
    await h.expectText("Add Service");
    await h.settle();
    await snapshotAllWidths("gym-member-sales");
    await h.settle();
    await clickLabel("Sell Product");
    await h.expectText("Sell a product to this member");
    await h.expectText("Available Products (2)");
    await h.settle();
    await snapshotAllWidths("gym-sell-product");
    await clickLabel("Whey Protein 1kg, ₹3,200");
    await page.waitFor(`[...document.querySelectorAll("input")].some((i) => i.value === "18")`, NAV_TIMEOUT, "18 in stock shown");
    await page.waitFor(`!!document.querySelector('[aria-label="Amount payable ₹3,200"]') && !!document.querySelector('[aria-label="Due amount ₹3,200"]')`, NAV_TIMEOUT, "the product's price is payable and due");
    await snapshotAllWidths("gym-sell-product-picked");
    await page.setInput(h.input("Quantity"), "2");
    await page.setInput(h.input("Discount Amount"), "400");
    await clickLabel("CASH");
    await page.setInput(h.input("Amount Collected"), "6000");
    await page.waitFor(`!!document.querySelector('[aria-label="Amount payable ₹6,000"]') && !!document.querySelector('[aria-label="Due amount ₹0"]')`, NAV_TIMEOUT, "2 × 3200 − 400 = 6000, all collected");
    // The sheet's button shares its words with the row beneath: press the last one (the sheet on top)
    const pos = await page.evaluate(`(() => { const el = [...document.querySelectorAll('[aria-label="Sell Product"]')].filter((e) => e.getClientRects().length > 0).pop(); el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await h.settle();
    await page.clickAt(pos.x, pos.y);
    await page.waitFor(`!(document.body.innerText || "").includes("Sell a product to this member")`, NAV_TIMEOUT, "the Sell Product sheet closes");
    const [[sale]] = await connection.query("SELECT kind, title, detail, method, amount FROM gym_payments WHERE gym_id = ? AND member_id = ? AND kind = 'sale'", [state.gym, state.asif]);
    assert.deepEqual({ ...sale }, { kind: "sale", title: "Mohammed Asif", detail: "Whey Protein 1kg × 2", method: "cash", amount: 6000 });
    const [[whey]] = await connection.query("SELECT stock FROM gym_catalog_items WHERE gym_id = ? AND name = 'Whey Protein 1kg'", [state.gym]);
    assert.equal(whey.stock, 16, "two taken out of stock");
    await h.expectText("Whey Protein 1kg × 2");
  }));

  it("4d2. a member's ⋯ › Edit Profile: the filled-in profile, gender and height changed, saved", run("gym-edit-profile", async () => {
    await page.navigate(`${expo.baseUrl}/gym/members/${state.asif}`);
    await clickLabel("Mohammed Asif: options");
    await h.expectText("Edit Profile");
    await h.settle();
    await clickLabel("Edit Profile");
    await h.expectText("Update member profile.");
    // Filled in from the member: the name, the number and the Member ID (read only)
    await page.waitFor(`[...document.querySelectorAll("input")].some((i) => i.value === "Mohammed Asif") && [...document.querySelectorAll("input")].some((i) => i.value === "9876543210")`, NAV_TIMEOUT, "the name and number filled in");
    const [[before]] = await connection.query("SELECT member_code FROM gym_members WHERE id = ?", [state.asif]);
    assert.ok(await page.evaluate(`[...document.querySelectorAll("input")].some((i) => i.value === ${JSON.stringify(before.member_code)} && i.readOnly)`), "the Member ID shown, not editable");
    await snapshotAllWidths("gym-edit-profile");
    await clickLabel("Female");
    await page.setInput(h.input("Height (cm)"), "170");
    await page.setInput(h.input("Email"), "asif@example.com");
    await page.evaluate(`document.querySelector('[aria-label="Save Changes"]').scrollIntoView({ block: "center" })`);
    await h.settle();
    await clickLabel("Save Changes");
    await page.waitFor(`!(document.body.innerText || "").includes("Update member profile.")`, NAV_TIMEOUT, "the Edit Profile sheet closes");
    const [[asif]] = await connection.query("SELECT full_name, phone, gender, height_cm, email, member_code FROM gym_members WHERE id = ?", [state.asif]);
    assert.deepEqual({ ...asif }, { full_name: "Mohammed Asif", phone: "9876543210", gender: "female", height_cm: 170, email: "asif@example.com", member_code: before.member_code });
    await h.expectText("Female");
    await h.expectText("170 cm");
  }));

  it("4e. Manage › Member reminders, then Send Bulk SMS: credits, Auto Reminders, Manual Send, Message Logs", run("gym-sms", async () => {
    // The justFit team has given the branch 5 credits; Karthik's plan ended 6 days ago
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/sms-credits`, { credits: 5 })).status, 200);
    const karthik = await apiAs("gym", "POST", "/api/gym/members", { name: "Karthik Raja", phone: "9811122233", unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash" });
    assert.equal(karthik.status, 201, JSON.stringify(karthik.json));
    const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
    await connection.query("UPDATE gym_members SET expires_on = DATE_SUB(?, INTERVAL 6 DAY) WHERE id = ?", [today, karthik.json.member.id]);
    // His payment would change the takings the later steps check
    await connection.query("DELETE FROM gym_payments WHERE member_id = ?", [karthik.json.member.id]);
    const credits = async () => (await connection.query("SELECT sms_credits FROM gyms WHERE id = ?", [state.gym]))[0][0].sms_credits;
    // window.alert would block the page: keep its messages instead
    const stubAlerts = () => page.evaluate(`(() => { window.__alerts = []; window.alert = (m) => { window.__alerts.push(String(m)); }; return true; })()`);
    const alerted = (text) => page.waitFor(`(window.__alerts || []).some((m) => m.includes(${JSON.stringify(text)}))`, NAV_TIMEOUT, `an alert saying ${text}`);

    await page.navigate(`${expo.baseUrl}/gym/manage`);
    await h.expectText("All Members");
    // Members opens on its own: no top tabs for the other sections, and no section title
    await page.waitFor(`!document.body.innerText.includes("Plan / Catalogue") && !document.body.innerText.includes("Plans / Catalogue")`, NAV_TIMEOUT, "Members without the Manage top tabs");
    await h.expectText("Karthik Raja");
    await h.expectText("6 days ago");
    await h.expectText("₹1,500 due");
    await snapshotAllWidths("gym-manage-members");
    await stubAlerts();
    // The bell opens Send Reminder on the expired template; SMS alone, through justFit (credits
    // are left and the text is the template), after the confirm
    await clickLabel("Send Karthik Raja an expired reminder");
    await h.expectText("Notify member about payment or membership");
    await h.settle();
    await clickLabel("Send by WhatsApp"); // off
    await clickLabel("Send by SMS");
    await h.expectText("Via justFit: 1 credit");
    await snapshotAllWidths("gym-send-reminder");
    await clickLabel("Send Reminder");
    await h.expectText("Send expired reminder?");
    await h.expectText("Credits left");
    await snapshotAllWidths("gym-sms-confirm");
    await clickLabel("Send SMS");
    await alerted("Expired reminder sent to Karthik Raja");
    const [[log]] = await connection.query("SELECT kind, source, status FROM gym_sms_log WHERE member_id = ?", [karthik.json.member.id]);
    assert.deepEqual({ ...log }, { kind: "expired", source: "manual", status: "sent" });
    assert.equal(await credits(), 4);
    assert.ok(fs.readFileSync(path.join(server.outbox, "gym-sms.jsonl"), "utf8").includes("9811122233"), "the fake provider got it");

    // The filter chips filter the list; the chosen chip carries its count
    await clickLabel("Expired");
    await page.waitFor(`!(document.body.innerText || "").includes("Mohammed Asif")`, NAV_TIMEOUT, "only expired members");
    await h.expectText("Karthik Raja");
    await page.waitFor(`(() => { const chip = document.querySelector('[role="tab"][aria-label="Expired"]'); return !!chip && (chip.textContent || "").replace(/\\s+/g, "") === "Expired1"; })()`, NAV_TIMEOUT, "the Expired chip counts 1");
    await clickLabel("All Members");
    await h.expectText("Mohammed Asif");

    // Home › Send Bulk SMS
    await page.navigate(`${expo.baseUrl}/gym`);
    await h.expectPath("/gym");
    await h.expectText("Send Bulk SMS");
    await h.settle(); // Home's cards finish sliding in before the tap
    await stubAlerts();
    await clickLabel("Send Bulk SMS. Auto reminders, alerts and wishes");
    await h.expectText("Available Credits");
    await h.expectText("QUICK ACTIONS");
    assert.ok(await hasLabel("4 credits"));
    await h.settle();
    await snapshotAllWidths("gym-bulk-sms");
    await clickLabel("Buy credits");
    await alerted("added by the justFit team");

    // Auto Reminders: a switch saves, a preview shows the message
    await clickLabel("Auto Reminders. Manage scheduled SMS reminders");
    await h.expectText("Reminders will be skipped if your balance runs out.");
    await h.expectText("Membership Expiry Reminder");
    await h.settle();
    await snapshotAllWidths("gym-auto-reminders");
    await clickLabel("Membership Expiry Reminder, 1 day before expiry");
    await page.waitFor(`true`, 500, "a moment");
    const switched = async () => (await connection.query("SELECT enabled FROM gym_sms_settings WHERE gym_id = ? AND kind = 'expiry'", [state.gym]))[0][0]?.enabled;
    for (let i = 0; i < 40 && (await switched()) !== 1; i++) await new Promise((r) => setTimeout(r, 250));
    assert.equal(await switched(), 1, "the expiry reminder is switched on");
    await clickLabel("Preview the Birthday Wishes");
    await h.expectText("Happy birthday Priya!");
    await snapshotAllWidths("gym-sms-preview");
    await clickLabel("Close preview");

    // Manual Send to the members who owe
    await clickLabel("Back");
    const due = (await apiAs("gym", "GET", "/api/gym/sms")).json.groups.find((g) => g.id === "due").count;
    assert.ok(due >= 1);
    await clickLabel("Manual Send. Send SMS to specific member groups");
    await h.expectText("Who should get it?");
    await clickLabel(`Payment due, ${due} members, Due reminder`);
    await h.expectText("Message preview");
    await h.settle();
    await snapshotAllWidths("gym-manual-send");
    await clickLabel(`Send to ${due} ${due === 1 ? "member" : "members"}`);
    await h.expectText("Send these SMS?");
    await clickLabel("Send");
    await h.expectText(`${due} SMS sent`);
    assert.equal(await credits(), 4 - due);
    await clickLabel("Done");

    // Message Logs
    await clickLabel("Message Logs. View sent SMS history");
    await h.expectText("Karthik Raja");
    await h.expectText("Expired reminder · Manual");
    await h.settle();
    await snapshotAllWidths("gym-sms-logs");
    await clickLabel("Close");
    await page.waitFor(`!(document.body.innerText || "").includes("QUICK ACTIONS") && !(document.body.innerText || "").includes("Message Logs")`, NAV_TIMEOUT, "the sheet closes");
  }));

  it("4f. Manage › Enquiry: add one with a call-back day, it shows under Today; edit, Convert opens Add Member filled in", run("gym-enquiries", async () => {
    await page.navigate(`${expo.baseUrl}/gym/manage?tab=enquiry`);
    await h.expectText("No open enquiries");
    await snapshotAllWidths("gym-enquiries-empty");
    await clickLabel("Add an enquiry");
    await h.expectText("Someone who asked about joining.");
    await h.settle();
    await page.setInput(h.input("Name (Eg. Priya)"), "Priya Sharma");
    await page.setInput(h.input("Mobile Number"), "9123456780");
    await clickLabel("PT");
    // Referral asks who referred them, and Save waits for a real number (2026-11-08)
    const saveDisabled = () => page.evaluate(`document.querySelector('[aria-label="Save enquiry"]').getAttribute("aria-disabled") === "true"`);
    await clickLabel("Referral");
    await page.waitFor(`!!document.querySelector('input[placeholder="Referred by (mobile number)"]')`, NAV_TIMEOUT, "the referrer's number field");
    assert.equal(await saveDisabled(), true, "a referral needs the referrer's number");
    await page.setInput(h.input("Referred by (mobile number)"), "9123456780");
    await h.expectText("That's their own number");
    assert.equal(await saveDisabled(), true, "not their own number");
    await page.setInput(h.input("Referred by (mobile number)"), "9876500011");
    await page.waitFor(`document.querySelector('[aria-label="Save enquiry"]').getAttribute("aria-disabled") !== "true"`, NAV_TIMEOUT, "Save ready with a referrer");
    await snapshotAllWidths("gym-enquiry-referral");
    await clickLabel("Instagram");
    await page.waitFor(`!document.querySelector('input[placeholder="Referred by (mobile number)"]')`, NAV_TIMEOUT, "another source hides the field");
    await page.setInput('textarea[placeholder="Evening timings? Budget? Goal?"]', "Evenings after 6");
    await clickLabel("Follow up today");
    await snapshotAllWidths("gym-enquiry-add");
    await page.evaluate(`document.querySelector('[aria-label="Save enquiry"]').scrollIntoView({ block: "center" })`);
    await h.settle();
    await clickLabel("Save enquiry");
    // Cold · 0: an Instagram enquiry nobody has contacted yet scores nothing (predictions #3)
    const card = "Priya Sharma, Follow-up, Cold · 0, Follow up today, PT · Instagram. Edit";
    await page.waitFor(`!!document.querySelector(${JSON.stringify(`[aria-label="${card}"]`)})`, NAV_TIMEOUT, "the new enquiry's card");
    assert.ok(await hasLabel("Today, 1"), "one call for today");
    assert.ok(await hasLabel("Open, 1"));
    assert.ok(await hasLabel("Call Priya Sharma"));
    assert.ok(await hasLabel("WhatsApp Priya Sharma"));
    await snapshotAllWidths("gym-enquiries");
    await clickLabel("Today, 1");
    await page.waitFor(`!!document.querySelector(${JSON.stringify(`[aria-label="${card}"]`)})`, NAV_TIMEOUT, "listed under Today");

    // Edit: Convert to member opens Add Member with the name and number
    await clickLabel(card);
    await h.expectText("Edit Enquiry");
    await snapshotAllWidths("gym-enquiry-edit");
    await page.evaluate(`document.querySelector('[aria-label="Convert Priya Sharma to a member"]').scrollIntoView({ block: "center" })`);
    await h.settle();
    await clickLabel("Convert Priya Sharma to a member");
    await h.expectText("Add member profile.");
    await page.waitFor(`[...document.querySelectorAll("input")].some((i) => i.value === "Priya Sharma") && [...document.querySelectorAll("input")].some((i) => i.value === "9123456780")`, NAV_TIMEOUT, "the name and number filled in");
    await clickLabel("Close");
    await h.settle();

    // Not interested: off the open lists
    await clickLabel(card);
    await h.expectText("Edit Enquiry");
    await h.settle();
    await clickLabel("Not interested");
    await page.evaluate(`document.querySelector('[aria-label="Save changes"]').scrollIntoView({ block: "center" })`);
    await h.settle();
    await clickLabel("Save changes");
    await page.waitFor(`!!document.querySelector('[aria-label="Not interested, 1"]')`, NAV_TIMEOUT, "counted as not interested");
    await h.expectText("No calls for today");
    const [[row]] = await connection.query("SELECT status, interest, source, phone FROM gym_enquiries WHERE full_name = 'Priya Sharma'");
    assert.deepEqual({ ...row }, { status: "lost", interest: "pt", source: "instagram", phone: "9123456780" });
    await connection.query("DELETE FROM gym_enquiries WHERE full_name = 'Priya Sharma'");
  }));

  it("4b. the branch switcher opens Kunigal's own numbers, then back to Tumkur", run("gym-branches", async () => {
    await page.navigate(`${expo.baseUrl}/gym`);
    await clickLabel("Tumkur branch, SIT Road, Tumakuru. Switch or edit branch");
    await h.expectPath("/gym/branches");
    await h.expectText("Kunigal branch");
    await snapshotAllWidths("gym-branches");
    // Add branch: the sheet asks for the name and the location; the new branch joins the list
    await clickLabel("Add branch");
    await h.expectText("Another branch of Forma");
    await page.setInput(h.input("For example: Kunigal"), "Gubbi");
    await page.setInput(h.input("For example: Main Road"), "Market Road");
    await page.setInput(h.input("For example: Tumakuru"), "Gubbi");
    await snapshotAllWidths("gym-add-branch");
    await clickLabel("Add Branch");
    await h.expectText("Gubbi branch");
    await h.expectText("Market Road, Gubbi");
    const [[gubbi]] = await connection.query("SELECT g.id FROM gyms g JOIN gym_staff s ON s.gym_id = g.id AND s.kind = 'owner' WHERE g.name = 'Gubbi' AND s.user_id = ?", [identities.gym.id]);
    assert.ok(gubbi, "the gym admin is linked to the new branch");
    await connection.query("DELETE FROM gym_staff WHERE gym_id = ?", [gubbi.id]);
    await connection.query("DELETE FROM gyms WHERE id = ?", [gubbi.id]);
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
    await h.expectText("₹18,200 today"); // with 4d's ₹6,000 product sale
    await snapshotAllWidths("admin-gyms");
    await clickLabel("Forma, Tumkur branch, SIT Road, Tumakuru. ₹18,200 today, 3 members, 1 in today");
    await page.waitFor(`location.pathname.startsWith("/admin/gyms/")`, NAV_TIMEOUT, "the gym's page");
    await h.expectText("Arjun Kumar");
    await h.expectText("Ravi Shankar");
    await h.expectText("Kunigal");
    await snapshotAllWidths("admin-gym");
    // SMS credits: the team adds them by hand
    await h.expectText("SMS credits");
    const before = (await connection.query("SELECT sms_credits FROM gyms WHERE id = ?", [state.gym]))[0][0].sms_credits;
    await page.setInput(h.input("500"), "100");
    await clickLabel("Add SMS credits");
    await page.waitFor(`!!document.querySelector('[aria-label="${before + 100} SMS credits left"]')`, NAV_TIMEOUT, "the new balance");
    assert.equal((await connection.query("SELECT sms_credits FROM gyms WHERE id = ?", [state.gym]))[0][0].sms_credits, before + 100);
  }));

  it("7. a member can't open the gym portal", run("member-guard", async () => {
    await signIn(identities.member, "/home");
    await page.navigate(`${expo.baseUrl}/gym`);
    await page.waitFor(`!location.pathname.startsWith("/gym")`, NAV_TIMEOUT, "sent away from /gym");
    assert.equal(await page.hasText("Today's Revenue"), false);
    // Profile › Gym attendance: the scan screen and their (empty) visits; this member isn't at any gym
    await page.navigate(`${expo.baseUrl}/attendance`);
    await h.expectText("Check in or out at your gym");
    await h.expectText("No visits yet.");
    assert.ok(await hasLabel("Scan QR code") || (await page.hasText("Scan QR code")));
    await snapshotAllWidths("member-attendance");
  }));
});
