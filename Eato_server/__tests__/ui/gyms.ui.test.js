// Gym communities in the real Expo web build against the isolated test server and the eato_test
// database. A platform admin creates "Iron Temple" through the API with Priya as its owner;
// Priya is signed in; Rohan acts through the API with his own session token. Covers: the Gyms
// tab, the gym screen, Manage (settings, profile, members), creating an event, posting in the
// gym (kept out of the main feed), the invite screen (nothing is sent), joining a hidden gym
// with a code, and screenshots at three widths.
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
const CLEANUP_TABLES = ["gym_event_rsvps", "gym_events", "gym_announcements", "gym_invitations", "community_comments", "community_post_likes", "community_post_media", "community_posts", "gym_members", "whatsapp_agent_settings", "whatsapp_connections", "gyms"];

describe("ui gyms: a gym community from the owner's side", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, clerk, h;
  const identities = {};
  const tokens = {};
  const sessions = {};
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
  // The screen updates as the server answers: wait for the database to catch up
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
      for (const [tag, role] of [["b", undefined], ["platform", "admin"]]) {
        identities[tag] = await clerk.createIdentity(runId, tag, { role });
        const minted = await clerk.mintToken(identities[tag].id);
        tokens[tag] = minted.jwt;
        sessions[tag] = minted.sessionId;
      }
    } catch (error) {
      throw new Error(`Clerk could not create a test identity: ${JSON.stringify(describeClerkError(error))}`);
    }
    await clerk.setUnsafeMetadata(identities.a.id, { profileComplete: true });
    const names = { a: "Priya Sharma", b: "Rohan Mehta", platform: "Platform Admin" };
    for (const tag of Object.keys(identities)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [identities[tag].id, identities[tag].emailAddress, names[tag], tag === "platform" ? "admin" : "user"]);
    }
    const created = await apiAs("platform", "POST", "/api/gyms", { name: "Iron Temple", tagline: "Lift heavy, lift often", location: "Indiranagar", ownerEmail: identities.a.emailAddress });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    state.gym = created.json.gym.id;
    // A hidden gym Rohan owns, for joining with a code
    const hidden = await apiAs("platform", "POST", "/api/gyms", { name: "Secret Barbell Club", ownerEmail: identities.b.emailAddress, visibility: "hidden" });
    state.hidden = hidden.json.gym.id;
    state.hiddenCode = (await apiAs("b", "GET", `/api/gyms/${state.hidden}`)).json.gym.inviteCode;
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

  it("1. the Gyms tab lists the owner's gym under My Gyms", run("tab", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await clickTab("Community");
    await h.expectPath("/community");
    await page.clickText("Gyms");
    await h.expectText("My Gyms");
    await h.expectText("Iron Temple");
    await h.expectText("Owner");
    assert.equal(await page.hasText("Secret Barbell Club"), false, "a hidden gym isn't listed");
    await noOverflow("gyms tab");
    await snapshotAllWidths("gyms-tab");
  }));

  it("2. the gym screen shows the header, owner tools and empty states", run("detail", async () => {
    await page.clickText("Iron Temple");
    await page.waitFor(`location.pathname.startsWith("/community/gyms/")`, NAV_TIMEOUT, "gym screen");
    await h.expectText("Lift heavy, lift often");
    await h.expectText("No posts yet");
    assert.equal(await page.evaluate(`!!document.querySelector('[aria-label="Manage gym"]')`), true);
    assert.equal(await page.evaluate(`!!document.querySelector('[aria-label="Invite members"]')`), true);
    await noOverflow("gym screen");
    await snapshotAllWidths("gyms-detail");
    await page.clickText("About");
    await h.expectText("Nothing here yet");
    assert.equal(await page.hasText("Leave gym"), false, "the owner can't leave");
  }));

  it("3. Manage: settings save at once and the profile saves its changes", run("manage", async () => {
    await clickLabel("Manage gym");
    await page.waitFor(`location.pathname.endsWith("/manage")`, NAV_TIMEOUT, "manage screen");
    await h.expectText("No requests");
    await page.clickText("Settings");
    await h.expectText("Who can post");
    await clickLabel("Post moderation");
    await waitForRow("SELECT post_moderation FROM gyms WHERE id = ?", [state.gym], (row) => row.post_moderation === 1, "post moderation on");
    await h.expectText("no payment is taken");
    await snapshotAllWidths("gyms-manage-settings");
    await clickLabel("Post moderation"); // back off, so the owner's post below is published either way
    await waitForRow("SELECT post_moderation FROM gyms WHERE id = ?", [state.gym], (row) => row.post_moderation === 0, "post moderation off");
    await page.clickText("Profile");
    await page.setInput('[aria-label="Facilities"]', "Free weights, Sauna");
    await page.setInput('[aria-label="Opening hours"]', "Mon–Fri: 5am–11pm");
    await clickLabel("Save gym profile");
    const row = await waitForRow("SELECT facilities, hours FROM gyms WHERE id = ?", [state.gym], (r) => Array.isArray(r.facilities) && r.facilities.length === 2, "profile saved");
    assert.deepEqual(row.hours, [{ label: "Mon–Fri", value: "5am–11pm" }]);
    await snapshotAllWidths("gyms-manage-profile");
    // Rohan joins from his own account; he shows up under Members
    assert.equal((await apiAs("b", "POST", `/api/gyms/${state.gym}/join`)).status, 200);
    await page.clickText("Members"); // the section chip
    await page.clickText("Members", 1); // the list chip inside it (Requests · Members · Suspended)
    await h.expectText("Rohan Mehta");
    await page.evaluate("history.back()");
    await page.waitFor(`location.pathname === "/community/gyms/${state.gym}"`, NAV_TIMEOUT, "back on the gym");
  }));

  it("4. creating an event: it shows under Upcoming with its capacity", run("event", async () => {
    await page.clickText("Events");
    await clickLabel("Create event");
    await page.waitFor(`location.pathname.endsWith("/event-new")`, NAV_TIMEOUT, "event form");
    await page.setInput('[aria-label="Title"]', "Deadlift clinic");
    await page.setInput('[aria-label="Description"]', "Form check for all levels.");
    const d = new Date(Date.now() + 3 * 86400000);
    await page.setInput('[aria-label="Date"]', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    await page.setInput('[aria-label="Location"]', "Main floor");
    await page.setInput('[aria-label="Maximum attendees (optional)"]', "5");
    await clickLabel("Create event");
    await page.waitFor(`location.pathname === "/community/gyms/${state.gym}"`, NAV_TIMEOUT, "back on the gym");
    await page.clickText("Events");
    await h.expectText("Deadlift clinic");
    await h.expectText("0 of 5 going");
    await snapshotAllWidths("gyms-events");
    await clickLabel("RSVP to Deadlift clinic");
    await waitForRow("SELECT attendee_count FROM gym_events WHERE gym_id = ?", [state.gym], (row) => row.attendee_count === 1, "RSVP saved");
    await h.expectText("1 of 5 going");
  }));

  it("5. a post in the gym stays in the gym", run("post", async () => {
    await page.clickText("Feed");
    await clickLabel("Share with Iron Temple");
    await h.expectPath("/community/compose");
    await h.expectText("Posting to");
    await h.expectText("Iron Temple");
    await clickLabel("Post type: Text"); // Create Post starts on Photo, which needs a photo
    await page.setInput('[aria-label="Post text"]', "New squat racks arrive Monday.");
    await clickLabel("Post");
    await page.waitFor(`location.pathname === "/community/gyms/${state.gym}"`, NAV_TIMEOUT, "back on the gym");
    await h.expectText("New squat racks arrive Monday.");
    const [[row]] = await connection.query("SELECT gym_id, review_status FROM community_posts WHERE body = 'New squat racks arrive Monday.'");
    assert.deepEqual({ ...row }, { gym_id: state.gym, review_status: "published" });
    await snapshotAllWidths("gyms-feed");
    await h.goto("/community", "TRAIN TOGETHER");
    await h.expectText("Be the first to post");
    assert.equal(await page.hasText("New squat racks arrive Monday."), false, "gym posts stay out of the main feed");
  }));

  it("6. the invite screen shows the gym code and records an invitation without sending anything", run("invite", async () => {
    await h.goto(`/community/gyms/${state.gym}/invite`, "Gym code");
    const [[gym]] = await connection.query("SELECT invite_code FROM gyms WHERE id = ?", [state.gym]);
    await h.expectText(`${gym.invite_code.slice(0, 4)}-${gym.invite_code.slice(4)}`);
    await page.setInput('[aria-label="Email to invite"]', "friend@example.com");
    await clickLabel("Record invitation");
    await h.expectText("Nothing was sent");
    await h.expectText("friend@example.com");
    await waitForRow("SELECT status, channel FROM gym_invitations WHERE gym_id = ? AND contact = 'friend@example.com'", [state.gym], (row) => row.status === "pending", "invitation recorded");
    await noOverflow("invite");
    await snapshotAllWidths("gyms-invite");
  }));

  it("7. joining a hidden gym with its code: preview, accept, open", run("join", async () => {
    await h.goto("/community/gyms/join", "Invite code");
    await page.setInput('[aria-label="Invite code"]', state.hiddenCode.toLowerCase());
    await clickLabel("Find gym");
    await h.expectText("Secret Barbell Club");
    await h.expectText("adds you as a member");
    await snapshotAllWidths("gyms-join");
    await clickLabel("Accept invitation");
    await page.waitFor(`location.pathname === "/community/gyms/${state.hidden}"`, NAV_TIMEOUT, "the hidden gym");
    await h.expectText("Secret Barbell Club");
    await waitForRow("SELECT role, status FROM gym_members WHERE gym_id = ? AND user_id = ?", [state.hidden, identities.a.id], (row) => row.status === "active", "joined");
  }));
});
