// Reminder Templates in the real Expo web build against the isolated test server and the
// justfit_test database. The gym admin opens ☰ › Reminder Templates (four messages, each Default,
// with a sample member filled in), rewords Payment due in the edit sheet (a placeholder chip, the
// preview, a refused typo), saves it (Custom), and Send Reminder on a member who owes then writes
// the new wording; Reset to default puts it back. A Staff login sees the list without Edit.
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

describe("ui gym reminder templates: the list, editing one, Send Reminder using it, Staff read only", () => {
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
    const ravi = await apiAs("owner", "POST", "/api/gym/members", { name: "Ravi Kumar", phone: "9123456789", duration: 3, fee: 4500, paid: 4000, method: "cash", dueBy: "2027-01-15" });
    assert.equal(ravi.status, 201, JSON.stringify(ravi.json));
    state.member = ravi.json.member.id;
    state.code = ravi.json.member.code;
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
        for (const table of ["gym_added_templates", "gym_reminder_templates", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
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

  const textarea = 'textarea[aria-label="Payment due message"]';
  // Typing into the sheet scrolls the modal's own containers (the harness's scrollIntoView), which
  // pushes the whole sheet below the screen on the web build; put them back before a tap in it
  const tapInSheet = async (label) => {
    await page.evaluate(`document.querySelectorAll("*").forEach((e) => { if (e.scrollTop) e.scrollTop = 0; })`);
    // Then scroll only the sheet's own list (the nearest scrolling parent) to the element
    await page.evaluate(`(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label") === ${JSON.stringify(label)})[0]; if (!el) return; let box = el.parentElement; while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement; if (!box) return; const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(); if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 16; })()`);
    await h.settle();
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label") === ${JSON.stringify(label)})[0]; if (!el) return null; const r = el.getBoundingClientRect(); return r.bottom <= innerHeight ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`, NAV_TIMEOUT, `${label} on screen`);
    await page.clickAt(pos.x, pos.y);
  };
  const labelDisabled = (label) => page.evaluate(`document.querySelector('[aria-label=${JSON.stringify(label)}]')?.getAttribute("aria-disabled")`);

  it("1. ☰ › Reminder Templates lists the four messages with their default wording filled in", run("templates-list", async () => {
    await viewport(390, 844);
    await signIn(identities.owner, "/gym");
    await h.expectText("Tumkur branch");
    await clickLabel("Menu");
    await h.expectText("Sign out");
    await h.settle(); // the menu slides in
    await clickLabel("Reminder Templates");
    await page.waitFor(`location.pathname === "/gym/templates"`, NAV_TIMEOUT, "the Reminder Templates screen");
    await h.expectText("Membership expiring");
    for (const text of ["Payment due", "Membership expired", "Enquiry follow-up", "SMS sent through justFit use the registered text"]) await h.expectText(text);
    await h.expectText("Hi Priya, this is Forma (Tumkur). A payment of ₹1,500 is due by 15 Nov 2026");
    assert.equal(await page.evaluate(`(document.body.innerText.match(/Default/g) || []).length`), 4, "every message is the default");
    for (const label of ["Edit Payment due", "Edit Membership expiring", "Edit Membership expired", "Edit Enquiry follow-up"]) assert.ok(await hasLabel(label), label);
    await snapshotAllWidths("gym-templates");
  }));

  it("2. the edit sheet: a typo is refused, a chip inserts a detail, the preview follows, Save makes it Custom", run("templates-edit", async () => {
    await clickLabel("Edit Payment due");
    await page.waitFor(`!!document.querySelector(${JSON.stringify(textarea)})`, NAV_TIMEOUT, "the edit sheet");
    assert.equal(await labelDisabled("Save Template"), "true", "Save waits for a change");
    await page.setInput(textarea, "Namaste {nmae}, please clear your dues.");
    await h.expectText("{nmae} isn't a placeholder this message can use.");
    assert.equal(await labelDisabled("Save Template"), "true", "a typo can't be saved");
    await page.setInput(textarea, "Namaste , please clear your dues of ");
    await tapInSheet("Insert Amount due");
    await page.waitFor(`document.querySelector(${JSON.stringify(textarea)}).value.includes("{amount}")`, 8000, "the chip's detail in the message");
    // Where it lands follows the cursor, which a script-set value leaves wherever the browser put it
    const withChip = await page.inputValue(textarea);
    assert.ok(withChip.includes("{amount}") && withChip.length === "Namaste , please clear your dues of ".length + "{amount}".length, withChip);
    await page.setInput(textarea, "Namaste {name}, please clear your dues of {amount} at {gym}.");
    await h.expectText("Namaste Priya, please clear your dues of ₹1,500 at Forma (Tumkur).");
    await snapshotAllWidths("gym-templates-edit");
    await tapInSheet("Save Template");
    await page.waitFor(`!document.querySelector(${JSON.stringify(textarea)})`, NAV_TIMEOUT, "the sheet closes once saved");
    await h.expectText("Custom");
    const [rows] = await connection.query("SELECT kind, body FROM gym_reminder_templates WHERE gym_id = ?", [state.gym]);
    assert.deepEqual(rows, [{ kind: "due", body: "Namaste {name}, please clear your dues of {amount} at {gym}." }]);
  }));

  it("3. Send Reminder on a member who owes writes the branch's wording, filled in for them", run("templates-send", async () => {
    await page.navigate(`${expo.baseUrl}/gym/members`);
    await h.expectText("Ravi Kumar");
    await clickLabel("Send Ravi Kumar a due reminder");
    await page.waitFor(`!!document.querySelector('textarea[aria-label="Message"]')`, NAV_TIMEOUT, "Send Reminder");
    await page.waitFor(`document.querySelector('textarea[aria-label="Message"]').value === "Namaste Ravi, please clear your dues of ₹500 at Forma (Tumkur)."`, NAV_TIMEOUT, "the custom wording, filled in");
    await clickLabel("Send by SMS");
    await h.expectText("Your own template goes from your phone's Messages app");
    await snapshotAllWidths("gym-templates-send-reminder");
  }));

  it("4. Reset to default asks once more, then the wording is justFit's again", run("templates-reset", async () => {
    await page.navigate(`${expo.baseUrl}/gym/templates`);
    await h.expectText("Custom");
    await clickLabel("Edit Payment due");
    await tapInSheet("Reset to justFit's default text");
    await h.expectText("Use justFit's default text?");
    await tapInSheet("Reset");
    await page.waitFor(`!document.querySelector(${JSON.stringify(textarea)})`, NAV_TIMEOUT, "the sheet closes once reset");
    await page.waitFor(`(document.body.innerText.match(/Default/g) || []).length === 4`, NAV_TIMEOUT, "all four are the default again");
    const [rows] = await connection.query("SELECT COUNT(*) AS n FROM gym_reminder_templates WHERE gym_id = ?", [state.gym]);
    assert.equal(rows[0].n, 0);
  }));

  it("4b. + adds a template of your own; Send Reminder lists it and fills it in; Delete asks once more", run("templates-added", async () => {
    const message = 'textarea[aria-label="Template message"]';
    const name = 'input[aria-label="Template name"]';
    await h.expectText("Your templates");
    await clickLabel("Add template");
    await page.waitFor(`!!document.querySelector(${JSON.stringify(name)})`, NAV_TIMEOUT, "the add sheet");
    assert.equal(await labelDisabled("Add Template"), "true", "Add waits for a name");
    await page.setInput(name, "Festive offer");
    await page.setInput(message, "Hi {name}, renew at {gym} before {date} and save 10%.");
    await h.expectText("Hi Priya, renew at Forma (Tumkur) before 30 Nov 2026 and save 10%.");
    await tapInSheet("Add Template");
    await page.waitFor(`!document.querySelector(${JSON.stringify(name)})`, NAV_TIMEOUT, "the sheet closes once added");
    await h.expectText("Festive offer");
    assert.ok(await hasLabel("Edit Festive offer"));
    await snapshotAllWidths("gym-templates-added");
    const [rows] = await connection.query("SELECT name, body FROM gym_added_templates WHERE gym_id = ?", [state.gym]);
    assert.deepEqual(rows, [{ name: "Festive offer", body: "Hi {name}, renew at {gym} before {date} and save 10%." }]);

    await page.navigate(`${expo.baseUrl}/gym/members`);
    await h.expectText("Ravi Kumar");
    await clickLabel("Send Ravi Kumar a due reminder");
    await page.waitFor(`!!document.querySelector('textarea[aria-label="Message"]')`, NAV_TIMEOUT, "Send Reminder");
    await tapInSheet("Use Template");
    await tapInSheet("Template: Festive offer");
    await page.waitFor(`document.querySelector('textarea[aria-label="Message"]').value.startsWith("Hi Ravi, renew at Forma (Tumkur) before ")`, NAV_TIMEOUT, "the added template, filled in");
    await tapInSheet("Send by SMS");
    await h.expectText("Your own template goes from your phone's Messages app");

    await page.navigate(`${expo.baseUrl}/gym/templates`);
    await clickLabel("Edit Festive offer");
    await tapInSheet("Delete Festive offer");
    await h.expectText("Delete this template?");
    await tapInSheet("Delete");
    await page.waitFor(`!document.querySelector(${JSON.stringify(message)})`, NAV_TIMEOUT, "the sheet closes once deleted");
    const [left] = await connection.query("SELECT COUNT(*) AS n FROM gym_added_templates WHERE gym_id = ?", [state.gym]);
    assert.equal(left[0].n, 0);
  }));

  it("5. a Staff login reads the templates but has no Edit", run("templates-staff", async () => {
    assert.equal((await apiAs("owner", "PUT", "/api/gym/templates/enquiry", { text: "Hi {name}, come try a free session at {gym}!" })).status, 200);
    await signIn(identities.staff, "/gym");
    await page.navigate(`${expo.baseUrl}/gym/templates`);
    await h.expectText("Only the gym admin can change these.");
    await h.expectText("Hi Priya, come try a free session at Forma (Tumkur)!");
    assert.equal(await hasLabel("Edit Payment due"), false, "no Edit for Staff");
    await snapshotAllWidths("gym-templates-staff");
  }));
});
