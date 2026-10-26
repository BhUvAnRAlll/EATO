// QR attendance in the real Expo web build against the isolated test server and the eato_test
// database. Priya owns "Iron Temple"; Rohan is a member whose pass she scans (typed in, as on the
// web the camera isn't available); Zoe's package has expired. Covers the Check-in tab, scanning and
// verifying, checking in, a refused scan, today's list, visit detail, the check-out QR (switch and
// front-desk display), and the member's side: the session card on Home, My QR code, and checking
// out by scanning the gym's code. Screenshots at three widths.
//
//   yarn test:ui      (needs Eato_server/.env.test and Google Chrome; otherwise skipped)
//   EATO_SCREENSHOT_DIR=<dir> saves screenshots of each screen at three widths
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { clerkFor, describeClerkError } = require("../e2e/clerk-identities.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.EATO_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const CLEANUP_TABLES = ["gym_visits", "gym_scan_failures", "gym_member_plans", "gym_members", "gym_faqs", "whatsapp_usage", "whatsapp_agent_settings", "whatsapp_connections", "gym_notices", "gym_assistant_questions", "gyms"];

describe("ui owner check-in: QR attendance at the front desk and the member's side", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, clerk, h;
  const identities = {};
  const tokens = {};
  const sessions = {};
  const rowsOnly = {};
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
  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === ${JSON.stringify(label)} && e.getClientRects().length > 0); if (!els.length) return null; const el = els.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `tab ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const clickLabel = async (label, nth = 0) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(`[aria-label=${JSON.stringify(label)}]`)})].filter((e) => e.getClientRects().length > 0); const el = els.at(${nth}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const hasLabel = (label) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`[aria-label=${JSON.stringify(label)}]`)})].some((e) => e.getClientRects().length > 0)`);
  const apiAs = async (tag, method, route, body) => {
    const headers = { Authorization: `Bearer ${tokens[tag]}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  const waitForRow = async (sql, params, check, label) => {
    const deadline = Date.now() + 10000;
    let row;
    while (Date.now() < deadline) {
      [[row]] = await connection.query(sql, params);
      if (row && check(row)) return row;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.fail(`${label}: ${JSON.stringify(row)}`);
  };
  // Types a code into the open scanner and submits it (the camera isn't available on the web)
  const scanCode = async (code) => {
    await page.waitFor(`[...document.querySelectorAll('[aria-label="Code"]')].some((e) => e.getClientRects().length > 0)`, NAV_TIMEOUT, "the scanner");
    await page.setInput('[aria-label="Code"]', code);
    // The newest scanner is the last one on the page (setInput types into the last one too)
    await clickLabel("Use this code", -1);
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    // The first web bundle can take a while: load the sign-in screen once before any test
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      for (const tag of ["owner", "member", "lapsed"]) {
        identities[tag] = await clerk.createIdentity(runId, tag, { withPassword: tag !== "lapsed" });
        const minted = await clerk.mintToken(identities[tag].id);
        tokens[tag] = minted.jwt;
        sessions[tag] = minted.sessionId;
      }
      identities.platform = await clerk.createIdentity(runId, "platform", { role: "admin" });
      const minted = await clerk.mintToken(identities.platform.id);
      tokens.platform = minted.jwt;
      sessions.platform = minted.sessionId;
    } catch (error) {
      throw new Error(`Clerk could not create a test identity: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of ["owner", "member"]) await clerk.setUnsafeMetadata(identities[tag].id, { profileComplete: true });
    const names = { owner: "Priya Sharma", member: "Rohan Mehta", lapsed: "Zoe Adams", platform: "Platform Admin" };
    for (const tag of Object.keys(identities)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [identities[tag].id, identities[tag].emailAddress, names[tag], tag === "platform" ? "admin" : "user"]);
    }
    const created = await apiAs("platform", "POST", "/api/gyms", { name: "Iron Temple", tagline: "Lift heavy, lift often", location: "Indiranagar", ownerEmail: identities.owner.emailAddress });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    state.gym = created.json.gym.id;
    for (const tag of ["member", "lapsed"]) {
      await connection.query("INSERT INTO gym_members (gym_id, user_id, role, status, requested_at, joined_at) VALUES (?, ?, 'member', 'active', NOW(), NOW())", [state.gym, identities[tag].id]);
    }
    await connection.query(
      "INSERT INTO gym_member_plans (gym_id, user_id, plan_name, status, starts_on, ends_on) VALUES (?, ?, 'Unlimited', 'active', CURDATE() - INTERVAL 20 DAY, CURDATE() + INTERVAL 40 DAY), (?, ?, 'Standard', 'active', CURDATE() - INTERVAL 40 DAY, CURDATE() - INTERVAL 2 DAY)",
      [state.gym, identities.member.id, state.gym, identities.lapsed.id],
    );
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
      for (const table of CLEANUP_TABLES) await connection.query("DELETE FROM `" + table + "`");
      await db.deleteUsers(connection, [...Object.values(identities).map((i) => i.id), ...Object.values(rowsOnly)]);
      await connection.end();
    });
    await step("identities", async () => {
      if (!clerk) return;
      for (const sessionId of Object.values(sessions)) await clerk.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await clerk.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the owner opens the Check-in tab: empty counts, the two buttons, and Home's in-the-gym card", run("tab", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.owner);
    await h.expectPath("/home");
    await clickTab("Community");
    await page.clickText("Gyms");
    await clickLabel("Gym owner portal for Iron Temple");
    await page.waitFor(`location.pathname === "/owner"`, NAV_TIMEOUT, "owner home");
    await h.expectText("0 in the gym now");
    await clickLabel("0 in the gym now. Open Check-in");
    await page.waitFor(`location.pathname === "/owner/checkin"`, NAV_TIMEOUT, "check-in tab");
    await h.expectText("Nobody is checked in right now");
    for (const label of ["In the gym now: 0", "Check-ins today: 0", "Completed sessions: 0", "Failed scans today: 0", "Scan member QR", "Check-out QR"]) assert.equal(await hasLabel(label), true, label);
  }));

  it("2. scanning a member's pass verifies them; checking in confirms and counts them in", run("checkin", async () => {
    const pass = (await apiAs("member", "GET", "/api/owner/me/pass")).json.pass;
    await clickLabel("Scan member QR");
    await h.expectText("Attendance scanner");
    await snapshotAllWidths("owner-scanner");
    await scanCode(pass);
    await page.waitFor(`location.pathname === "/owner/verify"`, NAV_TIMEOUT, "verification");
    await h.expectText("Member verified");
    await h.expectText("Rohan Mehta");
    await h.expectText("Unlimited");
    await h.expectText("Eligible");
    await snapshotAllWidths("owner-verified");
    await clickLabel("Check in Rohan Mehta");
    await h.expectText("Check-in successful");
    await waitForRow("SELECT COUNT(*) AS n FROM gym_visits WHERE gym_id = ? AND user_id = ? AND checked_out_at IS NULL", [state.gym, identities.member.id], (row) => row.n === 1, "one open visit");
    await snapshotAllWidths("owner-checked-in");
    // Scanning the same pass again is refused, and nothing new is created
    await clickLabel("Scan next member");
    await scanCode(pass);
    await h.expectText("Verification failed");
    await h.expectText("Already checked in");
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM gym_visits WHERE user_id = ?", [identities.member.id]))[0][0].n, 1);
  }));

  it("3. an expired package and a junk code are refused, explained and counted as failed scans", run("refused", async () => {
    await clickLabel("Scan again");
    await scanCode((await apiAs("lapsed", "GET", "/api/owner/me/pass")).json.pass);
    await h.expectText("Membership not active");
    await h.expectText("Zoe Adams");
    await h.expectText("Package expired on");
    await h.expectText("Not allowed");
    await snapshotAllWidths("owner-verification-failed");
    await clickLabel("Scan again");
    await scanCode("not-a-member-code");
    await h.expectText("Invalid QR code");
    await clickLabel("Done");
    await page.waitFor(`location.pathname === "/owner/checkin"`, NAV_TIMEOUT, "back on the tab");
    await page.waitFor(`[...document.querySelectorAll('[aria-label^="Failed scans today: "]')].some((e) => Number(e.getAttribute("aria-label").split(": ")[1]) >= 3)`, NAV_TIMEOUT, "failed scans counted");
    await h.expectText("Rohan Mehta checked in");
    await snapshotAllWidths("owner-checkin-tab");
  }));

  it("4. today's list filters and searches; the visit detail shows who scanned them in", run("today", async () => {
    await clickLabel("Today's list");
    await page.waitFor(`location.pathname === "/owner/today"`, NAV_TIMEOUT, "today's list");
    await h.expectText("Rohan Mehta");
    await page.clickText("Checked out");
    await h.expectText("No visits");
    await page.clickText("All");
    await page.setInput('[aria-label="Search visits"]', "zzz");
    await h.expectText("Nobody by that name today.");
    await page.setInput('[aria-label="Search visits"]', "Rohan");
    await h.expectText("Rohan Mehta");
    await snapshotAllWidths("owner-today");
    await page.clickText("Rohan Mehta");
    await page.waitFor(`location.pathname.startsWith("/owner/visit/")`, NAV_TIMEOUT, "visit detail");
    await h.expectText("Scanned in by");
    await h.expectText("Priya Sharma");
    await h.expectText("Still in the gym");
    await snapshotAllWidths("owner-visit");
    await clickLabel("Back");
    await clickLabel("Back");
  }));

  it("5. the check-out QR: shown with its code, switched off and on, and the front-desk display", run("checkout-qr", async () => {
    await clickLabel("Check-out QR");
    await page.waitFor(`location.pathname === "/owner/checkout-qr"`, NAV_TIMEOUT, "check-out QR");
    await h.expectText("Members scan this at the exit");
    const [[gym]] = await connection.query("SELECT checkout_code, checkout_qr_enabled FROM gyms WHERE id = ?", [state.gym]);
    assert.match(gym.checkout_code, /^[A-HJ-NP-Z2-9]{12}$/);
    state.checkoutText = `JUSTFIT-OUT-${gym.checkout_code}`;
    await snapshotAllWidths("owner-checkout-qr");
    await clickLabel("Check-out QR active");
    await waitForRow("SELECT checkout_qr_enabled FROM gyms WHERE id = ?", [state.gym], (row) => row.checkout_qr_enabled === 0, "switched off");
    await h.expectText("Members ask the front desk to check them out.");
    await clickLabel("Check-out QR active");
    await waitForRow("SELECT checkout_qr_enabled FROM gyms WHERE id = ?", [state.gym], (row) => row.checkout_qr_enabled === 1, "switched on");
    await clickLabel("Open front-desk display");
    await page.waitFor(`location.pathname === "/owner/display"`, NAV_TIMEOUT, "display");
    await h.expectText("Leaving? Scan to check out");
    await h.expectText("0 checked out today");
    await snapshotAllWidths("owner-display");
  }));

  it("6. the member sees their session on Home, opens My QR code, and checks out by scanning the gym's code", run("member", async () => {
    await signInAs(page, h, identities.member);
    await h.expectPath("/home");
    await h.expectText("In the gym at Iron Temple");
    await snapshotAllWidths("member-active-visit");
    await clickLabel("My QR code");
    await page.waitFor(`location.pathname === "/my-qr"`, NAV_TIMEOUT, "my QR");
    await h.expectText("Show this at the front desk");
    assert.equal(await hasLabel("Your check-in QR code"), true);
    await snapshotAllWidths("member-my-qr");
    await clickLabel("Back");
    await h.expectPath("/home");
    await clickLabel("Check out");
    await scanCode(state.checkoutText);
    await h.expectText("Checked out of Iron Temple");
    const visit = await waitForRow("SELECT checkout_method FROM gym_visits WHERE user_id = ?", [identities.member.id], (row) => row.checkout_method === "qr", "checked out by QR");
    assert.equal(visit.checkout_method, "qr");
    assert.equal(await page.hasText("In the gym at Iron Temple"), false);
  }));
});
