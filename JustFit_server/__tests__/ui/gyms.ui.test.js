// Gym communities in the real Expo web build against the isolated test server and the justfit_test
// database. A platform admin creates "Iron Temple" through the API with Priya as its owner;
// Priya is signed in; Rohan acts through the API with his own session token. Covers: the Gyms
// tab, the gym screen, Manage (settings, profile, members), creating an event, posting in the
// gym (kept out of the main feed), the invite screen (nothing is sent), joining a hidden gym
// with a code, and screenshots at three widths.
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
const CLEANUP_TABLES = ["gym_event_rsvps", "gym_events", "gym_announcements", "gym_invitations", "community_comments", "community_post_likes", "community_post_media", "community_posts", "gym_members", "gym_faqs", "whatsapp_usage", "whatsapp_agent_settings", "whatsapp_connections", "gym_visits", "gym_scan_failures", "gym_notices", "gym_assistant_questions", "gyms"];

describe("ui gyms: a gym community from the owner's side", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, testAccounts, h;
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
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" }); // the gym assistant uses the test-only fake AI, never a paid model
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    try {
      identities.a = await testAccounts.createIdentity(runId, "a");
      for (const [tag, role] of [["b", undefined], ["platform", "admin"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        tokens[tag] = minted.jwt;
        sessions[tag] = minted.sessionId;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await testAccounts.setProfileComplete(identities.a.id, true);
    const names = { a: "Priya Sharma", b: "Rohan Mehta", platform: "Platform Admin" };
    for (const tag of Object.keys(identities)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [identities[tag].id, identities[tag].emailAddress, names[tag], tag === "platform" ? "admin" : "user"]);
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
      if (!testAccounts) return;
      for (const sessionId of Object.values(sessions)) await testAccounts.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await testAccounts.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the Gyms tab lists the owner's gym under My Gyms and the Explore preview; an email invitation shows no banner", run("tab", async () => {
    // The hidden gym's owner invites a by email. Phone sign-in proves no email address, so no
    // banner is shown for it (an unproved address unlocks nothing); its link still works (7b)
    const invited = await apiAs("b", "POST", `/api/gyms/${state.hidden}/invitations`, { channel: "email", contact: identities.a.emailAddress });
    assert.equal(invited.status, 201, JSON.stringify(invited.json));
    await viewport(390, 844);
    await signInAs(page, h, identities.a);
    await h.expectPath("/home");
    await clickTab("Community");
    await h.expectPath("/community");
    await page.clickText("Gyms");
    await h.expectText("My Gyms");
    await h.expectText("Iron Temple");
    await h.expectText("Owner");
    await h.expectText("Explore Gyms");
    assert.equal(await page.hasText("Secret Barbell Club invited you"), false, "no banner for an email invitation");
    await h.expectText("View All");
    await noOverflow("gyms tab");
    await snapshotAllWidths("gyms-tab");
  }));

  it("1b. View All opens Explore: search by name or area and filter by how a gym takes members; hidden gyms never show", run("explore", async () => {
    await clickLabel("View all gyms");
    await h.expectPath("/community/gyms/explore");
    await h.expectText("Explore Gyms");
    await h.expectText("Iron Temple");
    assert.equal(await page.hasText("Secret Barbell Club"), false, "a hidden gym isn't listed");
    await noOverflow("explore");
    await snapshotAllWidths("gyms-explore");
    await page.setInput('[aria-label="Search gyms"]', "zzz-no-such-gym");
    await h.expectText("No gyms found");
    await page.setInput('[aria-label="Search gyms"]', "");
    await h.expectText("Iron Temple");
    await clickLabel("Back");
    await h.expectPath("/community");
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
    await h.expectText("Location");
    await h.expectText("Staff (1)");
    assert.equal(await page.hasText("Leave gym"), false, "the owner can't leave");
    await snapshotAllWidths("gyms-about");
  }));

  it("3. Manage Gym: the hub opens Community Settings (saves at once), Subscription, Gym Profile and Members", run("manage", async () => {
    await clickLabel("Manage gym");
    await page.waitFor(`location.pathname.endsWith("/manage")`, NAV_TIMEOUT, "manage hub");
    await h.expectText("Manage Gym");
    await h.expectText("Gym Profile");
    await h.expectText("Community Settings");
    await h.expectText("Invitations");
    await noOverflow("manage hub");
    await snapshotAllWidths("gyms-manage");

    await clickLabel("Community Settings");
    await page.waitFor(`location.pathname.endsWith("/manage/settings")`, NAV_TIMEOUT, "settings page");
    await h.expectText("Changes apply immediately across the gym community.");
    await h.expectText("WHO CAN POST"); // innerText follows the uppercase style
    await clickLabel("Post moderation");
    await waitForRow("SELECT post_moderation FROM gyms WHERE id = ?", [state.gym], (row) => row.post_moderation === 1, "post moderation on");
    await snapshotAllWidths("gyms-manage-settings");
    await clickLabel("Post moderation"); // back off, so the owner's post below is published either way
    await waitForRow("SELECT post_moderation FROM gyms WHERE id = ?", [state.gym], (row) => row.post_moderation === 0, "post moderation off");
    await clickLabel("Back");

    await clickLabel("Subscription");
    await h.expectText("no payment is taken");
    await clickLabel("Back");

    await clickLabel("Gym Profile");
    await page.waitFor(`location.pathname.endsWith("/manage/profile")`, NAV_TIMEOUT, "profile page");
    // The form appears once the gym has loaded, so wait for the field before typing
    await page.waitFor(`[...document.querySelectorAll('[aria-label="Facilities"]')].some((e) => e.getClientRects().length > 0)`, NAV_TIMEOUT, "the profile form");
    await page.setInput('[aria-label="Facilities"]', "Free weights, Sauna");
    await page.setInput('[aria-label="Opening hours"]', "Mon–Fri: 5am–11pm");
    await clickLabel("Save gym profile");
    const row = await waitForRow("SELECT facilities, hours FROM gyms WHERE id = ?", [state.gym], (r) => Array.isArray(r.facilities) && r.facilities.length === 2, "profile saved");
    assert.deepEqual(row.hours, [{ label: "Mon–Fri", value: "5am–11pm" }]);
    await snapshotAllWidths("gyms-manage-profile");
    await clickLabel("Back");

    // Rohan joins from his own account; he shows up under Members
    assert.equal((await apiAs("b", "POST", `/api/gyms/${state.gym}/join`)).status, 200);
    await clickLabel("Members");
    await page.waitFor(`location.pathname.endsWith("/manage/members")`, NAV_TIMEOUT, "members page");
    await h.expectText("Rohan Mehta");
    await h.expectText("Active (2)");
    await snapshotAllWidths("gyms-manage-members");
    await clickLabel("Back");
    await clickLabel("Back");
    await page.waitFor(`location.pathname === "/community/gyms/${state.gym}"`, NAV_TIMEOUT, "back on the gym");
  }));

  it("4. creating an event: it shows under Upcoming with its capacity", run("event", async () => {
    await page.clickText("Events");
    await clickLabel("Create event");
    await page.waitFor(`location.pathname.endsWith("/event-new")`, NAV_TIMEOUT, "event form");
    await h.expectText("Create Event");
    // Validation: nothing filled in yet
    await clickLabel("Create event");
    await h.expectText("Give the event a title.");
    await page.setInput('[aria-label="Title"]', "Deadlift clinic");
    await page.setInput('[aria-label="Description"]', "Form check for all levels.");
    // A date from the strip, three days ahead
    const d = new Date(Date.now() + 3 * 86400000);
    await clickLabel(`Date: ${d.toLocaleDateString("en-GB", { weekday: "short" })} ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })}`);
    // Times from the list: the end defaults to an hour after the start
    await clickLabel("Start time");
    await clickLabel("Start at 7:00 AM");
    await page.waitFor(`!!document.querySelector('[aria-label="End time: 8:00 AM"]')`, NAV_TIMEOUT, "the end time follows");
    await page.setInput('[aria-label="Location"]', "Main floor");
    await noOverflow("create event");
    await snapshotAllWidths("gyms-create-event");
    await page.setInput('[aria-label="Maximum attendees (optional)"]', "5");
    await clickLabel("Create event");
    await page.waitFor(`location.pathname === "/community/gyms/${state.gym}"`, NAV_TIMEOUT, "back on the gym");
    await page.clickText("Events");
    await h.expectText("Deadlift clinic");
    await h.expectText("0 / 5 going");
    await clickLabel("RSVP to Deadlift clinic");
    await waitForRow("SELECT attendee_count FROM gym_events WHERE gym_id = ?", [state.gym], (row) => row.attendee_count === 1, "RSVP saved");
    await h.expectText("1 / 5 going");
    await h.expectText("Going ✓");
    await snapshotAllWidths("gyms-events");
  }));

  it("4b. an event opens its page: date, time, place, spots left, attendees; Cancel RSVP from there", run("event-detail", async () => {
    const pos = await page.waitFor(`(() => { const el = [...document.querySelectorAll('[aria-label^="Deadlift clinic, "]')].find((e) => e.getClientRects().length > 0); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, "the event card");
    await page.clickAt(pos.x, pos.y);
    await page.waitFor(`location.pathname.includes("/events/")`, NAV_TIMEOUT, "the event page");
    await h.expectText("Upcoming");
    await h.expectText("Hosted by");
    await h.expectText("1 going · 4 spots left");
    await h.expectText("Attendees (1)");
    assert.equal(await page.evaluate(`!!document.querySelector('[aria-label="Cancel event"]')`), true, "the host can cancel");
    await noOverflow("event page");
    await snapshotAllWidths("gyms-event-detail");
    await clickLabel("Cancel my RSVP");
    await waitForRow("SELECT attendee_count FROM gym_events WHERE gym_id = ?", [state.gym], (row) => row.attendee_count === 0, "RSVP cancelled");
    await h.expectText("Attendees (0)");
    await clickLabel("Back");
    await page.waitFor(`location.pathname === "/community/gyms/${state.gym}"`, NAV_TIMEOUT, "back on the gym");
  }));

  it("4c. Members: owners and admins apart from members, a lock for anyone who isn't a friend; Ask the gym answers from its facts", run("members-ask", async () => {
    await page.clickText("Members");
    await h.expectText("OWNERS & ADMINS · 1"); // innerText follows the uppercase style
    await h.expectText("MEMBERS · 1");
    const lockLabel = JSON.stringify(`[aria-label=${JSON.stringify("Messaging Rohan Mehta is locked until you're friends")}]`);
    assert.equal(await page.evaluate(`!!document.querySelector(${lockLabel})`), true, "a lock beside a member who isn't a friend");
    await snapshotAllWidths("gyms-members");
    await connection.query("INSERT INTO gym_faqs (gym_id, question, answer) VALUES (?, 'What are your opening hours?', 'Iron Temple is open 5am to 11pm on weekdays.')", [state.gym]);
    await clickLabel("Ask the gym");
    await page.waitFor(`location.pathname.endsWith("/ask")`, NAV_TIMEOUT, "the assistant");
    await h.expectText("Ask Iron Temple");
    await clickLabel("Ask: Opening hours");
    await h.expectText("Iron Temple is open 5am to 11pm on weekdays.");
    await page.setInput('[aria-label="Ask the gym"]', "Do you have a swimming pool?");
    await clickLabel("Send question");
    await h.expectText("A team member will follow up"); // the fake AI can't answer: it escalates
    await noOverflow("ask");
    await snapshotAllWidths("gyms-ask");
    await clickLabel("Back");
    await page.waitFor(`location.pathname === "/community/gyms/${state.gym}"`, NAV_TIMEOUT, "back on the gym");
  }));

  it("5. a post in the gym stays in the gym", run("post", async () => {
    await page.clickText("Feed");
    await clickLabel("Share something with Iron Temple");
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
    await h.goto(`/community/gyms/${state.gym}/invite`, "Invite Members");
    const [[gym]] = await connection.query("SELECT invite_code FROM gyms WHERE id = ?", [state.gym]);
    await h.expectText(`${gym.invite_code.slice(0, 4)}-${gym.invite_code.slice(4)}`);
    await h.expectText("Invited people skip the approval queue");
    await snapshotAllWidths("gyms-invite-link");
    await page.clickText("QR Code");
    await h.expectText("Scan to join");
    await page.clickText("Phone/Email");
    await page.setInput('[aria-label="Email to invite"]', "friend@example.com");
    await clickLabel("Record invitation");
    await h.expectText("Nothing was sent");
    await h.expectText("friend@example.com");
    await waitForRow("SELECT status, channel FROM gym_invitations WHERE gym_id = ? AND contact = 'friend@example.com'", [state.gym], (row) => row.status === "pending", "invitation recorded");
    await noOverflow("invite");
    await snapshotAllWidths("gyms-invite");
  }));

  it("7. Join a Gym: Search finds gyms by name and opens a typed code; QR Code offers the scanner and the owner's own QR", run("join-tabs", async () => {
    await h.goto("/community/gyms/join", "Join a Gym");
    await page.clickText("Search");
    await page.setInput('[aria-label="Search gyms or enter a code"]', "Iron");
    await h.expectText("Iron Temple");
    await h.expectText("Owner");
    await page.setInput('[aria-label="Search gyms or enter a code"]', state.hiddenCode);
    await page.waitFor(`[...document.querySelectorAll('[aria-label$="opens Secret Barbell Club"]')].some((e) => e.getClientRects().length > 0)`, NAV_TIMEOUT, "the code's gym");
    await noOverflow("join search");
    await snapshotAllWidths("gyms-join-search");
    await page.clickText("QR Code");
    await h.expectText("Scan a gym QR code");
    await h.expectText("Invite a friend to your gym"); // a owns Iron Temple, so its QR is offered
    await h.expectText("Scan to join");
    await noOverflow("join qr");
    await snapshotAllWidths("gyms-join-qr");
    await page.setInput('[aria-label="Invite code"]', "nope");
    await clickLabel("Continue");
    await h.expectText("isn't an justFit invitation link or code");
  }));

  it("7b. an emailed invitation isn't listed (no verified email), but its link opens the Gym Invitation screen and is accepted once", run("join", async () => {
    await page.clickText("Invite Link");
    await h.expectText("Have an invitation link?");
    assert.equal(await page.hasText("Invited by Rohan Mehta"), false, "not listed under Your invitations");
    await snapshotAllWidths("gyms-join-link");
    // The link the owner shared (as the invitee would open it from a message)
    const [[sent]] = await connection.query("SELECT code FROM gym_invitations WHERE gym_id = ? AND channel = 'email' AND status = 'pending'", [state.hidden]);
    await h.goto(`/community/gyms/invite/${sent.code}`, "Gym Invitation");
    await h.expectText("Rohan Mehta invited you to join");
    await h.expectText("Secret Barbell Club");
    await noOverflow("invitation");
    await snapshotAllWidths("gyms-invitation");
    await clickLabel("Accept invitation");
    await page.waitFor(`location.pathname === "/community/gyms/${state.hidden}"`, NAV_TIMEOUT, "the hidden gym");
    await h.expectText("Secret Barbell Club");
    await waitForRow("SELECT role, status FROM gym_members WHERE gym_id = ? AND user_id = ?", [state.hidden, identities.a.id], (row) => row.status === "active", "joined");
    const [[invite]] = await connection.query("SELECT status, accepted_by FROM gym_invitations WHERE gym_id = ? AND channel = 'email'", [state.hidden]);
    assert.deepEqual({ ...invite }, { status: "accepted", accepted_by: identities.a.id }, "the emailed invitation is used up");
  }));
});
