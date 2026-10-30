// Friendships end to end: test accounts in justfit_test against the real Express server
// and the isolated `justfit_test` database. Covers search and suggestions, request → accept,
// cancel, decline (with its cool-down), remove, and blocking; that messaging stays locked
// until a request is accepted; and the attack paths: no session, answering a request meant
// for someone else, spoofed ids in the body, malformed and unknown ids, SQL in the search.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const { pairOf } = require("../../community/friendRules.js");

const CLEANUP_TABLES = ["messages", "conversation_members", "conversations", "community_friendships", "community_blocks", "community_profiles"];

describe("community friends e2e: requests, answers, removal and the messaging lock", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const ids = {};
  const tokens = {};

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const newIdentity = async (tag) => {
    const identity = await testAccounts.createIdentity(runId, tag, {});
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const stateBetween = async (viewer, other) => (await api("GET", `/api/community/profiles/${ids[other]}`, tokens[viewer])).json.profile.friendState;
  const pairRow = async (a, b) => {
    const [low, high] = pairOf(ids[a], ids[b]);
    const [rows] = await connection.query("SELECT requester_id, status FROM community_friendships WHERE user_low = ? AND user_high = ?", [low, high]);
    return rows[0] ? { ...rows[0] } : null;
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const tag of ["a", "b", "c"]) await newIdentity(tag);
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    const names = { a: "Asha Rao", b: "Bilal Khan", c: "Chitra Iyer" };
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user') ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [ids[tag], identities[tag].emailAddress, names[tag]]);
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

  test("1. every friends route needs a valid session", async () => {
    const someone = ids.b;
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      for (const [method, route] of [
        ["GET", "/api/community/friends"], ["GET", "/api/community/friends/requests"], ["GET", "/api/community/friends/search?search=a"],
        ["POST", `/api/community/friends/${someone}/request`], ["DELETE", `/api/community/friends/${someone}/request`],
        ["POST", `/api/community/friends/${someone}/accept`], ["POST", `/api/community/friends/${someone}/decline`], ["DELETE", `/api/community/friends/${someone}`],
      ]) {
        assert.equal((await api(method, route, token)).status, 401, `${method} ${route}`);
      }
    }
  });

  test("2. search finds members by name and leaves out yourself; suggestions skip open requests", async () => {
    const search = await api("GET", "/api/community/friends/search?search=asha", tokens.b);
    assert.equal(search.status, 200);
    assert.deepEqual(search.json.members.map((m) => m.member.id), [ids.a]);
    assert.deepEqual(search.json.members[0], { member: { id: ids.a, name: "Asha Rao", initial: "A" }, bio: null, friendState: "none" });
    assert.equal(Object.hasOwn(search.json.members[0].member, "email"), false, "no email");
    // The member's own bio shows under their name (the same line their profile shows)
    assert.equal((await api("PATCH", "/api/community/me", tokens.a, { bio: "Morning lifter" })).status, 200);
    assert.equal((await api("GET", "/api/community/friends/search?search=asha", tokens.b)).json.members[0].bio, "Morning lifter");
    assert.equal((await api("PATCH", "/api/community/me", tokens.a, { bio: "" })).status, 200);
    const suggested = await api("GET", "/api/community/friends/search", tokens.a);
    assert.deepEqual(suggested.json.members.map((m) => m.member.id).sort(), [ids.b, ids.c].sort(), "everyone but me");
    // SQL and LIKE wildcards in the search are plain text
    for (const term of ["%", "_", "' OR 1=1 --", "\\"]) {
      const result = await api("GET", `/api/community/friends/search?search=${encodeURIComponent(term)}`, tokens.a);
      assert.equal(result.status, 200, term);
      assert.equal(result.json.members.length, 0, `${term} matches nobody`);
    }
  });

  test("3. a request waits for the other member; messaging stays locked until they accept", async () => {
    const sent = await api("POST", `/api/community/friends/${ids.b}/request`, tokens.a);
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.deepEqual(sent.json, { userId: ids.b, friendState: "outgoing" });
    assert.deepEqual((await api("POST", `/api/community/friends/${ids.b}/request`, tokens.a)).json.friendState, "outgoing", "repeating changes nothing");
    assert.equal(await stateBetween("a", "b"), "outgoing");
    assert.equal(await stateBetween("b", "a"), "incoming");
    const requests = (await api("GET", "/api/community/friends/requests", tokens.b)).json;
    assert.deepEqual(requests.incoming.map((r) => r.member.id), [ids.a]);
    assert.deepEqual(requests.outgoing, []);
    assert.deepEqual((await api("GET", "/api/community/friends/requests", tokens.a)).json.outgoing.map((r) => r.member.id), [ids.b]);
    assert.equal((await api("GET", "/api/community/friends/search?search=bilal", tokens.a)).json.members[0].friendState, "outgoing");
    // Locked both ways while it waits
    const locked = await api("POST", "/api/community/conversations", tokens.a, { userId: ids.b });
    assert.equal(locked.status, 403);
    assert.equal(locked.json.error, "Messaging unlocks when Bilal accepts your friend request.");
    assert.equal((await api("POST", "/api/community/conversations", tokens.b, { userId: ids.a })).json.error, "Accept Asha's friend request to message them.");
    // Only the member who was asked can answer: not the sender, not a third member
    assert.equal((await api("POST", `/api/community/friends/${ids.b}/accept`, tokens.a)).status, 404, "the sender can't accept their own request");
    assert.equal((await api("POST", `/api/community/friends/${ids.a}/accept`, tokens.c)).status, 404, "a third member can't accept it");
    assert.equal((await pairRow("a", "b")).status, "pending");
    // Accepting unlocks messaging
    assert.deepEqual((await api("POST", `/api/community/friends/${ids.a}/accept`, tokens.b)).json, { userId: ids.a, friendState: "friends" });
    assert.equal(await stateBetween("a", "b"), "friends");
    assert.deepEqual((await api("GET", "/api/community/friends", tokens.a)).json.friends.map((f) => f.member.id), [ids.b]);
    const open = await api("POST", "/api/community/conversations", tokens.a, { userId: ids.b });
    assert.equal(open.status, 200);
    const conversation = open.json.conversation.id;
    assert.equal((await api("POST", `/api/community/conversations/${conversation}/messages`, tokens.a, { body: "Leg day tomorrow?" })).status, 201);
    const read = await api("GET", `/api/community/conversations/${conversation}/messages`, tokens.b);
    assert.equal(read.json.canSend, true);
    assert.equal(read.json.lockReason, null);
  });

  test("4. removing a friend locks sending again; the history stays readable", async () => {
    const [{ id: conversation }] = (await api("GET", "/api/community/conversations", tokens.a)).json.conversations;
    assert.equal((await api("DELETE", `/api/community/friends/${ids.a}`, tokens.b)).status, 200, "either friend can remove");
    assert.equal(await stateBetween("a", "b"), "none");
    assert.equal((await pairRow("a", "b")).status, "removed", "kept as history, not deleted");
    const read = await api("GET", `/api/community/conversations/${conversation}/messages`, tokens.a);
    assert.equal(read.status, 200, "old messages are still readable");
    assert.equal(read.json.canSend, false);
    assert.equal(read.json.lockReason, "Add Bilal as a friend to message them.");
    assert.equal((await api("POST", `/api/community/conversations/${conversation}/messages`, tokens.a, { body: "still there?" })).status, 403);
    const [[count]] = await connection.query("SELECT COUNT(*) AS n FROM messages WHERE body = 'still there?'");
    assert.equal(count.n, 0);
    assert.equal((await api("POST", "/api/community/conversations", tokens.a, { userId: ids.b })).status, 200, "reopening the old conversation to read it is fine");
    assert.equal((await api("DELETE", `/api/community/friends/${ids.a}`, tokens.b)).status, 404, "removing twice is a 404");
  });

  test("5. cancel and decline; a declined sender waits before asking again", async () => {
    await api("POST", `/api/community/friends/${ids.c}/request`, tokens.a);
    assert.equal((await api("DELETE", `/api/community/friends/${ids.c}/request`, tokens.c)).status, 404, "only the sender cancels");
    assert.deepEqual((await api("DELETE", `/api/community/friends/${ids.c}/request`, tokens.a)).json, { userId: ids.c, friendState: "none" });
    assert.equal((await api("GET", "/api/community/friends/requests", tokens.c)).json.incoming.length, 0);
    await api("POST", `/api/community/friends/${ids.c}/request`, tokens.a);
    assert.deepEqual((await api("POST", `/api/community/friends/${ids.a}/decline`, tokens.c)).json, { userId: ids.a, friendState: "none" });
    const again = await api("POST", `/api/community/friends/${ids.c}/request`, tokens.a);
    assert.equal(again.status, 409, "cool-down after a decline");
    assert.match(again.json.error, /later/);
    // The member who declined can still ask themselves
    assert.equal((await api("POST", `/api/community/friends/${ids.a}/request`, tokens.c)).json.friendState, "outgoing");
    await api("DELETE", `/api/community/friends/${ids.a}/request`, tokens.c);
  });

  test("6. two members asking each other at once end up friends", async () => {
    const [first, second] = await Promise.all([
      api("POST", `/api/community/friends/${ids.c}/request`, tokens.b),
      api("POST", `/api/community/friends/${ids.b}/request`, tokens.c),
    ]);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(await stateBetween("b", "c"), "friends");
    const [[rows]] = await connection.query("SELECT COUNT(*) AS n FROM community_friendships WHERE (user_low = ? AND user_high = ?) OR (user_low = ? AND user_high = ?)", [ids.b, ids.c, ids.c, ids.b]);
    assert.equal(rows.n, 1, "one row for the pair");
  });

  test("7. blocking ends the friendship and hides the member from search and requests", async () => {
    assert.equal(await stateBetween("b", "c"), "friends");
    assert.equal((await api("POST", `/api/community/profiles/${ids.c}/block`, tokens.b)).status, 200);
    try {
      assert.equal((await pairRow("b", "c")).status, "removed");
      assert.equal((await api("GET", "/api/community/friends/search?search=chitra", tokens.b)).json.members.length, 0);
      assert.equal((await api("GET", "/api/community/friends/search?search=bilal", tokens.c)).json.members.length, 0, "hidden both ways");
      assert.equal((await api("POST", `/api/community/friends/${ids.b}/request`, tokens.c)).status, 404, "the blocked member can't ask");
      assert.equal((await api("POST", `/api/community/friends/${ids.c}/request`, tokens.b)).status, 404, "nor can the blocker");
    } finally {
      await api("DELETE", `/api/community/profiles/${ids.c}/block`, tokens.b);
    }
    assert.equal(await stateBetween("b", "c"), "none", "unblocking doesn't restore the friendship");
  });

  test("8. ids come from the route and the session, never the body; bad ids are refused", async () => {
    // A body naming someone else is ignored: the request is from the session's member to the route's member
    const spoof = await api("POST", `/api/community/friends/${ids.b}/request`, tokens.c, { requesterId: ids.a, userId: ids.a });
    assert.equal(spoof.status, 200);
    assert.deepEqual(await pairRow("b", "c"), { requester_id: ids.c, status: "pending" });
    assert.equal((await pairRow("a", "b")).status, "removed", "a's friendship with b untouched");
    await api("DELETE", `/api/community/friends/${ids.b}/request`, tokens.c);
    assert.equal((await api("POST", `/api/community/friends/${ids.a}/request`, tokens.a)).status, 400, "not yourself");
    assert.equal((await api("POST", "/api/community/friends/user_doesNotExist0000000000/request", tokens.a)).status, 404);
    for (const bad of ["x", "user_' OR 1=1 --", "user_short", "../../etc"]) {
      assert.equal((await api("POST", `/api/community/friends/${encodeURIComponent(bad)}/request`, tokens.a)).status, 400, bad);
    }
    assert.equal((await api("GET", "/api/community/friends/search?search=" + "a".repeat(500), tokens.a)).status, 200, "a long search is trimmed, not an error");
  });

  test("9. pairs whose ids differ only in letter case order the way MySQL does (regression)", async () => {
    // The old order (plain <) put "user_B…" first; the table's case-insensitive CHECK refused it
    const small = "user_aaaaaaaaaaaaaaaa";
    const capital = "user_BBBBBBBBBBBBBBBB";
    await connection.query("INSERT INTO users (id, email, role) VALUES (?, ?, 'user'), (?, ?, 'user') ON DUPLICATE KEY UPDATE email = VALUES(email), role = IF(role = 'user', VALUES(role), role)", [small, `s-${runId}@example.com`, capital, `c-${runId}@example.com`]);
    try {
      await assert.rejects(
        connection.query("INSERT INTO community_friendships (user_low, user_high, requester_id) VALUES (?, ?, ?)", [capital, small, small]),
        (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED",
      );
      const [low, high] = pairOf(capital, small);
      await connection.query("INSERT INTO community_friendships (user_low, user_high, requester_id) VALUES (?, ?, ?)", [low, high, small]);
      assert.deepEqual([low, high], [small, capital]);
    } finally {
      await db.deleteUsers(connection, [small, capital]);
    }
  });
});
