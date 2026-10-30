// Phase 9, step 2: onboarding step validation. Drives the real Expo web build in headless
// Chrome through every setup step using only the screens' visible labels and placeholders.
// The setup routes need a session, so one test account signs in through the real phone
// sign-in first (and is deleted afterwards). Finish is never pressed: no profile request is
// sent and nothing is written beyond the account row sign-in makes.
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
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
const { helpers, signInAs } = require("./onboarding-steps.js");
const nutrition = require("../../../JustFit_client/src/lib/nutrition/index.ts");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const NAV_TIMEOUT = 20000;

// The answers the test enters, and what the calculator must show for them
const AGE = 30;
const birth = new Date(); birth.setFullYear(birth.getFullYear() - AGE);
const pad = (n) => String(n).padStart(2, "0");
const dobInput = `${birth.getFullYear()}-${pad(birth.getMonth() + 1)}-${pad(birth.getDate())}`; // what the web date field takes
const dobShown = birth.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); // what the field then displays
const answers = { fullName: "E2E Tester", heightCm: "170", weightKg: "60" };
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const expected = nutrition.calculateTargets({ age: AGE, gender: "female", heightCm: 170, weightKg: 60, activityLevel: "lightly_active", fitnessGoal: "fat_loss", healthFlags: [] });
assert.equal(expected.status, "ok");
const expectedCalories = expected.displayCalories.toLocaleString("en-IN");

