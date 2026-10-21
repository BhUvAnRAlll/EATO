// The gym owner portal in the real Expo web build against the isolated test server and the
// eato_test database. A platform admin creates "Iron Temple" with Priya as its owner; Rohan is a
// member whose package ends this week; other members, a trainer and a join request are rows only.
// Covers: the entry button on Community › Gyms (owner only), Home (stats, attention list, chart,
// coaching team, next event), Members (approving a request), Renewals (renew +1 month, recorded
// in the database), the Gym tab, a coming-soon tab, the member's own package on the gym page, a
// member seeing no entry button, and a platform admin opening the portal from Admin › Gyms.
// Screenshots at three widths.
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
const { helpers, signInAs, fillSignInForm, NAV_TIMEOUT, CLERK_TEST_CODE } = require("./onboarding-steps.js");

const EXPO_PORT = 8090;
const EVIDENCE_DIR = path.join(os.tmpdir(), "eato-ui-evidence");
const SCREENSHOT_DIR = process.env.EATO_SCREENSHOT_DIR || null;
const WIDTHS = [[320, 568], [390, 844], [430, 932]];
const CLEANUP_TABLES = ["gym_member_plans", "gym_event_rsvps", "gym_events", "gym_invitations", "gym_members", "gym_faqs", "whatsapp_usage",
  "whatsapp_agent_settings", "whatsapp_connections", "gym_visits", "gym_scan_failures", "gym_notices", "gym_assistant_questions", "gyms", "trainer_connections", "trainer_profiles"];

