// Trainers in the real Expo web build against the isolated test server and the eato_test
// database. Priya (a member with targets) signs in and finds Tara (a trainer); Tara acts
// through the API with her own session token for the steps that are hers, then signs in
// herself for the trainer area. Covers: Find Trainers, the locked profile and the request,
// acceptance unlocking My Trainer, logging a plan meal into the diary, applying and undoing
// the trainer's targets, the trainer's dashboard, clients and client page, and screenshots
// at three widths.
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
const EVIDENCE_DIR = path.join(os.tmpdir(), "eato-ui-evidence");
const SCREENSHOT_DIR = process.env.EATO_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const CLEANUP_TABLES = ["diet_plan_completions", "diet_plan_meal_items", "diet_plan_meals", "diet_plans", "trainer_target_recommendations", "trainer_connections",
  "trainer_profiles", "trainer_clients", "macro_meal_items", "macro_meal_logs", "nutrition_targets", "profiles"];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const MEAL = (slot, name, items) => ({ slot, name, time: "08:00", items });
const OATS = { name: "Oats", quantity: 60, unit: "g", kcal: 230, proteinG: 8, carbsG: 40, fatG: 4 };
const MILK = { name: "Milk", quantity: 200, unit: "ml", kcal: 100, proteinG: 7, carbsG: 10, fatG: 3.5 };

