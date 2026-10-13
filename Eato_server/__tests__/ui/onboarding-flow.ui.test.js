// Phase 9, step 2: unauthenticated onboarding UI validation. Drives the real Expo web
// build in headless Chrome through every setup step using only the screens' visible
// labels and placeholders. Signed out throughout: the setup routes are not auth-gated,
// and the Finish handler does nothing without a signed-in user, which test 10 proves.
// No Clerk identity, no sign-in, no profile request, no database write.
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
const nutrition = require("../../../Eato_client/src/lib/nutrition/index.ts");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "eato-ui-evidence");
const NAV_TIMEOUT = 20000;

// The answers the test enters, and what the calculator must show for them
const AGE = 30;
const birth = new Date(); birth.setFullYear(birth.getFullYear() - AGE);
const pad = (n) => String(n).padStart(2, "0");
const dobInput = `${birth.getFullYear()}-${pad(birth.getMonth() + 1)}-${pad(birth.getDate())}`; // what the web date field takes
const dobShown = birth.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); // what the field then displays
const answers = { fullName: "E2E Tester", phone: "9876543210", email: "e2e-ui@example.com", heightCm: "170", weightKg: "60" };
const expected = nutrition.calculateTargets({ age: AGE, gender: "female", heightCm: 170, weightKg: 60, activityLevel: "lightly_active", fitnessGoal: "fat_loss", healthFlags: [] });
assert.equal(expected.status, "ok");
const expectedCalories = expected.displayCalories.toLocaleString("en-IN");

