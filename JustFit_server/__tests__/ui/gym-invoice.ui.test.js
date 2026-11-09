// The Invoice screen in the real Expo web build against the isolated test server and the
// justfit_test database. The gym admin opens a payment's invoice laid out like the user's template
// (the number and dates, Member and Plan Details, the item table, the totals, Payment Details,
// the signature line and the gym's footer), the gym's logo appears at the top right once uploaded,
// the member's page carries an Invoice chip that opens it, and Branch details has the Invoice
// details form with the Logo picker. Screenshots at three widths.
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
const { png, body } = require("../e2e/images.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];

describe("ui gym invoice: a payment's invoice, the member's Invoice chip, Invoice details", () => {
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
    state.logoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-gym-logo-ui-"));
    server = await startTestServer({ ...env, GYM_LOGO_DIR: state.logoDir });
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
    const gym = await apiAs("admin", "POST", "/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "SIT Road", city: "Tumakuru" });
    assert.equal(gym.status, 201, JSON.stringify(gym.json));
    state.gym = gym.json.gym.id;
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/staff`, { phone: identities.owner.phone })).status, 201);
    assert.equal((await apiAs("owner", "PATCH", "/api/gym/invoice-details", { address: "12, 1st Main Road, SS Puram", phone: "9876543210", gstin: "29ABCDE1234F1Z5" })).status, 200);
    const ravi = await apiAs("owner", "POST", "/api/gym/members", { name: "Ravi Kumar", phone: "9123456789", duration: 3, fee: 4500, paid: 4000, method: "cash", dueBy: "2027-01-15" });
    assert.equal(ravi.status, 201, JSON.stringify(ravi.json));
    state.member = ravi.json.member.id;
    state.code = ravi.json.member.code;
    state.payment = ravi.json.payments.find((p) => p.kind === "admission").id;
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    await step("logo folder", async () => { if (state.logoDir) fs.rmSync(state.logoDir, { recursive: true, force: true }); });
    await step("rows", async () => {
      if (!connection) return;
      if (state.gym) {
        const [[{ brand_id: brandId }]] = await connection.query("SELECT brand_id FROM gyms WHERE id = ?", [state.gym]);
        for (const table of ["gym_activity_log", "gym_payments", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
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

  it("1. the invoice of the admission payment, laid out like the template: the number and dates, the cards, the item, the totals and the gym's footer", run("invoice", async () => {
    await viewport(390, 844);
    await signIn(identities.owner, "/gym");
    await h.expectText("Tumkur branch");
    await page.navigate(`${expo.baseUrl}/gym/invoice?paymentId=${state.payment}`);
    await h.expectText("INV-FOR-TUM-0001");
    await h.expectText("Membership Invoice");
    assert.ok(await hasLabel("Forma, no logo yet"), "no logo yet: the gym's initials in the corner");
    await h.expectText("Member Details");
    await h.expectText("Ravi Kumar");
    await h.expectText(state.code);
    await h.expectText("+91\u00A091234\u00A056789"); // no-break spaces: the number never wraps
    await h.expectText("Plan Details");
    await h.expectText("3 Months");
    await h.expectText("Active");
    await h.expectText("Membership – 3 Months");
    await h.expectText("Subtotal");
    await h.expectText("Total Amount");
    await h.expectText("₹4,000");
    await h.expectText("Balance Due");
    await h.expectText("by\u00A015\u00A0Jan\u00A02027");
    await h.expectText("₹500");
    await h.expectText("Payment Details");
    await h.expectText("Cash");
    await h.expectText("Paid");
    await h.expectText("Authorized Signature");
    await h.expectText("GSTIN 29ABCDE1234F1Z5");
    await h.expectText("12, 1st Main Road, SS Puram");
    assert.ok(await hasLabel("Share PDF"), "Share PDF");
    assert.ok(await hasLabel("WhatsApp the invoice"), "WhatsApp");
    assert.ok(await hasLabel("SMS the invoice"), "SMS");
    assert.equal(await hasLabel("Email the invoice"), false, "no email on record, no Email button");
    await snapshotAllWidths("gym-invoice");
  }));

  it("1b. once the gym admin uploads a logo, it sits at the top right of the invoice", run("invoice-logo", async () => {
    const set = await apiAs("owner", "PUT", "/api/gym/logo", body(png(240, 96, [212, 0, 5]), "image/png"));
    assert.equal(set.status, 200, JSON.stringify(set.json));
    await page.navigate(`${expo.baseUrl}/gym/invoice?paymentId=${state.payment}`);
    await h.expectText("INV-FOR-TUM-0001");
    await page.waitFor(`[...document.querySelectorAll('[aria-label]')].some((e) => e.getAttribute("aria-label") === "Forma logo")`, NAV_TIMEOUT, "the gym's logo in the corner");
    assert.equal(await hasLabel("Forma, no logo yet"), false);
    await snapshotAllWidths("gym-invoice-logo");
  }));

  it("2. the member's page has an Invoice chip on the payment, and it opens the same invoice", run("invoice-chip", async () => {
    await page.navigate(`${expo.baseUrl}/gym/members/${state.member}`);
    await h.expectText("Ravi Kumar");
    await clickLabel("Invoice for Ravi Kumar, 3 Months");
    await page.waitFor(`location.pathname === "/gym/invoice"`, NAV_TIMEOUT, "the Invoice screen");
    await h.expectText("INV-FOR-TUM-0001");
  }));

  it("3. Branch details carries the Invoice details form with what was saved", run("invoice-details", async () => {
    await page.navigate(`${expo.baseUrl}/gym/details`);
    await h.expectText("Printed on every invoice");
    await h.expectText("Logo (optional)");
    await page.waitFor(`[...document.querySelectorAll('[aria-label]')].some((e) => e.getAttribute("aria-label") === "Gym logo, chosen")`, NAV_TIMEOUT, "the logo spot shows the uploaded logo");
    assert.ok(await hasLabel("Remove the logo"), "Remove is offered once there is a logo");
    assert.equal(await page.evaluate(`[...document.querySelectorAll("input")].map((i) => i.value).includes("29ABCDE1234F1Z5")`), true, "the GSTIN is filled in");
    assert.equal(await page.evaluate(`document.querySelector('[aria-label="Save invoice details"]').getAttribute("aria-disabled")`), "true", "Save waits for a change");
    await snapshotAllWidths("gym-invoice-details");
  }));
});
