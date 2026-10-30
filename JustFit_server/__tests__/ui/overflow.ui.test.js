// Regression tests for horizontal overflow on the signed-out screens: the page must never be
// wider than the viewport, the decorative circles must still show at the screen edge, and
// titles and primary buttons must stay fully inside the viewport. Signed out, nothing written.
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
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
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const WIDTHS = [[320, 568], [375, 812], [430, 932]];
// route, text that proves it rendered, its title utility, its primary button label, its decorative circle utility
const ROUTES = [
  ["/", "Get Started", "onboarding__title", "Get Started", "onboarding__circle"],
  ["/sign-up", "Create your", "auth__title", "Send code", "auth__circle"],
  ["/sign-in", "Log in with your mobile number", "auth__title", "Send code", "auth__circle"],
];

describe("ui overflow: signed-out screens never widen the page", () => {
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, h;

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | visible text: "${text}"`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  // Plain size override (mobile emulation would zoom out an overflowing page and hide the defect)
  const viewport = (width, height) => client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, page.sessionId);
  const measure = (titleClass, buttonLabel, circleClass) => page.evaluate(`(() => {
    const vw = innerWidth;
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) }; };
    const byClass = (c) => [...document.querySelectorAll("[class]")].filter((e) => e.className.toString().split(" ").includes(c) && e.getClientRects().length > 0);
    const title = byClass(${JSON.stringify(titleClass)})[0];
    const button = [...document.querySelectorAll("body *")].find((e) => e.childElementCount === 0 && (e.textContent || "").trim() === ${JSON.stringify(buttonLabel)} && e.getClientRects().length > 0);
    const buttonBox = button ? button.closest('[tabindex="0"]') || button : null;
    return { vw, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
      title: title ? box(title) : null, button: buttonBox ? box(buttonBox) : null, circles: byClass(${JSON.stringify(circleClass)}).map(box) };
  })()`);

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

  for (const [width, height] of WIDTHS) {
    it(`${width}px: no horizontal overflow, circles visible at the edge, titles and buttons inside the viewport`, run(`overflow-${width}`, async () => {
      await viewport(width, height);
      for (const [route, text, titleClass, buttonLabel, circleClass] of ROUTES) {
        await h.goto(route, text);
        const m = await measure(titleClass, buttonLabel, circleClass);
        assert.equal(m.vw, width, `${route}: viewport width`);
        assert.equal(m.scrollWidth, width, `${route}: document is ${m.scrollWidth}px wide in a ${width}px viewport`);
        assert.equal(m.bodyScrollWidth, width, `${route}: body is ${m.bodyScrollWidth}px wide`);
        assert.ok(m.title, `${route}: title not rendered`);
        assert.ok(m.title.left >= 0 && m.title.right <= width, `${route}: title spans ${m.title.left}..${m.title.right}`);
        assert.ok(m.button, `${route}: primary button "${buttonLabel}" not rendered`);
        assert.ok(m.button.left >= 0 && m.button.right <= width && m.button.height >= 40, `${route}: button spans ${m.button.left}..${m.button.right} (h ${m.button.height})`);
        assert.ok(m.circles.length >= 1, `${route}: decorative circle not rendered`);
        for (const c of m.circles) {
          // Still drawn at the screen edge: part of it is inside the viewport, at its full designed size
          const visible = Math.min(c.right, width) - Math.max(c.left, 0);
          assert.ok(c.width > 40 && visible > 10, `${route}: circle ${c.left}..${c.right} (w ${c.width}) is not visible at the edge`);
        }
      }
    }));
  }
});
