// Notify members and the Community tab end to end: real Clerk development identities against the
// real Express server and the isolated `eato_test` database. Covers who may send (owner and admins
// only), input checks, every audience and its live count (pending, suspended and community-suspended
// people are never included), delivery to exactly the right bells, a test to yourself, renewal
// reminders, the automatic check-in and renewal notes, the per-sender rate limit, and the Community
// tab's counts.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const CLEANUP_TABLES = ["gym_notices", "gym_visits", "gym_scan_failures", "gym_member_plans", "gym_announcements", "gym_events", "community_posts", "community_profiles",
  "whatsapp_agent_settings", "whatsapp_connections", "gym_members", "gyms"];

describe("owner notices e2e: Notify members, reminders, automatic notes and the Community tab", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, clerk;
  const identities = {};
  const ids = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const as = (tag) => ({ get: (route) => api("GET", route, tokens[tag]), post: (route, body) => api("POST", route, tokens[tag], body) });
  const route = (path) => `/api/owner/gyms/${state.gym}${path}`;
  const bellNotices = async (tag) => {
    const res = await as(tag).get("/api/community/notifications");
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.activity.filter((a) => a.type === "gym_notice");
  };
  // Sorted here, the same way as sorted() below (the database sorts ignoring case)
  const recipientsOf = async (noticeId) => (await connection.query("SELECT user_id FROM gym_notice_recipients WHERE notice_id = ?", [noticeId]))[0].map((r) => r.user_id).sort();
  const sorted = (...tags) => tags.map((t) => ids[t]).sort();

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      for (const tag of ["owner", "admin", "coach", "regular", "lapsed", "away", "pending", "suspended", "banned", "outsider"]) {
        const identity = await clerk.createIdentity(runId, tag, { role: tag === "coach" ? "trainer" : undefined });
        const { sessionId, jwt } = await clerk.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        ids[tag] = identity.id;
        tokens[tag] = jwt;
      }
      const platform = await clerk.createIdentity(runId, "platform", { role: "admin" });
      const minted = await clerk.mintToken(platform.id);
      identities.platform = { ...platform, sessionId: minted.sessionId };
      ids.platform = platform.id;
      tokens.platform = minted.jwt;
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user')", [ids[tag], identities[tag].emailAddress, `${tag[0].toUpperCase()}${tag.slice(1)} Person`]);
    }
    const created = await as("platform").post("/api/gyms", { name: `Notice Gym ${runId}`, ownerEmail: identities.owner.emailAddress });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    state.gym = created.json.gym.id;
    const add = (tag, role, status = "active") => connection.query(
      "INSERT INTO gym_members (gym_id, user_id, role, status, requested_at, joined_at) VALUES (?, ?, ?, ?, NOW(), IF(? = 'active', NOW(), NULL))",
      [state.gym, ids[tag], role, status, status],
    );
    await add("admin", "admin");
    await add("coach", "trainer");
    for (const tag of ["regular", "lapsed", "away", "banned"]) await add(tag, "member");
    await add("pending", "member", "pending");
    await add("suspended", "member", "suspended");
    // "banned" is suspended from the whole community: never a recipient
    await connection.query("INSERT INTO community_profiles (user_id, status) VALUES (?, 'suspended')", [ids.banned]);
    // regular is in the gym now and visited recently; lapsed's package ended; away never visits
    await connection.query("INSERT INTO gym_visits (gym_id, user_id, checked_in_by) VALUES (?, ?, ?)", [state.gym, ids.regular, ids.owner]);
    await connection.query(
      "INSERT INTO gym_member_plans (gym_id, user_id, plan_name, status, starts_on, ends_on) VALUES (?, ?, 'Standard', 'active', CURDATE() - INTERVAL 40 DAY, CURDATE() - INTERVAL 3 DAY), (?, ?, 'Unlimited', 'active', CURDATE() - INTERVAL 10 DAY, CURDATE() + INTERVAL 60 DAY)",
      [state.gym, ids.lapsed, state.gym, ids.regular],
    );
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of CLEANUP_TABLES) await connection.query("DELETE FROM `" + table + "`");
        await db.deleteUsers(connection, Object.values(ids));
      } catch (error) { problems.push(`rows: ${error.code}`); }
    }
    if (clerk) for (const tag of Object.keys(identities)) {
      try {
        if (identities[tag].sessionId) await clerk.revokeSession(identities[tag].sessionId).catch(() => {});
        await clerk.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeClerkError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. sign-in is required; only the owner, gym admins and platform admins may notify", async () => {
    for (const [method, path] of [["GET", route("/notices")], ["GET", route("/notices/audiences")], ["POST", route("/notices")], ["GET", route("/community")], ["POST", route("/renewals/remind-due")]]) {
      assert.equal((await api(method, path, null, method === "POST" ? {} : undefined)).status, 401, path);
    }
    const notice = { title: "Hi", body: "Hello", audience: "everyone" };
    for (const tag of ["coach", "regular", "pending"]) {
      assert.equal((await as(tag).post(route("/notices"), notice)).status, 403, tag);
      assert.equal((await as(tag).get(route("/notices/audiences"))).status, 403, tag);
      assert.equal((await as(tag).get(route("/community"))).status, 403, tag);
    }
    assert.equal((await as("outsider").post(route("/notices"), notice)).status, 403);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM gym_notices"))[0][0].n, 0);
  });

  test("2. the notice is checked: title, message, target, audience, people and unknown fields", async () => {
    const send = (body) => as("owner").post(route("/notices"), body);
    const ok = { title: "Closing early", body: "We close at 6 today.", audience: "everyone" };
    for (const body of [{ ...ok, title: "" }, { ...ok, title: "x".repeat(61) }, { ...ok, body: "  " }, { ...ok, body: "x".repeat(241) },
      { ...ok, target: "website" }, { ...ok, audience: "the world" }, { ...ok, audience: "chosen" }, { ...ok, audience: "chosen", userIds: ["nope"] },
      { ...ok, audience: "chosen", userIds: Array(501).fill(ids.regular) }, { ...ok, userIds: [ids.regular] }, { ...ok, test: "yes" }, { ...ok, sentBy: ids.admin }, []]) {
      assert.equal((await send(body)).status, 400, JSON.stringify(body).slice(0, 80));
    }
  });

  test("3. each audience's live count leaves out pending, suspended and community-suspended people", async () => {
    const res = await as("admin").get(route("/notices/audiences"));
    assert.equal(res.status, 200);
    // active and reachable: owner, admin, coach, regular, lapsed, away (not pending, suspended, banned)
    assert.deepEqual(res.json.counts, { everyone: 6, in_gym: 1, renewal_due: 1, inactive: 2, staff: 3 });
  });

  test("4. sending reaches exactly its audience's bells, with the gym's name; others see nothing", async () => {
    const res = await as("owner").post(route("/notices"), { title: "Closing early", body: "We close at 6 PM today for maintenance.", target: "gym", audience: "everyone" });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    assert.equal(res.json.notice.reach, 6);
    assert.deepEqual(await recipientsOf(res.json.notice.id), sorted("owner", "admin", "coach", "regular", "lapsed", "away"));
    const [n] = await bellNotices("away");
    assert.equal(n.title, "Closing early");
    assert.equal(n.preview, "We close at 6 PM today for maintenance.");
    assert.equal(n.gymId, state.gym);
    assert.equal(n.target, "gym");
    for (const tag of ["pending", "suspended", "banned", "outsider"]) assert.deepEqual(await bellNotices(tag), [], tag);

    const inGym = await as("admin").post(route("/notices"), { title: "Last call", body: "Floor closes in 15 minutes.", target: "session", audience: "in_gym" });
    assert.deepEqual(await recipientsOf(inGym.json.notice.id), [ids.regular]);
    const staff = await as("admin").post(route("/notices"), { title: "Staff meeting", body: "Tomorrow at 7.", target: "none", audience: "staff" });
    assert.deepEqual(await recipientsOf(staff.json.notice.id), sorted("owner", "admin", "coach"));
    const lapsed = await as("admin").post(route("/notices"), { title: "Renew", body: "Your package is due.", audience: "renewal_due" });
    assert.deepEqual(await recipientsOf(lapsed.json.notice.id), [ids.lapsed]);
    const missed = await as("admin").post(route("/notices"), { title: "We miss you", body: "Come back this week!", audience: "inactive" });
    assert.deepEqual(await recipientsOf(missed.json.notice.id), sorted("lapsed", "away"));
  });

  test("5. Choose people sends only to active members picked; a test goes only to you", async () => {
    const chosen = await as("owner").post(route("/notices"), { title: "Class moved", body: "Spin is at 7 now.", audience: "chosen", userIds: [ids.away, ids.pending, ids.outsider, ids.banned, ids.away] });
    assert.equal(chosen.status, 201);
    assert.deepEqual(await recipientsOf(chosen.json.notice.id), [ids.away], "pending, outsiders and suspended people are dropped, and duplicates");
    const nobody = await as("owner").post(route("/notices"), { title: "Class moved", body: "Spin is at 7 now.", audience: "chosen", userIds: [ids.outsider] });
    assert.equal(nobody.status, 400);
    const test = await as("admin").post(route("/notices"), { title: "Test", body: "Only me", test: true, audience: "everyone" });
    assert.equal(test.status, 201);
    assert.equal(test.json.notice.audience, "test");
    assert.deepEqual(await recipientsOf(test.json.notice.id), [ids.admin]);
  });

  test("6. the sent list shows messages and reminders with their audience and reach, not automatic notes", async () => {
    const res = await as("owner").get(route("/notices"));
    assert.equal(res.status, 200);
    assert.equal(res.json.notices[0].title, "Test");
    const closing = res.json.notices.find((n) => n.title === "Closing early");
    assert.equal(closing.audience, "everyone");
    assert.equal(closing.reach, 6);
    assert.equal(closing.sentBy, "Owner Person");
    assert.ok(res.json.notices.every((n) => n.kind === "message" || n.kind === "reminder"));
  });

  test("7. renewal reminders: one member, or everyone expired or ending this week", async () => {
    const one = await as("owner").post(route(`/renewals/${ids.lapsed}/remind`));
    assert.equal(one.status, 201, JSON.stringify(one.json));
    assert.equal((await bellNotices("lapsed"))[0].title, "Renewal reminder");
    assert.equal((await as("owner").post(route(`/renewals/${ids.pending}/remind`))).status, 400, "not an active member");
    assert.equal((await as("owner").post(route("/renewals/not-a-user/remind"))).status, 400);
    assert.equal((await as("coach").post(route(`/renewals/${ids.lapsed}/remind`))).status, 403);
    const due = await as("admin").post(route("/renewals/remind-due"));
    assert.equal(due.status, 201);
    assert.equal(due.json.reach, 1, "only lapsed is expired or ending this week");
  });

  test("8. checking in and renewing leave a note in the member's bell", async () => {
    const pass = (await as("away").get("/api/owner/me/pass")).json.pass;
    assert.equal((await as("owner").post(route("/attendance/checkin"), { code: pass })).status, 201);
    const [checkin] = await bellNotices("away");
    assert.equal(checkin.title, "Checked in");
    assert.equal(checkin.target, "session");
    assert.equal((await as("owner").post(route(`/renewals/${ids.away}`), { months: 1 })).status, 200);
    const [renewal] = await bellNotices("away");
    assert.equal(renewal.title, "Membership renewed");
    assert.match(renewal.preview, /runs until \d{4}-\d{2}-\d{2}/);
    assert.ok(!(await as("owner").get(route("/notices"))).json.notices.some((n) => n.title === "Checked in"), "automatic notes aren't in the sent list");
  });

  test("9. the Community tab counts each part of the gym", async () => {
    await connection.query("INSERT INTO gym_announcements (gym_id, author_id, title, body, pinned) VALUES (?, ?, 'Holiday hours', 'Closed Monday', TRUE)", [state.gym, ids.owner]);
    await connection.query(
      "INSERT INTO gym_events (gym_id, host_id, title, description, event_date, start_time, end_time, location, attendee_count) VALUES (?, ?, 'Clinic', 'Form', CURDATE() + INTERVAL 2 DAY, '07:00', '08:00', 'Floor', 3)",
      [state.gym, ids.owner],
    );
    await connection.query("INSERT INTO community_posts (id, user_id, gym_id, review_status, body) VALUES (?, ?, ?, 'pending', 'Held post'), (?, ?, ?, 'published', 'Leg day done')",
      [crypto.randomUUID(), ids.away, state.gym, crypto.randomUUID(), ids.regular, state.gym]);
    const res = await as("owner").get(route("/community"));
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const c = res.json.counts;
    assert.deepEqual([c.postsToReview, c.posts, c.announcements, c.pinnedAnnouncements, c.upcomingEvents, c.upcomingRsvps], [1, 1, 1, 1, 1, 3]);
    assert.ok(c.noticesSent >= 9);
    assert.match(res.json.inviteCode, /^[A-Z0-9]{8}$/);
    assert.equal(res.json.rules.whoCanPost, "everyone");
    assert.deepEqual(res.json.latestPosts.map((p) => p.preview), ["Leg day done"], "held posts aren't in the latest feed");
  });

  test("10. sending is rate limited per sender", async () => {
    let status = 0;
    for (let i = 0; i < 40 && status !== 429; i++) status = (await as("admin").post(route("/notices"), { title: `Spam ${i}`, body: "x", test: true })).status;
    assert.equal(status, 429, "the limit stops a flood of notices");
  });
});
