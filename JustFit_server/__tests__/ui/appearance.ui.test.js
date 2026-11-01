// Dark mode in the real Expo web build (2026-11-01). The browser is switched to the dark
// appearance (CDP media emulation, which is what the phone's setting does for the app), then
// the signed-out screens and the member's five tabs are opened. On each screen:
//   - the page is the dark page colour, not white
//   - no large surface (a card, a sheet, a field) is still painted white
//   - text has enough contrast with what is behind it (4.5:1 for body text, 3:1 for large)
// and screenshots are saved at three widths. The light look is covered by every other suite.
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
const DARK_PAGE = "rgb(15, 15, 17)"; // --color-background in dark (tokens.css)

// Runs in the page: the problems on screen, as short strings
const AUDIT = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(",").map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== "hidden" && Number(getComputedStyle(e).opacity) > 0.2; };
  const label = (e) => (e.getAttribute("aria-label") || e.innerText || e.className || e.tagName).toString().trim().replace(/\\s+/g, " ").slice(0, 50);
  // Things that are white on purpose: QR codes, photos, and anything inside a dark/red hero
  const onPurpose = (e) => !!e.closest('[aria-label*="QR"], img') || !!e.querySelector("img, canvas");
  const problems = [];
  for (const e of document.querySelectorAll("body *")) {
    if (!visible(e)) continue;
    const s = getComputedStyle(e);
    const bg = parse(s.backgroundColor);
    const r = e.getBoundingClientRect();
    if (bg && bg.a > 0.9 && bg.r > 245 && bg.g > 245 && bg.b > 245 && r.width * r.height > 2500 && !onPurpose(e)) problems.push("white surface: " + label(e));
  }
  // Text contrast: each visible text leaf against the first opaque background behind it
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.trim();
    const e = n.parentElement;
    if (!text || !e || seen.has(e) || !visible(e)) continue;
    seen.add(e);
    // What is under the middle of the text, top to bottom: a photo means the text was styled
    // for that photo (skipped); otherwise the first opaque colour is its background
    const box = e.getBoundingClientRect();
    const stack = document.elementsFromPoint(Math.min(innerWidth - 1, Math.max(0, box.left + box.width / 2)), Math.min(innerHeight - 1, Math.max(0, box.top + box.height / 2)));
    const at = stack.indexOf(e);
    if (at < 0) continue; // covered by something else (a sheet, the tab bar): not readable here anyway
    let back = null, overImage = false;
    for (const p of stack.slice(at)) {
      if (p.tagName === "IMG" || p.tagName === "CANVAS" || getComputedStyle(p).backgroundImage !== "none") { overImage = true; break; }
      const c = parse(getComputedStyle(p).backgroundColor);
      if (c && c.a > 0.85) { back = c; break; }
    }
    if (overImage || !back) continue;
    const fg = parse(getComputedStyle(e).color);
    if (!fg || fg.a < 0.5) continue;
    const size = parseFloat(getComputedStyle(e).fontSize);
    const need = size >= 18 ? 3 : 4.5;
    const got = ratio(fg, back);
    if (got < need) problems.push("low contrast " + got.toFixed(2) + ": " + text.slice(0, 40) + " (" + getComputedStyle(e).color + " on " + "rgb(" + back.r + ", " + back.g + ", " + back.b + "))");
  }
  return [...new Set(problems)];
})()`;

describe("ui appearance: dark mode follows the phone's setting", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot}`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  const viewport = (width, height) => client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true }, page.sessionId);
  const appearance = (value) => client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] }, page.sessionId);
  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === ${JSON.stringify(label)} && e.getClientRects().length > 0); if (!els.length) return null; const el = els.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `tab ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  // Every width: a screenshot, then the audit (it reads only what is on screen)
  const checkScreen = async (name) => {
    const found = new Set();
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await h.settle();
      if (SCREENSHOT_DIR) { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); await page.screenshot(path.join(SCREENSHOT_DIR, `dark-${name}-${w}.png`)); }
      for (const problem of await page.evaluate(AUDIT)) found.add(problem);
    }
    await viewport(390, 844);
    assert.deepEqual([...found], [], `${name} in dark mode`);
  };
  const pageColour = () => page.evaluate(`(() => { const el = [...document.querySelectorAll("body *")].find((e) => { const r = e.getBoundingClientRect(); return r.width >= innerWidth && r.height >= innerHeight * 0.8 && getComputedStyle(e).backgroundColor !== "rgba(0, 0, 0, 0)"; }); return el ? getComputedStyle(el).backgroundColor : getComputedStyle(document.body).backgroundColor; })()`);

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" });
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    try {
      identities.a = await testAccounts.createIdentity(runId, "a");
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await testAccounts.setProfileComplete(identities.a.id, true);
    await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, 'Priya Sharma', 'user') ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [identities.a.id, identities.a.emailAddress]);
    await connection.query(
      `INSERT INTO nutrition_targets (user_id, formula, config_version, inputs, calculated, calculated_at, calories, protein_g, carbs_g, fat_g)
       VALUES (?, 'justfit-calculator', 'test', ?, ?, NOW(), 2000, 150, 200, 60)`,
      [
        identities.a.id,
        JSON.stringify({ age: 30, gender: "female", heightCm: 165, weightKg: 70, activityLevel: "lightly_active", fitnessGoal: "fat_loss" }),
        JSON.stringify({ rmrFormula: "mifflin_st_jeor", report: null, rmr: 1400, tdee: 1925, targetCalories: 1525, displayCalories: 1550, macros: { proteinG: 140, carbsG: 146, fatG: 43 } }),
      ],
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
      const ids = Object.values(identities).map((i) => i.id);
      if (ids.length) await connection.query("DELETE FROM nutrition_targets WHERE user_id IN (?)", [ids]);
      await db.deleteUsers(connection, ids);
      await connection.end();
    });
    await step("identities", async () => { if (testAccounts) for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id); });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. signed out: onboarding and Log in are dark, readable, and keep the logo", run("signed-out", async () => {
    await viewport(390, 844);
    await appearance("dark");
    await h.goto("/", "Get Started");
    assert.equal(await pageColour(), DARK_PAGE, "the onboarding page is the dark page colour");
    await checkScreen("onboarding");
    await h.goto("/sign-in", "Send code");
    await checkScreen("sign-in");
  }));

  it("2. the member's tabs: Home, Meals, AI Coach, Macro and Workout", run("tabs", async () => {
    await appearance("light");
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await appearance("dark");
    await h.settle();
    assert.equal(await pageColour(), DARK_PAGE, "Home is the dark page colour");
    await checkScreen("home");
    for (const [tab, route, name] of [["Meals", "/meals", "meals"], ["AI Coach", "/coach", "coach"], ["Macro", "/macro", "macro"], ["Workout", "/workout", "workout"]]) {
      await clickTab(tab);
      await h.expectPath(route);
      await h.settle();
      await checkScreen(name);
    }
  }));

  it("3. switching back to light while the app is open repaints it light", run("back-to-light", async () => {
    await appearance("light");
    await h.settle();
    assert.equal(await pageColour(), "rgb(244, 244, 245)", "the light page colour returns without a reload");
  }));

  it("4. Profile › Appearance offers Light, Dark and System, with Light chosen by default", run("profile-appearance", async () => {
    await clickTab("Home");
    await h.expectPath("/home");
    const pos = await page.waitFor(`(() => { const el = document.querySelector('[aria-label="Profile"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, "the profile avatar");
    await page.clickAt(pos.x, pos.y);
    await h.expectPath("/profile");
    await h.expectText("Appearance");
    const choices = await page.evaluate(`[...document.querySelectorAll('[aria-label="Appearance"] [role="radio"]')].map((e) => e.getAttribute("aria-label") + ":" + e.getAttribute("aria-checked"))`);
    assert.deepEqual(choices, ["Light:true", "Dark:false", "System:false"], "Light is the default choice");
    await page.evaluate(`document.querySelector('[aria-label="Appearance"]').scrollIntoView({ block: "center" })`);
    await h.settle();
    if (SCREENSHOT_DIR) await page.screenshot(path.join(SCREENSHOT_DIR, "profile-appearance-390.png"));
    await appearance("dark");
    await h.settle();
    if (SCREENSHOT_DIR) await page.screenshot(path.join(SCREENSHOT_DIR, "dark-profile-appearance-390.png"));
    assert.deepEqual(await page.evaluate(AUDIT), [], "Profile in dark mode");
    await appearance("light");
  }));
});
