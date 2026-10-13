// Phase 9, step 1: browser smoke test. Real Expo web build of the client in headless
// Chrome, pointed at the isolated Express test server. Signed-out only: it opens the
// start route and checks that the onboarding screen renders. No sign-in, no Clerk
// identities, no onboarding submission, no database rows.
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

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "eato-ui-evidence");

describe("ui smoke: Expo web → headless Chrome → onboarding renders", () => {
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page;
  const apiUrl = () => `http://localhost:${env.PORT}`;

  // Saves a screenshot and the visible text when something goes wrong (page text only)
  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 400).replace(/\s+/g, " ");
    return `screenshot: ${shot} | visible text: "${text}"`;
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    countsBefore = await db.rowCounts(connection);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: apiUrl() });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
  });

  // Each step runs even if an earlier one fails, so no child process can be left behind
  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    await step("row counts unchanged", async () => {
      if (!connection) return;
      try { assert.deepEqual(await db.rowCounts(connection), countsBefore, "test database rows changed during a read-only smoke test"); }
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

  it("1. the web bundle is built against the test server, never port 4000", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const html = await (await fetch(`${expo.baseUrl}/`)).text();
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(scripts.length > 0, "no script tags in the served page");
    let bundle = "";
    for (const src of scripts) bundle += await (await fetch(src.startsWith("http") ? src : `${expo.baseUrl}${src}`)).text();
    assert.ok(bundle.includes(apiUrl()), "EXPO_PUBLIC_API_URL for the test server was not inlined into the bundle");
    assert.ok(!bundle.includes("localhost:4000") && !bundle.includes("127.0.0.1:4000"), "bundle references the development server port");
  });

  it("2. the start route renders the onboarding screen", async (t) => {
    if (skipReason) return t.skip(skipReason);
    await page.navigate(`${expo.baseUrl}/`);
    try {
      const text = await page.waitFor(
        `(() => { const t = document.body && document.body.innerText || ""; return t.includes("Get Started") && t.includes("Log in") ? t : ""; })()`,
        120000, "onboarding screen text ('Get Started' and 'Log in')",
      );
      assert.ok(text.includes("Get Started"));
      assert.ok(text.includes("Already have an account?"));
    } catch (error) {
      throw new Error(`${error.message}\n${await evidence("start-route")}\nexpo log tail:\n${expo.logs.slice(-6).join("\n")}`);
    }
  });

  it("3. the browser made no request to port 4000 while rendering", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const toDev = page.requests.filter((u) => /\/\/(localhost|127\.0\.0\.1):4000\b/.test(u));
    assert.deepEqual(toDev, [], "requests to the development server were observed");
    assert.ok(page.requests.some((u) => u.startsWith(expo.baseUrl)), "no requests to the Expo web server were observed");
  });

  it("4. nothing was written: test database row counts unchanged", async (t) => {
    if (skipReason) return t.skip(skipReason);
    assert.deepEqual(await db.rowCounts(connection), countsBefore);
  });
});
