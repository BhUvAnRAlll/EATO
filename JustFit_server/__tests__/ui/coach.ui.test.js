// The AI Coach in the real Expo web build against the isolated test server (with the fake AI)
// and the justfit_test database, as a signed-in member who finished setup (muscle gain, gym) and
// has a workout profile. Covers the intro on the Coach tab, every intake step (prefilled answers,
// Continue staying off until a step is answered, the doctor note), the disclaimer tick, the
// save, the summary on the Coach tab, Edit, making the plan (the timeline, Week and Insights), logging
// a plan meal to Macro, the coach chat (the fake AI's reply), and screenshots at 3 widths.
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

describe("ui coach: the AI Coach intake", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
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
  // The red arrow button at the bottom (the last visible "Continue" / save button). Its label
  // is the accessibility label: on the web the arrow icon is font text inside the button.
  const buttonDisabled = (text) => page.evaluate(`(() => { const el = [...document.querySelectorAll('[role="button"]')].filter((e) => e.getClientRects().length > 0 && ((e.getAttribute("aria-label") || e.innerText || "").trim() === ${JSON.stringify(text)})).pop(); return el ? el.getAttribute("aria-disabled") === "true" : "missing"; })()`);
  // Continue, then wait for the next step's title: Expo web bundles each route the first time it opens
  const next = async (pathName, title) => { await page.clickText("Continue"); await h.expectPath(pathName); await h.expectText(title); await h.settle(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" }); // the plan's meals never call a paid model in tests
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    // A cold Metro cache can take well over NAV_TIMEOUT to bundle the first screen: warm it here
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 180000, "the first bundle (sign-in)");
    try {
      identities.a = await testAccounts.createIdentity(runId, "a");
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, 'Priya Sharma', 'user') ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [identities.a.id, identities.a.emailAddress]);
    await connection.query(
      "INSERT INTO profiles (user_id, goal, workout_type, dob, gender, height_cm, weight_kg, diet, profile_complete) VALUES (?, 'muscle_gain', 'gym', '1996-03-12', 'female', 162, 58, 'vegetarian', TRUE)",
      [identities.a.id],
    );
    await connection.query(
      "INSERT INTO nutrition_targets (user_id, formula, config_version, inputs, calculated_at, calories, protein_g, carbs_g, fat_g) VALUES (?, 'justfit-calculator', 'test', '{}', NOW(), 1800, 110, 200, 55)",
      [identities.a.id],
    );
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
      const tables = [
        "coach_plan_meal_items", "coach_plan_meals", "coach_plans", "macro_meal_items", "macro_meal_logs", "workout_day_overrides",
        "workout_day_exercises", "workout_days", "workout_plans", "nutrition_targets", "coach_profiles", "workout_profiles", "profiles",
      ];
      if (ids.length) for (const table of tables) await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [ids]);
      await db.deleteUsers(connection, ids);
      await connection.end();
    });
    await step("identities", async () => { if (testAccounts) for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id); });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the Coach tab introduces the coach before the intake", run("intro", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await h.goto("/coach", "Meet your AI coach");
    await h.expectText("Customized Diet Plan");
    await h.expectText("Problem Solving & Guidance Anytime");
    await snapshotAllWidths("coach-intro");
  }));

  it("2. the intake walks every step, starting from what justFit already knows", run("intake", async () => {
    await page.clickText("Get started");
    await h.expectPath("/coach/intake/goal");
    await h.expectText("What's your goal?");
    assert.equal(await checked("Build muscle, Gain strength and muscle mass"), "true", "goal prefilled from setup (muscle gain)");
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
    await h.expectText("Food first · Supportive");
    await h.expectText("Ask Priya anything...");
    await h.expectText("Make my plan");
    await h.expectText("Edit my answers");
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
    assert.equal(await checked("Build muscle, Gain strength and muscle mass"), "true");
    await h.goto("/coach", "Coach Priya"); // leaving mid-edit saves nothing
    const [[row]] = await connection.query("SELECT coach FROM coach_profiles WHERE user_id = ?", [identities.a.id]);
    assert.equal(row.coach, "priya");
  }));

  it("5. Make my plan shows Logged today, the meal plan summary and today's workout; the Meal Plan screen lists the meals", run("plan", async () => {
    await page.clickText("Make my plan");
    await h.expectText("Logged today");
    await h.expectText("Meal plan");
    await h.expectText("WORKOUT"); // today's workout, a card of its own (not on the meal plan)
    const [[plan]] = await connection.query("SELECT COUNT(*) AS n, MAX(calories) AS kcal FROM coach_plans WHERE user_id = ? AND status = 'active'", [identities.a.id]);
    assert.deepEqual({ n: plan.n, kcal: plan.kcal }, { n: 1, kcal: 1800 });
    await h.expectText("/ 1800"); // the calories column of Logged today
    await snapshotAllWidths("coach-plan");
    // The Meal Plan screen: the meals on a timeline, and the Adjust Plan banner
    await clickLabel("Open meal plan");
    await h.expectPath("/coach/meal-plan");
    await h.expectText("Meal Plan");
    await h.expectText("BREAKFAST"); // the slot pill, shown in capitals
    await h.expectText("Moong dal chilla");
    await h.expectText("Need to make changes?");
    await snapshotAllWidths("coach-meal-plan");
    await page.evaluate(`(() => { const el = [...document.querySelectorAll("body *")].find((e) => e.childElementCount === 0 && (e.textContent || "").trim() === "Adjust Plan"); if (el) el.scrollIntoView({ block: "center" }); })()`);
    await h.settle();
    await snapshotAllWidths("coach-meal-plan-adjust");
    await clickLabel("Back");
    await h.expectPath("/coach");
    // Week: the workout week and the day's calories; Insights: coming soon
    await page.clickText("Week");
    await h.expectText("Mon");
    await h.expectText("Open my workouts");
    await snapshotAllWidths("coach-plan-week");
    await page.clickText("Insights");
    await h.expectText("Insights are coming soon");
    await page.clickText("Today");
    await h.expectText("Meal plan");
  }));

  it("6. Log on the Meal Plan screen puts a plan meal in today's Macro diary, once", run("log", async () => {
    await clickLabel("Open meal plan");
    await h.expectPath("/coach/meal-plan");
    await clickLabel("Log Dal, rice and sabzi");
    await page.waitFor(`(() => !![...document.querySelectorAll('[aria-label="Dal, rice and sabzi logged"]')].find((e) => e.getClientRects().length > 0))()`, NAV_TIMEOUT, "the meal to show Logged");
    const [[log]] = await connection.query("SELECT COUNT(*) AS n, MAX(source) AS source, MAX(slot) AS slot FROM macro_meal_logs WHERE user_id = ?", [identities.a.id]);
    assert.deepEqual({ n: log.n, source: log.source, slot: log.slot }, { n: 1, source: "plan", slot: "lunch" });
    // Coming back keeps it logged, and the tab's summary counts it
    await h.goto("/home", "");
    await h.goto("/coach", "Meal plan");
    await h.expectText("1 of 5 logged");
    await clickLabel("Open meal plan");
    await page.waitFor(`(() => !![...document.querySelectorAll('[aria-label="Dal, rice and sabzi logged"]')].find((e) => e.getClientRects().length > 0))()`, NAV_TIMEOUT, "still Logged after reload");
    await clickLabel("Back");
    await h.expectPath("/coach");
  }));

  it("7. a quick question opens the chat and the coach answers; a typed message too", run("chat", async () => {
    await clickLabel("Ask: Adjust my diet");
    await h.expectPath("/coach/chat");
    await h.expectText("Hi! I'm Coach Priya");
    await h.expectText("Adjust my diet");
    await h.expectText("test reply");
    await page.setInput('textarea[aria-label="Message your coach"]', "How much water should I drink?");
    await clickLabel("Send message");
    await h.expectText("How much water should I drink?");
    await page.waitFor(`(document.body.innerText.match(/test reply/g) || []).length >= 2`, NAV_TIMEOUT, "a second reply");
    await snapshotAllWidths("coach-chat");
    // Back on the Coach tab, the ask box opens the same conversation
    await clickLabel("Back");
    await h.expectPath("/coach");
    await clickLabel("Ask Priya");
    await h.expectPath("/coach/chat");
    await h.expectText("How much water should I drink?");
  }));

  it("8. Change opens the coach picker; saving switches the coach and keeps the other answers", run("change-coach", async () => {
    await clickLabel("Back");
    await h.expectPath("/coach");
    await clickLabel("Change coach");
    await h.expectText("How should Priya coach you?");
    await snapshotAllWidths("coach-change");
    await clickLabel("Coach Meera, Mobility and yoga. Mindful.");
    await h.expectText("How should Meera coach you?");
    await page.clickText("Direct");
    await clickLabel("Save");
    await h.expectText("Mobility and yoga · Direct");
    const [[row]] = await connection.query("SELECT coach, coach_style, goal, weekdays FROM coach_profiles WHERE user_id = ?", [identities.a.id]);
    assert.deepEqual({ coach: row.coach, style: row.coach_style, goal: row.goal, days: row.weekdays }, { coach: "meera", style: "direct", goal: "build_muscle", days: [1, 2, 4] });
    // The chat with Priya is over: Meera starts a new one
    await clickLabel("Ask Meera");
    await h.expectText("Hi! I'm Coach Meera");
    assert.equal(await page.hasText("How much water should I drink?"), false);
  }));
});

