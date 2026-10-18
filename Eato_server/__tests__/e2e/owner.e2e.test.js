// The gym owner portal end to end: real Clerk development identities against the real Express
// server and the isolated `eato_test` database. Covers who may open it (the gym's owner and
// admins, and EATO platform admins; never its trainers, members or outsiders), the Home summary
// built from real rows, renewals (extend, restart, a new package, validation, no payment), and a
// member reading only their own package.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const CLEANUP_TABLES = ["gym_member_plans", "whatsapp_agent_settings", "whatsapp_connections", "gym_event_rsvps", "gym_events",
  "gym_invitations", "gym_members", "community_reports", "community_posts", "gyms", "trainer_connections", "trainer_profiles"];

describe("owner e2e: the gym owner portal's access, Home summary and renewals", () => {
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
  const as = (tag) => ({
    get: (route) => api("GET", route, tokens[tag]),
    post: (route, body) => api("POST", route, tokens[tag], body),
    patch: (route, body) => api("PATCH", route, tokens[tag], body),
  });
  const newIdentity = async (tag, role) => {
    const identity = await clerk.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const plansOf = async (userId) => (await connection.query(
    "SELECT plan_name, status, DATE_FORMAT(starts_on, '%Y-%m-%d') AS starts_on, DATE_FORMAT(ends_on, '%Y-%m-%d') AS ends_on FROM gym_member_plans WHERE gym_id = ? AND user_id = ? ORDER BY created_at",
    [state.gym, userId],
  ))[0];
  const dayOffset = async (days) => (await connection.query("SELECT DATE_FORMAT(CURDATE() + INTERVAL ? DAY, '%Y-%m-%d') AS d", [days]))[0][0].d;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      await newIdentity("owner");
      await newIdentity("admin");
      await newIdentity("coach", "trainer");
      await newIdentity("member");
      await newIdentity("lapsed");
      await newIdentity("outsider");
      await newIdentity("platform", "admin");
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    const names = { owner: "Olive Owner", admin: "Adam Admin", coach: "Cora Coach", member: "Mira Member", lapsed: "Leo Lapsed", outsider: "Omar Outside", platform: "Pat Platform" };
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [ids[tag], identities[tag].emailAddress, names[tag], tag === "coach" ? "trainer" : tag === "platform" ? "admin" : "user"]);
    }
    // A hidden gym (so outsiders get 404) created by the platform admin with the owner named
    const created = await as("platform").post("/api/gyms", { name: `Owner Portal Gym ${runId}`, ownerEmail: identities.owner.emailAddress, visibility: "hidden" });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    state.gym = created.json.gym.id;
    await connection.query("UPDATE gyms SET membership_tiers = ? WHERE id = ?", [JSON.stringify([{ name: "Unlimited", price: "₹2,000/month", perks: "All classes" }]), state.gym]);
    const add = (tag, role, status = "active") => connection.query(
      "INSERT INTO gym_members (gym_id, user_id, role, status, requested_at, joined_at) VALUES (?, ?, ?, ?, NOW(), IF(? = 'active', NOW(), NULL))",
      [state.gym, ids[tag], role, status, status],
    );
    await add("admin", "admin");
    await add("coach", "trainer");
    await add("member", "member");
    await add("lapsed", "member");
    await connection.query("UPDATE gyms SET member_count = 5 WHERE id = ?", [state.gym]);
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

  test("1. every owner route needs a valid session", async () => {
    for (const route of ["/api/owner/gyms", `/api/owner/gyms/${state.gym}/summary`, `/api/owner/gyms/${state.gym}/renewals`, `/api/owner/my-plan/${state.gym}`]) {
      assert.equal((await api("GET", route, null)).status, 401, route);
      assert.equal((await api("GET", route, "not-a-jwt")).status, 401, route);
    }
    assert.equal((await api("POST", `/api/owner/gyms/${state.gym}/renewals/${ids.member}`, null, { months: 1 })).status, 401);
  });

  test("2. the gym list holds only gyms the caller runs", async () => {
    const mine = await as("owner").get("/api/owner/gyms");
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.json.gyms.map((g) => [g.id, g.as]), [[state.gym, "owner"]]);
    assert.deepEqual((await as("admin").get("/api/owner/gyms")).json.gyms.map((g) => g.as), ["admin"]);
    for (const tag of ["coach", "member", "outsider", "platform"]) assert.deepEqual((await as(tag).get("/api/owner/gyms")).json.gyms, [], tag);
  });

  test("3. only the owner, gym admins and platform admins open the portal; others are refused", async () => {
    for (const tag of ["owner", "admin", "platform"]) {
      const res = await as(tag).get(`/api/owner/gyms/${state.gym}/summary`);
      assert.equal(res.status, 200, `${tag}: ${JSON.stringify(res.json)}`);
    }
    assert.equal((await as("platform").get(`/api/owner/gyms/${state.gym}/summary`)).json.gym.as, "platform");
    for (const tag of ["coach", "member"]) {
      const res = await as(tag).get(`/api/owner/gyms/${state.gym}/summary`);
      assert.equal(res.status, 403, tag);
      assert.equal(res.json.error, "Only this gym's owner and admins can open the owner portal.");
      assert.equal((await as(tag).get(`/api/owner/gyms/${state.gym}/renewals`)).status, 403, tag);
      assert.equal((await as(tag).post(`/api/owner/gyms/${state.gym}/renewals/${ids.member}`, { months: 1 })).status, 403, tag);
    }
    // A hidden gym looks missing to an outsider, and so does a gym that doesn't exist
    assert.equal((await as("outsider").get(`/api/owner/gyms/${state.gym}/summary`)).status, 404);
    assert.equal((await as("owner").get(`/api/owner/gyms/${crypto.randomUUID()}/summary`)).status, 404);
    assert.equal((await as("owner").get("/api/owner/gyms/not-a-uuid/summary")).status, 400);
    assert.equal((await as("owner").get("/api/owner/gyms/1%27%20OR%201%3D1/summary")).status, 400, "an injection attempt is just a bad id");
  });

  test("4. Home counts real rows: members, requests, trainers, events, posts, review, reports, invitations, team", async () => {
    await connection.query("INSERT INTO gym_members (gym_id, user_id, role, status) VALUES (?, ?, 'member', 'pending')", [state.gym, ids.outsider]);
    const date = await dayOffset(3);
    await connection.query(
      "INSERT INTO gym_events (gym_id, host_id, title, description, event_date, start_time, end_time, location, max_attendees) VALUES (?, ?, 'Deadlift clinic', 'Form check', ?, '07:00', '08:00', 'Main floor', 10)",
      [state.gym, ids.owner, date],
    );
    const post = (userId, status) => connection.query(
      "INSERT INTO community_posts (id, user_id, gym_id, review_status, body, category) VALUES (?, ?, ?, ?, 'Leg day', 'general')",
      [crypto.randomUUID(), userId, state.gym, status],
    );
    await post(ids.member, "published");
    await post(ids.lapsed, "pending");
    const [[reported]] = await connection.query("SELECT id FROM community_posts WHERE gym_id = ? AND review_status = 'published' LIMIT 1", [state.gym]);
    await connection.query("INSERT INTO community_reports (reporter_id, post_id, reason) VALUES (?, ?, 'Spam'), (?, ?, 'Rude')", [ids.lapsed, reported.id, ids.admin, reported.id]);
    await connection.query("INSERT INTO gym_invitations (gym_id, code, channel, contact, role, invited_by, expires_at) VALUES (?, ?, 'email', 'x@example.com', 'member', ?, NOW() + INTERVAL 7 DAY)", [state.gym, runId.toUpperCase().padEnd(10, "Q").slice(0, 10), ids.owner]);
    await connection.query("INSERT INTO trainer_profiles (user_id, title, specialties, bio) VALUES (?, 'Strength coach', '[\"strength\"]', 'Coaching')", [ids.coach]);
    await connection.query("INSERT INTO trainer_connections (trainer_id, client_id, status, responded_at) VALUES (?, ?, 'connected', NOW())", [ids.coach, ids.member]);

    const res = await as("owner").get(`/api/owner/gyms/${state.gym}/summary`);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const s = res.json;
    assert.deepEqual(s.stats, { members: 5, joinRequests: 1, upcomingEvents: 1, trainers: 1, postsThisWeek: 1, plan: "starter" });
    assert.equal(s.attention.joinRequests, 1);
    assert.equal(s.attention.postsToReview, 1);
    assert.equal(s.attention.reportedPosts, 1, "two reports on one post count as one reported post");
    assert.equal(s.attention.invitationsPending, 1);
    assert.equal(s.newMembers.length, 6);
    assert.equal(s.newMembers.at(-1).count, 4, "this month: admin, coach and two members (the owner isn't counted)");
    assert.deepEqual(s.coachingTeam.map((t) => [t.member.name, t.title, t.clients]), [["Cora Coach", "Strength coach", 1]]);
    assert.equal(Object.hasOwn(s.coachingTeam[0].member, "email"), false);
    assert.equal(s.nextEvent.title, "Deadlift clinic");
    assert.equal(s.nextEvent.date, date);
  });

  test("5. renewals: sorted by days left; extend an active package, restart an expired one, start one for a member without", async () => {
    const soon = await dayOffset(5);
    const past = await dayOffset(-10);
    const start = await dayOffset(-40);
    await connection.query(
      "INSERT INTO gym_member_plans (gym_id, user_id, plan_name, status, starts_on, ends_on) VALUES (?, ?, 'Unlimited', 'active', ?, ?), (?, ?, 'Unlimited', 'active', ?, ?)",
      [state.gym, ids.member, start, soon, state.gym, ids.lapsed, start, past],
    );
    const list = await as("admin").get(`/api/owner/gyms/${state.gym}/renewals`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.members.map((r) => [r.member.name, r.flag]), [
      ["Leo Lapsed", "expired"], ["Mira Member", "this_week"], ["Adam Admin", "none"], ["Cora Coach", "none"],
    ], "the owner isn't listed; no-package members come last");
    assert.equal(summaryOf(await as("owner").get(`/api/owner/gyms/${state.gym}/summary`)).membershipsExpired, 1);

    // Extend: +3 months from the current end
    const extended = await as("owner").post(`/api/owner/gyms/${state.gym}/renewals/${ids.member}`, { months: 3 });
    assert.equal(extended.status, 200, JSON.stringify(extended.json));
    const [memberPlan] = await plansOf(ids.member);
    assert.equal(extended.json.plan.endsOn, memberPlan.ends_on);
    assert.equal(memberPlan.starts_on, start, "an extension keeps the start date");
    assert.equal(extended.json.flag, "active");

    // Restart: an expired package runs from today
    const restarted = await as("admin").post(`/api/owner/gyms/${state.gym}/renewals/${ids.lapsed}`, { months: 1 });
    assert.equal(restarted.status, 200);
    const [lapsedPlan] = await plansOf(ids.lapsed);
    assert.equal(lapsedPlan.starts_on, await dayOffset(0));
    assert.equal(lapsedPlan.status, "active");
    assert.ok(restarted.json.plan.daysLeft >= 27 && restarted.json.plan.daysLeft <= 31, `about a month: ${restarted.json.plan.daysLeft}`);

    // A member without a package gets one named after the gym's first tier
    const fresh = await as("platform").post(`/api/owner/gyms/${state.gym}/renewals/${ids.coach}`, { months: 1 });
    assert.equal(fresh.status, 200, JSON.stringify(fresh.json));
    assert.deepEqual((await plansOf(ids.coach)).map((p) => [p.plan_name, p.status]), [["Unlimited", "active"]]);
  });

  test("6. renewal input is checked, and the owner, outsiders and pending people can't be renewed", async () => {
    const renew = (target, body) => as("owner").post(`/api/owner/gyms/${state.gym}/renewals/${target}`, body);
    for (const body of [{}, { months: 2 }, { months: "1" }, { months: 12 }, { months: 1, price: 0 }, [1]]) {
      assert.equal((await renew(ids.member, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await renew(ids.owner, { months: 1 })).status, 400);
    assert.equal((await renew(ids.outsider, { months: 1 })).status, 404, "a pending request isn't an active member");
    assert.equal((await renew(ids.platform, { months: 1 })).status, 404, "not a member at all");
    assert.equal((await renew("user_' OR '1'='1", { months: 1 })).status, 400);
    assert.equal((await plansOf(ids.outsider)).length, 0);
  });

  test("7. a member reads only their own package", async () => {
    const mine = await as("member").get(`/api/owner/my-plan/${state.gym}`);
    assert.equal(mine.status, 200);
    assert.equal(mine.json.plan.name, "Unlimited");
    assert.equal(mine.json.flag, "active");
    const none = await as("outsider").get(`/api/owner/my-plan/${state.gym}`);
    assert.deepEqual(none.json, { plan: null, flag: "none" }, "a pending request has no package to show");
  });
});

function summaryOf(res) {
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json.attention;
}
