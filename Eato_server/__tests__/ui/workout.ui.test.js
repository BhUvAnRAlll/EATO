// The Fitness tab in the real Expo web build against the isolated test server and the eato_test
// database, as a signed-in member who finished setup (gaining muscle, 3-4 days a week, 70 kg).
// Covers the first visit building the plan, the hub (today, this week, empty and filled
// history), the training day (Exercises, Muscles, About, the "How to do it" sheet), a rest day,
// and screenshots at 3 widths.
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
const WORKOUT_TABLES = ["workout_logs", "workout_day_overrides", "workout_day_exercises", "workout_days", "workout_plans", "workout_profiles", "profiles"];

// The page's local day, n days from today, as YYYY-MM-DD (the app works in local days)
const localDay = (n) => `(() => { const d = new Date(); d.setDate(d.getDate() + ${n}); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`;
// The week tile's accessible name for a date: "Friday 16 October: …"
const tileLabel = (iso) => `(() => { const [y, m, d] = ${JSON.stringify(iso)}.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) + ":"; })()`;
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

describe("ui workout: the Fitness hub and a training day", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, clerk, h;
  const identities = {};
  const state = {};

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
  const clickTab = async (label) => {
    const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && (e.textContent || "").trim() === ${JSON.stringify(label)} && e.getClientRects().length > 0); if (!els.length) return null; const el = els.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `tab ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  const clickLabelStarting = async (prefix) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label").startsWith(${JSON.stringify(prefix)}))[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${prefix}…`);
    await page.clickAt(pos.x, pos.y);
  };
  // Back to the hub and load it fresh (the hub reloads on focus)
  const backToHub = async () => {
    await clickLabelStarting("Back");
    await h.expectPath("/fitness");
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), 44, "schema.sql should create 44 tables in eato_test");
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
    await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, 'Arjun Mehta', 'user')", [identities.a.id, identities.a.emailAddress]);
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency, profile_complete) VALUES (?, '1995-05-10', 'male', 'muscle_gain', 175, 70, '3-4', TRUE)", [identities.a.id]);
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
      if (ids.length) for (const table of WORKOUT_TABLES) await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [ids]);
      await db.deleteUsers(connection, ids);
      await connection.end();
    });
    await step("identities", async () => { if (clerk) for (const identity of Object.values(identities)) await clerk.deleteUser(identity.id); });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the first visit builds the plan: today, this week and an empty history", run("hub-first", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await clickTab("Fitness");
    await h.expectPath("/fitness");
    await h.expectText("This week");
    await h.expectText("Stay consistent, get stronger");
    const [plans] = await connection.query("SELECT id FROM workout_plans WHERE user_id = ? AND status = 'active'", [identities.a.id]);
    assert.equal(plans.length, 1, "the visit made exactly one plan");
    state.planId = plans[0].id;
    const [days] = await connection.query("SELECT id, weekday, title FROM workout_days WHERE plan_id = ? ORDER BY weekday", [state.planId]);
    assert.equal(days.length, 3);
    state.days = days;
    state.today = await page.evaluate(localDay(0));
    const todayDay = days.find((d) => d.weekday === weekdayOf(state.today));
    if (todayDay) {
      await h.expectText(todayDay.title);
      assert.equal(await page.evaluate(`!!document.querySelector('[aria-label^="Today: "]')`), true, "today's session card");
    } else {
      await h.expectText("Recharge to come back stronger");
    }
    await h.expectText("0 of 3 done");
    await h.expectText("No sessions yet");
    await snapshotAllWidths("workout-hub-new");
  }));

  it("2. history: a finished session and a missed one, once the plan has been running a while", run("hub-history", async () => {
    await connection.query("UPDATE workout_plans SET start_date = DATE_SUB(start_date, INTERVAL 30 DAY) WHERE id = ?", [state.planId]);
    // The two most recent scheduled days in the last week: one finished, one missed
    const past = [];
    for (let i = 1; i <= 7; i++) past.push(await page.evaluate(localDay(-i)));
    const scheduled = past.filter((d) => state.days.some((day) => day.weekday === weekdayOf(d)));
    assert.ok(scheduled.length >= 2);
    const [done, missed] = scheduled;
    const dayOf = (iso) => state.days.find((d) => d.weekday === weekdayOf(iso));
    await connection.query("INSERT INTO workout_logs (user_id, plan_id, day_id, on_date, status, completed_at) VALUES (?, ?, ?, ?, 'completed', NOW(3))", [identities.a.id, state.planId, dayOf(done).id, done]);
    state.done = done;
    // Reload the hub (it reads on focus)
    await clickTab("Home");
    await h.expectPath("/home");
    await clickTab("Fitness");
    await h.expectPath("/fitness");
    await h.expectText("History");
    await page.waitFor(`!!document.querySelector('[aria-label$=": Completed"][aria-label^=${JSON.stringify(dayOf(done).title + ",")}]')`, NAV_TIMEOUT, "the completed history row");
    assert.equal(await page.evaluate(`!!document.querySelector('[aria-label^=${JSON.stringify(dayOf(missed).title + ",")}][aria-label$=": Missed"]')`), true, "the missed history row");
    await snapshotAllWidths("workout-hub-history");
  }));

  it("3. a training day: the exercise list by section, muscles, about, and how to do an exercise", run("day", async () => {
    // The next scheduled day from today (it's planned, so the footer offers no action yet)
    let target = null;
    for (let i = 0; i < 7 && !target; i++) {
      const iso = await page.evaluate(localDay(i));
      if (state.days.some((d) => d.weekday === weekdayOf(iso))) target = iso;
    }
    const title = state.days.find((d) => d.weekday === weekdayOf(target)).title;
    const weekStart = await page.evaluate(`(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
    if (target <= await page.evaluate(localDay(6 - ((new Date().getDay() + 6) % 7))) && target >= weekStart) {
      await clickLabelStarting(await page.evaluate(tileLabel(target)));
    } else {
      await h.goto(`/workout/day?date=${target}`, "Exercises");
    }
    await h.expectPath("/workout/day");
    await h.expectText(title);
    await h.expectText("Main Workout");
    await h.expectText("Warm Up");
    await h.expectText("sets total");
    await h.expectText("Stretch");
    await h.expectText(target === state.today ? "Start Workout" : "Not yet");
    await snapshotAllWidths("workout-day-exercises");

    await clickLabelStarting("More about ");
    await h.expectText("How to do it");
    await page.clickText("How to do it");
    await h.expectText("How to do it: ");
    await h.expectText("1. ");
    await snapshotAllWidths("workout-day-how-to");
    await page.clickText("Done");
    await h.expectNoText("How to do it: ");

    await page.clickText("Muscles");
    await page.waitFor(`/\\d+ exercises · \\d+ sets/.test(document.body.innerText)`, NAV_TIMEOUT, "a muscle group row");
    await snapshotAllWidths("workout-day-muscles");

    await page.clickText("About");
    await h.expectText("Planned by");
    await h.expectText("EATO workout engine");
    await h.expectText("Estimated burn");
    await h.expectText("Gain muscle");
    await snapshotAllWidths("workout-day-about");
    await backToHub();
  }));

  it("4. a past finished day shows Completed; a rest day says nothing is scheduled", run("rest", async () => {
    await h.goto(`/workout/day?date=${state.done}`, "Exercises");
    await h.expectText("Completed");
    await snapshotAllWidths("workout-day-completed");

    let rest = null;
    for (let i = 1; i <= 7 && !rest; i++) {
      const iso = await page.evaluate(localDay(i));
      if (!state.days.some((d) => d.weekday === weekdayOf(iso))) rest = iso;
    }
    await h.goto(`/workout/day?date=${rest}`, "Rest day");
    await h.expectText("Nothing is scheduled on this day.");
    await snapshotAllWidths("workout-day-rest");
    await clickLabelStarting("Back");
    await h.expectPath("/fitness");
  }));
});
