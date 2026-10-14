// Regression tests for expired-session recovery. A genuine Clerk development identity
// signs in through the real screens; the server's answers to the app's own requests are
// then simulated inside the page (fetch replaced for /api/profile and /api/body-composition
// only) to produce 401, 500 and network failures. This proves the app's handling of each
// status; it does not revoke a real Clerk session, which needs a device test.
//
//   yarn test:ui      (needs Eato_server/.env.test and Google Chrome; otherwise skipped)
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
const { fillSetup, helpers } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "eato-ui-evidence");
const CLERK_TEST_CODE = "424242";
const EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
// A 1×1 PNG for the photo upload path (never stored: the request is answered by the stub).
// The PDF path is not used: expo-file-system's File is unavailable on web, a separate finding.
const TINY_PNG = path.join(os.tmpdir(), "eato-session-test.png");
const TINY_PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("ui session recovery: 401 offers sign-in, other failures keep the session", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, clerk, h;
  const identities = {};

  const consoleLines = [];
  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | visible text: "${text}" | console: ${JSON.stringify(consoleLines.slice(-4))}`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  const apiUrl = () => `http://localhost:${env.PORT}`;
  // Replace the page's fetch for the app's own API paths only; Clerk's requests are untouched.
  // mode: "401" | "500" | "network" | "off"
  const stubApi = (mode) => page.evaluate(`(() => {
    if (!window.__realFetch) window.__realFetch = window.fetch;
    const mode = ${JSON.stringify(mode)};
    if (mode === "off") { window.fetch = window.__realFetch; return "restored"; }
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (!/\\/api\\/(profile|body-composition)\\b/.test(url)) return window.__realFetch(input, init);
      if (mode === "network") return Promise.reject(new TypeError("Failed to fetch"));
      const body = mode === "401" ? { error: "Please sign in again." } : { error: "Something went wrong. Please try again." };
      return Promise.resolve(new Response(JSON.stringify(body), { status: Number(mode), headers: { "content-type": "application/json" } }));
    };
    return "stubbed " + mode;
  })()`);
  const hasSession = () => page.evaluate(`!!(window.Clerk && window.Clerk.session)`);
  const alertText = () => page.evaluate(`(() => { const a = document.querySelector('[role="alert"]'); return a ? a.innerText.trim() : ""; })()`);
  const signInAs = async (identity) => {
    await h.goto("/sign-in", "Log in");
    if (await hasSession()) { await page.evaluate(`window.Clerk.signOut({ redirectUrl: "/sign-in" })`); await page.waitFor(`!(window.Clerk && window.Clerk.session)`, 15000, "previous session ended"); await h.goto("/sign-in", "Log in"); }
    await page.setInput('input[placeholder="Email address"]', identity.emailAddress);
    await page.setInput('input[placeholder="Password"]', identity.password);
    await page.clickText("Log in");
    const outcome = await page.waitFor(`(() => { if (location.pathname.startsWith("/setup") || location.pathname === "/home") return "routed"; if ((document.body.innerText || "").includes("Check your email")) return "code"; return ""; })()`, 60000, "sign-in outcome");
    if (outcome === "code") { await page.setInput('input[maxlength="6"]', CLERK_TEST_CODE); await page.waitFor(`location.pathname.startsWith("/setup") || location.pathname === "/home"`, 60000, "route after code"); }
    await h.settle();
  };
  const toTargets = async () => {
    await h.goto("/setup/personal", "Let's get to know you");
    await fillSetup(page, expo.baseUrl, { fullName: "Session Tester" });
  };
  const cleanupIdentity = async (tag) => {
    const identity = identities[tag]; if (!identity) return;
    await db.deleteUsers(connection, [identity.id]);
    await clerk.deleteUser(identity.id);
    delete identities[tag];
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    countsBefore = await db.rowCounts(connection);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    await clerk.sweepOrphans();
    fs.writeFileSync(TINY_PNG, TINY_PNG_BYTES);
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: apiUrl() });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    client.on((m) => { if (m.sessionId !== page.sessionId) return; if (m.method === "Runtime.exceptionThrown") consoleLines.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200)); if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) consoleLines.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200)); });
    h = helpers(page, expo.baseUrl);
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    try { identities.a = await clerk.createIdentity(runId, "a", { withPassword: true }); } catch (error) { throw new Error(`Clerk could not create the test identity: ${JSON.stringify(describeClerkError(error))}`); }
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    if (connection && clerk) {
      for (const tag of Object.keys(identities)) await step(`cleanup identity ${tag} (${identities[tag]?.id})`, () => cleanupIdentity(tag));
      await step("row counts back to baseline", async () => { assert.deepEqual(await db.rowCounts(connection), countsBefore); });
    }
    await step("close database", async () => { if (connection) await connection.end(); });
    await step("remove temp image", async () => { fs.rmSync(TINY_PNG, { force: true }); });
    await step("ports released", async () => {
      for (const port of [env ? Number(env.PORT) : 4100, EXPO_PORT]) {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !(await portFree(port))) await new Promise((r) => setTimeout(r, 250));
        assert.ok(await portFree(port), `port ${port} was not released`);
      }
    });
    await step("profile removed", async () => { if (chrome) assert.ok(!fs.existsSync(chrome.profile), "temporary Chrome profile was not removed"); });
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE; orphaned test identifiers:", Object.values(identities).map((i) => i.id).join(", ") || "none"); throw new Error("teardown problems: " + problems.join("; ")); }
  });

  it("1. a 401 on Finish shows the sign-in-again message and a button that reaches sign-in with the session ended", run("targets-401", async () => {
    await signInAs(identities.a);
    await toTargets();
    assert.equal(await stubApi("401"), "stubbed 401");
    await page.clickText("Finish");
    await h.expectText(EXPIRED_MESSAGE);
    assert.ok((await alertText()).includes(EXPIRED_MESSAGE), "the alert carries the sign-in-again message");
    assert.equal(await page.path(), "/setup/targets", "no automatic navigation on the failure itself");
    assert.ok(await page.hasText("Sign in again"));
    await page.clickText("Sign in again");
    await h.expectPath("/sign-in");
    await page.waitFor(`!(window.Clerk && window.Clerk.session)`, 15000, "session ended");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 0 }, "nothing was saved");
  }));

  it("2. a 500 on Finish shows the generic error, keeps the session and offers no sign-out", run("targets-500", async () => {
    await signInAs(identities.a);
    await toTargets();
    await stubApi("500");
    await page.clickText("Finish");
    await h.expectText("Something went wrong. Please try again.");
    assert.equal(await page.path(), "/setup/targets");
    assert.equal(await page.hasText("Sign in again"), false, "a server error must not offer sign-out");
    assert.equal(await hasSession(), true, "the session must survive a server error");
  }));

  it("3. a network failure on Finish keeps the retry behaviour: message, same screen, session intact, Finish still usable", run("targets-network", async () => {
    await stubApi("network");
    await page.clickText("Finish");
    await h.expectText("Couldn't reach the server. Check your connection and try again.");
    assert.equal(await page.path(), "/setup/targets");
    assert.equal(await page.hasText("Sign in again"), false);
    assert.equal(await hasSession(), true);
    assert.notEqual(await page.evaluate(`(() => { const t = [...document.querySelectorAll("body *")].find((e) => e.childElementCount === 0 && (e.textContent || "").trim() === "Finish"); let el = t; for (let i = 0; i < 5 && el; i++) { if (el.getAttribute("aria-disabled") !== null) return el.getAttribute("aria-disabled"); el = el.parentElement; } return null; })()`), "true", "Finish is enabled again for a retry");
  }));

  it("4. with the stub removed, Finish succeeds and saves the profile as before", run("targets-ok", async () => {
    assert.equal(await stubApi("off"), "restored");
    await page.clickText("Finish");
    await h.expectPath("/home");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 });
  }));

  it("5. a 401 while reading an uploaded photo report shows the message and the sign-in button on the upload card", run("upload-401", async () => {
    await h.goto("/setup/body-composition", "Body composition");
    await page.evaluate(`window.addEventListener("unhandledrejection", (e) => console.error("unhandled rejection: " + String(e.reason && e.reason.stack || e.reason).slice(0, 300)))`);
    await stubApi("401");
    // "Choose from gallery" opens the browser's file chooser on a hidden input. Headless Chrome
    // may cancel that dialog at once (and the picker then removes its input), so intercept the
    // chooser through DevTools: Chrome reports the input it belongs to, and the file goes in there.
    await client.send("Page.enable", {}, page.sessionId); // Page events (idempotent)
    await client.send("Page.setInterceptFileChooserDialog", { enabled: true }, page.sessionId);
    const chooser = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the image picker did not open a file chooser")), 10000);
      client.on((m) => { if (m.sessionId === page.sessionId && m.method === "Page.fileChooserOpened") { clearTimeout(timer); resolve(m.params); } });
    });
    await page.clickText("Choose from gallery");
    const { backendNodeId } = await chooser;
    await client.send("DOM.setFileInputFiles", { backendNodeId, files: [TINY_PNG] }, page.sessionId);
    await client.send("Page.setInterceptFileChooserDialog", { enabled: false }, page.sessionId);
    await h.expectText(EXPIRED_MESSAGE);
    assert.ok(await page.hasText("Sign in again"));
    assert.equal(await page.path(), "/setup/body-composition");
    await page.clickText("Sign in again");
    await h.expectPath("/sign-in");
    await page.waitFor(`!(window.Clerk && window.Clerk.session)`, 15000, "session ended");
  }));
});
