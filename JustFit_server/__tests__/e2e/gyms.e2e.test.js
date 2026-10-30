// Gym communities end to end: test accounts in eato_test against the real Express
// server and the isolated `eato_test` database. A platform admin creates gyms; an owner, a
// gym admin and two members use them; an outsider tries what they shouldn't.
// Covers: creating gyms, visibility (public, private, hidden), joining (instant, request and
// approval, invite codes), member management with the owner protected, gym posts and their
// review, the comment setting, announcements, events with capacity, invitations, and the
// attack paths: no session, wrong role, another gym's ids, spoofed fields, SQL in a search.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const CLEANUP_TABLES = ["gym_event_rsvps", "gym_events", "gym_announcements", "gym_invitations", "community_comments", "community_post_likes",
  "community_post_media", "community_reports", "community_posts", "gym_members", "whatsapp_agent_settings", "whatsapp_connections", "gym_visits", "gym_scan_failures", "gym_notices", "gym_assistant_questions", "gyms", "community_media"];

describe("gyms e2e: communities, roles, joining, posts, events and invitations", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
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
    del: (route) => api("DELETE", route, tokens[tag]),
  });
  const newIdentity = async (tag, role) => {
    const identity = await testAccounts.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const memberRow = async (gymId, tag) => (await connection.query("SELECT role, status FROM gym_members WHERE gym_id = ? AND user_id = ?", [gymId, ids[tag]]))[0][0] ?? null;
  const count = async (gymId) => (await connection.query("SELECT member_count FROM gyms WHERE id = ?", [gymId]))[0][0].member_count;
  const inFuture = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      await newIdentity("platform", "admin");
      for (const tag of ["owner", "admin", "regular", "member", "outsider"]) await newIdentity(tag);
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    const names = { platform: "Platform Admin", owner: "Omar Owner", admin: "Anita Admin", regular: "Rita Regular", member: "Manu Member", outsider: "Olga Outsider" };
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [ids[tag], identities[tag].emailAddress, names[tag], tag === "platform" ? "admin" : "user"]);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of CLEANUP_TABLES) await connection.query("DELETE FROM `" + table + "`");
        await db.deleteUsers(connection, Object.values(ids));
      } catch (error) { problems.push(`rows: ${error.code}`); }
    }
    if (testAccounts) for (const tag of Object.keys(identities)) {
      try {
        if (identities[tag].sessionId) await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. every gym route needs a valid session", async () => {
    const fake = crypto.randomUUID();
    for (const token of [null, "not-a-jwt"]) {
      for (const [method, route] of [["GET", "/api/gyms"], ["POST", "/api/gyms"], ["GET", `/api/gyms/${fake}`], ["POST", `/api/gyms/${fake}/join`], ["POST", "/api/gyms/join-by-code"], ["GET", `/api/gyms/${fake}/events`]]) {
        assert.equal((await api(method, route, token, method === "POST" ? {} : undefined)).status, 401, `${method} ${route}`);
      }
    }
  });

  test("2. only platform admins create gyms; the owner is found by email and becomes the owner", async () => {
    const body = { name: "Iron Temple", tagline: "Lift heavy", location: "Indiranagar", ownerEmail: identities.owner.emailAddress.toUpperCase() };
    assert.equal((await as("owner").post("/api/gyms", body)).status, 403, "a member can't create a gym");
    const created = await as("platform").post("/api/gyms", body);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    state.gym = created.json.gym.id;
    assert.deepEqual(await memberRow(state.gym, "owner"), { role: "owner", status: "active" });
    assert.equal(await count(state.gym), 1);
    assert.equal((await as("platform").post("/api/gyms", body)).status, 409, "names are unique");
    assert.equal((await as("platform").post("/api/gyms", { ...body, name: "Ghost Gym", ownerEmail: "nobody@example.com" })).status, 404);
    assert.equal((await as("platform").post("/api/gyms", { ...body, name: "Spoof", ownerId: ids.outsider })).status, 400, "the owner can't be named by id");
    // A private gym and a hidden one, both owned by the same owner
    state.private = (await as("platform").post("/api/gyms", { name: "Quiet Strength", ownerEmail: identities.owner.emailAddress, visibility: "private" })).json.gym.id;
    state.hidden = (await as("platform").post("/api/gyms", { name: "Secret Barbell Club", ownerEmail: identities.owner.emailAddress, visibility: "hidden" })).json.gym.id;
  });

  test("3. public gyms are open; private ones keep content for members; hidden ones look missing", async () => {
    const list = (await as("outsider").get("/api/gyms")).json;
    assert.deepEqual(list.mine, []);
    assert.deepEqual(list.explore.map((g) => g.name).sort(), ["Iron Temple", "Quiet Strength"], "hidden gyms aren't listed");
    assert.equal(list.explore.find((g) => g.name === "Quiet Strength").joinMode, "request");
    assert.equal((await as("outsider").get(`/api/gyms/${state.hidden}`)).status, 404);
    assert.equal((await as("outsider").get(`/api/gyms/${state.hidden}/posts`)).status, 404);
    // Platform admins see every gym, hidden ones included; members can't use that listing
    assert.equal((await as("outsider").get("/api/gyms/admin/all")).status, 403);
    const all = await as("platform").get("/api/gyms/admin/all");
    assert.equal(all.status, 200);
    assert.deepEqual(all.json.gyms.map((g) => g.name).sort(), ["Iron Temple", "Quiet Strength", "Secret Barbell Club"]);
    assert.equal((await as("outsider").get(`/api/gyms/${state.private}`)).status, 200, "a private gym's About is visible");
    assert.equal((await as("outsider").get(`/api/gyms/${state.private}/posts`)).status, 403);
    assert.equal((await as("outsider").get(`/api/gyms/${state.private}/members`)).status, 403);
    assert.equal((await as("outsider").get(`/api/gyms/${state.gym}/posts`)).status, 200, "a public gym's feed is readable");
    const ownerView = (await as("owner").get(`/api/gyms/${state.gym}`)).json.gym;
    assert.match(ownerView.inviteCode, /^[A-Z2-9]{8}$/);
    assert.equal(ownerView.can.manage, true);
    assert.equal((await as("outsider").get(`/api/gyms/${state.gym}`)).json.gym.inviteCode, null, "the code is for staff");
    // SQL and LIKE wildcards in a search are plain text
    for (const term of ["' OR 1=1 --", "%", "_"]) {
      const result = await as("outsider").get(`/api/gyms?search=${encodeURIComponent(term)}`);
      assert.equal(result.status, 200, term);
      assert.equal(result.json.explore.length, 0, term);
    }
  });

  test("4. joining: instant in an open gym, a request in a private one, approved by an admin", async () => {
    for (const tag of ["admin", "regular", "member"]) {
      const joined = await as(tag).post(`/api/gyms/${state.gym}/join`);
      assert.equal(joined.status, 200, JSON.stringify(joined.json));
      assert.deepEqual(joined.json.gym.membership, { role: "member", status: "active" });
    }
    assert.equal((await as("member").post(`/api/gyms/${state.gym}/join`)).status, 200, "joining twice changes nothing");
    assert.equal(await count(state.gym), 4);
    // Roles: the owner makes an admin; there is no trainer rank to give
    assert.equal((await as("admin").patch(`/api/gyms/${state.gym}/members/${ids.regular}`, { role: "admin" })).status, 403, "a member can't change roles");
    assert.equal((await as("owner").patch(`/api/gyms/${state.gym}/members/${ids.admin}`, { role: "admin" })).status, 200);
    assert.equal((await as("owner").patch(`/api/gyms/${state.gym}/members/${ids.regular}`, { role: "trainer" })).status, 400, "the trainer rank is gone");
    assert.equal((await as("admin").patch(`/api/gyms/${state.gym}/members/${ids.member}`, { role: "admin" })).status, 403, "only the owner makes admins");
    // A private gym: a request waits; a member can't see it until approved
    const asked = await as("member").post(`/api/gyms/${state.private}/join`);
    assert.deepEqual(asked.json.gym.membership, { role: "member", status: "pending" });
    assert.equal((await as("member").get(`/api/gyms/${state.private}/posts`)).status, 403, "a request isn't membership");
    assert.equal((await as("member").get(`/api/gyms/${state.private}/members?status=pending`)).status, 403, "only admins see requests");
    const pending = await as("owner").get(`/api/gyms/${state.private}/members?status=pending`);
    assert.deepEqual(pending.json.members.map((m) => m.member.id), [ids.member]);
    assert.equal(await count(state.private), 1);
    assert.equal((await as("owner").patch(`/api/gyms/${state.private}/members/${ids.member}`, { status: "active" })).status, 200);
    assert.equal(await count(state.private), 2);
    assert.equal((await as("member").get(`/api/gyms/${state.private}/posts`)).status, 200);
    // Withdrawing a request
    await as("outsider").post(`/api/gyms/${state.private}/join`);
    assert.equal((await as("outsider").del(`/api/gyms/${state.private}/join`)).status, 200);
    assert.equal(await memberRow(state.private, "outsider"), null);
  });

  test("5. the owner is protected; members can't manage; a gym's admin has no power in another gym", async () => {
    assert.equal((await as("admin").patch(`/api/gyms/${state.gym}/members/${ids.owner}`, { status: "suspended" })).status, 403);
    assert.equal((await as("admin").del(`/api/gyms/${state.gym}/members/${ids.owner}`)).status, 403);
    assert.equal((await as("owner").del(`/api/gyms/${state.gym}/join`)).status, 403, "the owner can't leave");
    assert.equal((await as("member").patch(`/api/gyms/${state.gym}/settings`, { whoCanPost: "admins" })).status, 403);
    assert.equal((await as("member").patch(`/api/gyms/${state.gym}`, { tagline: "hijacked" })).status, 403);
    assert.equal((await as("member").del(`/api/gyms/${state.gym}/members/${ids.regular}`)).status, 403);
    // Iron Temple's admin isn't a member of Quiet Strength
    assert.equal((await as("admin").patch(`/api/gyms/${state.private}/members/${ids.member}`, { status: "suspended" })).status, 403);
    assert.equal((await as("admin").patch(`/api/gyms/${state.private}/settings`, { visibility: "public" })).status, 403);
    assert.equal((await as("admin").patch(`/api/gyms/${state.hidden}/settings`, { visibility: "public" })).status, 404, "a hidden gym looks missing");
    // Spoofed and unknown fields are refused
    assert.equal((await as("owner").patch(`/api/gyms/${state.gym}/settings`, { member_count: 9999 })).status, 400);
    assert.equal((await as("owner").patch(`/api/gyms/${state.gym}`, { inviteCode: "AAAAAAAA" })).status, 400);
    assert.equal(await count(state.gym), 4);
    // The admin edits the profile; a suspended member loses access and can't rejoin
    const edited = await as("admin").patch(`/api/gyms/${state.gym}`, { tagline: "Lift heavy, lift often", facilities: ["Free weights", "Sauna"] });
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
    assert.deepEqual(edited.json.gym.facilities, ["Free weights", "Sauna"]);
    await as("outsider").post(`/api/gyms/${state.gym}/join`);
    assert.equal((await as("admin").patch(`/api/gyms/${state.gym}/members/${ids.outsider}`, { status: "suspended" })).status, 200);
    assert.equal((await as("outsider").post(`/api/gyms/${state.gym}/join`)).status, 403);
    assert.equal((await as("outsider").post(`/api/gyms/${state.gym}/posts`, { body: "still here" })).status, 403);
    assert.equal((await as("admin").del(`/api/gyms/${state.gym}/members/${ids.outsider}`)).status, 200);
    assert.equal(await count(state.gym), 4);
  });

  test("6. gym posts stay in the gym; private gym posts are hidden from outsiders everywhere", async () => {
    const posted = await as("member").post(`/api/gyms/${state.gym}/posts`, { body: "PR on squats today", category: "progress" });
    assert.equal(posted.status, 201, JSON.stringify(posted.json));
    state.gymPost = posted.json.post.id;
    assert.equal(posted.json.post.gymId, state.gym);
    assert.equal(posted.json.post.reviewStatus, "published");
    const gymFeed = (await as("outsider").get(`/api/gyms/${state.gym}/posts`)).json.posts.map((p) => p.id);
    assert.ok(gymFeed.includes(state.gymPost), "a public gym's posts are readable");
    const mainFeed = (await as("member").get("/api/community/feed")).json.posts.map((p) => p.id);
    assert.equal(mainFeed.includes(state.gymPost), false, "gym posts never reach the main feed");
    const profile = (await as("outsider").get(`/api/community/profiles/${ids.member}/posts`)).json.posts.map((p) => p.id);
    assert.equal(profile.includes(state.gymPost), false, "nor a member's profile");
    // A private gym's post: members only, through every route
    const secret = (await as("member").post(`/api/gyms/${state.private}/posts`, { body: "members only" })).json.post.id;
    assert.equal((await as("outsider").get(`/api/community/posts/${secret}`)).status, 404);
    assert.equal((await as("outsider").post(`/api/community/posts/${secret}/like`)).status, 404);
    assert.equal((await as("outsider").post(`/api/community/posts/${secret}/comments`, { body: "hi" })).status, 404);
    assert.equal((await as("owner").get(`/api/community/posts/${secret}`)).status, 200);
    // Outsiders can't post into a gym; the gym comes from the route, never the body
    assert.equal((await as("outsider").post(`/api/gyms/${state.gym}/posts`, { body: "drive-by" })).status, 403);
    assert.equal((await as("member").post(`/api/gyms/${state.gym}/posts`, { body: "x", gymId: state.private })).status, 400);
    assert.equal((await as("member").post(`/api/gyms/${state.gym}/posts`, { body: "x", userId: ids.owner })).status, 400);
  });

  test("7. post moderation holds members' posts for staff; the comment setting is enforced", async () => {
    for (const old of [{ whoCanPost: "trainers" }, { whoCanComment: "trainers" }, { whoCanCreateEvents: "trainers" }]) {
      assert.equal((await as("owner").patch(`/api/gyms/${state.gym}/settings`, old)).status, 400, JSON.stringify(old));
    }
    assert.equal((await as("owner").patch(`/api/gyms/${state.gym}/settings`, { postModeration: true, whoCanComment: "off" })).status, 200);
    const held = await as("member").post(`/api/gyms/${state.gym}/posts`, { body: "Is my deadlift form ok?" });
    assert.equal(held.json.post.reviewStatus, "pending");
    const heldId = held.json.post.id;
    const seenBy = async (tag) => (await as(tag).get(`/api/gyms/${state.gym}/posts`)).json.posts.some((p) => p.id === heldId);
    assert.equal(await seenBy("member"), true, "the author sees it");
    assert.equal(await seenBy("admin"), true, "staff see it");
    assert.equal(await seenBy("outsider"), false, "others don't");
    assert.equal((await as("outsider").get(`/api/community/posts/${heldId}`)).status, 404);
    assert.equal((await as("member").post(`/api/gyms/${state.gym}/posts/${heldId}/approve`)).status, 403, "members can't approve");
    assert.equal((await as("admin").post(`/api/gyms/${state.gym}/posts/${heldId}/approve`)).status, 200);
    assert.equal(await seenBy("outsider"), true, "approved posts show");
    const staffPost = await as("admin").post(`/api/gyms/${state.gym}/posts`, { body: "Mobility tip" });
    assert.equal(staffPost.json.post.reviewStatus, "published", "staff skip review");
    // whoCanComment = off: only admins can still reply
    assert.equal((await as("member").post(`/api/community/posts/${heldId}/comments`, { body: "me too" })).status, 403);
    assert.equal((await as("admin").post(`/api/community/posts/${heldId}/comments`, { body: "Looks solid" })).status, 201);
    // Moderation actions only reach this gym's posts
    assert.equal((await as("owner").post(`/api/gyms/${state.hidden}/posts/${heldId}/approve`)).status, 404, "another gym's post id");
    assert.equal((await as("member").del(`/api/gyms/${state.gym}/posts/${heldId}`)).status, 403);
    assert.equal((await as("admin").del(`/api/gyms/${state.gym}/posts/${heldId}`)).status, 200);
    assert.equal((await as("outsider").get(`/api/community/posts/${heldId}`)).status, 404, "removed");
    await as("owner").patch(`/api/gyms/${state.gym}/settings`, { postModeration: false, whoCanComment: "members" });
  });

  test("8. announcements: admins post them, pinned first; members can only read", async () => {
    assert.equal((await as("member").post(`/api/gyms/${state.gym}/announcements`, { title: "Free pizza", body: "Not really" })).status, 403);
    const first = await as("admin").post(`/api/gyms/${state.gym}/announcements`, { title: "New squat racks", body: "Two more racks arrive Monday." });
    assert.equal(first.status, 201);
    const pinned = await as("owner").post(`/api/gyms/${state.gym}/announcements`, { title: "Diwali hours", body: "Closed on the 1st.", pinned: true });
    const list = (await as("member").get(`/api/gyms/${state.gym}/announcements`)).json.announcements;
    assert.deepEqual(list.map((a) => a.id), [pinned.json.announcement.id, first.json.announcement.id]);
    assert.equal((await as("member").patch(`/api/gyms/${state.gym}/announcements/${first.json.announcement.id}`, { pinned: true })).status, 403);
    assert.equal((await as("admin").patch(`/api/gyms/${state.private}/announcements/${first.json.announcement.id}`, { pinned: true })).status, 403, "not their gym");
    assert.equal((await as("owner").patch(`/api/gyms/${state.private}/announcements/${first.json.announcement.id}`, { pinned: true })).status, 404, "another gym's announcement");
    assert.equal((await as("admin").del(`/api/gyms/${state.gym}/announcements/${first.json.announcement.id}`)).status, 200);
  });

  test("9. events: who may create follows the setting; capacity holds even when RSVPs race", async () => {
    const event = { title: "Deadlift clinic", description: "Form check with Omar", date: inFuture(3), startTime: "07:00", endTime: "08:00", location: "Main floor", maxAttendees: 1 };
    assert.equal((await as("member").post(`/api/gyms/${state.gym}/events`, event)).status, 403, "members can't create events by default");
    const created = await as("owner").post(`/api/gyms/${state.gym}/events`, event);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const eventId = created.json.event.id;
    assert.equal((await as("owner").post(`/api/gyms/${state.gym}/events`, { ...event, endTime: "06:00" })).status, 400);
    assert.equal((await as("owner").post(`/api/gyms/${state.gym}/events`, { ...event, hostId: ids.owner })).status, 400);
    // Two members race for the last place: exactly one gets it
    const [a, b] = await Promise.all([as("member").post(`/api/gyms/${state.gym}/events/${eventId}/rsvp`), as("admin").post(`/api/gyms/${state.gym}/events/${eventId}/rsvp`)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `one place, two members: ${a.status}/${b.status}`);
    const [[row]] = await connection.query("SELECT attendee_count, (SELECT COUNT(*) FROM gym_event_rsvps WHERE event_id = ?) AS rsvps FROM gym_events WHERE id = ?", [eventId, eventId]);
    assert.equal(row.attendee_count, 1);
    assert.equal(row.rsvps, 1);
    const winner = a.status === 200 ? "member" : "admin";
    const loser = winner === "member" ? "admin" : "member";
    assert.equal((await as(winner).post(`/api/gyms/${state.gym}/events/${eventId}/rsvp`)).status, 200, "a repeat RSVP changes nothing");
    assert.equal((await as(loser).post(`/api/gyms/${state.gym}/events/${eventId}/rsvp`)).json?.error, "This event is full.");
    // Cancelling frees the place
    assert.equal((await as(winner).del(`/api/gyms/${state.gym}/events/${eventId}/rsvp`)).json.event.attendeeCount, 0);
    assert.equal((await as(loser).post(`/api/gyms/${state.gym}/events/${eventId}/rsvp`)).json.event.going, true);
    // Outsiders can read a public gym's events but not RSVP
    assert.equal((await as("outsider").get(`/api/gyms/${state.gym}/events`)).status, 200);
    assert.equal((await as("outsider").post(`/api/gyms/${state.gym}/events/${eventId}/rsvp`)).status, 403);
    // The event belongs to this gym only
    assert.equal((await as("owner").post(`/api/gyms/${state.private}/events/${eventId}/rsvp`)).status, 404);
    // Old events fall off the list after 60 days; upcoming ones always show
    await connection.query("INSERT INTO gym_events (id, gym_id, host_id, title, description, event_date, start_time, end_time, location) VALUES (UUID(), ?, ?, 'Ancient history', 'x', CURRENT_DATE - INTERVAL 90 DAY, '07:00', '08:00', 'Floor')", [state.gym, ids.owner]);
    const listed = (await as("member").get(`/api/gyms/${state.gym}/events`)).json.events.map((e) => e.title);
    assert.ok(listed.includes("Deadlift clinic") && !listed.includes("Ancient history"), JSON.stringify(listed));
    assert.equal((await as("member").del(`/api/gyms/${state.gym}/events/${eventId}`)).status, 403, "only the host or an admin cancels");
    assert.equal((await as("admin").del(`/api/gyms/${state.gym}/events/${eventId}`)).status, 200, "an admin cancels it");
  });

  test("10. invitations: admins record them for members, codes join, revoked and expired codes fail", async () => {
    assert.equal((await as("member").post(`/api/gyms/${state.gym}/invitations`, { channel: "link" })).status, 403);
    assert.equal((await as("admin").post(`/api/gyms/${state.gym}/invitations`, { channel: "link", role: "trainer" })).status, 400, "invitations are for members only");
    const byEmail = await as("admin").post(`/api/gyms/${state.gym}/invitations`, { channel: "email", contact: "friend@example.com" });
    assert.equal(byEmail.status, 201);
    assert.equal(byEmail.json.invitation.status, "pending");
    // An invitation to the hidden gym: the outsider can preview and accept it
    const toHidden = await as("owner").post(`/api/gyms/${state.hidden}/invitations`, { channel: "qr" });
    const code = toHidden.json.invitation.code;
    const preview = await as("outsider").get(`/api/gyms/codes/${code.toLowerCase()}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.json.gym.name, "Secret Barbell Club");
    assert.equal(preview.json.role, "member");
    const accepted = await as("outsider").post("/api/gyms/join-by-code", { code });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    assert.deepEqual(accepted.json.gym.membership, { role: "member", status: "active" });
    assert.equal((await as("outsider").post("/api/gyms/join-by-code", { code })).status, 404, "an accepted invitation is used up");
    // Revoked and expired codes
    const revokeMe = (await as("owner").post(`/api/gyms/${state.gym}/invitations`, { channel: "link" })).json.invitation;
    assert.equal((await as("member").post(`/api/gyms/${state.gym}/invitations/${revokeMe.id}/revoke`)).status, 403);
    assert.equal((await as("owner").post(`/api/gyms/${state.gym}/invitations/${revokeMe.id}/revoke`)).json.invitation.status, "revoked");
    assert.equal((await as("member").post("/api/gyms/join-by-code", { code: revokeMe.code })).status, 404);
    const expireMe = (await as("owner").post(`/api/gyms/${state.gym}/invitations`, { channel: "link" })).json.invitation;
    await connection.query("UPDATE gym_invitations SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?", [expireMe.id]);
    assert.equal((await as("outsider").get(`/api/gyms/codes/${expireMe.code}`)).status, 404);
    const list = (await as("owner").get(`/api/gyms/${state.gym}/invitations`)).json.invitations;
    assert.equal(list.find((i) => i.id === expireMe.id).status, "expired");
    assert.equal((await as("owner").post(`/api/gyms/${state.gym}/invitations/${expireMe.id}/renew`)).json.invitation.status, "pending", "renewing gives it new days");
    assert.equal((await as("regular").post(`/api/gyms/${state.gym}/invitations/${expireMe.id}/renew`)).status, 403, "only admins renew");
    assert.equal((await as("owner").post(`/api/gyms/${state.private}/invitations/${expireMe.id}/revoke`)).status, 404, "another gym's invitation");
    // The gym's own code joins a private gym without approval (it is an invitation)
    const privateCode = (await as("owner").get(`/api/gyms/${state.private}`)).json.gym.inviteCode;
    const viaCode = await as("regular").post("/api/gyms/join-by-code", { code: privateCode });
    assert.deepEqual(viaCode.json.gym.membership, { role: "member", status: "active" });
    for (const bad of ["x", "' OR 1=1 --", "AAAAAAAA"]) {
      assert.ok([400, 404].includes((await as("member").post("/api/gyms/join-by-code", { code: bad })).status), bad);
    }
    assert.equal((await as("member").post("/api/gyms/join-by-code", { code: privateCode, gymId: state.hidden })).status, 400, "unexpected fields");
    // Admins see every invitation's code (each one grants the member role); members see none
    const ownerInvite = (await as("owner").post(`/api/gyms/${state.gym}/invitations`, { channel: "link" })).json.invitation;
    const seenByAdmin = (await as("admin").get(`/api/gyms/${state.gym}/invitations`)).json.invitations;
    assert.equal(seenByAdmin.find((i) => i.id === ownerInvite.id).code, ownerInvite.code);
    assert.equal(seenByAdmin.find((i) => i.id === byEmail.json.invitation.id).code, byEmail.json.invitation.code, "their own invitation's code is shown");
    assert.equal((await as("member").get(`/api/gyms/${state.gym}/invitations`)).status, 403);
    // Replacing a leaked gym code: admins only; the old code stops working at once
    const oldCode = (await as("owner").get(`/api/gyms/${state.gym}`)).json.gym.inviteCode;
    assert.equal((await as("regular").post(`/api/gyms/${state.gym}/code/rotate`)).status, 403);
    const rotated = await as("admin").post(`/api/gyms/${state.gym}/code/rotate`);
    assert.equal(rotated.status, 200, JSON.stringify(rotated.json));
    assert.match(rotated.json.gym.inviteCode, /^[A-Z2-9]{8}$/);
    assert.notEqual(rotated.json.gym.inviteCode, oldCode);
    assert.equal((await as("outsider").get(`/api/gyms/codes/${oldCode}`)).status, 404, "the old code is dead");
    assert.equal((await as("outsider").get(`/api/gyms/codes/${rotated.json.gym.inviteCode}`)).json.gym.id, state.gym);
  });

  test("11. a gym's logo must be the editor's own upload, and loads for anyone who can see the gym", async () => {
    const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const mine = (await as("owner").post("/api/community/media", { data: TINY_PNG, mediaType: "image/png" })).json.media.id;
    const someoneElses = (await as("member").post("/api/community/media", { data: TINY_PNG, mediaType: "image/png" })).json.media.id;
    assert.equal((await as("owner").patch(`/api/gyms/${state.hidden}`, { logoMediaId: someoneElses })).status, 400);
    const set = await as("owner").patch(`/api/gyms/${state.hidden}`, { logoMediaId: mine });
    assert.equal(set.status, 200);
    assert.equal(set.json.gym.logoUrl, `/api/media/${mine}`);
    assert.equal((await as("outsider").get(`/api/media/${mine}`)).status, 200, "the outsider is now a member of the hidden gym");
    assert.equal((await as("member").get(`/api/media/${mine}`)).status, 404, "non-members can't load a hidden gym's logo");
  });

  // Phone sign-in verifies no email, so an email invitation unlocks no "invited" banner for
  // anyone (it fails closed rather than trusting an unproved address); it is still recorded,
  // and its code and link work exactly as before.
  test("12. email invitations: recorded but no banner without a verified email; the code still previews and joins", async () => {
    const gym = (await as("platform").post("/api/gyms", { name: "Banner Gym", ownerEmail: identities.owner.emailAddress, visibility: "private" })).json.gym.id;
    const invite = async (contact) => (await as("owner").post(`/api/gyms/${gym}/invitations`, { channel: "email", contact })).json.invitation;
    const mine = async (tag) => (await as(tag).get("/api/gyms/invitations/mine")).json.invitations;
    const sent = await invite(identities.outsider.emailAddress.toUpperCase()); // stored lowercased
    await invite("someone-else@example.com");
    assert.deepEqual(await mine("outsider"), [], "no verified email, no banner");
    assert.deepEqual(await mine("member"), []);
    const [[stored]] = await connection.query("SELECT channel, contact FROM gym_invitations WHERE id = ?", [sent.id]);
    assert.deepEqual({ ...stored }, { channel: "email", contact: identities.outsider.emailAddress.toLowerCase() }, "recorded, lowercased");
    assert.equal((await api("GET", "/api/gyms/invitations/mine", null)).status, 401);
    // Revoked and expired invitations disappear
    const revoked = await invite(identities.outsider.emailAddress);
    await as("owner").post(`/api/gyms/${gym}/invitations/${revoked.id}/revoke`);
    const expired = await invite(identities.outsider.emailAddress);
    await connection.query("UPDATE gym_invitations SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?", [expired.id]);
    assert.deepEqual(await mine("outsider"), []);
    // The invitation screen's preview names who sent it; a gym's own code has no sender
    const preview = (await as("outsider").get(`/api/gyms/codes/${sent.code}`)).json;
    assert.deepEqual([preview.gym.name, preview.role, preview.invitedBy.name], ["Banner Gym", "member", "Omar Owner"]);
    assert.deepEqual(Object.keys(preview.invitedBy).sort(), ["id", "initial", "name"], "only the public member summary: no email, phone or role");
    assert.equal((await as("outsider").get(`/api/gyms/codes/${revoked.code}`)).status, 404, "a revoked code reveals nothing, not even who sent it");
    assert.equal((await as("outsider").get(`/api/gyms/codes/${expired.code}`)).status, 404);
    const ownCode = (await as("owner").get(`/api/gyms/${gym}`)).json.gym.inviteCode;
    assert.equal((await as("outsider").get(`/api/gyms/codes/${ownCode}`)).json.invitedBy, null);
    // Accepting it makes the outsider a member, and the banner goes
    assert.equal((await as("outsider").post("/api/gyms/join-by-code", { code: sent.code })).status, 200);
    assert.deepEqual(await mine("outsider"), []);
  });

  test("13. the gym page's extras: friend state on members, one event with its attendees, authors' gym roles", async () => {
    const gym = (await as("platform").post("/api/gyms", { name: "Extras Gym", ownerEmail: identities.owner.emailAddress, visibility: "private", memberApproval: false })).json.gym.id;
    const code = (await as("owner").get(`/api/gyms/${gym}`)).json.gym.inviteCode;
    assert.equal((await as("member").post("/api/gyms/join-by-code", { code })).status, 200);
    // Owner and member become friends; the outsider stays out of this private gym
    await db.befriend(connection, ids.owner, ids.member);
    const people = (await as("member").get(`/api/gyms/${gym}/members`)).json.members;
    const owner = people.find((row) => row.member.id === ids.owner);
    const self = people.find((row) => row.member.id === ids.member);
    assert.deepEqual([owner.friendState, self.friendState, self.isMe], ["friends", "none", true]);
    assert.equal(Object.hasOwn(owner, "title"), false, "no trainer title any more");
    assert.equal(Object.hasOwn(owner.member, "email"), false);

    const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const event = (await as("owner").post(`/api/gyms/${gym}/events`, { title: "Open mat", description: "Bring a towel.", date, startTime: "07:00", endTime: "08:00", location: "Main floor", maxAttendees: 3 })).json.event;
    await as("member").post(`/api/gyms/${gym}/events/${event.id}/rsvp`);
    const asMember = (await as("member").get(`/api/gyms/${gym}/events/${event.id}`)).json.event;
    assert.deepEqual([asMember.attendees.map((m) => m.id), asMember.canCancel, asMember.going], [[ids.member], false, true]);
    assert.equal((await as("owner").get(`/api/gyms/${gym}/events/${event.id}`)).json.event.canCancel, true, "the host can cancel");
    assert.equal((await as("outsider").get(`/api/gyms/${gym}/events/${event.id}`)).status, 403, "a private gym's event is for members");
    assert.equal((await as("member").get(`/api/gyms/${state.gym}/events/${event.id}`)).status, 404, "an event is found only under its own gym");
    assert.equal((await as("member").get(`/api/gyms/${gym}/events/not-an-id`)).status, 400);
    const listed = (await as("member").get(`/api/gyms/${gym}/events`)).json.events.find((e) => e.id === event.id);
    assert.deepEqual(listed.attendeesPreview.map((m) => m.id), [ids.member]);

    await as("owner").post(`/api/gyms/${gym}/posts`, { body: "Welcome to Extras", category: "general" });
    const posts = (await as("member").get(`/api/gyms/${gym}/posts`)).json.posts;
    assert.equal(posts[0].authorRole, "owner");
  });
});
