// Regression tests for verified visual defects on web: the Google logo's size inside its
// button, and the onboarding artwork's rendered size and placement, plus the carousel's
// behaviour around it. Signed out, nothing submitted, nothing written.
//
//   yarn test:ui      (needs Eato_server/.env.test and Google Chrome; otherwise skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "eato-ui-evidence");
const LOGO_SIZE = 20; // the button's 20 × 20 logo
const AUTO_ADVANCE_MS = 1800; // onboarding slides advance on their own this often

describe("ui visual fixes: Google logo size and onboarding artwork", () => {
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, h;

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
  // Plain size override: mobile emulation zooms the viewport out when a page overflows
  // horizontally, and the zoom persists across sizes, which skews pointer coordinates
  const viewport = (width, height) => client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, page.sessionId);
  // Rendered box of the image whose file name contains `name`, with its page geometry
  const imageBox = (name) => page.evaluate(`(() => { const img = [...document.querySelectorAll("img")].find((i) => (i.currentSrc || i.src).includes(${JSON.stringify(name)})); if (!img) return null; const r = img.getBoundingClientRect(); const btn = img.closest('[tabindex="0"]'); const b = btn ? btn.getBoundingClientRect() : null; return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), natural: [img.naturalWidth, img.naturalHeight], complete: img.complete, clientWidth: document.documentElement.clientWidth, button: b ? { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) } : null }; })()`);
  const waitForImage = async (name) => page.waitFor(`(() => { const img = [...document.querySelectorAll("img")].find((i) => (i.currentSrc || i.src).includes(${JSON.stringify(name)})); return !!img && img.complete && img.naturalWidth > 0; })()`, 20000, `image ${name} loaded`);

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    countsBefore = await db.rowCounts(connection);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    await step("row counts unchanged", async () => {
      if (!connection) return;
      try { assert.deepEqual(await db.rowCounts(connection), countsBefore, "rows changed during a signed-out UI test"); }
      finally { await connection.end(); }
    });
    await step("ports released", async () => {
      for (const port of [env ? Number(env.PORT) : 4100, EXPO_PORT]) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !(await portFree(port))) await new Promise((r) => setTimeout(r, 250));
        assert.ok(await portFree(port), `port ${port} was not released`);
      }
    });
    await step("profile removed", async () => { if (chrome) assert.ok(!fs.existsSync(chrome.profile), "temporary Chrome profile was not removed"); });
    if (problems.length > 0) throw new Error("teardown problems: " + problems.join("; "));
  });

  it("1. the Google logo renders at its intended size on the sign-in and sign-up screens", run("logo-size", async () => {
    await viewport(390, 844);
    for (const [route, text] of [["/sign-in", "Log in"], ["/sign-up", "Create account"]]) {
      await h.goto(route, text);
      await waitForImage("google-logo");
      const box = await imageBox("google-logo");
      assert.ok(box, `${route}: Google logo not rendered`);
      assert.deepEqual({ w: box.w, h: box.h }, { w: LOGO_SIZE, h: LOGO_SIZE }, `${route}: logo size`);
    }
  }));

  it("2. the logo stays inside its button, vertically centred", run("logo-in-button", async () => {
    const box = await imageBox("google-logo");
    assert.ok(box.button, "logo is not inside a pressable button");
    assert.ok(box.top >= box.button.top && box.bottom <= box.button.bottom && box.left >= box.button.left && box.right <= box.button.right, "logo overflows its button");
    const logoMid = (box.top + box.bottom) / 2, buttonMid = (box.button.top + box.button.bottom) / 2;
    assert.ok(Math.abs(logoMid - buttonMid) <= 2, "logo is not vertically centred in the button");
    assert.equal(box.button.h, 44, "button height must be unchanged");
  }));

  it("3. the onboarding artwork renders with real height at its natural aspect ratio", run("art-visible", async () => {
    await h.goto("/", "Get Started");
    await waitForImage("onboarding-art-meals");
    const box = await imageBox("onboarding-art-meals");
    assert.ok(box.h > 100, `artwork height is ${box.h}px`);
    assert.ok(box.w > 100, `artwork width is ${box.w}px`);
    // contentFit "contain" keeps the aspect ratio: the box is never wider than the ratio allows
    const [nw, nh] = box.natural;
    assert.ok(box.h <= Math.ceil(box.w * (nh / nw)) + 1, "artwork is taller than its aspect ratio allows");
  }));

  it("4. at 320 px the artwork stays inside the screen width", run("art-320", async () => {
    await viewport(320, 568);
    await h.goto("/", "Get Started");
    await waitForImage("onboarding-art-meals");
    const box = await imageBox("onboarding-art-meals");
    assert.ok(box.h > 50, `artwork height at 320px is ${box.h}px`);
    assert.ok(box.left >= 0 && box.right <= box.clientWidth, `artwork spans ${box.left}..${box.right} in a ${box.clientWidth}px viewport`);
    // The title block above the art is not covered by it
    const titleBottom = await page.evaluate(`(() => { const t = [...document.querySelectorAll("body *")].find((e) => e.childElementCount === 0 && (e.textContent || "").startsWith("Fresh. Nutritious.")); return t ? Math.round(t.getBoundingClientRect().bottom) : null; })()`);
    assert.ok(titleBottom !== null && box.top >= titleBottom - 8, "artwork overlaps the subtitle");
  }));

  it("5. the carousel still auto-advances and the buttons still navigate", run("carousel", async () => {
    await viewport(390, 844);
    await h.goto("/", "Get Started");
    const dots = await page.evaluate(`document.querySelectorAll('[class*="onboarding__dot"]').length`);
    assert.equal(dots, 3, "three slide dots");
    const firstSlideTitle = await page.evaluate(`(() => { const t = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").includes("Healthy meals")); return t.length; })()`);
    assert.ok(firstSlideTitle >= 1);
    // After one interval the list has scrolled to the second slide
    await page.waitFor(`(() => { const list = [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).overflowX === "scroll" || getComputedStyle(d).overflowX === "auto"); return !!list && list.scrollLeft >= ${300}; })()`, AUTO_ADVANCE_MS + 3000, "carousel advanced to the second slide");
    // Navigation checks on freshly loaded screens: go elsewhere first, since loading the URL
    // the page already shows resolves against the old document before the reload lands
    await h.goto("/sign-up", "Create account");
    await h.goto("/", "Get Started");
    await page.clickText("Log in");
    await h.expectPath("/sign-in");
    await h.goto("/", "Get Started");
    await page.clickText("Get Started");
    await h.expectPath("/sign-up");
  }));
});
