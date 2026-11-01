// The Macro tab in the real Expo web build against the isolated test server and the justfit_test
// database, as a signed-in member with a 2000 kcal target. Covers the hub (target ring, empty
// day, week strip, past day), the logging flow (Add meal → Log food → Manual entry → back to
// the hub), Home's Today's Macros card, Daily calories (today and a past day), Calories &
// macros, Adjust targets, Water, Favourites, Repeat a meal, the meal sheet (heart, remove behind a confirmation),
// Scan food (a photo, the fake AI estimate, an edit, saved) and screenshots at 3 widths.
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
const TINY_PNG = path.join(os.tmpdir(), "justfit-food-scan-test.png");
const MACRO_TABLES = ["macro_meal_items", "macro_meal_logs", "macro_favorite_foods", "macro_water_logs", "macro_hydration_days", "macro_hydration_preferences", "nutrition_targets"];

describe("ui macro: the Macro tab hub and logging a meal by hand", () => {
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
  // Nothing wider than the viewport: the page itself, and any vertical scroll view inside it
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
  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === ${JSON.stringify(label)} && e.getClientRects().length > 0); if (!els.length) return null; const el = els.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `tab ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const clickLabel = async (label, nth = 0) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll('[aria-label=${JSON.stringify(label)}]')].filter((e) => e.getClientRects().length > 0); const el = els.at(${nth}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const clickLabelStarting = async (prefix) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label").startsWith(${JSON.stringify(prefix)}))[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${prefix}…`);
    await page.clickAt(pos.x, pos.y);
  };
  // Opens a meal's sheet from its card and waits until it has finished sliding up (so a click lands)
  const openMeal = async (title) => {
    await clickLabel(`View ${title}`);
    await h.expectText("Remove meal");
    await new Promise((r) => setTimeout(r, 450));
  };
  const meals = async () => (await connection.query("SELECT id, title, slot, source FROM macro_meal_logs WHERE user_id = ?", [identities.a.id]))[0];

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" }); // Scan food answers a fixed estimate, never a paid model
    fs.writeFileSync(TINY_PNG, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
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
    // A target as setup saves it: the calculator's inputs, its result (1550 kcal) and the
    // active target in use (2000 kcal, so the numbers below are easy to follow)
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
      if (ids.length) for (const table of MACRO_TABLES) await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [ids]);
      await db.deleteUsers(connection, ids);
      await connection.end();
    });
    await step("identities", async () => { if (testAccounts) for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id); });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the Macro tab shows today's target ring, the week strip and an empty day", run("hub", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await clickTab("Macro");
    await h.expectPath("/macro");
    // The calories card: the ring with what's left, eaten and target beside it, and the three macros under it
    assert.ok(await page.evaluate(`!!document.querySelector('[aria-label="2,000 kcal left. Eaten 0 of 2,000 kcal. Open daily calories"]')`), "the calories card opens daily calories");
    assert.ok(await page.evaluate(`!!document.querySelector('[aria-label="Protein 0 of 150 grams"]')`), "the protein bar");
    await h.expectText("kcal left");
    await h.expectText("0/150g");
    await h.expectText("Add your first meal to start today."); // only the Macro hub says this (Home has its own "Nothing logged yet today.")
    await h.expectText("Today's meals");
    await h.expectText("Calories & macros");
    assert.equal(await page.evaluate(`document.querySelectorAll('[aria-label="Jump to a day"], [aria-label="Water"]').length >= 2`), true, "header buttons");
    await snapshotAllWidths("macro-hub-empty");
  }));

  it("2. Add meal: pick a slot and time, Continue opens Log food", run("add-meal", async () => {
    await clickLabel("Add meal");
    await h.expectPath("/macro/add-meal");
    await h.expectText("Which meal?");
    await h.expectText("You have 2,000 kcal left today.");
    await clickLabelStarting("Lunch,");
    await h.expectText("12:30 PM");
    await snapshotAllWidths("macro-add-meal");
    await page.clickText("12:30 PM");
    await page.clickText("Continue");
    await h.expectPath("/macro/log");
    await h.expectText("How would you like to log?");
    await snapshotAllWidths("macro-log-food");
  }));

  it("3. Manual entry validates, warns when macros disagree, saves, and closes the flow back to the hub", run("manual", async () => {
    await clickLabel("Manual entry: type calories and macros");
    await h.expectPath("/macro/manual");
    await h.expectText("Search a food and enter how much");
    // Nothing typed: the first missing thing is named
    await clickLabel("Save meal");
    await h.expectText("Give the food a name.");
    await page.setInput('input[aria-label="Food name"]', "Paneer tikka bowl");
    await clickLabel("Save meal");
    await h.expectText("Enter the calories.");
    assert.equal((await meals()).length, 0, "nothing saved yet");

    await page.setInput('input[aria-label="Quantity"]', "350");
    await page.setInput('input[aria-label="Calories in kcal"]', "480");
    await page.setInput('input[aria-label="Protein in grams"]', "10");
    await h.expectText("far from your 480 entry");
    await page.setInput('input[aria-label="Carbs in grams"]', "40");
    await page.setInput('input[aria-label="Fat in grams"]', "18");
    await page.setInput('input[aria-label="Protein in grams"]', "32");
    await h.expectText("Macros add up to 450 kcal");
    await h.expectText("close to your 480 entry. Looks good.");
    await snapshotAllWidths("macro-manual-entry");

    await clickLabel("Save meal");
    await h.expectPath("/macro");
    const rows = await meals();
    assert.equal(rows.length, 1);
    assert.deepEqual({ title: rows[0].title, slot: rows[0].slot, source: rows[0].source }, { title: "Paneer tikka bowl", slot: "lunch", source: "manual" });
    const [[item]] = await connection.query("SELECT quantity, unit, kcal, protein_g, carbs_g, fat_g FROM macro_meal_items WHERE macro_meal_id = ?", [rows[0].id]);
    assert.deepEqual({ ...item, quantity: Number(item.quantity), kcal: Number(item.kcal), protein_g: Number(item.protein_g), carbs_g: Number(item.carbs_g), fat_g: Number(item.fat_g) }, { quantity: 350, unit: "g", kcal: 480, protein_g: 32, carbs_g: 40, fat_g: 18 });
    // Back on the hub, the meal and the new remaining calories are there
    await h.expectText("Paneer tikka bowl");
    await page.waitFor(`!!document.querySelector('[aria-label="1,520 kcal left. Eaten 480 of 2,000 kcal. Open daily calories"]')`, NAV_TIMEOUT, "the calories card at 1,520 kcal left");
    await snapshotAllWidths("macro-hub-with-meal");

    // Home's "Today's Macros" card reads the same diary, has no quick-action cards above it,
    // and opens the Macro tab
    await clickTab("Home");
    await h.expectPath("/home");
    await h.expectText("Today's Macros");
    await h.expectText("480 kcal logged today. Tap to see your meals.");
    // The rings match the Macro hub: the meal eaten against the same targets (2000 kcal, 150 g protein),
    // and water against the member's own target
    await h.expectText("of 2,000 kcal");
    await h.expectText("1,520 kcal left");
    for (const label of ["Calories: 480 of 2000 kcal", "Protein: 32 of 150 g"]) {
      assert.ok(await page.evaluate(`!!document.querySelector('[aria-label=${JSON.stringify(label)}]')`), `the "${label}" ring`);
    }
    assert.ok(await page.evaluate(`!!document.querySelector('[aria-label^="Water: "]')`), "the water ring");
    assert.equal(await page.hasText("Sample numbers"), false, "real targets, not the sample");
    for (const tile of ["Browse menu", "For your goals", "Track intake", "At your doorstep"]) assert.equal(await page.hasText(tile), false, `the "${tile}" card is gone`);
    await snapshotAllWidths("home-todays-macros");
    await clickLabelStarting("Today's Macros: 480 of 2000 kcal eaten");
    await h.expectPath("/macro");
    await h.expectText("1,520");
  }));

  it("3b. Daily calories: what's left, the macros badge, and the timeline of logged meals only", run("daily", async () => {
    await clickLabelStarting("1,520 kcal left");
    await h.expectPath("/macro/daily");
    await h.expectText("Daily calories");
    await h.expectText("kcal to reach your 2,000 target");
    await h.expectText("24%");
    await h.expectText("Behind target"); // 32 g protein is under 55% of 150 g
    await h.expectText("Meals timeline");
    await h.expectText("Paneer tikka bowl");
    assert.ok(await page.evaluate(`!!document.querySelector('[aria-label^="Lunch at "][aria-label*="Paneer tikka bowl, 480 kcal"]')`), "the lunch card shows the meal and its time");
    assert.ok(await page.evaluate(`!!document.querySelector('[aria-label="View Paneer tikka bowl"]')`), "the card's View meal button");
    assert.equal(await page.hasText("Not logged yet"), false, "only logged meals are listed, no empty slots");
    await snapshotAllWidths("macro-daily");
    await page.evaluate("history.back()");
    await h.expectPath("/macro");
  }));

  it("3c. Calories & macros: the split by calories, the macro tiles, the week's trend, periods and Adjust targets", run("calories-macros", async () => {
    await clickLabel("Calories and macros: split, weekly trend and targets");
    await h.expectPath("/macro/calories-macros");
    await h.expectText("This week");
    // One lunch of 480 kcal (32 g protein, 40 g carbs, 18 g fat) against 2000 kcal (150/200/60 g)
    await h.expectText("31 / 41 / 28"); // the target split
    for (const text of ["28%", "36%", "21% of 150g", "20% of 200g", "30% of 60g", "Avg 69 kcal · target 2,000", "-1,931 avg"]) await h.expectText(text);
    assert.ok(await page.evaluate(`!!document.querySelector('[aria-label="Protein: 32 grams, 21% of 150 grams"]')`), "the protein tile");
    await snapshotAllWidths("macro-calories-today");
    // The week averages over 7 days, the month over 30
    await page.clickText("Week");
    // ("69" is already on screen in the This week card, so wait for the week's own tile)
    await page.waitFor(`!!document.querySelector('[aria-label="Protein: 5 grams, 3% of 150 grams"]')`, NAV_TIMEOUT, "the week's protein average");
    await snapshotAllWidths("macro-calories-week");
    await page.clickText("Month");
    await page.waitFor(`!!document.querySelector('[aria-label="Protein: 1 grams, 1% of 150 grams"]')`, NAV_TIMEOUT, "the month's protein average");
    await page.clickText("Adjust targets");
    await h.expectPath("/macro/adjust-targets");
    await page.evaluate("history.back()");
    await h.expectPath("/macro/calories-macros");
    await page.evaluate("history.back()");
    await h.expectPath("/macro");
  }));

  it("3d. Adjust targets: set calories by hand (macros on auto), see it everywhere, reset to calculated, limits", run("adjust-targets", async () => {
    const targetRow = async () => (await connection.query("SELECT calories, protein_g, carbs_g, fat_g, source FROM nutrition_targets WHERE user_id = ?", [identities.a.id]))[0][0];
    await clickLabel("Calories and macros: split, weekly trend and targets");
    await h.expectPath("/macro/calories-macros");
    await page.clickText("Adjust targets");
    await h.expectPath("/macro/adjust-targets");
    await h.expectText("These were calculated from your profile.");
    assert.equal(await page.inputValue('input[aria-label="Daily calories in kcal"]'), "2000", "seeded from the saved target");
    assert.equal(await page.hasText("Reset to calculated"), false, "nothing to reset while the target is the calculated one");
    await snapshotAllWidths("macro-adjust-targets");

    // 2200 kcal with the macros left on auto: the calculator splits them for the goal
    await page.setInput('input[aria-label="Daily calories in kcal"]', "2200");
    for (const m of ["Protein", "Carbs", "Fat"]) await page.setInput(`input[aria-label="${m} target in grams"]`, "");
    await clickLabel("Save targets");
    await h.expectPath("/macro/calories-macros");
    await h.expectText("target 2,200");
    assert.deepEqual(await targetRow(), { calories: 2200, protein_g: 138, carbs_g: 275, fat_g: 61, source: "user_adjusted" });

    // Now a hand-set target: the copy says so, and Reset goes back to the calculation
    await page.clickText("Adjust targets");
    await h.expectText("You set these by hand.");
    await h.expectText("Reset to calculated (1,550 kcal)");
    await clickLabel("Reset to calculated");
    await h.expectPath("/macro/calories-macros");
    await h.expectText("target 1,550");
    assert.equal((await targetRow()).source, "calculated");

    // The calculator's limits come back as the server's message, and nothing is saved
    await page.clickText("Adjust targets");
    await h.expectPath("/macro/adjust-targets");
    await page.setInput('input[aria-label="Daily calories in kcal"]', "900");
    await clickLabel("Save targets");
    await h.expectText("Enter a daily target between 1000 and 5000 kcal.");
    assert.equal((await targetRow()).calories, 1550);
    // Back to 2000 kcal (150/200/60 g) for the steps that follow
    await page.setInput('input[aria-label="Daily calories in kcal"]', "2000");
    await page.setInput('input[aria-label="Protein target in grams"]', "150");
    await page.setInput('input[aria-label="Carbs target in grams"]', "200");
    await page.setInput('input[aria-label="Fat target in grams"]', "60");
    await h.expectText("Macros add up to 1940 kcal");
    await clickLabel("Save targets");
    await h.expectPath("/macro/calories-macros");
    assert.deepEqual(await targetRow(), { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, source: "user_adjusted" });
    await page.evaluate("history.back()");
    await h.expectPath("/macro");
  }));

  it("3e. Water: the estimate, a glass, a custom amount, the floating glass, removing an entry, reminders, and the Daily card", run("water", async () => {
    const water = async () => (await connection.query("SELECT amount_ml, source, label FROM macro_water_logs WHERE user_id = ? ORDER BY logged_at", [identities.a.id]))[0];
    const waitForWater = async (count) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (await water()).length !== count) await new Promise((r) => setTimeout(r, 250));
      assert.equal((await water()).length, count, "water rows on the server");
    };
    await clickLabel("Water");
    await h.expectPath("/macro/water");
    // No weight in the profile: the 70 kg fallback (2.1 L) and the note that says so
    await h.expectText("/ 2.1 L");
    await h.expectText("0% of goal");
    await h.expectText("2.1 L to go · about 9 glasses");
    await h.expectText("Add your weight in your profile for a closer estimate.");
    await h.expectText("Add your first glass to start the day.");
    await snapshotAllWidths("macro-water-empty");

    await clickLabel("+250 ml, Glass");
    await waitForWater(1);
    await h.expectText("12% of goal");
    // A custom litre from the sheet
    await clickLabel("Custom, Pick amount");
    await h.expectText("Add 300 ml");
    await snapshotAllWidths("macro-water-custom");
    await page.clickText("1 L");
    await clickLabel("Add 1000 ml");
    await waitForWater(2);
    await h.expectText("60% of goal");
    // The floating button adds a glass
    await clickLabel("Add a glass, 250 ml");
    await waitForWater(3);
    await h.expectText("71% of goal");
    assert.deepEqual((await water()).map((w) => [w.amount_ml, w.source, w.label]), [[250, "quick_add", "Glass"], [1000, "custom", null], [250, "quick_add", "Glass"]]);
    await snapshotAllWidths("macro-water-logged");
    // Remove the litre
    await clickLabel("Remove 1000 ml");
    await waitForWater(2);
    await h.expectText("24% of goal");
    // Reminders off is saved for this member
    await clickLabel("Hydration reminders");
    const deadline = Date.now() + 10000;
    let pref = null;
    while (Date.now() < deadline) {
      [[pref]] = await connection.query("SELECT reminders_enabled FROM macro_hydration_preferences WHERE user_id = ?", [identities.a.id]);
      if (pref && pref.reminders_enabled === 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(pref?.reminders_enabled, 0, "reminders turned off on the server");

    // Daily calories shows the same water
    await page.evaluate("history.back()");
    await h.expectPath("/macro");
    await clickLabelStarting("1,520 kcal left");
    await h.expectPath("/macro/daily");
    await page.waitFor(`!!document.querySelector('[aria-label="Water: 0.5 of 2.1 litres, 24%. Open water"]')`, NAV_TIMEOUT, "the Daily water card");
    await snapshotAllWidths("macro-daily-with-water");
    await page.evaluate("history.back()");
    await h.expectPath("/macro");
  }));

  it("4. the recent strip on Log food hearts a meal, and the hub's meal sheet removes it behind a confirmation", run("sheet", async () => {
    await clickLabel("Add meal");
    await page.clickText("Continue");
    await h.expectPath("/macro/log");
    await h.expectText("Recent meals");
    await clickLabel("Save Paneer tikka bowl to favourites");
    await page.waitFor(`!!document.querySelector('[aria-label="Remove Paneer tikka bowl from favourites"]')`, NAV_TIMEOUT, "the filled heart");
    const deadline = Date.now() + 10000;
    let favourites = 0;
    while (Date.now() < deadline && favourites === 0) { favourites = (await connection.query("SELECT COUNT(*) AS n FROM macro_favorite_foods WHERE user_id = ?", [identities.a.id]))[0][0].n; await new Promise((r) => setTimeout(r, 250)); }
    assert.equal(favourites, 1, "the favourite is stored");

    await page.evaluate("history.back()"); await page.evaluate("history.back()");
    await h.expectPath("/macro");
    await openMeal("Paneer tikka bowl");
    await h.expectText("350 g"); // the foods table (its headings are styled uppercase)
    await snapshotAllWidths("macro-meal-sheet");
    await clickLabel("Remove meal");
    await h.expectText("Remove this meal?");
    await clickLabel("Keep");
    assert.equal((await meals()).length, 1, "Keep keeps it");
    await clickLabel("Remove meal");
    await clickLabel("Remove");
    await h.expectText("Add your first meal to start today."); // only the Macro hub says this (Home has its own "Nothing logged yet today.")
    const gone = Date.now() + 10000;
    while (Date.now() < gone && (await meals()).length > 0) await new Promise((r) => setTimeout(r, 250));
    assert.equal((await meals()).length, 0, "removed on the server");
  }));

  it("4b. Favourites: the hearted meal logs in one tap into the chosen slot, and its heart removes it", run("favorites", async () => {
    const favourites = async () => (await connection.query("SELECT COUNT(*) AS n FROM macro_favorite_foods WHERE user_id = ?", [identities.a.id]))[0][0].n;
    const waitFor = async (fn, expected, label) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && JSON.stringify(await fn()) !== JSON.stringify(expected)) await new Promise((r) => setTimeout(r, 250));
      assert.deepEqual(await fn(), expected, label);
    };
    const toFavourites = async (slotPrefix) => {
      await clickLabel("Add meal");
      await h.expectPath("/macro/add-meal");
      if (slotPrefix) await clickLabelStarting(slotPrefix);
      await page.clickText("Continue");
      await h.expectPath("/macro/log");
      await clickLabel("Favourites");
      await h.expectPath("/macro/favorites");
    };
    assert.equal(await favourites(), 1, "step 4 saved the favourite");
    await toFavourites("Dinner,");
    await h.expectText("Paneer tikka bowl");
    assert.equal(await page.hasText("Add to"), false, "the slot came from Add meal, so it isn't asked again");
    await snapshotAllWidths("macro-favorites");
    await clickLabelStarting("Paneer tikka bowl, 480 kcal");
    await clickLabel("Log Paneer tikka bowl");
    await h.expectPath("/macro");
    await waitFor(async () => (await meals()).map((m) => [m.title, m.slot, m.source]), [["Paneer tikka bowl", "dinner", "favorite"]], "logged from the favourite");
    await h.expectText("Paneer tikka bowl");

    // Clean up through the app: remove the meal, then un-heart the favourite
    await openMeal("Paneer tikka bowl");
    await clickLabel("Remove meal");
    await clickLabel("Remove");
    await waitFor(async () => (await meals()).length, 0, "the meal is removed");
    await toFavourites(null);
    await clickLabel("Remove Paneer tikka bowl from favourites");
    await h.expectText("No favourites yet");
    await waitFor(favourites, 0, "the favourite is removed on the server");
    await snapshotAllWidths("macro-favorites-empty");
    for (let i = 0; i < 3; i++) await page.evaluate("history.back()");
    await h.expectPath("/macro");
  }));

  it("4c. Repeat a meal: yesterday's meal is copied into today's chosen slot; the original stays as it was", run("repeat", async () => {
    // Logging is today-only, so yesterday's meal is written directly (two foods)
    const yesterday = await page.evaluate(`(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
    const [[{ id: originalId }]] = await connection.query("SELECT UUID() AS id");
    await connection.query("INSERT INTO macro_meal_logs (id, user_id, log_date, slot, title, logged_at) VALUES (?, ?, ?, 'breakfast', 'Oats with banana', NOW(3) - INTERVAL 1 DAY)", [originalId, identities.a.id, yesterday]);
    await connection.query(
      "INSERT INTO macro_meal_items (macro_meal_id, user_id, position, name, quantity, unit, kcal, protein_g, carbs_g, fat_g) VALUES (?, ?, 0, 'Oats', 60, 'g', 230, 8, 40, 4), (?, ?, 1, 'Banana', 1, 'piece', 120, 1, 27, 0)",
      [originalId, identities.a.id, originalId, identities.a.id],
    );
    try {
      await clickLabel("Add meal");
      await clickLabelStarting("Breakfast,");
      await page.clickText("Continue");
      await h.expectPath("/macro/log");
      await clickLabel("Repeat meal");
      await h.expectPath("/macro/repeat-meal");
      await h.expectText("Anything from the last 3 days");
      await h.expectText("Oats with banana");
      assert.equal(await page.hasText("Add to"), false, "the slot came from Add meal");
      await snapshotAllWidths("macro-repeat");
      await clickLabelStarting("Oats with banana, 350 kcal, Yesterday");
      await clickLabel("Repeat Oats with banana");
      await h.expectPath("/macro");
      await h.expectText("Oats with banana");

      const [rows] = await connection.query("SELECT id, slot, source, DATE_FORMAT(log_date, '%Y-%m-%d') AS d FROM macro_meal_logs WHERE user_id = ? AND title = 'Oats with banana' ORDER BY log_date", [identities.a.id]);
      assert.equal(rows.length, 2, "the original and the repeat");
      const repeat = rows.find((r) => r.id !== originalId);
      assert.deepEqual({ slot: repeat.slot, source: repeat.source }, { slot: "breakfast", source: "repeat" });
      assert.notEqual(repeat.d, yesterday, "the repeat is on today");
      const items = async (mealId) => (await connection.query("SELECT name, kcal FROM macro_meal_items WHERE macro_meal_id = ? ORDER BY position", [mealId]))[0].map((i) => [i.name, Number(i.kcal)]);
      assert.deepEqual(await items(repeat.id), [["Oats", 230], ["Banana", 120]], "the foods were copied");
      assert.deepEqual(await items(originalId), [["Oats", 230], ["Banana", 120]], "the original keeps its own foods");

      // Remove the repeat through the app; the original stays
      await openMeal("Oats with banana");
      await clickLabel("Remove meal");
      await clickLabel("Remove");
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (await meals()).length > 1) await new Promise((r) => setTimeout(r, 250));
      assert.deepEqual((await meals()).map((m) => m.id), [originalId], "only the original is left");
      await h.expectText("Add your first meal to start today.");
    } finally {
      // Yesterday must be empty again for the past-day step
      await connection.query("DELETE FROM macro_meal_logs WHERE id = ?", [originalId]);
    }
  }));

  it("5. a past day is read-only: the floating button becomes Back to today", run("past-day", async () => {
    const yesterday = await page.evaluate(`(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
    await clickLabelStarting(`${yesterday},`);
    await h.expectText("This day has no meals.");
    await h.expectText("Back to today");
    await snapshotAllWidths("macro-hub-past-day");
    // Daily calories on a past day: read-only timeline, and the footer goes back to today
    await clickLabelStarting("2,000 kcal left");
    await h.expectPath("/macro/daily");
    await h.expectText("Back to today");
    await h.expectText("Nothing was logged"); // the empty day card, read-only
    await snapshotAllWidths("macro-daily-past-day");
    await page.clickText("Back to today");
    await h.expectPath("/macro");
    await h.expectText("Add your first meal to start today."); // only the Macro hub says this (Home has its own "Nothing logged yet today.")
    await h.expectText("Add meal");
  }));
  // "Choose from library" opens the browser's file chooser on a hidden input: intercepted
  // through DevTools so headless Chrome can't cancel it (as in body-scan.ui.test.js)
  it("6. Scan food: a photo becomes an editable estimate, and Add to my day logs it", run("scan", async () => {
    await h.goto("/macro/log", "How would you like to log?");
    await clickLabel("Scan food: estimate calories and macros from a photo");
    await h.expectPath("/macro/scan");
    await h.expectText("Photograph your meal");
    await snapshotAllWidths("macro-scan-start");

    const before = (await meals()).length;
    await page.setInput('input[aria-label="Note about the food"]', "2 rotis");
    await client.send("Page.enable", {}, page.sessionId);
    await client.send("Page.setInterceptFileChooserDialog", { enabled: true }, page.sessionId);
    const chooser = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the photo picker did not open a file chooser")), 10000);
      client.on((m) => { if (m.sessionId === page.sessionId && m.method === "Page.fileChooserOpened") { clearTimeout(timer); resolve(m.params); } });
    });
    await page.clickText("Choose from library");
    const { backendNodeId } = await chooser;
    await client.send("DOM.setFileInputFiles", { backendNodeId, files: [TINY_PNG] }, page.sessionId);
    await client.send("Page.setInterceptFileChooserDialog", { enabled: false }, page.sessionId);

    await h.expectText("Foods we found");
    for (const food of ["Dal tadka", "Jeera rice", "Roti"]) await h.expectText(food);
    await h.expectText("590 kcal");
    await page.setInput('input[aria-label="Roti kcal"]', "250");
    await h.expectText("640 kcal");
    await clickLabel("Remove Jeera rice");
    await h.expectText("430 kcal");
    assert.equal((await meals()).length, before, "scanning saves nothing");
    await snapshotAllWidths("macro-scan-review");

    await clickLabel("Add to my day");
    await h.expectPath("/macro");
    const saved = (await meals()).filter((m) => m.title === "Dal, rice and roti");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].source, "manual");
    const [items] = await connection.query("SELECT name, kcal FROM macro_meal_items WHERE macro_meal_id = ? ORDER BY name", [saved[0].id]);
    assert.deepEqual(items.map((i) => [i.name, Number(i.kcal)]), [["Dal tadka", 180], ["Roti", 250]]);
  }));
  it("7. Manual entry, several foods: picked from the food list (numbers follow the amount), one estimated by AI, saved as one named meal", run("manual-multi", async () => {
    const before = (await meals()).length;
    await h.goto("/macro/manual", "Search a food and enter how much");
    // Food 1 from the list: 3 idli (a piece is about 40 g, 130 kcal per 100 g)
    await page.setInput('input[aria-label="Food name"]', "idli");
    await clickLabel("Pick Idli");
    await page.setInput('input[aria-label="Quantity"]', "3");
    await page.waitFor(`document.querySelector('input[aria-label="Calories in kcal"]')?.value === "156"`, NAV_TIMEOUT, "3 idli fill in 156 kcal");
    await h.expectText("Calculated from our food list");
    // Food 2 from the list by grams: 150 g sambar
    await clickLabel("Add another food");
    await page.setInput('input[aria-label="Food 2 name"]', "samb");
    await clickLabel("Pick Sambar");
    await page.setInput('input[aria-label="Food 2 Quantity"]', "150");
    await page.waitFor(`document.querySelector('input[aria-label="Food 2 Calories in kcal"]')?.value === "98"`, NAV_TIMEOUT, "150 g sambar fill in 98 kcal");
    // Food 3 isn't in the list: the AI estimates it (a fixed answer in tests)
    await clickLabel("Add another food");
    await page.setInput('input[aria-label="Food 3 name"]', "Peanut chikki");
    await page.setInput('input[aria-label="Food 3 Quantity"]', "50");
    await clickLabel("Estimate Peanut chikki with AI");
    await page.waitFor(`document.querySelector('input[aria-label="Food 3 Calories in kcal"]')?.value === "240"`, NAV_TIMEOUT, "the AI estimate fills in");
    await h.expectText("Estimated by AI for this amount");
    await page.setInput('input[aria-label="Meal name"]', "Idli sambar");
    await h.expectText("Meal total · 3 foods");
    await snapshotAllWidths("macro-manual-multi");

    await clickLabel("Save meal");
    await h.expectPath("/macro");
    const rows = await meals();
    assert.equal(rows.length, before + 1);
    const saved = rows.find((r) => r.title === "Idli sambar");
    assert.ok(saved, "saved as one meal with its name");
    const [items] = await connection.query("SELECT name, quantity, unit, kcal FROM macro_meal_items WHERE macro_meal_id = ? ORDER BY position", [saved.id]);
    assert.deepEqual(items.map((i) => [i.name, Number(i.quantity), i.unit, Number(i.kcal)]), [["Idli", 3, "piece", 156], ["Sambar", 150, "g", 98], ["Peanut chikki", 50, "g", 240]]);
  }));
});
