// Direct messages end to end: real Clerk development identities against the real Express
// server and the isolated `eato_test` database. Covers the normal flow (open, send, read,
// page) and the attack paths: no session, non-members, admins, unknown or malformed ids,
// bad or oversized input, SQL in a message, a retried send, suspended and blocked members.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const COMMUNITY_TABLES = ["messages", "conversation_members", "conversations", "community_blocks", "community_profiles"];
const PAGE = 20; // the server's default page size

describe("community messages e2e: conversations, pages, retries and who may read or write", () => {
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
  const send = (token, body) => api("POST", `/api/community/conversations/${state.conversation}/messages`, token, { body });
  const read = (token, query = "") => api("GET", `/api/community/conversations/${state.conversation}/messages${query}`, token);
  const inbox = async (token) => { const { status, json } = await api("GET", "/api/community/conversations", token); assert.equal(status, 200); return json; };
  const newIdentity = async (tag, role) => {
    const identity = await clerk.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const messageCount = async (where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM messages WHERE ${where}`, params))[0][0].n;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      await newIdentity("a");
      await newIdentity("b");
      await newIdentity("c");
      await newIdentity("admin", "admin");
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [ids[tag], identities[tag].emailAddress, `Member ${tag.toUpperCase()}`, tag === "admin" ? "admin" : "user"]);
    }
    await db.befriend(connection, ids.a, ids.b); // messaging is for friends; c and admin stay strangers
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of COMMUNITY_TABLES) await connection.query("DELETE FROM `" + table + "`");
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

  it("1. every messaging route needs a valid session", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const fake = crypto.randomUUID();
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      assert.equal((await api("GET", "/api/community/conversations", token)).status, 401);
      assert.equal((await api("POST", "/api/community/conversations", token, { userId: ids.b })).status, 401);
      assert.equal((await api("GET", `/api/community/conversations/${fake}/messages`, token)).status, 401);
      assert.equal((await api("POST", `/api/community/conversations/${fake}/messages`, token, { body: "hi" })).status, 401);
    }
  });

  it("2. a conversation is created once for a pair, and unread counts follow sends and reads", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const open = await api("POST", "/api/community/conversations", tokens.a, { userId: ids.b });
    assert.equal(open.status, 200, JSON.stringify(open.json));
    state.conversation = open.json.conversation.id;
    assert.equal((await api("POST", "/api/community/conversations", tokens.b, { userId: ids.a })).json.conversation.id, state.conversation, "opened from either side, it is the same conversation");
    assert.equal((await api("POST", "/api/community/conversations", tokens.a, { userId: ids.b })).json.conversation.id, state.conversation, "opening again doesn't create another");
    assert.equal(await messageCount("conversation_id = ?", [state.conversation]), 0);

    const first = await send(tokens.a, "Hey Rohan, how's the split going?");
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.equal(first.json.message.isOwn, true);
    assert.equal(first.json.message.senderId, ids.a, "the sender is the session, not a field");
    assert.equal(first.json.message.conversationId, state.conversation);

    let b = await inbox(tokens.b);
    assert.equal(b.unreadCount, 1);
    assert.equal(b.conversations.length, 1);
    assert.equal(b.conversations[0].other.id, ids.a);
    assert.equal(b.conversations[0].other.name, "Member A");
    assert.equal(b.conversations[0].lastMessage, "Hey Rohan, how's the split going?");
    assert.equal(b.conversations[0].unreadCount, 1);
    assert.equal((await inbox(tokens.a)).unreadCount, 0, "your own messages are never unread");
    assert.equal((await inbox(tokens.c)).conversations.length, 0, "a third member sees nothing of it");

    const page = await read(tokens.b);
    assert.equal(page.status, 200);
    assert.equal(page.json.other.id, ids.a);
    assert.deepEqual(page.json.messages.map((m) => [m.body, m.isOwn]), [["Hey Rohan, how's the split going?", false]]);
    assert.equal(page.json.nextCursor, null);
    b = await inbox(tokens.b);
    assert.equal(b.unreadCount, 0, "reading marks the conversation read");
    assert.equal(b.conversations[0].unreadCount, 0);

    assert.equal((await send(tokens.a, "Second")).status, 201);
    assert.equal((await send(tokens.a, "Third")).status, 201);
    assert.equal((await inbox(tokens.b)).unreadCount, 2, "two new messages since the read");
    assert.equal((await send(tokens.b, "All good, hitting legs today")).status, 201);
    assert.equal((await inbox(tokens.b)).unreadCount, 0, "replying counts as having read the chat");
    const a = await inbox(tokens.a);
    assert.equal(a.unreadCount, 1);
    assert.equal(a.conversations[0].lastMessage, "All good, hitting legs today");
    assert.ok(a.conversations[0].lastMessageAt, "the inbox carries the time of the last message");
    assert.equal((await read(tokens.a)).json.messages.map((m) => m.body)[0], "All good, hitting legs today", "newest first");
    assert.equal((await inbox(tokens.a)).unreadCount, 0);
  });

  it("3. pages never repeat or skip a message; a bad cursor or page size is refused", async (t) => {
    if (skipReason) return t.skip(skipReason);
    for (let i = 1; i <= 35; i++) assert.equal((await send(tokens.a, `Message ${i}`)).status, 201);
    const total = await messageCount("conversation_id = ?", [state.conversation]);
    assert.equal(total, 39);

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const page = await read(tokens.b, cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
      assert.equal(page.status, 200, JSON.stringify(page.json));
      assert.ok(page.json.messages.length <= PAGE);
      seen.push(...page.json.messages);
      cursor = page.json.nextCursor;
      pages++;
    } while (cursor);
    assert.equal(pages, 2, "39 messages, 20 per page");
    assert.equal(seen.length, total, "every message is on exactly one page");
    assert.equal(new Set(seen.map((m) => m.id)).size, total, "no repeats across pages");
    assert.equal(seen[0].body, "Message 35");
    assert.equal(seen[seen.length - 1].body, "Hey Rohan, how's the split going?");
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i - 1].createdAt >= seen[i].createdAt, "newest first throughout");

    const small = await read(tokens.b, "?limit=30");
    assert.equal(small.json.messages.length, 30);
    assert.equal((await read(tokens.b, `?limit=30&cursor=${encodeURIComponent(small.json.nextCursor)}`)).json.messages.length, 9);
    for (const query of ["?limit=0", "?limit=51", "?limit=abc", "?limit=-1", "?limit=1.5", "?cursor=garbage", "?cursor=123_not-a-uuid", `?cursor=${encodeURIComponent("1' OR '1'='1")}`]) {
      assert.equal((await read(tokens.b, query)).status, 400, `${query} is refused`);
    }
  });

  it("4. only members read or write: strangers, admins, unknown and malformed ids are refused", async (t) => {
    if (skipReason) return t.skip(skipReason);
    for (const [who, token] of [["stranger", tokens.c], ["admin", tokens.admin]]) {
      assert.equal((await read(token)).status, 403, `${who} can't read`);
      assert.equal((await send(token, "let me in")).status, 403, `${who} can't write`);
      assert.equal((await api("GET", "/api/community/conversations", token)).json.conversations.some((c) => c.id === state.conversation), false, `${who}'s inbox doesn't list it`);
    }
    assert.equal(await messageCount("conversation_id = ? AND body = 'let me in'", [state.conversation]), 0);
    const unknown = crypto.randomUUID();
    assert.equal((await api("GET", `/api/community/conversations/${unknown}/messages`, tokens.a)).status, 403, "an unknown conversation answers like someone else's");
    assert.equal((await api("POST", `/api/community/conversations/${unknown}/messages`, tokens.a, { body: "hi" })).status, 403);
    for (const bad of ["1", "not-a-uuid", "1 OR 1=1", "'; DROP TABLE messages; --", `${state.conversation}'`, "..%2F..%2Fetc"]) {
      assert.equal((await api("GET", `/api/community/conversations/${encodeURIComponent(bad)}/messages`, tokens.a)).status, 400, `${bad} is a 400`);
      assert.equal((await api("POST", `/api/community/conversations/${encodeURIComponent(bad)}/messages`, tokens.a, { body: "hi" })).status, 400);
    }
    // Starting a conversation: only with a real, other member
    assert.equal((await api("POST", "/api/community/conversations", tokens.a, { userId: ids.a })).status, 400, "not with yourself");
    assert.equal((await api("POST", "/api/community/conversations", tokens.a, { userId: "user_doesNotExist0000000000" })).status, 404);
    for (const bad of [undefined, "", 42, "x' OR '1'='1", "user_1; DROP TABLE users", { id: ids.b }]) {
      assert.equal((await api("POST", "/api/community/conversations", tokens.a, { userId: bad })).status, 400, `${JSON.stringify(bad)} is a 400`);
    }
    assert.equal((await api("POST", "/api/community/conversations", tokens.a, [ids.b])).status, 400);
  });

  it("5. invalid messages are 400s, and text is stored exactly as sent (SQL and HTML included)", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const before = await messageCount("conversation_id = ?", [state.conversation]);
    for (const body of [undefined, "", "   ", "\n\t", "x".repeat(1001), 42, null, ["hi"], { text: "hi" }]) {
      assert.equal((await api("POST", `/api/community/conversations/${state.conversation}/messages`, tokens.a, { body })).status, 400, `${JSON.stringify(body)} is refused`);
    }
    assert.equal((await api("POST", `/api/community/conversations/${state.conversation}/messages`, tokens.a, { body: "hi", senderId: ids.b })).status, 400, "unknown fields are refused, so the sender can't be spoofed");
    for (const id of ["not-a-uuid", 42, "1 OR 1=1", `${crypto.randomUUID()}'`]) {
      assert.equal((await api("POST", `/api/community/conversations/${state.conversation}/messages`, tokens.a, { body: "hi", id })).status, 400, `id ${JSON.stringify(id)} is refused`);
    }
    for (const raw of ["\"hi\"", "[]", "null", "not json"]) {
      const response = await fetch(`${server.baseUrl}/api/community/conversations/${state.conversation}/messages`, { method: "POST", headers: { Authorization: `Bearer ${tokens.a}`, "Content-Type": "application/json" }, body: raw });
      assert.equal(response.status, 400, `${raw} is a 400`);
    }
    assert.equal(await messageCount("conversation_id = ?", [state.conversation]), before, "nothing invalid was stored");

    const exact = "x".repeat(1000);
    const longest = await send(tokens.a, exact);
    assert.equal(longest.status, 201, "1000 characters is the limit, inclusive");
    assert.equal(longest.json.message.body, exact);
    const hostile = "Robert'); DROP TABLE messages; -- <script>alert(1)</script> \u{1F4AA} नमस्ते";
    const stored = await send(tokens.b, hostile);
    assert.equal(stored.status, 201);
    assert.equal(stored.json.message.body, hostile, "returned verbatim");
    const [[row]] = await connection.query("SELECT body, sender_id FROM messages WHERE id = ?", [stored.json.message.id]);
    assert.equal(row.body, hostile, "stored verbatim, as data");
    assert.equal(row.sender_id, ids.b);
    assert.equal(await messageCount("conversation_id = ?", [state.conversation]), before + 2, "the table is intact");
    assert.equal((await read(tokens.a, "?limit=1")).json.messages[0].body, hostile);
  });

  it("6. a send repeated with the same id stores one message, over HTTP and under a race", async (t) => {
    if (skipReason) return t.skip(skipReason);
    // Over the route: the app's retry after a timeout
    const clientId = crypto.randomUUID();
    const first = await api("POST", `/api/community/conversations/${state.conversation}/messages`, tokens.a, { body: "retried over http", id: clientId });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.equal(first.json.message.id, clientId);
    const second = await api("POST", `/api/community/conversations/${state.conversation}/messages`, tokens.a, { body: "retried over http", id: clientId });
    assert.equal(second.status, 201);
    assert.deepEqual(second.json.message, first.json.message, "the same message comes back");
    assert.equal(await messageCount("body = 'retried over http'", []), 1);
    const hijack = await api("POST", `/api/community/conversations/${state.conversation}/messages`, tokens.b, { body: "hijack", id: clientId });
    assert.equal(hijack.status, 400, "another member can't reuse the id");
    assert.equal((await connection.query("SELECT body, sender_id FROM messages WHERE id = ?", [clientId]))[0][0].sender_id, ids.a, "and can't overwrite the message");
    assert.equal((await read(tokens.b, "?limit=1")).json.messages[0].id, clientId, "the retried message reads back once");

    // Racing attempts (a tap during a slow network) need the module directly, with its own pool
    process.env.CLERK_SECRET_KEY ||= env.CLERK_SECRET_KEY; // members.js loads auth.js, which needs it at load
    const messages = require("../../community/messages.js");
    const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectionLimit: 4 });
    try {
      const retried = crypto.randomUUID();
      const first = await messages.sendMessage(pool, ids.a, state.conversation, { body: "sent once", id: retried });
      const again = await messages.sendMessage(pool, ids.a, state.conversation, { body: "sent once", id: retried });
      assert.equal(first.id, retried, "the stored message carries the client's id");
      assert.deepEqual(again, first, "the retry returns the message stored the first time");
      assert.equal(await messageCount("body = 'sent once'", []), 1, "one row");

      // Two attempts racing each other (a tap during a slow network) still store one row
      const raced = crypto.randomUUID();
      const results = await Promise.all([0, 1, 2].map(() => messages.sendMessage(pool, ids.b, state.conversation, { body: "raced", id: raced })));
      assert.ok(results.every((r) => r.id === raced && r.senderId === ids.b));
      assert.equal(await messageCount("body = 'raced'", []), 1);

      // Someone else's id can't be reused or overwritten, in this or another conversation
      await assert.rejects(messages.sendMessage(pool, ids.b, state.conversation, { body: "hijack", id: retried }), (error) => error.status === 400 && /already in use/.test(error.message));
      await db.befriend(connection, ids.a, ids.c); // a second conversation needs a friendship too
      const other = await messages.openConversation(pool, ids.a, ids.c);
      await assert.rejects(messages.sendMessage(pool, ids.a, other.id, { body: "moved", id: retried }), (error) => error.status === 400);
      const [[row]] = await connection.query("SELECT body, sender_id, conversation_id FROM messages WHERE id = ?", [retried]);
      assert.deepEqual(row, { body: "sent once", sender_id: ids.a, conversation_id: state.conversation });
      assert.equal(await messageCount("conversation_id = ?", [other.id]), 0);

      // Without an id the server still generates one, as the route does today
      const generated = await messages.sendMessage(pool, ids.a, state.conversation, { body: "no id" });
      assert.match(generated.id, /^[0-9a-f-]{36}$/);
      // A malformed client id never reaches SQL as anything but a refused insert
      await assert.rejects(messages.sendMessage(pool, ids.a, state.conversation, { body: "bad id", id: "x".repeat(40) }));
      assert.equal(await messageCount("body = 'bad id'", []), 0);
    } finally {
      await pool.end();
    }
  });

  it("7. a suspended member can read but not send, and nobody can start a chat with them", async (t) => {
    if (skipReason) return t.skip(skipReason);
    assert.equal((await api("POST", `/api/community/admin/members/${ids.b}/suspend`, tokens.a)).status, 403, "members can't suspend");
    assert.equal((await api("POST", `/api/community/admin/members/${ids.b}/suspend`, tokens.admin)).status, 200);
    try {
      assert.equal((await read(tokens.b)).status, 200, "still reads the history");
      const refused = await send(tokens.b, "while suspended");
      assert.equal(refused.status, 403);
      assert.match(refused.json.error, /suspended/);
      assert.equal(await messageCount("body = 'while suspended'", []), 0);
      assert.equal((await api("POST", "/api/community/conversations", tokens.b, { userId: ids.c })).status, 403, "can't start a chat");
      assert.equal((await api("POST", "/api/community/conversations", tokens.c, { userId: ids.b })).status, 404, "others can't start one with them");
    } finally {
      assert.equal((await api("DELETE", `/api/community/admin/members/${ids.b}/suspend`, tokens.admin)).status, 200);
    }
    assert.equal((await send(tokens.b, "back again")).status, 201, "reinstated");
  });

  it("8. blocking hides the conversation and stops sends both ways; unblocking restores it", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const before = await messageCount("conversation_id = ?", [state.conversation]);
    assert.equal((await api("POST", `/api/community/profiles/${ids.b}/block`, tokens.a)).status, 200);
    try {
      for (const [who, token] of [["blocker", tokens.a], ["blocked", tokens.b]]) {
        assert.equal((await read(token)).status, 404, `${who}: hidden`);
        assert.equal((await send(token, "through the block")).status, 403, `${who}: can't send`);
        const list = await inbox(token);
        assert.equal(list.conversations.some((c) => c.id === state.conversation), false, `${who}: not in the inbox`);
        assert.equal(list.unreadCount, 0, `${who}: no unread from it`);
      }
      assert.equal((await api("POST", "/api/community/conversations", tokens.b, { userId: ids.a })).status, 404);
      assert.equal(await messageCount("conversation_id = ?", [state.conversation]), before, "history kept, nothing added");
    } finally {
      assert.equal((await api("DELETE", `/api/community/profiles/${ids.b}/block`, tokens.a)).status, 200);
    }
    assert.equal((await read(tokens.b)).status, 200, "restored");
    assert.ok((await inbox(tokens.a)).conversations.some((c) => c.id === state.conversation));
    // The block ended the friendship, so the history is back but sending waits for a new one
    const locked = await send(tokens.b, "after the block");
    assert.equal(locked.status, 403);
    assert.match(locked.json.error, /friend/);
    assert.equal((await read(tokens.b)).json.canSend, false);
    await db.befriend(connection, ids.a, ids.b);
    assert.equal((await send(tokens.b, "after the block")).status, 201);
  });
});