describe("ui trainers: a member and their trainer", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, clerk, h;
  const identities = {};
  const tokens = {};
  const sessions = {};

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
  const snapshotAllWidths = async (name) => {
    if (!SCREENSHOT_DIR) return;
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await h.settle();
      await page.screenshot(path.join(SCREENSHOT_DIR, `${name}-${w}.png`));
    }
    await viewport(390, 844);
  };
  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === ${JSON.stringify(label)} && e.getClientRects().length > 0); if (!els.length) return null; const el = els.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `tab ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const clickLabel = async (label, nth = 0) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(`[aria-label=${JSON.stringify(label)}]`)})].filter((e) => e.getClientRects().length > 0); const el = els.at(${nth}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const noOverflow = async (label) => assert.equal(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, `${label}: the page must not overflow horizontally`);
  const apiAs = async (tag, method, route, body) => {
    const headers = { Authorization: `Bearer ${tokens[tag]}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  const waitForRow = async (sql, params, check, label) => {
    const deadline = Date.now() + 10000;
    let row;
    while (Date.now() < deadline) {
      [[row]] = await connection.query(sql, params);
      if (row && check(row)) return row;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.fail(`${label}: ${JSON.stringify(row)}`);
  };

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
      identities.tara = await clerk.createIdentity(runId, "tara", { withPassword: true, role: "trainer" });
      const minted = await clerk.mintToken(identities.tara.id);
      tokens.tara = minted.jwt;
      sessions.tara = minted.sessionId;
    } catch (error) {
      throw new Error(`Clerk could not create a test identity: ${JSON.stringify(describeClerkError(error))}`);
    }
    await clerk.setUnsafeMetadata(identities.a.id, { profileComplete: true });
    await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, 'Priya Sharma', 'user'), (?, ?, 'Tara Trainer', 'trainer')", [identities.a.id, identities.a.emailAddress, identities.tara.id, identities.tara.emailAddress]);
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, activity, workout_frequency, health_flags, profile_complete) VALUES (?, '1995-05-10', 'female', 'muscle_gain', 165, 70, 'moderately_active', '3-4', '[]', TRUE)", [identities.a.id]);
    const inputs = JSON.stringify({ weightKg: 70, heightCm: 165, age: 31, gender: "female", fitnessGoal: "muscle_gain", activityLevel: "moderately_active" });
    const calculated = JSON.stringify({ rmrFormula: "mifflin_st_jeor", report: null, rmr: 1450, tdee: 2250, targetCalories: 2400, displayCalories: 2400, macros: { proteinG: 140, carbsG: 290, fatG: 75 } });
    await connection.query("INSERT INTO nutrition_targets (user_id, formula, config_version, inputs, calculated, calculated_at, calories, protein_g, carbs_g, fat_g, source) VALUES (?, 'eato-calculator', 'test', ?, ?, NOW(), 2400, 140, 290, 75, 'calculated')", [identities.a.id, inputs, calculated]);
    const profile = await apiAs("tara", "PUT", "/api/trainers/me/profile", { title: "Strength coach", specialties: ["strength", "nutrition"], yearsExperience: 8, bio: "Eight years coaching lifters of every level.", coachingMode: "both", offersNutrition: true, availability: "Mon–Sat, 6–10am", approach: "Progressive overload, patiently.", qualifications: ["ACE CPT"], languages: ["English"] });
    assert.equal(profile.status, 200, JSON.stringify(profile.json));
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
      for (const table of CLEANUP_TABLES) await connection.query("DELETE FROM `" + table + "`");
      await db.deleteUsers(connection, Object.values(identities).map((i) => i.id));
      await connection.end();
    });
    await step("identities", async () => {
      if (!clerk) return;
      for (const sessionId of Object.values(sessions)) await clerk.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await clerk.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. Find Trainers lists Tara; her profile shows the basics with the rest locked", run("find", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await clickTab("Community");
    await h.expectPath("/community");
    await page.clickText("Trainers");
    await h.expectText("Find Trainers");
    await h.expectText("Tara Trainer");
    await h.expectText("You don't have a trainer yet");
    await noOverflow("trainers tab");
    await snapshotAllWidths("trainers-find");
    await clickLabel("Tara Trainer, Strength coach");
    await page.waitFor(`location.pathname.startsWith("/community/trainers/")`, NAV_TIMEOUT, "trainer profile");
    await h.expectText("Full profile unlocks after acceptance");
    assert.equal(await page.hasText("Progressive overload"), false, "the approach is locked");
    await h.expectText("Send Tara a connection request to message them.");
    await snapshotAllWidths("trainers-profile-locked");
  }));

  it("2. Connect sends a request: Request Sent, still locked", run("connect", async () => {
    await clickLabel("Connect with Trainer");
    await waitForRow("SELECT status FROM trainer_connections WHERE client_id = ?", [identities.a.id], (row) => row.status === "requested", "request saved");
    await page.waitFor(`!!document.querySelector('[aria-label="Request sent. Tap to cancel it"]')`, NAV_TIMEOUT, "Request Sent");
    await h.expectText("Messaging unlocks when Tara accepts your request.");
  }));

  it("3. when Tara accepts from her own account, My Trainer unlocks", run("accepted", async () => {
    const accepted = await apiAs("tara", "POST", `/api/trainers/me/requests/${identities.a.id}/accept`);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    // Tara shares a plan and a recommendation
    const meals = [["breakfast", "Oats and milk", [OATS, MILK]], ["morning_snack", "Fruit", [{ ...OATS, name: "Banana", quantity: 1, unit: "piece", kcal: 105 }]], ["lunch", "Dal and rice", [OATS]], ["evening_snack", "Nuts", [OATS]], ["dinner", "Paneer and veg", [OATS]]].map(([s, n, items]) => MEAL(s, n, items));
    assert.equal((await apiAs("tara", "PUT", `/api/trainers/me/clients/${identities.a.id}/plan`, { name: "Lean phase", goal: "fat_loss", startDate: today(), meals })).status, 200);
    assert.equal((await apiAs("tara", "PUT", `/api/trainers/me/clients/${identities.a.id}/recommendation`, { calories: 2100, proteinG: 160, carbsG: 220, fatG: 60, note: "Cutting phase" })).status, 200);
    await page.evaluate("history.back()");
    await h.expectPath("/community");
    await page.clickText("Feed");
    await page.clickText("Trainers");
    await h.expectText("Strength coach · connected");
    await clickLabel("My trainer Tara Trainer");
    await h.expectPath("/community/trainers/mine");
    await h.expectText("Lean phase");
    await h.expectText("A new recommendation is waiting");
    await snapshotAllWidths("trainers-mine");
  }));

  it("4. the diet plan: logging breakfast with more oats writes one diary meal", run("plan", async () => {
    await clickLabel("Diet Plan");
    await h.expectPath("/community/trainers/plan");
    await h.expectText("Oats and milk");
    await h.expectText("0 of 5 meals");
    await snapshotAllWidths("trainers-diet-plan");
    await clickLabel("Log Oats and milk");
    await page.waitFor(`location.pathname.startsWith("/community/trainers/log/")`, NAV_TIMEOUT, "log screen");
    await clickLabel("More Oats");
    await h.expectText("Planned: 330 kcal");
    await snapshotAllWidths("trainers-log-meal");
    await clickLabel("Log Meal, 445 kcal");
    await h.expectPath("/community/trainers/plan");
    await h.expectText("1 of 5 meals");
    const row = await waitForRow("SELECT m.source, m.title, SUM(i.kcal) AS kcal FROM macro_meal_logs m JOIN macro_meal_items i ON i.macro_meal_id = m.id WHERE m.user_id = ? GROUP BY m.id", [identities.a.id], (r) => r.source === "plan", "plan meal logged");
    assert.equal(row.title, "Oats and milk");
    assert.equal(Number(row.kcal), 445, "1.5 × oats + 1 × milk");
  }));

  it("5. targets: the trainer's recommendation applies only on tap, and there is a way back", run("targets", async () => {
    await page.evaluate("history.back()");
    await h.expectPath("/community/trainers/mine");
    await clickLabel("Nutrition Targets, new");
    await h.expectPath("/community/trainers/targets");
    await h.expectText("Active · Personal (calculated)");
    await h.expectText("2100 kcal · P 160 g · C 220 g · F 60 g");
    await snapshotAllWidths("trainers-targets");
    await clickLabel("Use trainer targets");
    await waitForRow("SELECT source, calories FROM nutrition_targets WHERE user_id = ?", [identities.a.id], (r) => r.source === "trainer_adjusted" && r.calories === 2100, "trainer target active");
    await h.expectText("Active · Trainer");
    await clickLabel("Use my personal targets");
    await waitForRow("SELECT source, calories FROM nutrition_targets WHERE user_id = ?", [identities.a.id], (r) => r.source === "calculated" && r.calories === 2400, "own target back");
    await h.expectText("Active · Personal (calculated)");
  }));

  it("6. Tara's trainer area: the dashboard, her client and the client's page", run("trainer-area", async () => {
    await page.evaluate(`window.Clerk.signOut({ redirectUrl: "/sign-in" })`);
    await page.waitFor(`!(window.Clerk && window.Clerk.session)`, 15000, "member signed out");
    // The shared helper waits for a member's routes; a trainer lands on /trainer
    try { await signInAs(page, h, identities.tara); } catch (error) { if (!/route after|sign-in outcome/.test(error.message)) throw error; }
    await page.waitFor(`location.pathname === "/trainer"`, 60000, "the trainer dashboard");
    await h.expectText("My clients");
    await snapshotAllWidths("trainers-dashboard");
    await page.clickText("My clients");
    await h.expectPath("/trainer/clients");
    await h.expectText("Priya Sharma");
    await clickLabel("Open Priya Sharma");
    await page.waitFor(`location.pathname.startsWith("/trainer/client/")`, NAV_TIMEOUT, "client page");
    await h.expectText("Recommended targets");
    await h.expectText("Lean phase");
    await noOverflow("client page");
    await snapshotAllWidths("trainers-client");
    await clickLabel("Edit diet plan");
    await page.waitFor(`location.pathname.endsWith("/plan")`, NAV_TIMEOUT, "plan editor");
    await h.expectText("Morning Snack");
    await snapshotAllWidths("trainers-plan-editor");
  }));
});
