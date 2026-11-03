// A program's page and the Fitness tab's cards in the real Expo web build against the isolated test
// server and the justfit_test database. Fit Mama gets one YouTube video from a local fake of the
// YouTube Data API; a member opens it: nothing written on the picture, the info strip, Follow along
// with the video's title and Watch on YouTube, then the program's own sessions. On the Fitness tab
// a card with a cover photo is the photo alone, while a gradient card keeps its level pill, title
// and meta; a section's See All opens its programs as a two-column grid. The program's page shows
// the admin's page photo at the top, never the card's cover. Fit Mama is put back and the photos
// removed afterwards. Screenshots at three widths.
//
//   yarn test:ui      (needs JustFit_server/.env.test and Google Chrome; otherwise skipped)
//   JUSTFIT_SCREENSHOT_DIR=<dir> saves screenshots of each screen at three widths
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const db = require("../e2e/test-db.js");
const { startTestServer, portFree } = require("../e2e/server.js");
const { identitiesFor, describeIdentityError } = require("../e2e/test-identities.js");
const { png } = require("../e2e/images.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const KEY = "test-youtube-key";
const vid = (n) => `fitmama${String(n).padStart(4, "0")}`; // 11 characters, like YouTube's
const TITLES = ["Day 1: Gentle core and breathing", "Day 2: Pelvic floor basics", "Day 3: Lower body strength", "Day 4: Mobility flow", "Day 5: Full body, low impact", "Day 6: Posture and upper back", "Day 7: Stretch and recover", "Day 8: Glutes and hips", "Day 9: Standing core", "Day 10: Celebration workout"];

// Answers like the YouTube Data API's /videos for the fake videos
function fakeYouTube() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fake");
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.searchParams.get("key") !== KEY) return send(403, { error: { message: "bad key" } });
    if (url.pathname === "/videos") {
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return send(200, { items: ids.map((id) => ({ id, snippet: { title: TITLES[Number(id.slice(-4)) - 1], channelTitle: "Mama Moves Studio" }, contentDetails: { duration: `PT${10 + Number(id.slice(-4))}M` }, status: { privacyStatus: "public" } })) });
    }
    send(404, {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

describe("ui fitness: a program's page and the Fitness tab's cards", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, youtube, expo, chrome, client, page, testAccounts, h, program, original, coverDir;
  const identities = {};
  const tokens = {};

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
  // The Sessions heading at the top of the screen, so the list is what the screenshot shows
  const showSessions = () => page.evaluate(`(() => { const el = [...document.querySelectorAll("body *")].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Follow along" && e.getClientRects().length > 0); if (el) el.scrollIntoView({ block: "start" }); return !!el; })()`);
  const snapshotAllWidths = async (name) => {
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await h.settle();
      await showSessions();
      await h.settle();
      assert.equal(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, `${name} at ${w}: no horizontal overflow`);
      if (SCREENSHOT_DIR) { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); await page.screenshot(path.join(SCREENSHOT_DIR, `${name}-${w}.png`)); }
    }
    await viewport(390, 844);
  };
  const card = (title) => `[...document.querySelectorAll("[aria-label]")].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label").startsWith(${JSON.stringify(title + ". ")}))[0]`;
  // Screenshots of a screen from its top, at each width
  const snapshotTop = async (name) => {
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await h.settle();
      assert.equal(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, `${name} at ${w}: no horizontal overflow`);
      if (SCREENSHOT_DIR) { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); await page.screenshot(path.join(SCREENSHOT_DIR, `${name}-${w}.png`)); }
    }
    await viewport(390, 844);
  };
  const clickLabel = async (label) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label=${JSON.stringify(label)}]')].filter((e) => e.getClientRects().length > 0)[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    youtube = await fakeYouTube();
    coverDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-covers-sessions-"));
    server = await startTestServer({ ...env, YOUTUBE_API_URL: youtube.url, YOUTUBE_API_KEY: KEY, COVER_DIR: coverDir });
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      for (const [tag, role] of [["member", "user"], ["admin", "admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, role === "admin" ? { role } : undefined);
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
        await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)", [identities[tag].id, identities[tag].emailAddress, `Fit ${tag}`, role]);
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency, profile_complete) VALUES (?, '1993-03-12', 'female', 'fat_loss', 162, 64, '3-4', TRUE)", [identities.member.id]);
    // The admin list seeds the built-in programs on its first read
    const list = await fetch(`${server.baseUrl}/api/admin/portal/programs`, { headers: { Authorization: `Bearer ${tokens.admin}` } }).then((r) => r.json());
    assert.ok(list.programs?.some((p) => p.title === "Fit Mama"), "the built-in Fit Mama program");
    [[original]] = await connection.query("SELECT id, youtube_kind, youtube_id, youtube_channel, videos_synced_at FROM fitness_programs WHERE slug = 'strong-mom'");
    program = original;
    // Fit Mama's one video session
    const saved = await fetch(`${server.baseUrl}/api/admin/portal/programs/${program.id}/sessions`, { method: "POST", headers: { Authorization: `Bearer ${tokens.admin}`, "Content-Type": "application/json" }, body: JSON.stringify({ title: TITLES[0], minutes: 11, youtube: `https://youtu.be/${vid(1)}` }) }).then((r) => r.json());
    assert.deepEqual(saved.program?.sessions?.at(-1)?.video, { id: vid(1), channel: "Mama Moves Studio" }, `Fit Mama has the video session: ${JSON.stringify(saved).slice(0, 200)}`);
  });

  after(async () => {
    const problems = [];
    const step = async (label, fn) => { try { await fn(); } catch (error) { problems.push(`${label}: ${error.message.split("\n")[0]}`); } };
    await step("close CDP", async () => { if (client) client.close(); });
    await step("stop Chrome", async () => { if (chrome) await chrome.close(); });
    await step("stop Expo web", async () => { if (expo) await expo.stop(); });
    await step("stop test server", async () => { if (server) await server.stop(); });
    await step("stop fake YouTube", async () => { if (youtube) await new Promise((r) => youtube.server.close(r)); });
    await step("rows", async () => {
      if (!connection) return;
      const ids = Object.values(identities).map((i) => i.id);
      if (program) {
        await connection.query("DELETE FROM fitness_video_progress WHERE program_id = ?", [program.id]);
        await connection.query("DELETE FROM fitness_program_videos WHERE program_id = ?", [program.id]);
        // The sessions the tests added (each has a video and no exercises); the exercise sessions lose any video
        await connection.query("DELETE FROM fitness_program_sessions WHERE program_id = ? AND youtube_id IS NOT NULL AND id NOT IN (SELECT DISTINCT session_id FROM fitness_program_exercises WHERE program_id = ?)", [program.id, program.id]);
        await connection.query("UPDATE fitness_program_sessions SET youtube_id = NULL, youtube_channel = NULL, youtube_synced_at = NULL WHERE program_id = ?", [program.id]);
        await connection.query("UPDATE fitness_programs SET youtube_kind = ?, youtube_id = ?, youtube_channel = ?, videos_synced_at = ?, cover_key = NULL, cover_updated_at = NULL, hero_key = NULL, hero_updated_at = NULL WHERE id = ?", [original.youtube_kind, original.youtube_id, original.youtube_channel, original.videos_synced_at, program.id]);
      }
      if (ids.length) {
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [ids]);
        await connection.query("DELETE FROM profiles WHERE user_id IN (?)", [ids]);
        await db.deleteUsers(connection, ids);
      }
      await connection.end();
    });
    await step("cover files", async () => { if (coverDir) fs.rmSync(coverDir, { recursive: true, force: true }); });
    await step("identities", async () => {
      if (!testAccounts) return;
      for (const identity of Object.values(identities)) {
        if (identity.sessionId) await testAccounts.revokeSession(identity.sessionId).catch(() => {});
        await testAccounts.deleteUser(identity.id);
      }
    });
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  it("1. the program's page: a bare picture, the info strip, Follow along with its video sessions only", run("program-page", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.member);
    await h.goto(`/fitness/${program.id}`, "Follow along");
    await h.expectText(TITLES[0]);
    for (const text of ["1 session", "11 min", "per session", "At home", "No equipment", "Mama Moves Studio · YouTube · 11 min", "Video by Mama Moves Studio on YouTube"]) await h.expectText(text);
    assert.equal(await page.hasText("Gentle strength for busy mothers"), false, "nothing written on the picture");
    for (const old of ["Core and posture", "Legs and glutes", "Full body flow"]) assert.equal(await page.hasText(old), false, `no exercise session (${old})`);
    assert.equal(await page.evaluate(`!!document.querySelector(${JSON.stringify(`[aria-label="Watch ${TITLES[0]} on YouTube"]`)})`), true, "Watch on YouTube");
    assert.equal(await page.evaluate(`document.querySelectorAll('[aria-label^="Do "][aria-label$=" today"]').length`), 0, "no Do this today");
    await page.evaluate(`window.scrollTo(0, 0)`);
    await snapshotTop("program-page");
    await page.evaluate(`(() => { const el = [...document.querySelectorAll("body *")].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Follow along"); if (el) el.scrollIntoView({ block: "start" }); })()`);
    await snapshotTop("program-video-session");
  }));

  it("2. a cover card is the photo alone; a gradient card keeps its text", run("cover-card", async () => {
    const put = await fetch(`${server.baseUrl}/api/admin/portal/programs/${program.id}/cover`, { method: "PUT", headers: { Authorization: `Bearer ${tokens.admin}`, "Content-Type": "application/json" }, body: JSON.stringify({ data: png(720, 900, [150, 30, 70]).toString("base64"), mediaType: "image/png" }) });
    assert.equal(put.status, 200, "the admin adds a cover");
    await h.goto("/workout", "Popular Programs");
    await page.waitFor(`(() => { const el = ${card("Fit Mama")}; return !!el && [...el.querySelectorAll("img")].some((img) => img.complete && img.naturalWidth > 0); })()`, NAV_TIMEOUT, "Fit Mama's card with its cover");
    assert.equal(await page.evaluate(`(${card("Fit Mama")}).innerText.trim()`), "", "nothing written over the cover");
    const kids = await page.evaluate(`(${card("Yoga for Kids")}).innerText`);
    assert.ok(kids.includes("Yoga for Kids") && kids.includes("Beginner"), `a gradient card keeps its title and level: ${kids}`);
    assert.equal(await page.evaluate(`[...document.querySelectorAll('[aria-label^="See all "]')].filter((e) => e.getClientRects().length > 0).length >= 2`), true, "See All on the sections");
    await page.evaluate(`window.scrollTo(0, 0)`);
    await snapshotTop("fitness-tab");
  }));

  it("3. See All opens the category: its programs in two columns", run("see-all", async () => {
    await clickLabel("See all Fitness Categories");
    await h.expectPath(`/fitness/category/categories`);
    await page.waitFor(`!!(${card("Yoga for Beginners")})`, NAV_TIMEOUT, "the category's cards");
    const [a, b] = await page.evaluate(`["Yoga for Beginners", "Workout for Beginners"].map((t) => { const r = [...document.querySelectorAll("[aria-label]")].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label").startsWith(t + ". "))[0].getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) }; })`);
    assert.equal(a.top, b.top, "two cards side by side");
    assert.ok(b.left > a.left + a.width, "the second in its own column");
    await snapshotTop("fitness-category");
    await clickLabel("Back");
    await h.expectPath("/workout");
  }));

  it("4. the program's page shows its page photo at the top, never the card's cover", run("page-photo", async () => {
    // Loaded photos on screen by their real width: the cover is 720 wide, the page photo 1000
    const shown = (w) => `[...document.querySelectorAll("img")].some((img) => img.getClientRects().length > 0 && img.complete && img.naturalWidth === ${w})`;
    await h.goto(`/fitness/${program.id}`, "Follow along");
    await h.settle();
    assert.equal(await page.evaluate(shown(720)), false, "no page photo yet: the gradient, not the cover");
    const put = await fetch(`${server.baseUrl}/api/admin/portal/programs/${program.id}/hero`, { method: "PUT", headers: { Authorization: `Bearer ${tokens.admin}`, "Content-Type": "application/json" }, body: JSON.stringify({ data: png(1000, 500, [30, 90, 160]).toString("base64"), mediaType: "image/png" }) });
    assert.equal(put.status, 200, "the admin adds a page photo");
    await h.goto("/workout", "Popular Programs");
    await h.goto(`/fitness/${program.id}`, "Follow along");
    await page.waitFor(shown(1000), NAV_TIMEOUT, "the page photo at the top");
    assert.equal(await page.evaluate(shown(720)), false, "the cover isn't on the page");
    await page.evaluate(`window.scrollTo(0, 0)`);
    await snapshotTop("program-page-photo");
  }));

  it("5. the admin adds a video session from the program's page; members get it", run("admin-sessions", async () => {
    await signInAs(page, h, identities.admin);
    await h.goto(`/admin/programs/${program.id}`, "Add session");
    await clickLabel("Add session");
    await page.setInput(h.input("For example: Day 1: gentle core"), TITLES[1]);
    await page.setInput(h.input("https://youtu.be/…"), `https://www.youtube.com/watch?v=${vid(2)}`);
    await clickLabel("Save session");
    await h.expectText("Session added.");
    await h.expectText(`2. ${TITLES[1]} · 15 min`);
    await h.expectText("YouTube video by Mama Moves Studio");
    await snapshotTop("admin-program-sessions");
    const [[row]] = await connection.query("SELECT youtube_id, position FROM fitness_program_sessions WHERE program_id = ? AND title = ?", [program.id, TITLES[1]]);
    assert.deepEqual({ ...row }, { youtube_id: vid(2), position: 1 });
    assert.equal(await page.hasText("Rewrite sessions with AI"), false, "no AI rewrite");
  }));
});
