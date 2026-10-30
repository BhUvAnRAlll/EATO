// The photo body-fat scan end to end: a test account in eato_test against the real
// Express server, with a local fake standing in for the Forma scan server (FORMA_SCAN_URL).
// Covers the happy path, Forma's refusals and outages, and the attack paths: no or forged
// session, oversized bodies, non-image bytes, out-of-range inputs, unexpected fields and the
// per-user scan budget. Nothing touches the database beyond the harness's own set-up.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const http = require("node:http");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const { rateLimits } = require("../../rateLimit.js");
const { scanLimits } = require("../../bodyComposition/scan.js");

const toBase64 = (bytes, padTo = 0) => {
  const all = new Uint8Array(Math.max(bytes.length, padTo));
  all.set(bytes);
  return Buffer.from(all).toString("base64");
};
const JPEG = toBase64([0xff, 0xd8, 0xff, 0xe0], 256);
const PDF = toBase64([0x25, 0x50, 0x44, 0x46, 0x2d], 256);
const valid = { front: JPEG, side: JPEG, heightCm: 173, weightKg: 75.3, age: 18, sex: "male" };
const formaResult = { model_version: "1.1.0", body_fat: { pct: 23.04, uncertainty_pct_points: 3.94, basis: "model estimate" }, derived: { fat: 17.34, lean: 58.06, bmi: 24.66 }, visceral_level: { value: 8, basis: "heuristic" } };

// A stand-in for Forma's POST /scan whose answer the test picks per request
function startFakeForma() {
  const fake = { mode: "ok", received: [], url: null, server: null };
  fake.server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* keep null */ }
      fake.received.push({ method: req.method, path: req.url, body });
      const answer = (status, json) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(json)); };
      if (req.method !== "POST" || req.url !== "/scan") return answer(404, { error: "not found" });
      if (fake.mode === "refuse") return answer(400, { error: "The side photo is too blurred to analyse. Retake it in good light with a steady hand." });
      if (fake.mode === "crash") return answer(500, { error: "scan failed; please try again" });
      if (fake.mode === "hang") return req.socket.destroy();
      answer(200, formaResult);
    });
  });
  return new Promise((resolve) => fake.server.listen(0, "127.0.0.1", () => {
    fake.url = `http://127.0.0.1:${fake.server.address().port}`;
    resolve(fake);
  }));
}

describe("body scan e2e: POST /api/body-composition/scan", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, fake;
  const identities = {};
  const tokens = {};

  const scan = async (token, body, raw) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}/api/body-composition/scan`, { method: "POST", headers, body: raw ?? JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const newIdentity = async (tag) => {
    const identity = await testAccounts.createIdentity(runId, tag, {});
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    tokens[tag] = jwt;
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    testAccounts = identitiesFor(env);
    fake = await startFakeForma();
    server = await startTestServer({ ...env, FORMA_SCAN_URL: fake.url });
    try {
      // Every authenticated attempt, valid or not, counts against the account's scan budget
      // (10 per 10 minutes), so each group of tests spends its own account's
      await newIdentity("member"); // the happy path and Forma's failures
      await newIdentity("checker"); // the refused inputs
      await newIdentity("big"); // the oversized body
      await newIdentity("other"); // the budget itself
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
  });

  after(async () => {
    const problems = [];
    if (testAccounts) for (const tag of Object.keys(identities)) {
      try {
        if (identities[tag].sessionId) await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (fake?.server) await new Promise((resolve) => fake.server.close(resolve));
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  it("1. needs a valid session", run(async () => {
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      const r = await scan(token, valid);
      assert.equal(r.status, 401, `token ${token}`);
    }
    assert.equal(fake.received.length, 0, "nothing reaches Forma without a session");
  }));

  it("2. returns the estimate and its body composition report, and forwards only the expected fields (no Forma HTML report)", run(async () => {
    fake.mode = "ok";
    const r = await scan(tokens.member, { ...valid, flipSide: true });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.estimate.percentBodyFat, 23);
    assert.equal(r.json.estimate.report.fatMassKg, 17.3);
    assert.equal(r.json.estimate.report.leanMassKg, 58.1);
    assert.equal(r.json.estimate.report.visceralFatLevel, 8);
    assert.deepEqual(Object.keys(r.json.estimate).sort(), ["percentBodyFat", "report"], "no model version, uncertainty or explanation is sent to the app");
    const sent = fake.received.at(-1);
    assert.equal(sent.path, "/scan");
    assert.deepEqual(Object.keys(sent.body).sort(), ["age", "ethnicity", "flip_side", "front", "height_cm", "include_report", "sex", "side", "weight_kg"]);
    assert.equal(sent.body.ethnicity, "asian");
    assert.equal(sent.body.include_report, false);
    assert.equal(sent.body.flip_side, true);
    assert.equal(sent.body.front, JPEG);
  }));

  it("3. refuses bad photos and inputs before Forma sees them", run(async () => {
    const before = fake.received.length;
    const cases = [
      [{ ...valid, front: PDF }, 415],
      [{ ...valid, side: "not base64!!" }, 400],
      [{ ...valid, side: undefined }, 400],
      [{ ...valid, heightCm: 260 }, 400],
      [{ ...valid, age: 18.5 }, 400],
      [{ ...valid, sex: "other" }, 400],
      [{ ...valid, userId: "someone-else" }, 400],
      [{ ...valid, front: toBase64([0xff, 0xd8, 0xff, 0xe0], scanLimits.maxImageBytes + 1) }, 413],
    ];
    for (const [body, expected] of cases) {
      const r = await scan(tokens.checker, body);
      assert.equal(r.status, expected, JSON.stringify(r.json));
      assert.equal(typeof r.json.error, "string");
    }
    const notJson = await scan(tokens.checker, null, "{not json");
    assert.equal(notJson.status, 400);
    assert.equal(fake.received.length, before, "nothing reached Forma");
  }));

  it("4. a body over the cap is refused while it is still arriving", run(async () => {
    const huge = { ...valid, front: toBase64([0xff, 0xd8, 0xff, 0xe0], 2 * scanLimits.maxImageBytes) };
    const r = await scan(tokens.big, huge);
    assert.equal(r.status, 413);
  }));

  it("5. Forma's refusal reaches the user as 422 with its message", run(async () => {
    fake.mode = "refuse";
    const r = await scan(tokens.member, valid);
    assert.equal(r.status, 422);
    assert.match(r.json.error, /side photo is too blurred/);
  }));

  it("6. a Forma crash or dropped connection is one safe line, never its internals", run(async () => {
    fake.mode = "crash";
    const crashed = await scan(tokens.member, valid);
    assert.equal(crashed.status, 502);
    assert.doesNotMatch(crashed.json.error, /scan failed; please try again|Traceback/);
    fake.mode = "hang";
    const dropped = await scan(tokens.member, valid);
    assert.equal(dropped.status, 502);
    assert.equal(typeof dropped.json.error, "string");
    fake.mode = "ok";
  }));

  it("7. each account has a scan budget", run(async () => {
    const used = fake.received.length; // calls that counted so far are per account in-memory; use a fresh account
    let last;
    for (let i = 0; i < rateLimits.upload.limit + 1; i += 1) last = await scan(tokens.other, valid);
    assert.equal(last.status, 429);
    assert.ok(fake.received.length <= used + rateLimits.upload.limit, "the refused scan never reached Forma");
  }));
});
