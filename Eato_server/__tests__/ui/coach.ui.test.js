// The AI Coach intake in the real Expo web build against the isolated test server and the
// eato_test database, as a signed-in member who finished setup (muscle gain, gym) and has a
// workout profile. Covers the intro on the Coach tab, every intake step (prefilled answers,
// Continue staying off until a step is answered, the doctor note), the disclaimer tick, the
// save, the summary on the Coach tab, Edit, and screenshots at 3 widths.
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

describe("ui coach: the AI Coach intake", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, clerk, h;
  const identities = {};

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
  const noOverflow = async (label) => {
    const wide = await page.evaluate(`(() => { const vw = document.documentElement.clientWidth; if (document.documentElement.scrollWidth > vw) return "page"; const el = [...document.querySelectorAll("body *")].find((e) => e.getClientRects().length > 0 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollWidth > e.clientWidth + 1); return el ? "scroll view " + Math.round(el.scrollWidth) + " > " + el.clientWidth : ""; })()`);
    assert.equal(wide, "", `${label}: nothing may overflow horizontally`);
  };
  const snapshotAllWidths = async (name) => {
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await h.settle();
      if (SCREENSHOT_DIR) { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); await page.screenshot(path.join(SCREENSHOT_DIR, `${name}-${w}.png`)); }
      await noOverflow(`${name} at ${w}`);
    }
    await viewport(390, 844);
  };
  const clickLabel = async (label) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label=${JSON.stringify(label)}]')].filter((e) => e.getClientRects().length > 0).pop(); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const checked = (label) => page.evaluate(`(() => { const el = [...document.querySelectorAll('[aria-label=${JSON.stringify(label)}]')].filter((e) => e.getClientRects().length > 0).pop(); return el ? el.getAttribute("aria-checked") : "missing"; })()`);
  // The dark pill at the bottom (the last visible "Continue" / save button)
  const buttonDisabled = (text) => page.evaluate(`(() => { const el = [...document.querySelectorAll('[role="button"]')].filter((e) => e.getClientRects().length > 0 && (e.innerText || "").trim() === ${JSON.stringify(text)}).pop(); return el ? el.getAttribute("aria-disabled") === "true" : "missing"; })()`);
  // Continue, then wait for the next step's title: Expo web bundles each route the first time it opens
  const next = async (pathName, title) => { await page.clickText("Continue"); await h.expectPath(pathName); await h.expectText(title); await h.settle(); };

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
    try {
      identities.a = await clerk.createIdentity(runId, "a", { withPassword: true });
    } catch (error) {
      throw new Error(`Clerk could not create a test identity: ${JSON.stringify(describeClerkError(error))}`);
    }
    await clerk.setUnsafeMetadata(identities.a.id, { profileComplete: true });
    await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, 'Priya Sharma', 'user')", [identities.a.id, identities.a.emailAddress]);
    await connection.query("INSERT INTO profiles (user_id, goal, workout_type, profile_complete) VALUES (?, 'muscle_gain', 'gym', TRUE)", [identities.a.id]);
    await connection.query("INSERT INTO workout_profiles (user_id, experience, weekdays) VALUES (?, 'intermediate', '[2,4,6]')", [identities.a.id]);
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
      if (ids.length) for (const table of ["coach_profiles", "workout_profiles", "profiles"]) await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [ids]);
      await db.deleteUsers(connection, ids);
      await connection.end();
    });
    await step("identities", async () => { if (clerk) for (const identity of Object.values(identities)) await clerk.deleteUser(identity.id); });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the Coach tab introduces the coach before the intake", run("intro", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await h.goto("/coach", "Meet your AI coach");
    await h.expectText("A diet plan made for you");
    await snapshotAllWidths("coach-intro");
  }));

  it("2. the intake walks every step, starting from what JustFit already knows", run("intake", async () => {
    await page.clickText("Get started");
    await h.expectPath("/coach/intake/goal");
    await h.expectText("What's your goal?");
    assert.equal(await checked("Build muscle"), "true", "goal prefilled from setup (muscle gain)");
    await snapshotAllWidths("coach-intake-goal");
    await next("/coach/intake/experience", "How experienced are you?");

    assert.equal(await checked("Intermediate, Comfortable with training"), "true", "experience prefilled from the workout profile");
    assert.equal(await buttonDisabled("Continue"), true, "still needs: working out now?");
    await clickLabel("No");
    await snapshotAllWidths("coach-intake-experience");
    await next("/coach/intake/schedule", "How often can you train?");

    await h.expectText("3 days a week"); // Tue, Thu, Sat from the workout profile
    assert.equal(await checked("Tue"), "true");
    await clickLabel("Sat"); // off
    await clickLabel("Mon"); // on
    await page.clickText("45 min");
    await snapshotAllWidths("coach-intake-schedule");
    await next("/coach/intake/spots", "Where do you train most?");

    assert.equal(await checked("Gym"), "true", "main spot prefilled (gym)");
    assert.equal(await buttonDisabled("Continue"), true, "still needs a backup answer");
    await clickLabel("Home");
    await snapshotAllWidths("coach-intake-spots");
    await next("/coach/intake/equipment", "What can you use?");

    await h.expectText("Gym · main spot");
    await clickLabel("Full gym, Machines, racks, everything");
    assert.equal(await buttonDisabled("Continue"), true, "still needs the backup's equipment");
    await clickLabel("A few things, Bands, dumbbells");
    await snapshotAllWidths("coach-intake-equipment");
    await next("/coach/intake/limits", "Anything to work around?");

    await page.clickText("Knees");
    await page.clickText("Diabetes");
    await h.expectText("Check with a doctor first");
    await page.setInput('textarea[aria-label="Injuries or notes"]', "Old knee injury from cricket");
    await snapshotAllWidths("coach-intake-limits");
    await next("/coach/intake/lifestyle", "Your food and recovery");

    await page.clickText("Under 15 min");
    await clickLabel("Moderate, ₹200–400 a day");
    await page.clickText("7–8 h");
    await snapshotAllWidths("coach-intake-lifestyle");
    await next("/coach/intake/coach", "Who's coaching you?");

    await clickLabel("Coach Priya, Food first. Warm and patient.");
    await h.expectText("How should Priya coach you?");
    await clickLabel("Supportive, Celebrates every win");
    await snapshotAllWidths("coach-intake-coach");
    await next("/coach/intake/notes", "Guide your plan");

    await h.expectText("Guide your plan");
    assert.equal(await buttonDisabled("Meet my coach"), true, "the disclaimer must be ticked");
    await page.setInput('textarea[aria-label="Plan notes"]', "I walk 6k steps daily");
    await clickLabel("Fitness guidance, not medical advice");
    assert.equal(await buttonDisabled("Meet my coach"), false);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM coach_profiles"))[0][0].n, 0, "nothing saved before the last step");
    await snapshotAllWidths("coach-intake-notes");
  }));

  it("3. saving stores the answers and the Coach tab shows the coach and a summary", run("saved", async () => {
    await page.clickText("Meet my coach");
    await h.expectPath("/coach");
    await h.expectText("Coach Priya");
    await h.expectText("Your answers");
    await h.expectText("Build muscle");
    await h.expectText("Mon, Tue, Thu · 45 min");
    await h.expectText("Gym · backup Home");
    await h.expectText("Knees, Diabetes");
    const [[row]] = await connection.query("SELECT * FROM coach_profiles WHERE user_id = ?", [identities.a.id]);
    assert.deepEqual(
      { goal: row.goal, experience: row.experience, training: !!row.currently_training, days: row.weekdays, minutes: row.session_minutes, main: row.main_spot, backup: row.backup_spot, mainEq: row.main_equipment, backupEq: row.backup_equipment, joints: row.joints, conditions: row.conditions, notes: row.limitation_notes, cooking: row.cooking_time, budget: row.food_budget, stress: row.stress, sleep: row.sleep, coach: row.coach, style: row.coach_style, plan: row.plan_notes },
      { goal: "build_muscle", experience: "intermediate", training: false, days: [1, 2, 4], minutes: 45, main: "gym", backup: "home", mainEq: "full_gym", backupEq: "some", joints: ["knees"], conditions: ["diabetes"], notes: "Old knee injury from cricket", cooking: "quick", budget: "medium", stress: null, sleep: "7_8", coach: "priya", style: "supportive", plan: "I walk 6k steps daily" },
    );
    await snapshotAllWidths("coach-summary");
  }));

  it("4. Edit opens the intake with the saved answers; the tick is asked for again", run("edit", async () => {
    await page.clickText("Edit my answers");
    await h.expectPath("/coach/intake/goal");
    assert.equal(await checked("Build muscle"), "true");
    await h.goto("/coach", "Coach Priya"); // leaving mid-edit saves nothing
    const [[row]] = await connection.query("SELECT coach FROM coach_profiles WHERE user_id = ?", [identities.a.id]);
    assert.equal(row.coach, "priya");
  }));
});
