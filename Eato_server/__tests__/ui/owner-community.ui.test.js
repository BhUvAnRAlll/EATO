// The owner portal's Community tab and Notify members in the real Expo web build against the
// isolated test server and the eato_test database. Priya owns "Iron Temple"; Rohan is a member,
// Zoe's package has expired. Covers the Community cards and their counts, the Events screen,
// sending a notice from a template (confirm, sent list, recipients in the database), renewal
// reminders, and the member's side: the notice in the bell, opening its target. Screenshots at
// three widths.
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
const CLEANUP_TABLES = ["gym_notices", "gym_visits", "gym_scan_failures", "gym_member_plans", "gym_announcements", "gym_event_rsvps", "gym_events", "community_posts",
  "gym_members", "gym_faqs", "whatsapp_usage", "whatsapp_agent_settings", "whatsapp_connections", "gym_assistant_questions", "gyms"];

describe("ui owner community: the Community tab, Events and Notify members, and the member's bell", () => {
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
  const noOverflow = async (label) => assert.equal(await page.evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`), false, `${label}: the page must not overflow horizontally`);
  const snapshotAllWidths = async (name) => {
    for (const [w, hgt] of WIDTHS) {
      await viewport(w, hgt);
      await h.settle();
      await noOverflow(`${name} at ${w}`);
      if (SCREENSHOT_DIR) { fs.mkdirSync(SCREENSHOT_DIR, { recursive: true }); await page.screenshot(path.join(SCREENSHOT_DIR, `${name}-${w}.png`)); }
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
  const hasLabel = (label) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(`[aria-label=${JSON.stringify(label)}]`)})].some((e) => e.getClientRects().length > 0)`);
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
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" }); // the gym assistant uses the test-only fake AI
    expo = await startExpoWeb({ port: EXPO_PORT, apiUrl: `http://localhost:${env.PORT}` });
    chrome = await launchChrome();
    client = await connect(chrome.browserWsUrl);
    page = await openPage(client);
    h = helpers(page, expo.baseUrl);
    // The first web bundle can take a while: load the sign-in screen once before any test
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      for (const tag of ["owner", "member", "lapsed"]) {
        identities[tag] = await clerk.createIdentity(runId, tag, { withPassword: tag !== "lapsed" });
        const minted = await clerk.mintToken(identities[tag].id);
        tokens[tag] = minted.jwt;
        sessions[tag] = minted.sessionId;
      }
      identities.platform = await clerk.createIdentity(runId, "platform", { role: "admin" });
      const minted = await clerk.mintToken(identities.platform.id);
      tokens.platform = minted.jwt;
      sessions.platform = minted.sessionId;
    } catch (error) {
      throw new Error(`Clerk could not create a test identity: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of ["owner", "member"]) await clerk.setUnsafeMetadata(identities[tag].id, { profileComplete: true });
    const names = { owner: "Priya Sharma", member: "Rohan Mehta", lapsed: "Zoe Adams", platform: "Platform Admin" };
    for (const tag of Object.keys(identities)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [identities[tag].id, identities[tag].emailAddress, names[tag], tag === "platform" ? "admin" : "user"]);
    }
    const created = await apiAs("platform", "POST", "/api/gyms", { name: "Iron Temple", tagline: "Lift heavy, lift often", location: "Indiranagar", ownerEmail: identities.owner.emailAddress });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    state.gym = created.json.gym.id;
    for (const tag of ["member", "lapsed"]) {
      await connection.query("INSERT INTO gym_members (gym_id, user_id, role, status, requested_at, joined_at) VALUES (?, ?, 'member', 'active', NOW(), NOW())", [state.gym, identities[tag].id]);
    }
    await connection.query(
      "INSERT INTO gym_member_plans (gym_id, user_id, plan_name, status, starts_on, ends_on) VALUES (?, ?, 'Standard', 'active', CURDATE() - INTERVAL 40 DAY, CURDATE() - INTERVAL 2 DAY)",
      [state.gym, identities.lapsed.id],
    );
    await connection.query("INSERT INTO gym_announcements (gym_id, author_id, title, body, pinned) VALUES (?, ?, 'Holiday hours', 'Closed on Monday', TRUE)", [state.gym, identities.owner.id]);
    await connection.query(
      "INSERT INTO gym_events (gym_id, host_id, title, description, event_date, start_time, end_time, location, max_attendees) VALUES (?, ?, 'Deadlift clinic', 'Form check', CURDATE() + INTERVAL 3 DAY, '07:00', '08:00', 'Main floor', 12)",
      [state.gym, identities.owner.id],
    );
    await connection.query("INSERT INTO community_posts (id, user_id, gym_id, review_status, body) VALUES (?, ?, ?, 'published', 'Week one of meal prep done')", [crypto.randomUUID(), identities.member.id, state.gym]);
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

  it("1. the Community tab shows a card for each part of the gym, with live counts and the latest post", run("community", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.owner);
    await h.expectPath("/home");
    await clickTab("Community");
    await page.clickText("Gyms");
    await clickLabel("Gym owner portal for Iron Temple");
    await page.waitFor(`location.pathname === "/owner"`, NAV_TIMEOUT, "owner home");
    await clickTab("Community");
    await page.waitFor(`location.pathname === "/owner/community"`, NAV_TIMEOUT, "community tab");
    for (const label of ["Gym feed, 1 post", "Announcements, 1 live", "Events, 1 upcoming · 0 RSVPs", "Member notifications, 0 sent", "Invites", "Rules & permissions", "Gym assistant, 0 custom answers"]) {
      await page.waitFor(`[...document.querySelectorAll(${JSON.stringify(`[aria-label=${JSON.stringify(label)}]`)})].some((e) => e.getClientRects().length > 0)`, NAV_TIMEOUT, label);
    }
    await h.expectText("Week one of meal prep done");
    await h.expectText("Everyone can post");
    await snapshotAllWidths("owner-community");
  }));

  it("2. Events lists upcoming and past events with the RSVP total", run("events", async () => {
    // Home (still on the page under the tab) has an "All events" too: take the newest
    await clickLabel("All events", -1);
    await page.waitFor(`location.pathname === "/owner/events"`, NAV_TIMEOUT, "events");
    await h.expectText("Deadlift clinic");
    assert.equal(await hasLabel("1 upcoming, 0 RSVPs in total"), true);
    await snapshotAllWidths("owner-events");
    await clickLabel("Back");
  }));

  it("3. Notify members: a template, Everyone with its count, the preview, a confirmation, and the sent list", run("notify", async () => {
    await clickLabel("Notify members");
    await page.waitFor(`location.pathname === "/owner/notify"`, NAV_TIMEOUT, "notify");
    await page.waitFor(`[...document.querySelectorAll('[aria-label="Everyone (3)"]')].some((e) => e.getClientRects().length > 0)`, NAV_TIMEOUT, "live counts");
    assert.equal(await hasLabel("Renewal due (1)"), true);
    await clickLabel("Template: Closing early");
    await h.expectText("Closing early today"); // the template filled the title and the preview
    await snapshotAllWidths("owner-notify");
    await clickLabel("Send to 3");
    await h.expectText("Send to 3 people?");
    await page.clickText("Send");
    await h.expectText("Sent to 3 people.");
    const row = await waitForRow("SELECT id, reach, audience FROM gym_notices WHERE gym_id = ? AND kind = 'message'", [state.gym], (r) => r.reach === 3, "the notice is saved");
    assert.equal(row.audience, "everyone");
    const [recipients] = await connection.query("SELECT user_id FROM gym_notice_recipients WHERE notice_id = ?", [row.id]);
    assert.deepEqual(recipients.map((r) => r.user_id).sort(), [identities.owner.id, identities.member.id, identities.lapsed.id].sort());
    await h.expectText("Sent (1)");
    await h.expectText("Everyone · 3 people");
  }));

  it("4. Renewals can remind one member or everyone due", run("reminders", async () => {
    await clickLabel("Back");
    await clickTab("Members");
    await clickLabel("Renewals");
    await page.waitFor(`location.pathname === "/owner/renewals"`, NAV_TIMEOUT, "renewals");
    // Wait for the list: the filter counts arrive with it and move the button down
    await h.expectText("Zoe Adams");
    await clickLabel("Remind everyone due");
    await h.expectText("Reminder sent to 1 member expired or ending this week.");
    await waitForRow("SELECT reach FROM gym_notices WHERE gym_id = ? AND kind = 'reminder'", [state.gym], (r) => r.reach === 1, "the reminder is saved");
    await snapshotAllWidths("owner-renewals-reminders");
  }));

  it("5. Review: a held post is approved and a reported post is removed, after a confirmation", run("review", async () => {
    const held = crypto.randomUUID();
    const reported = crypto.randomUUID();
    await connection.query("INSERT INTO community_posts (id, user_id, gym_id, review_status, body, created_at) VALUES (?, ?, ?, 'pending', 'Selling three unopened tubs of whey', NOW())", [held, identities.member.id, state.gym]);
    await connection.query("INSERT INTO community_posts (id, user_id, gym_id, review_status, body) VALUES (?, ?, ?, 'published', 'Something rude about the trainers')", [reported, identities.lapsed.id, state.gym]);
    await connection.query("INSERT INTO community_reports (id, reporter_id, post_id, reason) VALUES (UUID(), ?, ?, 'Harassment')", [identities.member.id, reported]);
    await signInAs(page, h, identities.owner);
    await h.expectPath("/home");
    await clickTab("Community");
    await page.clickText("Gyms");
    await clickLabel("Gym owner portal for Iron Temple");
    await page.waitFor(`location.pathname === "/owner"`, NAV_TIMEOUT, "owner home");
    await clickTab("Review");
    await page.waitFor(`location.pathname === "/owner/review"`, NAV_TIMEOUT, "review tab");
    await h.expectText("Selling three unopened tubs of whey");
    await h.expectText("Awaiting review");
    await snapshotAllWidths("owner-review-pending");
    await clickLabel("Approve Rohan Mehta's post");
    await h.expectText("Approved: it's live in the gym feed.");
    await waitForRow("SELECT review_status FROM community_posts WHERE id = ?", [held], (r) => r.review_status === "published", "approved");
    await clickLabel("Reported (1)");
    await h.expectText("Something rude about the trainers");
    await h.expectText("Harassment");
    assert.equal(await page.hasText("Rohan Mehta reported"), false, "reporters stay anonymous");
    await snapshotAllWidths("owner-review-reported");
    await clickLabel("Remove Zoe Adams's post");
    await h.expectText("Remove this post?");
    await page.clickText("Remove");
    await h.expectText("Removed from the gym feed.");
    const gone = await waitForRow("SELECT deleted_at FROM community_posts WHERE id = ?", [reported], (r) => r.deleted_at !== null, "removed");
    assert.ok(gone.deleted_at);
    assert.equal((await connection.query("SELECT status FROM community_reports WHERE post_id = ?", [reported]))[0][0].status, "reviewed");
  }));

  it("6. the member sees the gym's notice in their bell, and tapping it opens the gym", run("member", async () => {
    await signInAs(page, h, identities.member);
    await h.expectPath("/home");
    await page.navigate(`${expo.baseUrl}/community/notifications`);
    await h.expectText("Iron Temple: Closing early today");
    await snapshotAllWidths("member-bell-notice");
    await page.clickText("Iron Temple: Closing early today");
    await page.waitFor(`location.pathname.startsWith("/community/gyms/")`, NAV_TIMEOUT, "the gym page");
    await h.expectText("Lift heavy, lift often");
  }));

  it("7. Gym assistant: a question the assistant couldn't answer is replied to, and the member sees the reply in Ask", run("assistant", async () => {
    // A fresh session token: the one made in before() has expired by now
    const fresh = await clerk.mintToken(identities.member.id);
    tokens.member = fresh.jwt;
    sessions.memberLate = fresh.sessionId;
    const asked = await apiAs("member", "POST", `/api/gyms/${state.gym}/assistant`, { question: "Do you have a student discount?" });
    assert.equal(asked.json.escalated, true, JSON.stringify(asked.json));
    await signInAs(page, h, identities.owner);
    await h.expectPath("/home");
    await clickTab("Community");
    await page.clickText("Gyms");
    await clickLabel("Gym owner portal for Iron Temple");
    await page.waitFor(`location.pathname === "/owner"`, NAV_TIMEOUT, "owner home");
    await h.expectText("1 question for the team");
    await clickLabel("1 question for the team. The gym assistant couldn't answer these. Reply and it reaches them in chat");
    await page.waitFor(`location.pathname === "/owner/assistant"`, NAV_TIMEOUT, "gym assistant");
    await h.expectText("Do you have a student discount?");
    await snapshotAllWidths("owner-assistant-questions");
    await page.setInput('[aria-label="Reply to Rohan Mehta"]', "Yes, 15% off with a college ID.");
    await clickLabel("Send reply to Rohan Mehta");
    await h.expectText("Reply sent to Rohan Mehta.");
    await waitForRow("SELECT status FROM gym_assistant_questions WHERE gym_id = ?", [state.gym], (r) => r.status === "answered", "answered");
    await clickLabel("Custom answers (0)");
    await clickLabel("Add a custom answer");
    await page.setInput('[aria-label="Custom answer question"]', "Guest pass");
    await page.setInput('[aria-label="Custom answer text"]', "Members can bring one guest a month.");
    await clickLabel("Save custom answer");
    await h.expectText("Members can bring one guest a month.");
    await snapshotAllWidths("owner-assistant-answers");
    // The member sees the team's reply above their chat with the assistant
    await signInAs(page, h, identities.member);
    await h.expectPath("/home");
    await page.navigate(`${expo.baseUrl}/community/gyms/${state.gym}/ask`);
    await h.expectText("YOUR QUESTIONS TO THE TEAM");
    await h.expectText("Yes, 15% off with a college ID.");
    await snapshotAllWidths("member-ask-team-reply");
  }));
});
