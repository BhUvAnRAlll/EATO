// Voice questions for the coach chat end to end: a test account in justfit_test against the real
// Express server with the fake AI (never a paid model). Covers the happy path in each language
// (the text comes back, nothing is stored but one ai_usage row under coach_voice), and the attack
// paths: no or forged session, bytes that aren't audio, a mismatched label, an oversized body
// refused before parsing, unexpected fields (a user id included), a language not offered, and
// the per-member clip budget.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const { voiceLimits, FAKE_TRANSCRIPTS } = require("../../coach/voiceRules.js");

const b64 = (bytes, padTo = 0) => {
  const all = new Uint8Array(Math.max(bytes.length, padTo));
  all.set(bytes);
  return Buffer.from(all).toString("base64");
};
const M4A = b64([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20], 512);
const WAV = b64([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45], 512);
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0], 512);
const clip = (language = "kn-IN") => ({ data: M4A, mediaType: "audio/mp4", language });

describe("coach voice e2e: POST /api/coach/voice", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const ids = {};
  const tokens = {};

  const api = async (method, route, token, body, raw) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const voice = (token, body, raw) => api("POST", "/api/coach/voice", token, body, raw);
  const usageRows = async (userId) => (await connection.query("SELECT feature, model, status FROM ai_usage WHERE user_id = ? ORDER BY id", [userId]))[0];
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" });
    try {
      for (const tag of ["a", "b"]) {
        const identity = await testAccounts.createIdentity(runId, tag);
        const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        ids[tag] = identity.id;
        tokens[tag] = jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        await connection.query("DELETE FROM ai_usage WHERE user_id IN (?)", [Object.values(ids)]);
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
    if (problems.length) console.warn(`cleanup problems: ${problems.join("; ")}`);
  });

  it("1. a clip comes back as text in the asked language, recorded once under coach_voice and stored nowhere", run(async () => {
    for (const [language, code] of [["kn-IN", "kn"], ["hi-IN", "hi"], ["en-IN", "en"]]) {
      const result = await voice(tokens.a, clip(language));
      assert.equal(result.status, 200, JSON.stringify(result.json));
      assert.deepEqual(result.json, { text: FAKE_TRANSCRIPTS[code] });
    }
    const rows = await usageRows(ids.a);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.feature === "coach_voice" && row.status === "ok"), JSON.stringify(rows));
    // A WAV clip is fine too
    assert.equal((await voice(tokens.a, { data: WAV, mediaType: "audio/wav", language: "kn-IN" })).status, 200);
    // Nothing of the clip or the text is kept anywhere: no chat message was written
    const [[chat]] = await connection.query("SELECT COUNT(*) AS n FROM coach_chat_messages WHERE user_id = ?", [ids.a]);
    assert.equal(chat.n, 0);
  }));

  it("2. no session, a forged session and a body with no caller are refused", run(async () => {
    assert.equal((await voice(null, clip())).status, 401);
    assert.equal((await voice("jfs_" + "a".repeat(43), clip())).status, 401);
    assert.equal((await api("POST", "/api/coach/voice", tokens.a, { ...clip(), userId: ids.b })).status, 400);
    assert.equal((await usageRows(ids.b)).length, 0, "nothing is ever recorded against another member");
  }));

  it("3. bytes that aren't audio, a mismatched label, a language not offered and a bad body are refused without a call", run(async () => {
    const before = (await usageRows(ids.b)).length;
    assert.equal((await voice(tokens.b, { data: JPEG, mediaType: "audio/mp4", language: "kn-IN" })).status, 415);
    assert.equal((await voice(tokens.b, { data: M4A, mediaType: "audio/wav", language: "kn-IN" })).status, 415);
    assert.equal((await voice(tokens.b, { data: M4A, mediaType: "audio/mp4", language: "ta-IN" })).status, 400);
    assert.equal((await voice(tokens.b, { data: "' OR 1=1 --", mediaType: "audio/mp4", language: "kn-IN" })).status, 400);
    assert.equal((await voice(tokens.b, [])).status, 400);
    assert.equal((await voice(tokens.b, undefined, "not json")).status, 400);
    assert.equal((await usageRows(ids.b)).length, before, "a refused clip costs nothing");
  }));

  it("4. a body over the cap is refused before it is parsed", run(async () => {
    const huge = { data: b64([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], voiceLimits.maxAudioBytes + 4096), mediaType: "audio/mp4", language: "kn-IN" };
    const result = await voice(tokens.b, huge);
    assert.equal(result.status, 413, JSON.stringify(result.json));
  }));

  it("5. the clip budget: the 21st clip in an hour is refused", run(async () => {
    const results = [];
    for (let i = 0; i < 21; i += 1) results.push((await voice(tokens.b, clip())).status);
    const okCount = results.filter((s) => s === 200).length;
    assert.ok(okCount <= 20 && okCount >= 1, `at most 20 clips an hour (got ${okCount} ok)`);
    assert.equal(results.at(-1), 429, `the 21st is refused: ${results.join(",")}`);
  }));
});
