// WhatsApp agent, phase C: the webhook, routing by phone-number id, the job worker and sending
// through the gym's own number. A fake Meta (a local HTTP server) stands in for the Graph API,
// and every Meta setting is a made-up test value. The real Express server runs on the test port
// against `eato_test`; the worker runs here, in the test process, so each step is deterministic.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const http = require("node:http");
const mysql = require("mysql2/promise");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");

const APP_SECRET = `test-app-secret-${crypto.randomBytes(8).toString("hex")}`;
const VERIFY_TOKEN = `test-verify-${crypto.randomBytes(8).toString("hex")}`;
const TOKEN_KEY = crypto.randomBytes(32).toString("hex");
const GRAPH_VERSION = "v99.0"; // a made-up version: only the fake Meta answers it
const PHONE_A = "1100000001";
const PHONE_B = "1100000002";
const CUSTOMER = "919811111111";

const CLEANUP_TABLES = ["jobs", "whatsapp_webhook_events", "whatsapp_usage", "whatsapp_messages", "whatsapp_media", "whatsapp_conversations",
  "whatsapp_contacts", "whatsapp_agent_settings", "whatsapp_connections", "gym_members", "gyms"];

describe("whatsapp e2e: webhook, routing, worker and sending", () => {
  let skipReason = null;
  let env, connection, pool, server, fakeMeta, worker;
  const state = {};
  const metaRequests = [];
  let metaMode = "ok";

  // Workers and helpers load after the token key is set
  let createWorker, eventHandler, sendText, createMetaClient, encryptToken;

  const sign = (raw, secret = APP_SECRET) => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  const post = async (body, { signature, rawOverride } = {}) => {
    const raw = rawOverride ?? Buffer.from(JSON.stringify(body));
    const response = await fetch(`${server.baseUrl}/api/whatsapp/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(signature === null ? {} : { "X-Hub-Signature-256": signature ?? sign(raw) }) },
      body: raw,
    });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const envelope = (phone, value) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "91980000", phone_number_id: phone }, ...value } }] }] });
  const textMessage = (phone, id, body, from = CUSTOMER) => envelope(phone, { contacts: [{ profile: { name: "Asha" }, wa_id: from }], messages: [{ from, id, timestamp: "1760000000", type: "text", text: { body } }] });
  const statusUpdate = (phone, id, status) => envelope(phone, { statuses: [{ id, status, timestamp: "1760000100", recipient_id: CUSTOMER }] });
  const count = async (sql, params = []) => Number((await connection.query(sql, params))[0][0].n);

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    process.env.WHATSAPP_TOKEN_KEY = TOKEN_KEY;
    ({ createWorker } = require("../../whatsapp/worker.js"));
    ({ eventHandler } = require("../../whatsapp/process.js"));
    ({ sendText } = require("../../whatsapp/send.js"));
    ({ createMetaClient } = require("../../whatsapp/metaClient.js"));
    ({ encryptToken } = require("../../whatsapp/secrets.js"));

    // The fake Meta: records each call; answers like the Graph API, or fails on demand
    fakeMeta = http.createServer((req, res) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => {
        metaRequests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: data ? JSON.parse(data) : null });
        if (metaMode === "error") { res.writeHead(500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { code: 1, message: "boom" } })); }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: `wamid.OUT${metaRequests.length}` }] }));
      });
    });
    await new Promise((resolve) => fakeMeta.listen(0, "127.0.0.1", resolve));
    state.metaBase = `http://127.0.0.1:${fakeMeta.address().port}`;

    server = await startTestServer({ ...env, META_APP_SECRET: APP_SECRET, META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN, META_GRAPH_VERSION: GRAPH_VERSION, WHATSAPP_WORKER: "off" });
    pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectionLimit: 4 });
    worker = createWorker(pool, { "whatsapp.event": eventHandler() }, { log: () => {} });

    // Two gyms, each connected to its own number with its own (fake) token
    for (const [key, name, phone, token] of [["gymA", "Gym Alpha", PHONE_A, "token-for-alpha"], ["gymB", "Gym Beta", PHONE_B, "token-for-beta"]]) {
      const [[{ id }]] = await connection.query("SELECT UUID() AS id");
      await connection.query("INSERT INTO gyms (id, name, invite_code, visibility, member_count) VALUES (?, ?, ?, 'public', 0)", [id, name, crypto.randomBytes(4).toString("hex").toUpperCase()]);
      const sealed = encryptToken(token, TOKEN_KEY);
      await connection.query(
        "INSERT INTO whatsapp_connections (gym_id, status, phone_number_id, token_ciphertext, token_iv, token_tag) VALUES (?, 'connected', ?, ?, ?, ?)",
        [id, phone, sealed.ciphertext, sealed.iv, sealed.tag],
      );
      state[key] = id;
    }
  });

  after(async () => {
    if (connection) {
      for (const table of CLEANUP_TABLES) await connection.query("DELETE FROM `" + table + "`").catch(() => {});
    }
    if (server) await server.stop();
    if (pool) await pool.end();
    if (connection) await connection.end();
    if (fakeMeta) await new Promise((resolve) => fakeMeta.close(resolve));
  });

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. the GET handshake echoes the challenge only for our verify token", async () => {
    const ok = await fetch(`${server.baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=424242`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "424242");
    const bad = await fetch(`${server.baseUrl}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=424242`);
    assert.equal(bad.status, 403);
  });

  test("2. unsigned, wrongly signed, tampered or non-JSON posts are refused and store nothing", async () => {
    const body = textMessage(PHONE_A, "wamid.FORGED", "hello");
    assert.equal((await post(body, { signature: null })).status, 401);
    assert.equal((await post(body, { signature: sign(Buffer.from(JSON.stringify(body)), "not-the-secret") })).status, 401);
    const raw = Buffer.from(JSON.stringify(body));
    assert.equal((await post(null, { rawOverride: Buffer.from(JSON.stringify(body).replace("hello", "HELLO")), signature: sign(raw) })).status, 401, "tampered after signing");
    const notJson = Buffer.from("not json");
    assert.equal((await post(null, { rawOverride: notJson, signature: sign(notJson) })).status, 400);
    assert.equal(await count("SELECT COUNT(*) AS n FROM whatsapp_webhook_events"), 0);
  });

  test("3. a signed message to Gym A's number is saved once and queued once, even when Meta repeats it", async () => {
    const body = textMessage(PHONE_A, "wamid.IN1", "What are your timings?");
    const first = await post(body);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.accepted, 1);
    const again = await post(body);
    assert.equal(again.json.accepted, 0, "a repeat is accepted but not queued again");
    assert.equal(await count("SELECT COUNT(*) AS n FROM whatsapp_webhook_events WHERE event_key = 'msg:wamid.IN1' AND gym_id = ? AND status = 'pending'", [state.gymA]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'whatsapp.event' AND gym_id = ?", [state.gymA]), 1);
  });

  test("4. messages to an unknown or switched-off number are quarantined, never queued", async () => {
    await post(textMessage("1199999999", "wamid.UNKNOWN", "hi"));
    await connection.query("UPDATE whatsapp_connections SET disabled_by_admin = TRUE WHERE gym_id = ?", [state.gymB]);
    await post(textMessage(PHONE_B, "wamid.DISABLED", "hi"));
    await connection.query("UPDATE whatsapp_connections SET disabled_by_admin = FALSE WHERE gym_id = ?", [state.gymB]);
    assert.equal(await count("SELECT COUNT(*) AS n FROM whatsapp_webhook_events WHERE status = 'quarantined'"), 2);
    assert.equal(await count("SELECT COUNT(*) AS n FROM jobs WHERE payload->>'$.eventId' IN (SELECT id FROM whatsapp_webhook_events WHERE status = 'quarantined')"), 0);
  });

  test("5. the worker stores the message in Gym A only: one contact, one conversation, one message", async () => {
    assert.equal(await worker.runOnce(), 1);
    const [[message]] = await connection.query("SELECT gym_id, direction, sender, body, status FROM whatsapp_messages WHERE provider_message_id = 'wamid.IN1'");
    assert.deepEqual({ ...message }, { gym_id: state.gymA, direction: "in", sender: "customer", body: "What are your timings?", status: "received" });
    const [[conversation]] = await connection.query("SELECT id, unread_count, last_inbound_at IS NOT NULL AS window_open FROM whatsapp_conversations WHERE gym_id = ?", [state.gymA]);
    assert.deepEqual([conversation.unread_count, conversation.window_open], [1, 1]);
    state.conversationA = conversation.id;
    assert.equal(await count("SELECT COUNT(*) AS n FROM whatsapp_contacts WHERE gym_id = ? AND wa_id = ?", [state.gymA, CUSTOMER]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM whatsapp_messages WHERE gym_id = ?", [state.gymB]), 0, "nothing reaches Gym B");
    assert.equal(await count("SELECT COUNT(*) AS n FROM whatsapp_webhook_events WHERE event_key = 'msg:wamid.IN1' AND status = 'processed'"), 1);
    assert.equal(await worker.runOnce(), 0, "nothing left to do");
  });

  test("6. a reply goes out through Gym A's own number and token, and is recorded", async () => {
    const meta = createMetaClient({ graphBase: state.metaBase, graphVersion: GRAPH_VERSION });
    const sent = await sendText(pool, meta, { gymId: state.gymA, conversationId: state.conversationA, body: "We're open 6am to 10pm.", sender: "staff" });
    const call = metaRequests.at(-1);
    assert.equal(call.url, `/${GRAPH_VERSION}/${PHONE_A}/messages`);
    assert.equal(call.auth, "Bearer token-for-alpha");
    assert.deepEqual([call.body.to, call.body.type, call.body.text.body], [CUSTOMER, "text", "We're open 6am to 10pm."]);
    const [[row]] = await connection.query("SELECT gym_id, direction, status, provider_message_id FROM whatsapp_messages WHERE id = ?", [sent.id]);
    assert.deepEqual({ ...row }, { gym_id: state.gymA, direction: "out", status: "sent", provider_message_id: sent.providerMessageId });
    state.outA = sent.providerMessageId;
  });

  test("7. Gym B can't send into Gym A's conversation, and a closed 24-hour window refuses free text", async () => {
    const meta = createMetaClient({ graphBase: state.metaBase, graphVersion: GRAPH_VERSION });
    const before = metaRequests.length;
    await assert.rejects(sendText(pool, meta, { gymId: state.gymB, conversationId: state.conversationA, body: "hi", sender: "staff" }), (error) => error.code === "not_found");
    await connection.query("UPDATE whatsapp_conversations SET last_inbound_at = NOW() - INTERVAL 25 HOUR WHERE id = ?", [state.conversationA]);
    await assert.rejects(sendText(pool, meta, { gymId: state.gymA, conversationId: state.conversationA, body: "hi", sender: "staff" }), (error) => error.code === "window_closed");
    await connection.query("UPDATE whatsapp_conversations SET last_inbound_at = NOW() WHERE id = ?", [state.conversationA]);
    assert.equal(metaRequests.length, before, "Meta was never called");
  });

  test("8. delivery statuses update only that gym's message, never move backwards, and never trigger work", async () => {
    await post(statusUpdate(PHONE_A, state.outA, "read"));
    await post(statusUpdate(PHONE_A, state.outA, "delivered")); // arrives late
    await post(statusUpdate(PHONE_B, state.outA, "failed")); // the right id on the wrong gym's number
    await worker.runOnce();
    const [[row]] = await connection.query("SELECT status FROM whatsapp_messages WHERE provider_message_id = ?", [state.outA]);
    assert.equal(row.status, "read", "read stays read, and Gym B's event can't touch Gym A's message");
    assert.equal(await count("SELECT COUNT(*) AS n FROM whatsapp_webhook_events WHERE kind = 'status' AND gym_id = ? AND status = 'ignored'", [state.gymB]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM whatsapp_messages WHERE direction = 'out'"), 1, "no message was sent in response to a status");
  });

  test("9. a Meta failure marks the message failed; a failing job retries with backoff, then stops", async () => {
    const meta = createMetaClient({ graphBase: state.metaBase, graphVersion: GRAPH_VERSION });
    metaMode = "error";
    try {
      await assert.rejects(sendText(pool, meta, { gymId: state.gymA, conversationId: state.conversationA, body: "Second reply", sender: "staff" }), (error) => error.name === "MetaError" && error.retryable === true);
    } finally {
      metaMode = "ok";
    }
    const [[failed]] = await connection.query("SELECT status, error_code FROM whatsapp_messages WHERE body = 'Second reply'");
    assert.deepEqual({ ...failed }, { status: "failed", error_code: "1" });
    // A job whose handler keeps failing: queued again later, then failed after max_attempts
    const flaky = createWorker(pool, { "test.flaky": async () => { throw new Error("temporary"); } }, { log: () => {} });
    await connection.query("INSERT INTO jobs (kind, payload, max_attempts) VALUES ('test.flaky', '{}', 2)");
    await flaky.runOnce();
    const [[retry]] = await connection.query("SELECT status, attempts, run_at > NOW() AS later FROM jobs WHERE kind = 'test.flaky'");
    assert.deepEqual([retry.status, retry.attempts, retry.later], ["queued", 1, 1]);
    await connection.query("UPDATE jobs SET run_at = NOW() WHERE kind = 'test.flaky'");
    await flaky.runOnce();
    const [[gaveUp]] = await connection.query("SELECT status, attempts FROM jobs WHERE kind = 'test.flaky'");
    assert.deepEqual([gaveUp.status, gaveUp.attempts], ["failed", 2]);
  });

  test("10. an oversized body is refused before it's read", async () => {
    const huge = Buffer.alloc(1024 * 1024 + 10, 0x61);
    const result = await post(null, { rawOverride: huge, signature: sign(huge) });
    assert.equal(result.status, 413);
  });
});
