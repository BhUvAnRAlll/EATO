// The photo body-fat scan screen in the real web build (JustFit_client/src/app/setup/body-scan.tsx):
// the Body composition step offers "Scan Body", then the photo instructions, then the scan screen with both photo
// tiles, the body type choice (the account has no gender yet) and the pose tips, Scan stays
// unavailable without photos, and Back returns to Body composition with nothing saved. Picking a
// photo needs the device's camera or gallery, so the scan itself is covered by the e2e test
// (body-scan.e2e.test.js) with a fake Forma, not here.
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
//   JUSTFIT_SCREENSHOT_DIR=<dir> additionally saves the scan screen at three widths
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { identitiesFor, describeIdentityError } = require("../e2e/test-identities.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { dateOfBirth, fillSetup, helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const SCAN_BUTTON = "Scan Body";
// A 1×1 PNG picked as both photos; the fake Forma below answers instead of the real model
const TINY_PNG = path.join(os.tmpdir(), "justfit-body-scan-test.png");
const TINY_PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
// Shaped like a real Forma answer, technical fields included, so the test proves they never reach the screen
const formaResult = {
  model_version: "1.2.0",
  body_fat: { pct: 23.04, uncertainty_pct_points: 3.39, basis: "model estimate from silhouettes", reference_standard: "DXA (NHANES)" },
  derived: { fat: 13.8, lean: 46.2, water: 33.8, protein: 9.1, minerals: 3.3, smm: 25.7, bmi: 20.76, waist: 74.2, whtr: 0.4365, bmr: 1388.6, tdee: 1909.3, intake: 1388.6, target_weight: 58.1, weight_change: -1.9, fat_change: -1.9, muscle_change: 0 },
  derived_basis: "population formulas applied to body fat %",
  visceral_level: { value: 5, scale: "1-20", basis: "heuristic" },
  score: { value: 81, basis: "Forma heuristic" },
  segments: { right_arm: { kg: 2.6, status: "Normal" }, left_arm: { kg: 2.6, status: "Normal" }, trunk: { kg: 21.5, status: "Normal" }, right_leg: { kg: 7.2, status: "Under" }, left_leg: { kg: 7.3, status: "Normal" } },
  segments_fat: { right_arm: { kg: 0.8, status: "Normal" }, left_arm: { kg: 0.8, status: "Normal" }, trunk: { kg: 7.1, status: "Over" }, right_leg: { kg: 2.5, status: "Normal" }, left_leg: { kg: 2.6, status: "Normal" } },
  disclaimer: "Photo-based estimates are not a medical measurement.",
};

function startFakeForma() {
  const fake = { received: 0, url: null, server: null };
  fake.server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      fake.received += 1;
      res.writeHead(req.method === "POST" && req.url === "/scan" ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(req.url === "/scan" ? formaResult : { error: "not found" }));
    });
  });
  return new Promise((resolve) => fake.server.listen(0, "127.0.0.1", () => { fake.url = `http://127.0.0.1:${fake.server.address().port}`; resolve(fake); }));
}

