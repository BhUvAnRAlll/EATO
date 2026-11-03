// Admin › Programs in the real Expo web build against the isolated test server and the justfit_test
// database (covers in a throwaway folder). A program's cover photo: the admin adds it from the
// preview card's camera button, sees it on the card and in the programs list, replaces it (the old
// file is deleted) and removes it (the gradient is back). Categories: the admin creates one, moves
// it up, puts a program in it from the program's Category chips (members then get it with its
// name and layout), and can't delete it until it's empty. Screenshots at three widths.
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
const { png } = require("../e2e/images.js");
const { startExpoWeb } = require("./expo-web.js");
const { launchChrome, connect, openPage, CHROME } = require("./cdp.js");
const { helpers, signInAs, NAV_TIMEOUT } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "justfit-ui-evidence");
const SCREENSHOT_DIR = process.env.JUSTFIT_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];

describe("ui admin: programs, their cover photos and categories", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h, coverDir, photoDir, program, admin, session, token;

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
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await h.settle();
      assert.equal(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, `${name} at ${w}: no horizontal overflow`);
      if (SCREENSHOT_DIR) { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); await page.screenshot(path.join(SCREENSHOT_DIR, `${name}-${w}.png`)); }
    }
    await viewport(390, 844);
  };
  const clickLabel = async (label) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label=${JSON.stringify(label)}]')].filter((e) => e.getClientRects().length > 0).pop(); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${label}`);
    await page.clickAt(pos.x, pos.y);
  };
  // Chrome's file chooser, answered with a file from disk (the web image picker opens one)
  const chooseFile = async (label, file) => {
    const opened = new Promise((resolve) => client.on((msg) => { if (msg.sessionId === page.sessionId && msg.method === "Page.fileChooserOpened") resolve(msg.params); }));
    await clickLabel(label);
    const { backendNodeId } = await Promise.race([opened, new Promise((_, reject) => setTimeout(() => reject(new Error("no file chooser opened")), NAV_TIMEOUT))]);
    await client.send("DOM.setFileInputFiles", { files: [file], backendNodeId }, page.sessionId);
  };
  // A loaded cover <img> on screen (expo-image draws the photo it fetched with the session token)
  const coverShown = () => page.waitFor(`[...document.querySelectorAll("img")].some((img) => img.getClientRects().length > 0 && img.complete && img.naturalWidth >= 320)`, NAV_TIMEOUT, "the cover photo on screen");
  const clickLabelStarting = async (prefix) => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label]')].filter((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label").startsWith(${JSON.stringify(prefix)}))[0]; if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, `element labelled ${prefix}…`);
    await page.clickAt(pos.x, pos.y);
  };
  const row = async () => (await connection.query("SELECT cover_key FROM fitness_programs WHERE id = ?", [program.id]))[0][0];

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    if (!fs.existsSync(CHROME)) { skipReason = "Google Chrome is not installed"; return; }
    for (const port of [Number(env.PORT), EXPO_PORT]) if (!(await portFree(port))) throw new Error(`port ${port} is in use; refusing to start`);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    coverDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-covers-ui-"));
    photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-cover-photos-"));
    fs.writeFileSync(path.join(photoDir, "first.png"), png(640, 360, [220, 90, 40]));
    fs.writeFileSync(path.join(photoDir, "second.png"), png(800, 450, [40, 120, 200]));
    server = await startTestServer({ ...env, COVER_DIR: coverDir });
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    await client.send("Page.setInterceptFileChooserDialog", { enabled: true }, page.sessionId);
    h = helpers(page, expo.baseUrl);
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      admin = await testAccounts.createIdentity(runId, "admin", { role: "admin" });
      const minted = await testAccounts.mintToken(admin.id);
      token = minted.jwt;
      session = minted.sessionId;
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, 'Maya Ortiz', 'admin') ON DUPLICATE KEY UPDATE role = 'admin'", [admin.id, admin.emailAddress]);
    const list = await fetch(`${server.baseUrl}/api/admin/portal/programs`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    program = list.programs.find((p) => p.published);
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
      if (admin) {
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id = ?", [admin.id]);
        await db.deleteUsers(connection, [admin.id]);
      }
      await connection.query("UPDATE fitness_programs SET cover_key = NULL, cover_updated_at = NULL");
      await connection.query("UPDATE fitness_programs SET section = 'stay_fit' WHERE section IN (SELECT slug FROM fitness_sections WHERE built_in = FALSE)");
      await connection.query("DELETE FROM fitness_sections WHERE built_in = FALSE");
      await connection.end();
    });
    await step("identities", async () => {
      if (!testAccounts || !admin) return;
      if (session) await testAccounts.revokeSession(session).catch(() => {});
      await testAccounts.deleteUser(admin.id);
    });
    await step("folders", async () => {
      for (const dir of [coverDir, photoDir]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the camera button on the preview card adds a cover; it shows on the card and in the list", run("cover-add", async () => {
    assert.ok(program, "a starter program to work on");
    await viewport(390, 844);
    await signInAs(page, h, admin);
    await page.waitFor(`location.pathname.startsWith("/admin")`, 60000, "landing on /admin");
    await h.goto(`/admin/programs/${program.id}`, "Shown to members");
    assert.equal(await page.evaluate(`!!document.querySelector('[aria-label="Edit cover"]')`), false, "no Edit before there is a cover");
    await snapshotAllWidths("admin-program-no-cover");
    await chooseFile("Add cover", path.join(photoDir, "first.png"));
    await h.expectText("Cover added.");
    await coverShown();
    const { cover_key: key } = await row();
    assert.match(key, /\.png$/);
    assert.deepEqual(fs.readdirSync(coverDir), [key]);
    await snapshotAllWidths("admin-program-cover");
    // The programs list shows the same cover on the program's row
    await h.goto("/admin/programs", program.title);
    await coverShown();
  }));

  it("2. Edit → Replace photo swaps the cover and deletes the old file", run("cover-replace", async () => {
    await h.goto(`/admin/programs/${program.id}`, "Shown to members");
    await coverShown();
    const before = (await row()).cover_key;
    await clickLabel("Edit cover");
    await h.expectText("Replace photo");
    await h.expectText("Remove cover");
    await snapshotAllWidths("admin-program-cover-menu");
    await chooseFile("Replace cover photo", path.join(photoDir, "second.png"));
    await h.expectText("Cover replaced.");
    const after = (await row()).cover_key;
    assert.notEqual(after, before);
    assert.deepEqual(fs.readdirSync(coverDir), [after], "only the new file is left");
    await coverShown();
  }));

  it("3. Edit → Remove cover brings the gradient back and deletes the file", run("cover-remove", async () => {
    await clickLabel("Edit cover");
    await clickLabel("Remove cover");
    await h.expectText("Cover removed.");
    assert.equal((await row()).cover_key, null);
    assert.deepEqual(fs.readdirSync(coverDir), []);
    await page.waitFor(`!!document.querySelector('[aria-label="Add cover"]')`, NAV_TIMEOUT, "the Add cover button again");
  }));

  // ---- categories ------------------------------------------------------------------------------

  const sectionRow = async (slug) => (await connection.query("SELECT title, note, layout, position, published FROM fitness_sections WHERE slug = ?", [slug]))[0][0];

  it("4. Programs › Categories › New category: it's made, last in the list", run("category-new", async () => {
    await h.goto("/admin/programs", "New program");
    await clickLabel("Categories");
    await h.expectPath("/admin/categories");
    await h.expectText("Popular Programs");
    await h.expectText("Built in");
    await snapshotAllWidths("admin-categories");
    await clickLabel("New category");
    await h.expectPath("/admin/categories/new");
    await page.setInput('input[placeholder="For example: Yoga & Mobility"]', "Yoga & Mobility");
    await page.setInput('input[placeholder="For example: Stretch, breathe and move better"]', "Stretch and breathe");
    await page.clickText("Wide cards");
    await snapshotAllWidths("admin-category-new");
    await clickLabel("Create category");
    await h.expectPath("/admin/categories");
    await h.expectText("Yoga & Mobility");
    assert.deepEqual({ ...(await sectionRow("yoga_mobility")) }, { title: "Yoga & Mobility", note: "Stretch and breathe", layout: "wide", position: 6, published: 1 });
  }));

  it("5. the arrows move it up", run("category-move", async () => {
    await clickLabel("Move Yoga & Mobility up");
    await page.waitFor(`(() => { const t = document.body.innerText; return t.indexOf("Yoga & Mobility") < t.indexOf("Workplace Wellness"); })()`, NAV_TIMEOUT, "Yoga above Workplace Wellness");
    assert.equal((await sectionRow("yoga_mobility")).position, 5);
    assert.equal((await sectionRow("workplace")).position, 6);
  }));

  it("6. a program goes into it from the program's Category chips; members get it with its name and layout", run("category-program", async () => {
    await h.goto(`/admin/programs/${program.id}`, "Shown to members");
    await page.clickText("Yoga & Mobility");
    await page.clickText("Save");
    await h.expectText("Saved.");
    const [[row]] = await connection.query("SELECT section FROM fitness_programs WHERE id = ?", [program.id]);
    assert.equal(row.section, "yoga_mobility");
    // What the Fitness tab gets for a member (the admin's own token reads the same member route)
    const tab = await fetch(`${server.baseUrl}/api/fitness/programs?place=${program.place === "center" ? "center" : "home"}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    const section = tab.sections.find((s) => s.id === "yoga_mobility");
    assert.deepEqual({ title: section.title, layout: section.layout, ids: section.programs.map((p) => p.id) }, { title: "Yoga & Mobility", layout: "wide", ids: [program.id] });
    // The programs list groups it under the new category
    await h.goto("/admin/programs", "Yoga & Mobility");
  }));

  it("7. a category with programs can't be deleted; once empty, Delete removes it", run("category-delete", async () => {
    await h.goto("/admin/categories/yoga_mobility", "1 program in this category");
    await h.expectText("move its programs to another one first");
    assert.equal(await page.evaluate(`!!document.querySelector('[aria-label="Delete category"]')`), false);
    await snapshotAllWidths("admin-category-edit");
    // Back to a built-in category, then the category is empty
    await h.goto(`/admin/programs/${program.id}`, "Shown to members");
    await page.clickText("Popular Programs");
    await page.clickText("Save");
    await h.expectText("Saved.");
    // Opened from the list, the way the admin gets there (Delete then goes back to it)
    await h.goto("/admin/categories", "Yoga & Mobility");
    await clickLabelStarting("Yoga & Mobility, 0 programs");
    await h.expectText("0 programs in this category");
    await page.evaluate("window.confirm = () => true");
    await clickLabel("Delete category");
    await h.expectPath("/admin/categories");
    await h.expectNoText("Yoga & Mobility");
    assert.equal(await sectionRow("yoga_mobility"), undefined);
    // A built-in one offers no Delete
    await h.goto("/admin/categories/popular", "can't be deleted");
  }));
});
