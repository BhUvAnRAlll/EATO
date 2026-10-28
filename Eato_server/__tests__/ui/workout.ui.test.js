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
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.EATO_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const WORKOUT_TABLES = ["workout_set_logs", "workout_logs", "workout_day_overrides", "workout_day_exercises", "workout_days", "workout_plans", "workout_profiles", "profiles"];

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
  // Workout opens from Profile (AI Coach took its tab): Home's avatar → Profile → Workout
  const openWorkout = async () => {
    await clickLabelStarting("Profile");
    await h.expectPath("/profile");
    await page.clickText("Workout");
  };
  // Back to the hub and load it fresh (the hub reloads on focus)
  const backToHub = async () => {
    await clickLabelStarting("Back");
    await h.expectPath("/workout");
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
    // The tab bar has AI Coach where Fitness was; Workout lives on Profile
    assert.equal(await page.evaluate(`!!document.querySelector('[role="tab"][aria-label="Fitness"]')`), false, "no Fitness tab");
    await clickTab("AI Coach");
    await h.expectPath("/coach");
    await h.expectText("Get started");
    await clickTab("Home");
    await h.expectPath("/home");
    await openWorkout();
    await h.expectPath("/workout");
    await h.expectText("This week");
    // The app bar's preferences button is enabled only once the plan is ready
    await page.waitFor(`(() => { const b = document.querySelector('[aria-label="Workout preferences"]'); return !!b && b.getAttribute("aria-disabled") !== "true"; })()`, NAV_TIMEOUT, "an enabled Workout preferences button");
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
    // A plan made today doesn't count the days before it: only today onwards is scheduled.
    // The week runs Monday to Sunday, so on a late weekday this can be 0 (for example a Sunday rest day).
    const mondayIndex = (weekday) => (weekday + 6) % 7;
    const expected = days.filter((d) => mondayIndex(d.weekday) >= mondayIndex(weekdayOf(state.today))).length;
    await page.waitFor(`document.body.innerText.includes("0 of ${expected} done")`, NAV_TIMEOUT, `0 of ${expected} done`);
    assert.equal(await page.evaluate(`document.querySelectorAll('[aria-label$=": Missed"]').length`), 0, "nothing is missed yet");
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
    // Reload the hub (it reads on focus): Workout has no tab bar now, so go Home directly
    await h.goto("/home", "Today's Macros");
    await openWorkout();
    await h.expectPath("/workout");
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

    // An exercise with steps to read (on a training day today, warm-ups get a menu too, but
    // theirs only offers "Start from this exercise")
    const dayId = state.days.find((d) => d.weekday === weekdayOf(target)).id;
    const [[withSteps]] = await connection.query(
      "SELECT l.name FROM workout_day_exercises e JOIN workout_exercise_library l ON l.id = e.exercise_id WHERE e.day_id = ? AND JSON_LENGTH(l.instructions) > 0 ORDER BY FIELD(e.section, 'warmup', 'workout', 'cooldown'), e.position LIMIT 1",
      [dayId],
    );
    await clickLabelStarting(`More about ${withSteps.name}`);
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
    await h.expectText("JustFit workout engine");
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
    await h.expectPath("/workout");
  }));

  it("5. a missed session moves to today, and a later day swaps with today", run("reschedule", async () => {
    const today = await page.evaluate(localDay(0));
    const overrideOn = async (iso) => (await connection.query("SELECT day_id FROM workout_day_overrides WHERE user_id = ? AND on_date = ?", [identities.a.id, iso]))[0][0]?.day_id ?? null;
    const clickMissed = async () => {
      const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label$=": Missed"]')].filter((e) => e.getClientRects().length > 0)[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, "a missed day");
      await page.clickAt(pos.x, pos.y);
    };

    // "Not now" closes the prompt and changes nothing
    await clickMissed();
    await h.expectText("Do it today instead?");
    await h.expectText("Move that session to today and pick up where you left off.");
    await clickLabelStarting("Not now");
    await h.expectNoText("Do it today instead?");
    assert.equal(await overrideOn(today), null, "Not now wrote nothing");

    // "Move to today" points today at the missed session, and the hub shows it
    await clickMissed();
    await h.expectText("Do it today instead?");
    await snapshotAllWidths("workout-move-sheet");
    await clickLabelStarting("Move to today");
    await page.waitFor(`!document.body.innerText.includes("Do it today instead?")`, NAV_TIMEOUT, "the prompt closes");
    const movedDay = await overrideOn(today);
    assert.ok(movedDay, "today now points at the missed session");
    const movedTitle = state.days.find((d) => d.id === movedDay).title;
    await page.waitFor(`!!document.querySelector('[aria-label^=${JSON.stringify(`Today: ${movedTitle},`)}]')`, NAV_TIMEOUT, "today's card shows the moved session");

    // A later scheduled day in this week's strip offers to swap with today
    const daysLeft = 6 - ((weekdayOf(today) + 6) % 7);
    let later = null;
    for (let i = 1; i <= daysLeft && !later; i++) {
      const iso = await page.evaluate(localDay(i));
      if (state.days.some((d) => d.weekday === weekdayOf(iso))) later = iso;
    }
    if (!later) {
      // Late in the week there is no later session in the strip: nothing to swap with
      console.log(`  (swap not exercised: no scheduled day after ${today} in this week's strip)`);
      return;
    }
    const laterDay = state.days.find((d) => d.weekday === weekdayOf(later));
    await clickLabelStarting(await page.evaluate(tileLabel(later)));
    await h.expectText("Swap with today?");
    await h.expectText("will trade places.");
    await snapshotAllWidths("workout-swap-sheet");
    await clickLabelStarting("Swap days");
    await page.waitFor(`!document.body.innerText.includes("Swap with today?")`, NAV_TIMEOUT, "the prompt closes");
    assert.equal(await overrideOn(today), laterDay.id, "today runs the later session");
    assert.equal(await overrideOn(later), movedDay, "the later day runs what today had");
    await page.waitFor(`!!document.querySelector('[aria-label^=${JSON.stringify(`Today: ${laterDay.title},`)}]')`, NAV_TIMEOUT, "today's card shows the swapped session");
  }));

  it("6. the session player: start from an exercise, log a set with reps and weight, end early, then finish", run("player", async () => {
    const today = await page.evaluate(localDay(0));
    const user = identities.a.id;
    // Step 5 left today with a session (moved or swapped onto it)
    const [[{ day_id: dayId }]] = await connection.query("SELECT day_id FROM workout_day_overrides WHERE user_id = ? AND on_date = ?", [user, today]);
    const [rows] = await connection.query(
      "SELECT e.id, e.sets, e.reps_max, l.name FROM workout_day_exercises e JOIN workout_exercise_library l ON l.id = e.exercise_id WHERE e.user_id = ? AND e.day_id = ? AND e.section = 'workout' ORDER BY e.position",
      [user, dayId],
    );
    const setsOf = (r) => (typeof r.sets === "string" ? JSON.parse(r.sets) : r.sets);
    const rep = rows.find((r) => setsOf(r)[0].reps !== undefined || setsOf(r)[0].durationSec === undefined);
    const prescribed = setsOf(rep)[0].reps ?? rep.reps_max;
    // The screen saves in the background, so poll the row rather than reading it once
    const waitForRow = async (sql, params, test, what) => {
      const deadline = Date.now() + NAV_TIMEOUT;
      for (;;) {
        const [[row]] = await connection.query(sql, params);
        if (row && test(row)) return row;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    };
    const clickLast = async (label) => {
      const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(`[aria-label="${label}"]`)})].filter((e) => e.getClientRects().length > 0); const el = els[els.length - 1]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `the last ${label}`);
      await page.clickAt(pos.x, pos.y);
    };

    // The day: today's session can start, from any exercise
    await h.goto(`/workout/day?date=${today}`, "Exercises");
    await h.expectText("Start Workout");
    await clickLabelStarting(`Start from ${rep.name}`);
    await h.expectPath("/workout/session");
    await h.expectText(rep.name);
    await h.expectText(`SET 1 OF ${setsOf(rep).length}`); // innerText follows the uppercase style
    await h.expectText("Next up");
    await page.waitFor(`!!document.querySelector('[aria-label=${JSON.stringify(`${prescribed} reps`)}]')`, NAV_TIMEOUT, "the prescribed reps");
    const [[log]] = await connection.query("SELECT id FROM workout_logs WHERE user_id = ? AND on_date = ? AND status = 'in_progress'", [user, today]);
    assert.ok(log, "opening the player started today's session");
    await snapshotAllWidths("workout-player");

    // One rep more and 20 kg, then Set done: saved at once
    await clickLabelStarting("One rep more");
    await page.setInput('[aria-label="Weight in kg (optional)"]', "20");
    await clickLabelStarting("Set done");
    const saved = await waitForRow("SELECT reps, weight_kg FROM workout_set_logs WHERE log_id = ? AND day_exercise_id = ? AND set_index = 0", [log.id, rep.id], () => true, "the logged set");
    assert.deepEqual({ reps: saved.reps, weight: saved.weight_kg }, { reps: prescribed + 1, weight: 20 });
    await h.expectText("Next up");
    await snapshotAllWidths("workout-player-next");

    // Leave: the session stays under way, so the day offers Continue and End session
    await clickLabelStarting("Leave session");
    await h.expectPath("/workout/day");
    await h.expectText("Continue Workout");
    await clickLabelStarting("End session");
    await h.expectText("End this session?");
    await clickLabelStarting("Keep going");
    await h.expectNoText("End this session?");
    await clickLabelStarting("End session");
    await h.expectText("End this session?");
    await snapshotAllWidths("workout-end-sheet");
    await clickLast("End session");
    await waitForRow("SELECT status FROM workout_logs WHERE id = ?", [log.id], (r) => r.status === "abandoned", "the log ended early");
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM workout_set_logs WHERE log_id = ?", [log.id]))[0][0].n, 1, "the set is kept");
    await h.expectText("Start Workout");

    // Start again and skip to the end: the session is finished and the day shows Completed
    await clickLabelStarting("Start Workout");
    await h.expectPath("/workout/session");
    await h.expectText("Next up");
    for (let i = 0; i < 400; i++) {
      if ((await page.bodyText()).includes("Logged to today. Nice work.")) break;
      await clickLabelStarting("Skip ahead").catch(() => {});
      await new Promise((r) => setTimeout(r, 60));
    }
    await h.expectText("Logged to today. Nice work.");
    await h.expectText("WORKOUT COMPLETE");
    await page.waitFor(`/0 of \\d+ sets/.test(document.body.innerText)`, NAV_TIMEOUT, "the set count");
    await snapshotAllWidths("workout-player-complete");
    await waitForRow("SELECT COUNT(*) AS n FROM workout_logs WHERE user_id = ? AND on_date = ? AND status = 'completed'", [user, today], (r) => r.n === 1, "a completed log");
    await clickLabelStarting("Done");
    await h.expectPath("/workout/day");
    await h.expectText("Completed");
    await backToHub();
  }));

  it("7. preferences: change the goal and the days, and Submit builds a new plan", run("preferences", async () => {
    const user = identities.a.id;
    const [[before]] = await connection.query("SELECT id, goal FROM workout_plans WHERE user_id = ? AND status = 'active'", [user]);
    // Exact labels: the hub's week tiles ("Monday 12 October: …") stay mounted behind the modal
    const clickExact = async (label) => {
      const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(`[aria-label="${label}"]`)})].filter((e) => e.getClientRects().length > 0); const el = els[els.length - 1]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `the element labelled ${label}`);
      await page.clickAt(pos.x, pos.y);
    };
    await clickLabelStarting("Workout preferences");
    await h.expectPath("/workout/preferences");
    await h.expectText("Review your workout preferences. You can edit anytime before submitting.");
    await page.waitFor(`!!document.querySelector('[aria-label^="Fitness goal: "]')`, NAV_TIMEOUT, "the goal row");
    assert.equal(await page.evaluate(`document.querySelector('[aria-label="Submit"]').getAttribute("aria-disabled")`), "true", "nothing changed yet");
    await snapshotAllWidths("workout-preferences");

    // Goal: a sheet of options; picking one closes it
    await clickLabelStarting("Fitness goal: ");
    await h.expectText("Lose weight");
    await snapshotAllWidths("workout-preferences-goal");
    await clickExact("Lose weight");
    await page.waitFor(`!!document.querySelector('[aria-label="Fitness goal: Lose weight"]')`, NAV_TIMEOUT, "the new goal");

    // Days: below three, Done is off; three or more and it saves the choice
    const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
    const [current] = await connection.query("SELECT weekday FROM workout_days WHERE plan_id = ?", [before.id]);
    const chosen = current.map((d) => d.weekday);
    assert.equal(chosen.length, 3, "the plan trains three days");
    await clickLabelStarting("Workout days: ");
    await h.expectText("3 days a week");
    await clickExact(NAMES[chosen[0]]);
    await h.expectText("Pick at least 3 days (2 chosen).");
    assert.equal(await page.evaluate(`[...document.querySelectorAll('[aria-label="Done"]')].pop().getAttribute("aria-disabled")`), "true", "Done is off below three days");
    await snapshotAllWidths("workout-preferences-days");
    const added = MONDAY_FIRST.filter((d) => !chosen.includes(d)).slice(0, 2);
    for (const d of added) await clickExact(NAMES[d]);
    await h.expectText("4 days a week");
    await clickExact("Done");
    const expected = MONDAY_FIRST.filter((d) => d !== chosen[0] && (chosen.includes(d) || added.includes(d)));
    await page.waitFor(`!!document.querySelector('[aria-label=${JSON.stringify(`Workout days: ${expected.map((d) => NAMES[d]).join(", ")}`)}]')`, NAV_TIMEOUT, "the new days");

    await clickExact("Submit");
    await h.expectPath("/workout");
    const [[after]] = await connection.query("SELECT id, goal, source FROM workout_plans WHERE user_id = ? AND status = 'active'", [user]);
    assert.notEqual(after.id, before.id, "a new plan is active");
    assert.deepEqual({ goal: after.goal, source: after.source }, { goal: "lose_weight", source: "member" });
    const [days] = await connection.query("SELECT weekday FROM workout_days WHERE plan_id = ? ORDER BY weekday", [after.id]);
    assert.deepEqual(days.map((d) => d.weekday), [...expected].sort((a, b) => a - b));
  }));

  it("8. rebuild my plan: three steps, a review, the generating screen, and the reveal", run("recreate", async () => {
    const user = identities.a.id;
    const [[before]] = await connection.query("SELECT id FROM workout_plans WHERE user_id = ? AND status = 'active'", [user]);
    const clickExact = async (label) => {
      const pos = await page.waitFor(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(`[aria-label="${label}"]`)})].filter((e) => e.getClientRects().length > 0); const el = els[els.length - 1]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `the element labelled ${label}`);
      await page.clickAt(pos.x, pos.y);
    };
    // A choice inside a labelled group (the ranges repeat across questions)
    const clickIn = async (group, text) => {
      const pos = await page.waitFor(`(() => { const g = [...document.querySelectorAll(${JSON.stringify(`[aria-label="${group}"]`)})].filter((e) => e.getClientRects().length > 0).pop(); if (!g) return null; const el = [...g.querySelectorAll("*")].find((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `${text} in ${group}`);
      await page.clickAt(pos.x, pos.y);
    };
    const clickVisibleText = async (text) => {
      const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(text)} && e.getClientRects().length > 0).pop(); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `text ${text}`);
      await page.clickAt(pos.x, pos.y);
    };

    await clickLabelStarting("Workout preferences");
    await h.expectPath("/workout/preferences");
    await clickExact("Re-create plan");
    await h.expectPath("/workout/recreate");
    await h.expectText("Recreate your plan");
    await h.expectText("Your current plan won't be changed until your new plan is successfully created.");
    // The setup profile fills the basics; body type was never asked
    await page.waitFor(`document.querySelector('[aria-label="Weight in kg"]')?.value === "70"`, NAV_TIMEOUT, "weight from setup");
    await snapshotAllWidths("workout-recreate-basics");
    await clickExact("Continue");
    await h.expectText("Pick the closest body type");
    await clickVisibleText("Medium build");
    await h.expectNoText("Pick the closest body type");
    await clickExact("Continue");

    await h.expectPath("/workout/recreate/goals");
    await h.expectText("What you're training for, how often, and how fast you want to move.");
    await clickExact("Continue");
    await h.expectText("Pick a pace");
    await clickVisibleText("Healthy");
    await clickVisibleText("Training regularly");
    await snapshotAllWidths("workout-recreate-goals");
    await clickExact("Continue");

    await h.expectPath("/workout/recreate/performance");
    await h.expectText("Your current performance");
    await clickIn("Bodyweight squats", "6–15");
    await clickIn("Push-ups", "1–5");
    await clickIn("Pull-ups", "0");
    await clickVisibleText("Yes");
    await h.expectText("For your safety, your new plan will use beginner-level exercises");
    await snapshotAllWidths("workout-recreate-performance");
    await clickVisibleText("No");
    await h.expectNoText("For your safety, your new plan will use beginner-level exercises");
    await clickExact("Continue");

    await h.expectPath("/workout/recreate/review");
    await h.expectText("Medium build");
    await h.expectText("6–15");
    await snapshotAllWidths("workout-recreate-review");
    await clickExact("Generate my plan");
    await h.expectText("Creating your plan");
    await h.expectPath("/workout/recreate/reveal");
    await h.expectText("Your plan is ready");
    await h.expectText("Your first workout");
    const [[after]] = await connection.query("SELECT id, source, split FROM workout_plans WHERE user_id = ? AND status = 'active'", [user]);
    assert.notEqual(after.id, before.id, "a new plan is active");
    assert.deepEqual({ source: after.source, split: after.split }, { source: "member", split: "auto" });
    const [[saved]] = await connection.query("SELECT body_type, pace, fitness_base, squat_score, push_score, pull_score, serious_injury FROM workout_profiles WHERE user_id = ?", [user]);
    assert.deepEqual({ ...saved }, { body_type: "average", pace: "standard", fitness_base: 3, squat_score: 3, push_score: 2, pull_score: 1, serious_injury: 0 });
    await snapshotAllWidths("workout-recreate-reveal");
    await clickExact("View plan details");
    await h.expectPath("/workout");
  }));
});