describe("ui flow: onboarding steps in Expo web (signed in, nothing saved)", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, testAccounts, h;
  const identities = {};
  // How the personal step shows the account's number: +91 98765 43210
  const shownPhone = () => `+91 ${identities.a.phone.slice(0, 5)} ${identities.a.phone.slice(5)}`;

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
  // Saves the open screen at every supported width when JUSTFIT_SCREENSHOT_DIR is set
  const shoot = async (name) => {
    if (!SCREENSHOT_DIR) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    for (const [width, height] of WIDTHS) {
      await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, page.sessionId);
      await new Promise((r) => setTimeout(r, 500));
      await page.screenshot(path.join(SCREENSHOT_DIR, `${name}-${width}.png`));
    }
    await client.send("Emulation.clearDeviceMetricsOverride", {}, page.sessionId);
    await settle();
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    countsBefore = await db.rowCounts(connection);
    testAccounts = identitiesFor(env);
    await testAccounts.sweepOrphans();
    server = await startTestServer(env);
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    try { identities.a = await testAccounts.createIdentity(runId, "a"); } catch (error) { throw new Error(`could not create the test identity: ${JSON.stringify(describeIdentityError(error))}`); }
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    if (connection && testAccounts) {
      for (const tag of Object.keys(identities)) await step(`cleanup identity ${tag} (${identities[tag]?.id})`, async () => { await db.deleteUsers(connection, [identities[tag].id]); await testAccounts.deleteUser(identities[tag].id); delete identities[tag]; });
    }
    await step("row counts unchanged", async () => {
      if (!connection) return;
      try { assert.deepEqual(await db.rowCounts(connection), countsBefore, "test database rows changed during a UI test that never saves"); }
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
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE; orphaned test identifiers:", Object.values(identities).map((i) => i.id).join(", ") || "none"); throw new Error("teardown problems: " + problems.join("; ")); }
  });

  it("1. landing → Get Started reaches sign-up; signing in opens setup at the personal step", run("landing", async () => {
    await goto("/", "Get Started");
    await page.clickText("Get Started");
    await expectPath("/sign-up");
    await expectText("Create your");
    // A signed-in account with no profile is sent to the first setup step by the start screen
    await signInAs(page, h, identities.a);
    await expectPath("/setup/personal");
    await expectText("1/7");
  }));

  it("2. personal: the number signed in with (and any email) is the account's and read-only; Next stays disabled until name, date of birth, height and weight are valid", run("personal-required", async () => {
    await goto("/setup/personal", "Let's get to know you");
    // The account's number and address are shown as text with a note, and no input offers to change them
    await expectText(shownPhone());
    await expectText("The number you log in with. It can't be changed here.");
    await expectText(identities.a.emailAddress);
    const emailInputs = await page.evaluate(`[...document.querySelectorAll("input")].filter((e) => e.getClientRects().length > 0 && (e.placeholder === "you@email.com" || e.value === ${JSON.stringify(identities.a.emailAddress)} || e.type === "email")).length`);
    assert.equal(emailInputs, 0, "the email must not be rendered as an input");
    assert.equal(await page.evaluate(`[...document.querySelectorAll("input")].filter((e) => e.getClientRects().length > 0).length`), 3, "the personal step has exactly three inputs: name, height and weight");
    if (SCREENSHOT_DIR) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      for (const [width, height] of WIDTHS) {
        await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, page.sessionId);
        await new Promise((r) => setTimeout(r, 500));
        await page.screenshot(path.join(SCREENSHOT_DIR, `setup-personal-email-read-only-${width}.png`));
      }
      await client.send("Emulation.clearDeviceMetricsOverride", {}, page.sessionId);
      await settle();
    }
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
    await expectText(`Age ${AGE}`); // the age the targets use, from the date of birth
    await assertStuck("/setup/personal");
    await page.setInput(input("170"), "1a7b0c"); // non-digits dropped
    assert.equal(await page.inputValue(input("170")), "170");
    await assertStuck("/setup/personal"); // weight still missing
    await page.setInput(input("70"), "20"); // below the 30 kg minimum
    await assertStuck("/setup/personal");
    await page.setInput(input("70"), answers.weightKg);
    // The mobile number is the one signed in with: shown as text, never an input
    await expectText(shownPhone());
    assert.equal(await page.evaluate(`!!document.querySelector(${JSON.stringify(input("98765 43210"))})`), false, "the number can't be changed in setup");
    await shoot("setup-personal-filled");
  }));

  it("3. personal: valid inputs and the gender picker move on to the body composition step", run("personal-valid", async () => {
    await page.clickText("Select"); // the gender field (the only "Select" placeholder on this screen)
    await expectText("Prefer not to say");
    await page.clickText("Female");
    await page.waitFor(`!(document.body.innerText || "").includes("Prefer not to say")`, NAV_TIMEOUT, "gender sheet closed");
    await expectText("Female");
    await next();
    await expectPath("/setup/body-composition");
    await expectText("2/7");
  }));

  it("4. body composition: optional; there is no typed body fat field, Scan Body opens the photo instructions, and Skip moves on", run("body-composition", async () => {
    await expectText("Scan Body");
    await expectText("Two photos, front and side.");
    assert.equal(await page.evaluate(`[...document.querySelectorAll("input")].filter((e) => e.getClientRects().length > 0).length`), 0, "the typed body fat field is gone");
    await shoot("setup-body-composition");
    await page.clickText("Scan Body");
    await expectPath("/setup/scan-guide");
    for (const text of ["How to take your photos", "Watch first", "Your photos stay private", "Start scan"]) await expectText(text);
    // Only the video: the written tips and pose drawings were dropped for it
    for (const gone of ["Before you start", "Photo 1", "Photo 2", "What to wear"]) assert.equal(await page.hasText(gone), false, `"${gone}" is gone`);
    await shoot("setup-scan-guide");
    await page.clickLabel("Back");
    await expectPath("/setup/body-composition");
    await next("Skip");
    await expectPath("/setup/goal");
    await expectText("3/7");
  }));

  it("5. goal: a choice is required, then one option selects and continues", run("goal", async () => {
    await assertStuck("/setup/goal");
    await page.clickText("Lose fat");
    await next();
    await expectPath("/setup/activity");
    await expectText("4/7");
  }));

  it("5b. activity: the activity picker is required and completes the step", run("activity", async () => {
    await assertStuck("/setup/activity");
    await page.clickText("Select");
    await expectText("Extra active");
    await page.clickText("Lightly active");
    await page.waitFor(`!(document.body.innerText || "").includes("Extra active")`, NAV_TIMEOUT, "activity sheet closed");
    await expectText("exercise 1–3 days per week");
    await shoot("setup-activity");
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
    await page.clickLabel("Back"); await expectPath("/setup/lifestyle");
    await page.clickLabel("Back"); await expectPath("/setup/food");
    assert.equal(await page.inputValue(input("e.g. mushrooms, brinjal")), "okra");
    await page.clickLabel("Back"); await expectPath("/setup/activity");
    await expectText("Lightly active");
    await page.clickLabel("Back"); await expectPath("/setup/goal");
    await page.clickLabel("Back"); await expectPath("/setup/body-composition");
    await page.clickLabel("Back"); await expectPath("/setup/personal");
    assert.equal(await page.inputValue(input("Your full name")), answers.fullName);
    assert.equal(await page.inputValue(input("170")), answers.heightCm);
    assert.equal(await page.inputValue(input("70")), answers.weightKg);
    await expectText(shownPhone());
    await expectText(identities.a.emailAddress);
    await expectText(dobShown);
    await expectText("Female");
    // Forward again: each step still satisfied, so Next proceeds every time
    await next(); await expectPath("/setup/body-composition");
    await next("Skip"); await expectPath("/setup/goal");
    for (const route of ["/setup/activity", "/setup/food", "/setup/lifestyle", "/setup/targets"]) { await next(); await expectPath(route); }
    await expectText(`${expectedCalories} kcal`);
  }));

  it("10. nothing was saved: only the start screen's profile read was sent, and no row was written", run("no-save", async () => {
    assert.deepEqual(page.requests.filter((u) => u.includes("/api/profile") && !u.startsWith(`http://localhost:${env.PORT}/api/profile`)), [], "profile requests may only go to the test server");
    assert.deepEqual(page.requests.filter((u) => /\/\/(localhost|127\.0\.0\.1):4000\b/.test(u)), [], "no request to the development server");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 });
    assert.deepEqual(await db.rowCounts(connection), { ...countsBefore, users: countsBefore.users + 1 }, "only the account row sign-in made");
  }));
});