describe("ui flow: unauthenticated onboarding steps in Expo web", () => {
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page;

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 400).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | visible text: "${text}"`;
  };
  // Runs a test body; on failure attaches a screenshot path and the visible text
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  const settle = () => new Promise((r) => setTimeout(r, 1000)); // the tree becomes interactive shortly after its text appears
  const expectText = (text) => page.waitFor(`(document.body.innerText || "").includes(${JSON.stringify(text)})`, NAV_TIMEOUT, `text "${text}"`);
  // Loads a route and waits for a piece of its text (the app may redirect, e.g. "/" → "/onboarding")
  const goto = async (route, text) => { await page.navigate(`${expo.baseUrl}${route}`); await expectText(text); await settle(); };
  const expectPath = async (route) => { await page.waitFor(`location.pathname === ${JSON.stringify(route)}`, NAV_TIMEOUT, `navigation to ${route}`); await settle(); };
  const next = async (label = "Next") => { await page.clickText(label); };
  // The footer button must be rendered disabled, and clicking it must leave the route unchanged
  const assertStuck = async (route, label = "Next") => {
    const disabled = await page.evaluate(`(() => { const t = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === ${JSON.stringify(label)} && e.getClientRects().length > 0).pop(); let el = t; for (let i = 0; i < 5 && el; i++) { if (el.getAttribute("aria-disabled") !== null) return el.getAttribute("aria-disabled"); el = el.parentElement; } return null; })()`);
    assert.equal(disabled, "true", `${label} should render as disabled on ${route}`);
    await page.clickText(label);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await page.path(), route, `${label} should not navigate on ${route}`);
  };
  const input = (placeholder) => `input[placeholder=${JSON.stringify(placeholder)}]`;

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
      try { assert.deepEqual(await db.rowCounts(connection), countsBefore, "test database rows changed during an unauthenticated UI test"); }
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

  it("1. landing → Get Started reaches sign-up; setup is reachable directly and step 1 can be skipped", run("landing", async () => {
    await goto("/", "Get Started");
    await page.clickText("Get Started");
    await expectPath("/sign-up");
    await expectText("Create account");
    // Signed out, the only way into setup is the route itself (the app would send a signed-in user here)
    await goto("/setup/body-composition", "Body composition");
    await expectText("1/7");
    await page.clickText("Skip, I'll enter manually");
    await expectPath("/setup/personal");
    await expectText("2/7");
  }));

  it("2. personal: Next stays disabled until name, date of birth, phone and email are valid", run("personal-required", async () => {
    await goto("/setup/personal", "Let's get to know you");
    await assertStuck("/setup/personal");
    await page.setInput(input("Your full name"), answers.fullName);
    await assertStuck("/setup/personal");
    // Date of birth: a sheet whose field takes YYYY-MM-DD (react-native-web renders it as a text input)
    await page.clickText("Select your birthday");
    await expectText("Cancel");
    await page.setInput("[aria-modal] input", dobInput);
    await page.clickText("Done");
    await expectText(dobShown);
    await page.waitFor(`!(document.body.innerText || "").includes("Done")`, NAV_TIMEOUT, "date sheet closed");
    await assertStuck("/setup/personal");
    await page.setInput(input("98765 43210"), "12345"); // too short
    await assertStuck("/setup/personal");
    await page.setInput(input("98765 43210"), answers.phone);
    await page.setInput(input("you@email.com"), "not-an-email");
    await assertStuck("/setup/personal");
  }));

  it("3. personal: valid inputs and the gender picker move on to the goal step", run("personal-valid", async () => {
    await page.setInput(input("you@email.com"), answers.email);
    await page.clickText("Select"); // the gender field (the only "Select" placeholder on this screen)
    await expectText("Prefer not to say");
    await page.clickText("Female");
    await page.waitFor(`!(document.body.innerText || "").includes("Prefer not to say")`, NAV_TIMEOUT, "gender sheet closed");
    await expectText("Female");
    await next();
    await expectPath("/setup/goal");
    await expectText("3/7");
  }));

  it("4. goal: a choice is required, then one option selects and continues", run("goal", async () => {
    await assertStuck("/setup/goal");
    await page.clickText("Lose fat");
    await next();
    await expectPath("/setup/body");
    await expectText("4/7");
  }));

  it("5. body: numeric fields are sanitised and range-checked; activity picker completes the step", run("body", async () => {
    await page.setInput(input("170"), "1a7b0c"); // non-digits dropped
    assert.equal(await page.inputValue(input("170")), "170");
    await page.setInput(input("70"), "20"); // below the 30 kg minimum
    await assertStuck("/setup/body");
    await page.setInput(input("70"), answers.weightKg);
    await assertStuck("/setup/body"); // activity still missing
    await page.clickText("Select");
    await expectText("Extra active");
    await page.clickText("Lightly active");
    await page.waitFor(`!(document.body.innerText || "").includes("Extra active")`, NAV_TIMEOUT, "activity sheet closed");
    await expectText("exercise 1–3 days per week");
    await next();
    await expectPath("/setup/food");
    await expectText("5/7");
  }));

  it("6. food: diet tile is required; a cuisine chip and free text are accepted", run("food", async () => {
    await assertStuck("/setup/food");
    await page.clickText("Vegan");
    await page.clickText("South Indian");
    await page.setInput(input("e.g. mushrooms, brinjal"), "okra");
    await next();
    await expectPath("/setup/lifestyle");
    await expectText("6/7");
  }));

  it("7. lifestyle: all four choices are required before the targets step", run("lifestyle", async () => {
    await assertStuck("/setup/lifestyle");
    await page.clickText("3–4 days");
    await page.clickText("Home");
    await page.clickText("Evening");
    await assertStuck("/setup/lifestyle"); // meals per day missing
    await page.clickText("3");
    await next();
    await expectPath("/setup/targets");
    await expectText("7/7");
  }));

  it("8. targets: the calculated daily target, macros and water render and match the calculator", run("targets", async () => {
    await expectText("Estimated daily target");
    await expectText(`${expectedCalories} kcal`);
    for (const label of ["Protein", "Carbs", "Fats", "Drinking water"]) await expectText(label);
    await expectText(`${expected.macros.proteinG} g`);
    assert.ok(await page.hasText("Finish"));
  }));

  it("9. back navigation keeps every entered value", run("back", async () => {
    await page.clickText("Back"); await expectPath("/setup/lifestyle");
    await page.clickText("Back"); await expectPath("/setup/food");
    assert.equal(await page.inputValue(input("e.g. mushrooms, brinjal")), "okra");
    await page.clickText("Back"); await expectPath("/setup/body");
    assert.equal(await page.inputValue(input("170")), answers.heightCm);
    assert.equal(await page.inputValue(input("70")), answers.weightKg);
    await expectText("Lightly active");
    await page.clickText("Back"); await expectPath("/setup/goal");
    await page.clickText("Back"); await expectPath("/setup/personal");
    assert.equal(await page.inputValue(input("Your full name")), answers.fullName);
    assert.equal(await page.inputValue(input("98765 43210")), answers.phone);
    assert.equal(await page.inputValue(input("you@email.com")), answers.email);
    await expectText(dobShown);
    await expectText("Female");
    // Forward again: each step still satisfied, so Next proceeds every time
    for (const route of ["/setup/goal", "/setup/body", "/setup/food", "/setup/lifestyle", "/setup/targets"]) { await next(); await expectPath(route); }
    await expectText(`${expectedCalories} kcal`);
  }));

  it("10. Finish while signed out sends no profile request and writes nothing", run("finish", async () => {
    const requestsBefore = page.requests.length;
    await page.clickText("Finish");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await page.path(), "/setup/targets", "a signed-out Finish must not navigate");
    const newRequests = page.requests.slice(requestsBefore);
    assert.deepEqual(newRequests.filter((u) => u.includes("/api/profile")), [], "no profile request may be sent");
    assert.deepEqual(page.requests.filter((u) => /\/\/(localhost|127\.0\.0\.1):4000\b/.test(u)), [], "no request to the development server");
    assert.deepEqual(await db.rowCounts(connection), countsBefore);
  }));
});