describe("ui owner: the gym owner portal for owners, members and platform admins", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, expo, chrome, client, page, clerk, h;
  const identities = {};
  const tokens = {};
  const sessions = {};
  const rowsOnly = {}; // members who never sign in: users rows only
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
  const dayOffset = async (days) => (await connection.query("SELECT DATE_FORMAT(CURDATE() + INTERVAL ? DAY, '%Y-%m-%d') AS d", [days]))[0][0].d;
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
  // A platform admin lands on /admin, which signInAs doesn't wait for
  const signInAsAdmin = async (identity) => {
    await h.goto("/sign-in", "Log in");
    if (await page.evaluate(`!!(window.Clerk && window.Clerk.session)`)) {
      await page.evaluate(`window.Clerk.signOut({ redirectUrl: "/sign-in" })`);
      await page.waitFor(`!(window.Clerk && window.Clerk.session)`, 15000, "previous session ended");
      await h.goto("/sign-in", "Log in");
    }
    await fillSignInForm(page, h, identity);
    await page.clickText("Log in");
    // A new device may be asked for the emailed code (Clerk test identities take a fixed one)
    const outcome = await page.waitFor(`location.pathname.startsWith("/admin") ? "admin" : (document.body.innerText || "").includes("Check your email") ? "code" : ""`, 60000, "admin sign-in outcome");
    if (outcome === "code") await page.setInput('input[maxlength="6"]', CLERK_TEST_CODE);
    await page.waitFor(`location.pathname.startsWith("/admin")`, 60000, "admin home");
    await h.settle();
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
    // The first web bundle can take a while: load the sign-in screen once before any test
    await page.navigate(`${expo.baseUrl}/sign-in`);
    await page.waitFor(`(document.body.innerText || "").includes("Log in")`, 120000, "the first web bundle");
    try {
      for (const [tag, role] of [["owner", undefined], ["member", undefined], ["platform", "admin"]]) {
        identities[tag] = await clerk.createIdentity(runId, tag, { withPassword: true, role });
        const minted = await clerk.mintToken(identities[tag].id);
        tokens[tag] = minted.jwt;
        sessions[tag] = minted.sessionId;
      }
    } catch (error) {
      throw new Error(`Clerk could not create a test identity: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of ["owner", "member"]) await clerk.setUnsafeMetadata(identities[tag].id, { profileComplete: true });
    const names = { owner: "Priya Sharma", member: "Rohan Mehta", platform: "Platform Admin" };
    for (const tag of Object.keys(identities)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [identities[tag].id, identities[tag].emailAddress, names[tag], tag === "platform" ? "admin" : "user"]);
    }
    for (const [tag, name] of [["lapsed", "Leo Lapsed"], ["coach", "Cora Coach"], ["asking", "Asha Asking"]]) {
      rowsOnly[tag] = `user_ui${runId}${tag}`; // the shape of a Clerk id (user_ + letters and digits)
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user')", [rowsOnly[tag], `${tag}-${runId}@example.com`, name]);
    }
    const created = await apiAs("platform", "POST", "/api/gyms", { name: "Iron Temple", tagline: "Lift heavy, lift often", location: "Indiranagar", ownerEmail: identities.owner.emailAddress });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    state.gym = created.json.gym.id;
    await connection.query("UPDATE gyms SET membership_tiers = ? WHERE id = ?", [JSON.stringify([{ name: "Unlimited", price: "₹2,000/month", perks: "All classes" }]), state.gym]);
    const add = (userId, role, status = "active") => connection.query(
      "INSERT INTO gym_members (gym_id, user_id, role, status, requested_at, joined_at) VALUES (?, ?, ?, ?, NOW(), IF(? = 'active', NOW(), NULL))",
      [state.gym, userId, role, status, status],
    );
    await add(identities.member.id, "member");
    await add(rowsOnly.lapsed, "member");
    await add(rowsOnly.coach, "trainer");
    await add(rowsOnly.asking, "member", "pending");
    await connection.query("UPDATE gyms SET member_count = 4 WHERE id = ?", [state.gym]);
    await connection.query("INSERT INTO trainer_profiles (user_id, title, specialties, bio) VALUES (?, 'Strength coach', '[\"strength\"]', 'Coaching')", [rowsOnly.coach]);
    const start = await dayOffset(-40);
    await connection.query(
      "INSERT INTO gym_member_plans (gym_id, user_id, plan_name, status, starts_on, ends_on) VALUES (?, ?, 'Unlimited', 'active', ?, ?), (?, ?, 'Unlimited', 'active', ?, ?)",
      [state.gym, identities.member.id, start, await dayOffset(4), state.gym, rowsOnly.lapsed, start, await dayOffset(-6)],
    );
    await connection.query(
      "INSERT INTO gym_events (gym_id, host_id, title, description, event_date, start_time, end_time, location, max_attendees) VALUES (?, ?, 'Deadlift clinic', 'Form check for all levels', ?, '07:00', '08:00', 'Main floor', 12)",
      [state.gym, identities.owner.id, await dayOffset(3)],
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
      for (const table of CLEANUP_TABLES) await connection.query("DELETE FROM `" + table + "`");
      await db.deleteUsers(connection, [...Object.values(identities).map((i) => i.id), ...Object.values(rowsOnly)]);
      await connection.end();
    });
    await step("identities", async () => {
      if (!clerk) return;
      for (const sessionId of Object.values(sessions)) await clerk.revokeSession(sessionId).catch(() => {});
      for (const identity of Object.values(identities)) await clerk.deleteUser(identity.id);
    });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. the owner sees the Gym owner portal button on Community › Gyms, and it opens Home", run("entry", async () => {
    await viewport(390, 844);
    await signInAs(page, h, identities.owner);
    await h.expectPath("/home");
    await clickTab("Community");
    await h.expectPath("/community");
    await page.clickText("Gyms");
    await h.expectText("My Gyms");
    await clickLabel("Gym owner portal for Iron Temple");
    await page.waitFor(`location.pathname === "/owner"`, NAV_TIMEOUT, "owner home");
    await h.expectText("Today at a glance");
  }));

  it("2. Home shows the stats, what needs attention, new members, the coaching team and the next event", run("home", async () => {
    await h.expectText("IRON TEMPLE"); // the eyebrow is drawn in capitals
    await h.expectText("Needs your attention"); // the summary has arrived (the header shows first)
    for (const label of ["Members: 4", "Join requests: 1", "Upcoming events: 1", "Trainers: 1", "Plan: Starter"]) assert.equal(await hasLabel(label), true, label);
    await h.expectText("Needs your attention");
    await h.expectText("1 join request");
    await h.expectText("2 memberships ending");
    await h.expectText("1 expired · 1 end this week");
    await h.expectText("NEW MEMBERS");
    await h.expectText("Coaching team");
    await h.expectText("Cora Coach");
    await h.expectText("Strength coach");
    await h.expectText("Deadlift clinic");
    // The tab bar badges the waiting join request on Members
    assert.equal(await hasLabel("Members, 1 waiting"), true, "Members tab badge");
    await snapshotAllWidths("owner-home");
  }));

  it("3. Members: the join request tile opens the requests; approving updates the badge and the database", run("members", async () => {
    await clickLabel("Join requests: 1");
    await page.waitFor(`location.pathname === "/owner/members"`, NAV_TIMEOUT, "members tab");
    await h.expectText("Asha Asking");
    await snapshotAllWidths("owner-members-requests");
    await clickLabel("Approve Asha Asking");
    await waitForRow("SELECT status FROM gym_members WHERE gym_id = ? AND user_id = ?", [state.gym, rowsOnly.asking], (row) => row.status === "active", "the request is approved");
    await page.waitFor(`![...document.querySelectorAll('[aria-label="Members, 1 waiting"]')].some((e) => e.getClientRects().length > 0)`, NAV_TIMEOUT, "the badge clears");
  }));

  it("4. Renewals: expired first, then this week; renewing a member records a new end date, with no payment", run("renewals", async () => {
    await clickLabel("Renewals");
    await page.waitFor(`location.pathname === "/owner/renewals"`, NAV_TIMEOUT, "renewals");
    await h.expectText("Leo Lapsed");
    await h.expectText("Expired");
    await h.expectText("This week");
    const order = await page.evaluate(`(() => { const t = document.body.innerText; return [t.indexOf("Leo Lapsed"), t.indexOf("Rohan Mehta"), t.indexOf("Cora Coach")]; })()`);
    assert.ok(order[0] < order[1] && order[1] < order[2], `expired, then this week, then no package: ${order}`);
    await snapshotAllWidths("owner-renewals");
    await page.clickText("Leo Lapsed");
    await page.clickText("Renew for 1 month");
    await h.expectText("Recorded only: no payment was taken.");
    const plan = await waitForRow(
      "SELECT status, DATEDIFF(ends_on, CURDATE()) AS days FROM gym_member_plans WHERE gym_id = ? AND user_id = ?",
      [state.gym, rowsOnly.lapsed], (row) => row.days > 20, "the package restarts from today",
    );
    assert.equal(plan.status, "active");
    await clickLabel("Back");
  }));

  it("5. the Gym tab links every gym screen, and an unbuilt tab says it's coming", run("gym", async () => {
    await clickTab("Gym");
    await page.waitFor(`location.pathname === "/owner/gym"`, NAV_TIMEOUT, "gym tab");
    for (const label of ["Gym profile", "Subscription", "Trainers", "Members", "Renewals", "Invite & invitations", "Announcements", "Community settings", "Gym page"]) assert.equal(await hasLabel(label), true, label);
    await snapshotAllWidths("owner-gym");
    await clickTab("Gym");
    await clickLabel("Gym page");
    await page.waitFor(`location.pathname.startsWith("/community/gyms/")`, NAV_TIMEOUT, "the gym page opens");
    await h.expectText("Lift heavy, lift often");
  }));

  it("6. a member sees their own package on the gym's About tab, and no owner portal button", run("member", async () => {
    await signInAs(page, h, identities.member);
    await h.expectPath("/home");
    await clickTab("Community");
    await page.clickText("Gyms");
    await h.expectText("My Gyms");
    assert.equal(await page.hasText("Gym owner portal"), false, "members don't get the portal");
    await page.clickText("Iron Temple");
    await page.waitFor(`location.pathname.startsWith("/community/gyms/")`, NAV_TIMEOUT, "gym page");
    await page.clickText("About");
    await h.expectText("YOUR MEMBERSHIP");
    await h.expectText("4 days left");
    await h.expectText("Ask the front desk to renew it.");
    await snapshotAllWidths("owner-member-plan");
    // Straight to the portal's address: the server refuses, and nothing is shown
    await h.goto("/owner", "No gym to manage");
  }));

  it("7. a platform admin opens any gym's owner portal from Admin › Gyms", run("platform", async () => {
    await signInAsAdmin(identities.platform);
    await h.goto("/admin/gyms", "Iron Temple");
    // Admin › Gyms lists each gym as "<name>, <n> members · <plan> · <owner>"; its detail screen opens Gym Manager
    const row = await page.waitFor(`(() => { const el = [...document.querySelectorAll("[aria-label]")].find((e) => e.getClientRects().length > 0 && e.getAttribute("aria-label").startsWith("Iron Temple, ")); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, NAV_TIMEOUT, "the Iron Temple row");
    await page.clickAt(row.x, row.y);
    await page.waitFor(`location.pathname.startsWith("/admin/gyms/")`, NAV_TIMEOUT, "the admin gym detail");
    await clickLabel("Open Gym Manager for Iron Temple");
    await page.waitFor(`location.pathname === "/owner"`, NAV_TIMEOUT, "owner home");
    await h.expectText("IRON TEMPLE · EATO ADMIN");
    await h.expectText("Needs your attention");
    assert.equal(await hasLabel("Invite"), false, "the member app's tools stay with the gym's staff");
    await snapshotAllWidths("owner-platform-home");
  }));
});
