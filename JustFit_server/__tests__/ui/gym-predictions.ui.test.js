// Gym admin › Likely to leave (the renewal-risk prediction) in the real Expo web build against
// the isolated test server and justfit_test. A gym with Ravi (plan ending, no visit for 12 days,
// ₹800 due: High), Sneha (plan ending, visits halved: Medium) and a steady member; Home's Needs
// attention counts the High one and opens the list, which shows the level, the score and the
// reasons, filters by level, searches, and opens a member's options. Screenshots at three widths.
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

describe("ui gym predictions: Likely to leave", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  const sessions = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();
  const days = (n) => rules.addDays(today, n);

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
  // A card below the fold: at each width, scroll the screen's own list so the element holding
  // exactly `text` (its source text; the style may upper-case it) sits at the top, then the picture
  // (a width change lays the page out afresh)
  const snapshotScrolledTo = async (text, name) => {
    const scroll = () => page.evaluate(`(() => { const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent === ${JSON.stringify(text)}); if (!el) return false; let p = el.parentElement; while (p && !["auto", "scroll"].includes(getComputedStyle(p).overflowY)) p = p.parentElement; const top = el.getBoundingClientRect().top; if (p) p.scrollTop += top - 8; else window.scrollTo(0, window.scrollY + top - 8); return true; })()`);
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await h.settle();
      assert.equal(await scroll(), true, `"${text}" is on the page`);
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
  const hasLabel = (label) => page.evaluate(`!!document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`);
  // A bottom-bar tab, by its role
  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[role="tab"]')].filter((e) => e.getClientRects().length > 0 && (e.getAttribute("aria-label") || "").startsWith(${JSON.stringify(label)}))[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `the ${label} tab`);
    await page.clickAt(pos.x, pos.y);
  };
  const signIn = async (identity, landing) => {
    await signInAs(page, h, identity);
    await page.waitFor(`location.pathname.startsWith(${JSON.stringify(landing)})`, 60000, `landing on ${landing}`);
    await h.settle();
  };
  // A member through the API, then the plan's end set directly
  const admit = async (name, { expiresIn, due = 0 }) => {
    const body = { name, unit: "months", duration: 3, fee: 4500, paid: 4500 - due, method: "cash", ...(due > 0 ? { dueBy: days(5) } : {}) };
    const r = await apiAs("gym", "POST", "/api/gym/members", body);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    await connection.query("UPDATE gym_members SET expires_on = ?, joined_on = ? WHERE id = ?", [days(expiresIn), days(-100), r.json.member.id]);
    return r.json.member.id;
  };
  // Each a finished visit from 7:15 to 8:15 India time (epochs, so the hour is the same whatever
  // zone the database session runs in: the busy-hours card reads it)
  const visits = async (memberId, daysBack) => {
    for (const n of daysBack) {
      const inAt = Date.parse(`${days(-n)}T07:15:00+05:30`) / 1000;
      await connection.query(
        "INSERT INTO gym_attendance (gym_id, member_id, on_date, checked_in_at, checked_out_at, status, in_source, out_source, duration_min) VALUES (?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), 'completed', 'staff', 'staff', 60)",
        [state.gym, memberId, days(-n), inAt, inAt + 3600],
      );
    }
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
      for (const [tag, role] of [["gym", "gym_admin"], ["admin", "admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        sessions[tag] = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Arjun Kumar", identities.gym.id]);
    const gym = await apiAs("admin", "POST", "/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "SIT Road", city: "Tumakuru" });
    assert.equal(gym.status, 201, JSON.stringify(gym.json));
    state.gym = gym.json.gym.id;
    assert.equal((await apiAs("admin", "POST", `/api/admin/portal/gyms/${state.gym}/staff`, { phone: identities.gym.phone })).status, 201);
    // Ravi: High (80); Sneha: Medium (50); Steady: Low, never listed
    state.ravi = await admit("Ravi Kumar", { expiresIn: 5, due: 800 });
    await visits(state.ravi, [12, 20, 40, 45]);
    state.sneha = await admit("Sneha R", { expiresIn: 6 });
    await visits(state.sneha, [2, 4, 6, 35, 36, 38, 40, 42, 44, 46, 48]);
    state.steady = await admit("Steady Sam", { expiresIn: 90 });
    await visits(state.steady, [1, 3]);
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
        for (const table of ["gym_attendance", "gym_payments", "gym_enquiries", "gym_catalog_items", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id = ?`, [state.gym]);
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

  it("1. Home counts the one High-risk member under Needs attention and opens the list", run("predictions-home", async () => {
    await viewport(390, 844);
    await signIn(identities.gym, "/gym");
    await h.expectPath("/gym");
    await page.waitFor(`!!document.querySelector('[aria-label="1 Likely to leave, Risk"]')`, NAV_TIMEOUT, "Likely to leave 1 on Home");
    assert.ok(await hasLabel("1 Due Members, Action"), "the other rows are as before");
    await clickLabel("1 Likely to leave, Risk");
    await h.expectPath("/gym/predictions/renewals");
    await h.expectText("Likely to leave");
  }));

  it("2. the list: Ravi High 80 with his reasons, Sneha Medium 50, the steady member absent", run("predictions-list", async () => {
    await h.expectText("Ravi Kumar");
    await h.expectText("High · 80");
    await h.expectText("Plan ends in 5 days · No visit in 12 days · ₹800 due");
    await h.expectText("Sneha R");
    await h.expectText("Medium · 50");
    await h.expectText("Visits down from 8 to 3 a month");
    await h.expectText("Updated ");
    await h.expectNoText("Steady Sam");
    const tabs = await page.evaluate(`[...document.querySelectorAll('[role="tab"]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute("aria-label"))`);
    assert.deepEqual(tabs, ["All, 2", "High, 1", "Medium, 1"]);
    const order = await page.evaluate(`(document.body.innerText || "").indexOf("Ravi Kumar") < (document.body.innerText || "").indexOf("Sneha R")`);
    assert.equal(order, true, "highest risk first");
    assert.ok(await hasLabel("WhatsApp Ravi Kumar a renewal reminder"));
    assert.ok(await hasLabel("Call Ravi Kumar"));
    await snapshotAllWidths("gym-predictions");
  }));

  it("3. the level tabs and the search narrow the list; a level with no one shows the empty state", run("predictions-filter", async () => {
    await clickLabel("Medium, 1");
    await h.expectText("Sneha R");
    await h.expectNoText("Ravi Kumar");
    await clickLabel("High, 1");
    await h.expectText("Ravi Kumar");
    await h.expectNoText("Sneha R");
    await clickLabel("Search members at risk");
    await page.setInput(h.input("Search by name, phone or ID"), "sneha");
    await h.expectText("No one matches");
    await snapshotAllWidths("gym-predictions-empty");
    // The counts follow the search: one Medium match, no High
    await clickLabel("All, 1");
    await h.expectText("Sneha R");
    await h.expectNoText("Ravi Kumar");
    await clickLabel("Close search");
    await h.expectText("Ravi Kumar");
    assert.ok(await hasLabel("All, 2"), "the full counts are back once the search is cleared");
  }));

  it("4. ⋯ opens the member's usual options, and the ☰ menu has the entry", run("predictions-options", async () => {
    await clickLabel("Ravi Kumar: options");
    await h.expectText("Renew Member");
    await h.expectText("Collect Payment Due : ₹800");
    await snapshotAllWidths("gym-predictions-options");
    await page.navigate(`${expo.baseUrl}/gym`);
    await clickLabel("Menu");
    // Wait for the menu itself (Home already says "Likely to leave" in Needs attention)
    await h.expectText("Forma · Tumkur branch");
    await h.settle();
    await clickLabel("Likely to leave");
    await h.expectPath("/gym/predictions/renewals");
  }));

  it("5. QR Attendance shows tomorrow's busy hours: the 7 am visits on the last same weekdays average to 1", run("predictions-busy", async () => {
    // Tomorrow's weekday fell on today−6 (Sneha's visit) and today−20 (Ravi's), both at 7:15 am;
    // the other two weeks had none: 1, 0, 1, 0 → about 1, busiest 7–8 am
    await page.navigate(`${expo.baseUrl}/gym/attendance`);
    await h.expectText("TOMORROW'S BUSY HOURS"); // the section title is upper-cased by its style
    await h.expectText("About 1 check-in expected");
    await h.expectText("7–8 am");
    await h.expectText("Busiest · 1 expected");
    await h.expectText("Average of the last 4 ");
    await snapshotScrolledTo("Tomorrow's busy hours", "gym-busy-hours");
  }));

  it("6. Wallet shows the month-end estimate: collected so far, and the parts that still need history", run("predictions-revenue", async () => {
    // Three admissions today (₹3,700 + ₹4,500 + ₹4,500); no renewal history yet, so the estimate is partial
    await page.navigate(`${expo.baseUrl}/gym`);
    await h.expectText("Needs attention");
    await clickTab("Wallet");
    await h.expectText("EXPECTED BY MONTH END");
    await h.expectText("≥ ₹12,700");
    await h.expectText("Collected so far");
    await h.expectText("A partial estimate");
    await h.expectText("Likely renewals");
    await h.expectText("Likely dues collected");
    await snapshotScrolledTo("Expected by month end", "gym-revenue-forecast");
  }));
});
