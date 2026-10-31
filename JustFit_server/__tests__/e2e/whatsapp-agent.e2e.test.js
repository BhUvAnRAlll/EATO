// WhatsApp agent, phase D: automatic replies and the in-app assistant. A fake AI (deterministic,
// test-only) and a fake Meta stand in for the real services; every setting is a made-up test
// value. The server runs on the test port against `justfit_test`; the worker runs in this process.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const http = require("node:http");
const mysql = require("mysql2/promise");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const APP_SECRET = `test-app-secret-${crypto.randomBytes(8).toString("hex")}`;
const TOKEN_KEY = crypto.randomBytes(32).toString("hex");
const GRAPH_VERSION = "v99.0";
const PHONE_A = "1100000011";
const PHONE_B = "1100000012";

const CLEANUP_TABLES = ["jobs", "whatsapp_webhook_events", "whatsapp_usage", "whatsapp_messages", "whatsapp_media", "whatsapp_conversations",
  "whatsapp_contacts", "gym_faqs", "whatsapp_agent_settings", "whatsapp_connections", "gym_members", "gyms"];

describe("whatsapp e2e: the AI agent's replies and the in-app assistant", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, pool, server, fakeMeta, testAccounts, ai, worker;
  const identities = {};
  const ids = {};
  const tokens = {};
  const state = {};
  const sent = []; // what the fake Meta was asked to send
  let customerSeq = 0;

  const sign = (raw) => `sha256=${crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex")}`;
  const deliver = async (phone, from, message) => {
    const body = { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { metadata: { phone_number_id: phone }, contacts: [{ profile: { name: "Customer" }, wa_id: from }], messages: [{ from, timestamp: "1760000000", ...message }] } }] }] };
    const raw = Buffer.from(JSON.stringify(body));
    const response = await fetch(`${server.baseUrl}/api/whatsapp/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(raw) }, body: raw });
    assert.equal(response.status, 200);
  };
  const say = (phone, from, text) => deliver(phone, from, { id: `wamid.${crypto.randomBytes(6).toString("hex")}`, type: "text", text: { body: text } });
  const newCustomer = () => `9198${String(++customerSeq).padStart(8, "0")}`;
  const sentTo = (customer) => sent.filter((call) => call.body.to === customer).map((call) => call.body.text.body);
  const conversationOf = async (gymId, customer) => (await connection.query(
    "SELECT v.id, v.handler FROM whatsapp_conversations v JOIN whatsapp_contacts k ON k.id = v.contact_id WHERE v.gym_id = ? AND k.wa_id = ?", [gymId, customer]))[0][0];
  const api = async (method, route, token, body) => {
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    process.env.WHATSAPP_TOKEN_KEY = TOKEN_KEY;
    const { createWorker } = require("../../whatsapp/worker.js");
    const { eventHandler } = require("../../whatsapp/process.js");
    const { afterInbound, replyHandler } = require("../../whatsapp/reply.js");
    const { createMetaClient } = require("../../whatsapp/metaClient.js");
    const { fakeProvider } = require("../../whatsapp/aiProvider.js");
    const { encryptToken } = require("../../whatsapp/secrets.js");

    fakeMeta = http.createServer((req, res) => {
      let data = "";
      req.on("data", (chunk) => { data += chunk; });
      req.on("end", () => {
        sent.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(data || "{}") });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ messages: [{ id: `wamid.OUT${sent.length}` }] }));
      });
    });
    await new Promise((resolve) => fakeMeta.listen(0, "127.0.0.1", resolve));
    const meta = createMetaClient({ graphBase: `http://127.0.0.1:${fakeMeta.address().port}`, graphVersion: GRAPH_VERSION });

    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, META_APP_SECRET: APP_SECRET, META_GRAPH_VERSION: GRAPH_VERSION, WHATSAPP_WORKER: "off", AI_PROVIDER: "fake" });
    pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectionLimit: 4 });
    ai = fakeProvider();
    worker = createWorker(pool, { "whatsapp.event": eventHandler({ afterInbound }), "whatsapp.reply": replyHandler({ provider: ai, meta }) }, { log: () => {} });

    try {
      for (const tag of ["memberA", "outsider"]) {
        const identity = await testAccounts.createIdentity(runId, tag, {});
        const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        ids[tag] = identity.id;
        tokens[tag] = jwt;
        await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user') ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [identity.id, identity.emailAddress, `Member ${tag}`]);
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }

    // Gym Alpha (public) and Gym Beta (private), each with its own facts, number and token
    const gyms = [
      ["gymA", "Gym Alpha", "public", PHONE_A, "What are your timings?", "Gym Alpha is open 6am to 10pm every day.", '[{"name":"Monthly","price":"₹2,500","perks":"All classes"}]'],
      ["gymB", "Gym Beta", "private", PHONE_B, "What are your timings?", "Gym Beta is open 5am to midnight.", '[{"name":"Monthly","price":"₹4,000","perks":"Pool"}]'],
    ];
    for (const [key, name, visibility, phone, question, answer, tiers] of gyms) {
      const [[{ id }]] = await connection.query("SELECT UUID() AS id");
      await connection.query("INSERT INTO gyms (id, name, invite_code, visibility, member_count, membership_tiers) VALUES (?, ?, ?, ?, 0, ?)", [id, name, crypto.randomBytes(4).toString("hex").toUpperCase(), visibility, tiers]);
      const sealed = encryptToken(`token-for-${key}`, TOKEN_KEY);
      await connection.query("INSERT INTO whatsapp_connections (gym_id, status, phone_number_id, token_ciphertext, token_iv, token_tag) VALUES (?, 'connected', ?, ?, ?, ?)", [id, phone, sealed.ciphertext, sealed.iv, sealed.tag]);
      await connection.query("INSERT INTO whatsapp_agent_settings (gym_id) VALUES (?)", [id]);
      await connection.query("INSERT INTO gym_faqs (gym_id, question, answer) VALUES (?, ?, ?)", [id, question, answer]);
      state[key] = id;
    }
    await connection.query("INSERT INTO gym_members (gym_id, user_id, role, status, joined_at) VALUES (?, ?, 'member', 'active', NOW())", [state.gymA, ids.memberA]);
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
      try { await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {}); await testAccounts.deleteUser(identities[tag].id); } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (pool) await pool.end();
    if (connection) await connection.end();
    if (fakeMeta) await new Promise((resolve) => fakeMeta.close(resolve));
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. an agent in testing (every gym's default) stores WhatsApp messages and never replies there", async () => {
    const customer = newCustomer();
    await say(PHONE_A, customer, "What are your timings?");
    await worker.runOnce();
    assert.ok(await conversationOf(state.gymA, customer), "the message is kept");
    assert.deepEqual(sentTo(customer), []);
    assert.equal(ai.calls.length, 0);
  });

  test("2. an active agent answers from its own gym's facts, through its own number, and never sees the other gym's", async () => {
    await connection.query("UPDATE whatsapp_agent_settings SET agent_status = 'active' WHERE gym_id IN (?, ?)", [state.gymA, state.gymB]);
    const customer = newCustomer();
    await say(PHONE_A, customer, "What are your timings?");
    await worker.runOnce();
    assert.deepEqual(sentTo(customer), ["Gym Alpha is open 6am to 10pm every day."]);
    assert.equal(sent.at(-1).url, `/${GRAPH_VERSION}/${PHONE_A}/messages`);
    assert.equal(sent.at(-1).auth, "Bearer token-for-gymA");
    const prompt = ai.calls.at(-1).instructions;
    assert.match(prompt, /Gym Alpha/);
    assert.equal(/Gym Beta|5am to midnight|4,000/.test(prompt), false, "nothing from Gym Beta reaches Gym Alpha's prompt");
    const [[usage]] = await connection.query("SELECT count, ai_input_tokens FROM whatsapp_usage WHERE gym_id = ? AND kind = 'ai'", [state.gymA]);
    assert.ok(usage.count >= 1 && usage.ai_input_tokens > 0);
  });

  test("3. a repeated webhook and a burst of messages get exactly one reply", async () => {
    const customer = newCustomer();
    const id = `wamid.${crypto.randomBytes(6).toString("hex")}`;
    await deliver(PHONE_A, customer, { id, type: "text", text: { body: "Hello" } });
    await deliver(PHONE_A, customer, { id, type: "text", text: { body: "Hello" } }); // Meta repeats it
    await say(PHONE_A, customer, "What are your timings?"); // and a second message before any reply
    await worker.runOnce();
    assert.equal(sentTo(customer).length, 1);
    assert.equal(sentTo(customer)[0], "Gym Alpha is open 6am to 10pm every day.", "the reply answers the newest message");
    const history = ai.calls.at(-1).messages.map((m) => m.content);
    assert.deepEqual(history, ["Hello", "What are your timings?"], "with the whole burst as context, Hello stored once");
  });

  test("4. an invented price never reaches the customer; the conversation goes to a person", async () => {
    const customer = newCustomer();
    await say(PHONE_A, customer, "INVENT_PRICE how much is yearly?");
    await worker.runOnce();
    assert.deepEqual(sentTo(customer), ["I don't have a confirmed price for that. I've asked the team to reply with the exact details."]);
    assert.equal((await conversationOf(state.gymA, customer)).handler, "human");
    await say(PHONE_A, customer, "Hello?");
    await worker.runOnce();
    assert.equal(sentTo(customer).length, 1, "no AI reply once a person has the conversation");
  });

  test("5. asking for a person, sending an image, or a paused conversation: no AI answer", async () => {
    const asks = newCustomer();
    await say(PHONE_A, asks, "HUMAN_PLEASE");
    const photo = newCustomer();
    await deliver(PHONE_A, photo, { id: `wamid.${crypto.randomBytes(6).toString("hex")}`, type: "image", image: { id: "MEDIA9", mime_type: "image/jpeg" } });
    await worker.runOnce();
    assert.match(sentTo(asks)[0], /team/);
    assert.equal((await conversationOf(state.gymA, asks)).handler, "human");
    assert.deepEqual(sentTo(photo), ["Thanks for the photo. A team member will take a look and reply here."]);
    assert.equal((await conversationOf(state.gymA, photo)).handler, "human");

    const paused = newCustomer();
    await say(PHONE_A, paused, "What are your timings?");
    await worker.runOnce();
    await connection.query("UPDATE whatsapp_conversations v JOIN whatsapp_contacts k ON k.id = v.contact_id SET v.ai_paused = TRUE WHERE k.wa_id = ?", [paused]);
    const before = sentTo(paused).length;
    await say(PHONE_A, paused, "What are your timings?");
    await worker.runOnce();
    assert.equal(sentTo(paused).length, before, "paused: stored, not answered");
  });

  test("6. an AI failure keeps the customer's message and retries later; nothing half-sent", async () => {
    const customer = newCustomer();
    const callsBefore = ai.calls.length;
    await say(PHONE_A, customer, "FAIL_AI please");
    await worker.runOnce();
    assert.equal(ai.calls.length, callsBefore + 1);
    assert.deepEqual(sentTo(customer), []);
    const [[job]] = await connection.query("SELECT status, attempts, last_error, run_at > NOW() AS later FROM jobs WHERE kind = 'whatsapp.reply' AND status <> 'done'");
    assert.deepEqual([job.status, job.attempts, job.last_error, job.later], ["queued", 1, "ai_status_500", 1]);
    const [[kept]] = await connection.query("SELECT COUNT(*) AS n FROM whatsapp_messages WHERE gym_id = ? AND direction = 'in' AND body = 'FAIL_AI please'", [state.gymA]);
    assert.equal(kept.n, 1);
  });

  test("7. the daily reply limit hands the next conversation to a person", async () => {
    await connection.query("UPDATE whatsapp_agent_settings SET daily_reply_limit = 1 WHERE gym_id = ?", [state.gymA]);
    const customer = newCustomer();
    await say(PHONE_A, customer, "What are your timings?");
    await worker.runOnce();
    assert.deepEqual(sentTo(customer), ["Thanks for your message. A team member will reply here soon."]);
    assert.equal((await conversationOf(state.gymA, customer)).handler, "human");
    await connection.query("UPDATE whatsapp_agent_settings SET daily_reply_limit = 500 WHERE gym_id = ?", [state.gymA]);
  });

  test("8. the in-app assistant answers a member from the gym's own facts; others and disabled gyms are refused", async () => {
    const asked = await api("POST", `/api/gyms/${state.gymA}/assistant`, tokens.memberA, { question: "What are your timings?" });
    assert.equal(asked.status, 200, JSON.stringify(asked.json));
    assert.deepEqual(asked.json, { reply: "Gym Alpha is open 6am to 10pm every day.", escalated: false, contact: null });
    // The same question again (in different clothes) is answered from the server's cache: no model call, a ₹0 usage row
    const again = await api("POST", `/api/gyms/${state.gymA}/assistant`, tokens.memberA, { question: "  what are YOUR timings " });
    assert.deepEqual(again.json, asked.json);
    const [[cached]] = await connection.query("SELECT COUNT(*) AS n, COALESCE(SUM(input_tokens), 0) AS tokens FROM ai_usage WHERE gym_id = ? AND user_id = ? AND feature = 'gym_assistant' AND from_cache = TRUE", [state.gymA, ids.memberA]);
    assert.deepEqual({ n: Number(cached.n), tokens: Number(cached.tokens) }, { n: 1, tokens: 0 });
    assert.equal((await api("POST", `/api/gyms/${state.gymB}/assistant`, tokens.memberA, { question: "What are your timings?" })).status, 403, "a private gym's assistant is for its members");
    assert.equal((await api("POST", `/api/gyms/${state.gymA}/assistant`, tokens.memberA, { question: "" })).status, 400);
    assert.equal((await api("POST", `/api/gyms/${state.gymA}/assistant`, tokens.memberA, { question: "hi", gymId: state.gymB })).status, 400, "no extra fields");
    assert.equal((await api("POST", `/api/gyms/${state.gymA}/assistant`, "not-a-token", { question: "hi" })).status, 401);
    await connection.query("UPDATE whatsapp_agent_settings SET agent_status = 'disabled' WHERE gym_id = ?", [state.gymA]);
    assert.equal((await api("POST", `/api/gyms/${state.gymA}/assistant`, tokens.memberA, { question: "What are your timings?" })).status, 409);
    await connection.query("UPDATE whatsapp_agent_settings SET agent_status = 'testing' WHERE gym_id = ?", [state.gymA]);
  });

  test("9. the assistant is a paid call: each member gets 20 questions per 10 minutes, then a 429", async () => {
    // Test 8 used 2 of memberA's 20 (the answered one and the disabled-gym one; refusals before the gym check don't count)
    let last = null;
    for (let i = 0; i < 20; i++) {
      last = await api("POST", `/api/gyms/${state.gymA}/assistant`, tokens.memberA, { question: "What are your timings?" });
      if (last.status === 429) break;
    }
    assert.equal(last.status, 429, JSON.stringify(last.json));
    assert.match(last.json.error, /Too many requests/);
  });
});