describe("ui body scan: Scan Body, the photo instructions, the scan screen and the way back", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, countsBefore, server, expo, chrome, client, page, testAccounts, h, fake;
  const identities = {};

  const evidence = async (label) => {
    if (!page) return "";
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const shot = await page.screenshot(path.join(EVIDENCE_DIR, `${stamp}-${label}.png`)).catch(() => "no screenshot");
    const text = (await page.bodyText().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
    return `path: ${await page.path().catch(() => "?")} | screenshot: ${shot} | visible text: "${text}"`;
  };
  const run = (label, fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { throw new Error(`${error.message}\n${await evidence(label)}`); }
  };
  const apiUrl = () => `http://localhost:${env.PORT}`;
  const setWidth = (width, height) => client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, page.sessionId);
  const cleanupIdentity = async (tag) => {
    const identity = identities[tag]; if (!identity) return;
    await db.deleteUsers(connection, [identity.id]);
    await testAccounts.deleteUser(identity.id);
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
    testAccounts = identitiesFor(env);
    await testAccounts.sweepOrphans();
    fs.writeFileSync(TINY_PNG, TINY_PNG_BYTES);
    fake = await startFakeForma();
    server = await startTestServer({ ...env, FORMA_SCAN_URL: fake.url });
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: apiUrl() });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    await setWidth(390, 844);
    try { identities.a = await testAccounts.createIdentity(runId, "a"); } catch (error) { throw new Error(`could not create the test identity: ${JSON.stringify(describeIdentityError(error))}`); }
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    await step("stop fake Forma", async () => { if (fake) await new Promise((r) => fake.server.close(r)); });
    await step("remove temp image", async () => { fs.rmSync(TINY_PNG, { force: true }); });
    if (connection && testAccounts) {
      for (const tag of Object.keys(identities)) await step(`cleanup identity ${tag} (${identities[tag]?.id})`, () => cleanupIdentity(tag));
      await step("row counts back to baseline", async () => { assert.deepEqual(await db.rowCounts(connection), countsBefore); });
    }
    await step("close database", async () => { if (connection) await connection.end(); });
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

  it("1. Body composition offers Scan Body, which shows the photo instructions, and Start scan opens the scan screen", run("link", async () => {
    await signInAs(page, h, identities.a);
    await h.goto("/setup/body-composition", "Body composition");
    await h.expectText(SCAN_BUTTON);
    await page.clickText(SCAN_BUTTON);
    await h.expectPath("/setup/scan-guide");
    await h.expectText("How to take your photos");
    // The instruction video comes first: a real <video> that loads, muted and looping
    await h.expectText("Watch first");
    await page.waitFor(`(() => { const v = document.querySelector("video"); return !!v && v.readyState >= 2; })()`, 20000, "the instruction video to load");
    // No controls; it plays by itself on a loop (muted on the web, where autoplay with sound is blocked)
    await page.waitFor(`(() => { const v = document.querySelector("video"); return !!v && !v.paused; })()`, 20000, "the instruction video to autoplay");
    const video = await page.evaluate(`(() => { const v = document.querySelector("video"); return { controls: v.controls, muted: v.muted, loop: v.loop, duration: Math.round(v.duration), src: !!(v.currentSrc || v.src) }; })()`);
    assert.deepEqual(video, { controls: false, muted: true, loop: true, duration: 10, src: true });
    if (SCREENSHOT_DIR) {
      // A tall window shows the whole guide (poses and clothing) in one picture
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      for (const [width] of WIDTHS) {
        await setWidth(width, 2300);
        await new Promise((r) => setTimeout(r, 700));
        await page.screenshot(path.join(SCREENSHOT_DIR, `setup-scan-guide-full-${width}.png`));
      }
      await setWidth(390, 844);
      await h.settle();
    }
    await page.clickText("Start scan");
    await h.expectPath("/setup/body-scan");
    await h.expectText("Estimate from photos");
  }));

  it("2. the scan screen shows both photo tiles, the body type choice and the pose tips, and no scan request is made", run("screen", async () => {
    for (const text of ["Front photo", "Side photo", "Take photo", "Choose from gallery", "Which body type is closer to yours?", "For a better estimate", "Scan"]) {
      assert.ok(await page.hasText(text), `the scan screen must show "${text}"`);
    }
    assert.ok(await page.hasText("estimate, not a medical measurement"), "the screen must say the result is an estimate");
    // Without photos the Scan button is dimmed and inert: tapping it neither navigates nor calls the server
    await page.clickText("Scan");
    await h.settle();
    assert.equal(await page.path(), "/setup/body-scan");
    assert.deepEqual(page.requests.filter((u) => u.includes("/api/body-composition")), [], "no scan request without photos");
    if (SCREENSHOT_DIR) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      for (const [width, height] of WIDTHS) {
        await setWidth(width, height);
        await h.goto("/setup/body-scan", "Estimate from photos");
        await page.screenshot(path.join(SCREENSHOT_DIR, `setup-body-scan-${width}.png`));
      }
      await setWidth(390, 844);
    }
  }));

  it("3. Back returns to Body composition, still unscanned, with nothing saved", run("back", async () => {
    await h.goto("/setup/body-scan", "Estimate from photos");
    await page.clickLabel("Back");
    await h.expectPath("/setup/body-composition");
    await h.expectText("Body composition");
    await h.expectText(SCAN_BUTTON); // still unscanned: no estimate was kept
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 }, "nothing was saved");
  }));

  // "Choose from gallery" opens the browser's file chooser on a hidden input. Headless Chrome may
  // cancel that dialog at once, so the chooser is intercepted through DevTools and the file set there.
  const pickFromGallery = async () => {
    await client.send("Page.enable", {}, page.sessionId);
    await client.send("Page.setInterceptFileChooserDialog", { enabled: true }, page.sessionId);
    const chooser = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("the photo picker did not open a file chooser")), 10000);
      client.on((m) => { if (m.sessionId === page.sessionId && m.method === "Page.fileChooserOpened") { clearTimeout(timer); resolve(m.params); } });
    });
    await page.clickText("Choose from gallery");
    const { backendNodeId } = await chooser;
    await client.send("DOM.setFileInputFiles", { backendNodeId, files: [TINY_PNG] }, page.sessionId);
    await client.send("Page.setInterceptFileChooserDialog", { enabled: false }, page.sessionId);
  };

  it("4. a finished scan opens the full report: every section, no technical details, no download; Use this result returns to the step", run("report", async () => {
    // The scan needs height, weight, age and sex, which the personal step collects (kept in memory)
    const dob = dateOfBirth(30);
    await h.goto("/setup/personal", "Let's get to know you");
    await page.setInput(h.input("Your full name"), "Scan Tester");
    await page.clickText("Select your birthday");
    await h.expectText("Cancel");
    await page.setInput("[aria-modal] input", dob.input);
    await page.clickText("Done");
    await h.expectText(dob.shown);
    await page.setInput(h.input("170"), "168");
    await page.clickText("Select");
    await h.expectText("Prefer not to say");
    await page.clickText("Female");
    await h.expectNoText("Prefer not to say");
    await page.setInput(h.input("70"), "60");
    await page.clickText("Next");
    await h.expectPath("/setup/body-composition");
    await page.clickText(SCAN_BUTTON);
    await h.expectPath("/setup/scan-guide");
    await page.clickText("Start scan");
    await h.expectPath("/setup/body-scan");

    await pickFromGallery(); // front
    await h.expectText("Retake");
    await pickFromGallery(); // side
    await page.waitFor(`(document.body.innerText.match(/Retake/g) || []).length === 2`, 15000, "both photos picked");
    await page.clickText("Scan");
    await page.waitFor(`location.pathname === "/setup/scan-report"`, 20000, "the report opens");
    // Caught while the bars are still growing (they take about 1.7 s in all)
    if (SCREENSHOT_DIR) { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); await page.screenshot(path.join(SCREENSHOT_DIR, "setup-scan-report-animating-390.png")); }
    await h.settle();

    for (const text of ["Body Composition Report", "Female · 30 y", "168 cm", "60.0 kg", "ESTIMATED BODY FAT", "23.0%", "Healthy", "Low", "Elevated", "High",
      "Fat mass", "13.8", "Lean mass", "46.2", "Skeletal muscle", "25.7", "BMI", "20.8", "Body score", "Out of 100.",
      "What your 60.0 kg is made of", "Water", "33.8 kg", "Protein", "9.1 kg", "Minerals", "3.3 kg", "Lean body mass (everything except fat)",
      "Muscle and fat", "healthy 52–70 kg", "healthy 18–23 kg", "healthy 11–17 kg", "healthy 18–28%",
      "Healthy 18.5–24.9", "Waist-to-height", "0.44", "Est. waist 74 cm · healthy 0.40–0.50", "Visceral fat level", "5 / 20", "Lower is better", "Healthy 18–28% for females",
      "Segmental lean mass", "Segmental fat", "Right Arm", "Left Leg", "Trunk", "Over", "Under", "Normal",
      "Targets", "Toward the healthy range", "Target weight", "58.1 kg", "-1.9 kg", "0.0 kg",
      "Daily energy", "Resting (BMR)", "1,389 kcal", "Total with activity (TDEE)", "1,909 kcal", "Suggested intake for fat loss", "Use this result"]) await h.expectText(text);
    const shown = (await page.evaluate("document.body.innerText")).toLowerCase();
    for (const word of ["forma", "model", "±", "uncertain", "dexa", "dxa", "inbody", "nhanes", "heuristic", "formula", "silhouette", "validated", "1.2.0"]) {
      assert.ok(!shown.includes(word), `the report must not mention "${word}"`);
    }
    for (const word of ["download", "share", "export", "print", "save as"]) {
      assert.ok(!(await page.evaluate(`[...document.querySelectorAll('[role="button"], button, a')].some((e) => e.innerText.toLowerCase().includes(${JSON.stringify(word)}))`)), `no "${word}" control`);
    }
    assert.ok(shown.includes("can't be downloaded or shared"));
    assert.equal(await page.evaluate(`document.querySelectorAll("a[download]").length`), 0, "no download link");
    assert.equal(fake.received, 1, "one scan reached the fake Forma");
    if (SCREENSHOT_DIR) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      for (const [width, height] of WIDTHS) {
        await setWidth(width, height);
        await new Promise((r) => setTimeout(r, 600));
        await page.screenshot(path.join(SCREENSHOT_DIR, `setup-scan-report-${width}.png`));
        await setWidth(width, 2600);
        await new Promise((r) => setTimeout(r, 700));
        await page.screenshot(path.join(SCREENSHOT_DIR, `setup-scan-report-full-${width}.png`));
      }
      await setWidth(390, 844);
      await h.settle();
    }

    await page.clickText("Use this result");
    await h.expectPath("/setup/body-composition");
    await h.expectText("Estimated body fat");
    await h.expectText("23%");
    if (SCREENSHOT_DIR) {
      for (const [width, height] of WIDTHS) {
        await setWidth(width, height);
        await new Promise((r) => setTimeout(r, 500));
        await page.screenshot(path.join(SCREENSHOT_DIR, `setup-body-composition-scanned-${width}.png`));
      }
      await setWidth(390, 844);
      await h.settle();
    }
    await page.clickText("View full report");
    await h.expectPath("/setup/scan-report");
    await h.expectText("What your 60.0 kg is made of");
    await page.clickText("Done");
    await h.expectPath("/setup/body-composition");
    await page.clickText("Remove");
    await h.expectText(SCAN_BUTTON);
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 }, "nothing was saved");
  }));

  it("5. after setup, Profile offers Scan Body; the report saves to the profile after a confirmation and the targets are recalculated", run("profile-scan", async () => {
    // Finish setup without a scan, so the profile is saved with no body fat %
    await h.goto("/setup/personal", "Let's get to know you");
    await fillSetup(page, expo.baseUrl, { fullName: "Scan Tester" });
    await page.clickText("Finish");
    await h.expectPath("/home");
    const [[before]] = await connection.query("SELECT p.body_fat_percent AS bf, t.rmr_formula AS formula, t.calories FROM profiles p JOIN nutrition_targets t ON t.user_id = p.user_id WHERE p.user_id = ?", [identities.a.id]);
    assert.equal(before.bf, null);
    assert.equal(before.formula, "mifflin_st_jeor");

    await h.goto("/profile", "Body composition");
    await h.expectText("No body scan yet");
    if (SCREENSHOT_DIR) for (const [width, height] of WIDTHS) { await setWidth(width, height); await new Promise((r) => setTimeout(r, 500)); await page.screenshot(path.join(SCREENSHOT_DIR, `profile-body-composition-${width}.png`)); }
    await setWidth(390, 844);
    await page.clickText(SCAN_BUTTON);
    await h.expectPath("/setup/scan-guide");
    await h.expectText("How to take your photos");
    assert.equal(await page.hasText("2/7"), false, "no setup step counter outside setup");
    await page.clickText("Start scan");
    await h.expectPath("/setup/body-scan");
    await pickFromGallery();
    await h.expectText("Retake");
    await pickFromGallery();
    await page.waitFor(`(document.body.innerText.match(/Retake/g) || []).length === 2`, 15000, "both photos picked");
    await page.clickText("Scan");
    await h.expectPath("/setup/scan-report");
    await h.expectText("Save to my profile");

    await page.clickText("Save to my profile");
    await h.expectText("Save this result?");
    await h.expectText("Your body fat becomes 23%.");
    await h.expectText("Your daily target");
    if (SCREENSHOT_DIR) await page.screenshot(path.join(SCREENSHOT_DIR, "profile-scan-confirm-390.png"));
    // Back from the confirmation returns to the report, and nothing was saved yet
    await page.clickLabel("Back");
    await h.expectText("What your 60.0 kg is made of");
    assert.equal((await connection.query("SELECT body_fat_percent AS bf FROM profiles WHERE user_id = ?", [identities.a.id]))[0][0].bf, null);
    await page.clickText("Save to my profile");
    await h.expectText("Save this result?");
    await page.clickText("Confirm and save");
    await h.expectPath("/profile");
    await h.expectText("Body fat 23%");
    await h.expectText("View latest report");

    const [[after]] = await connection.query("SELECT p.body_fat_percent AS bf, t.rmr_formula AS formula, t.calories FROM profiles p JOIN nutrition_targets t ON t.user_id = p.user_id WHERE p.user_id = ?", [identities.a.id]);
    assert.equal(Number(after.bf), 23);
    assert.equal(after.formula, "katch_mcardle", "the targets now use fat-free mass");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 }, "updated in place, no new rows");

    await page.clickText("View latest report");
    await h.expectPath("/setup/scan-report");
    await h.expectText("Done");
    await page.clickText("Done");
    await h.expectPath("/profile");
  }));

  it("6. Profile's Weight tile changes height and weight after a confirmation; the targets are recalculated and the body fat % kept", run("measurements", async () => {
    await h.goto("/profile", "Body composition");
    await page.clickText("Weight");
    await h.expectPath("/measurements");
    await h.expectText("Height & weight");
    assert.equal(await page.inputValue(h.input("170")), "170", "the saved height fills the field");
    assert.equal(await page.inputValue(h.input("70")), "60", "the saved weight fills the field");
    assert.equal(await page.hasText("2/7"), false, "no setup step counter");
    // Out of range: Save stays disabled
    await page.setInput(h.input("70"), "20");
    await page.clickText("Save");
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await page.hasText("Save these changes?"), false);
    await page.setInput(h.input("70"), "65");
    if (SCREENSHOT_DIR) { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); await page.screenshot(path.join(SCREENSHOT_DIR, "profile-measurements-390.png")); }
    await page.clickText("Save");
    await h.expectText("Save these changes?");
    await h.expectText("Your weight becomes 65 kg.");
    await h.expectText("Your daily target");
    assert.equal(await page.hasText("Your height becomes"), false, "the unchanged height isn't mentioned");
    if (SCREENSHOT_DIR) await page.screenshot(path.join(SCREENSHOT_DIR, "profile-measurements-confirm-390.png"));
    // Back from the confirmation returns to the fields, and nothing was saved yet
    await page.clickLabel("Back");
    await h.expectText("Height 100–250 cm");
    assert.equal(Number((await connection.query("SELECT weight_kg AS w FROM profiles WHERE user_id = ?", [identities.a.id]))[0][0].w), 60);
    await page.clickText("Save");
    await h.expectText("Save these changes?");
    await page.clickText("Confirm and save");
    await h.expectPath("/profile");
    // The Weight tile shows the new weight and its BMI status (65 kg at 170 cm is 22.5: Healthy)
    await page.waitFor(`!!document.querySelector('[aria-label="Weight: 65 kg, Healthy"]')`, NAV_TIMEOUT, "the Weight tile at 65 kg");

    const [[row]] = await connection.query("SELECT p.weight_kg AS w, p.height_cm AS h, p.body_fat_percent AS bf, t.rmr_formula AS formula, JSON_EXTRACT(t.inputs, '$.weightKg') AS inputWeight FROM profiles p JOIN nutrition_targets t ON t.user_id = p.user_id WHERE p.user_id = ?", [identities.a.id]);
    assert.deepEqual({ w: Number(row.w), h: Number(row.h), bf: Number(row.bf), formula: row.formula, inputWeight: Number(row.inputWeight) }, { w: 65, h: 170, bf: 23, formula: "katch_mcardle", inputWeight: 65 });
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 }, "updated in place");
  }));
});
