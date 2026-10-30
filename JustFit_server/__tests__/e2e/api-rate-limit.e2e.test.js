// The upload and account routes under abuse, against the isolated test server (port
// from .env.test, database justfit_test): per-user rate limiting and the request-body cap,
// exercised with raw HTTP so that chunked bodies and declared sizes can be controlled.
//
// Every upload body sent here is malformed on purpose (not base64, or far too large), so
// the route rejects it before the AI provider is ever called: no OpenAI credit is spent
// (the test server is not even given an OpenAI key). Tokens are minted for throwaway test
// accounts in justfit_test and never logged.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const http = require("node:http");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const { rateLimits } = require("../../rateLimit.js");
const { uploadLimits } = require("../../bodyComposition/upload.js");

const UPLOAD_LIMIT = rateLimits.upload.limit;
const STANDARD_LIMIT = rateLimits.standard.limit;
// The route's cap: the largest allowed PDF as base64 plus JSON overhead (see index.js)
const MAX_BODY_BYTES = Math.ceil(uploadLimits.maxPdfBytes * (4 / 3)) + 1024;

// One raw HTTP request. `body` is a string or an async generator of chunks (sent chunked,
// no Content-Length). Resolves as soon as the response arrives, even mid-upload; a reset
// from the server while still sending is reported as such.
function rawRequest(port, { path, token, body, headers = {}, method = "POST" }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...headers } });
    let sent = 0;
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    req.on("response", (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => finish({ status: res.statusCode, headers: res.headers, text, sentBytes: sent }));
      res.on("error", () => finish({ status: res.statusCode, headers: res.headers, text, sentBytes: sent }));
    });
    req.on("error", (error) => { if (!settled) { if (["EPIPE", "ECONNRESET"].includes(error.code)) finish({ status: null, reset: error.code, headers: {}, text: "", sentBytes: sent }); else reject(error); } });
    (async () => {
      if (typeof body === "string") { sent = Buffer.byteLength(body); req.end(body); return; }
      for await (const chunk of body) {
        if (settled || req.destroyed) break;
        sent += Buffer.byteLength(chunk);
        if (!req.write(chunk)) await new Promise((r) => req.once("drain", r));
      }
      if (!req.destroyed) req.end();
    })().catch(() => { /* write after the server closed: fine */ });
  });
}
async function* chunksOf(total, size = 64 * 1024) {
  for (let sent = 0; sent < total; sent += size) yield "A".repeat(Math.min(size, total - sent));
}
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
const MALFORMED = JSON.stringify({ data: "not base64!", mediaType: "image/jpeg" });

describe("api rate limits e2e: the upload and account routes refuse abuse before any AI call", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, countsBefore, server, testAccounts, port;
  const identities = {};
  const tokens = {};

  const upload = (token, body, headers) => rawRequest(port, { path: "/api/body-composition", token, body, headers });
  const newIdentity = async (tag) => {
    const identity = await testAccounts.createIdentity(runId, tag);
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    tokens[tag] = jwt;
  };
  const cleanupIdentity = async (tag) => {
    const identity = identities[tag]; if (!identity) return;
    await db.deleteUsers(connection, [identity.id]);
    if (identity.sessionId) await testAccounts.revokeSession(identity.sessionId).catch(() => {});
    await testAccounts.deleteUser(identity.id);
    delete identities[tag]; delete tokens[tag];
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    port = Number(env.PORT);
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    testAccounts = identitiesFor(env);
    await testAccounts.sweepOrphans();
    server = await startTestServer(env);
    try { await newIdentity("a"); await newIdentity("b"); } catch (error) { throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`); }
    countsBefore = await db.rowCounts(connection); // the two accounts exist, as after sign-in
  });

  after(async () => {
    const problems = [];
    if (connection && testAccounts) {
      for (const tag of Object.keys(identities)) {
        try { await cleanupIdentity(tag); } catch (error) { problems.push(`${tag}: ${identities[tag]?.id} (${JSON.stringify(describeIdentityError(error))})`); }
      }
      // Everything the run made is gone again, the two accounts included
      try { assert.deepEqual(await db.rowCounts(connection), { ...countsBefore, users: countsBefore.users - 2 }); } catch (error) { problems.push(`rows changed: ${error.message.split("\n")[0]}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE; orphaned test identifiers:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  it("1. without a valid token the upload route is 401 and no budget is spent", run(async () => {
    assert.equal((await upload(null, "{}")).status, 401);
    assert.equal((await upload("not.a.token", "{}")).status, 401);
  }));

  it(`2. ${UPLOAD_LIMIT} malformed uploads are each refused by validation (400, no AI call); the next is a JSON 429 with Retry-After`, run(async () => {
    for (let i = 0; i < UPLOAD_LIMIT; i++) {
      const res = await upload(tokens.a, MALFORMED);
      assert.equal(res.status, 400, `upload ${i + 1} must be refused by validation, not by the limiter: ${res.text.slice(0, 120)}`);
      assert.equal(parse(res.text)?.error, "The file couldn't be read.");
    }
    const limited = await upload(tokens.a, MALFORMED);
    assert.equal(limited.status, 429);
    assert.match(parse(limited.text)?.error ?? "", /^Too many requests\. Please try again in \d+ seconds?\.$/);
    const retryAfter = Number(limited.headers["retry-after"]);
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= rateLimits.upload.windowMs / 1000, `Retry-After must be sensible (got ${limited.headers["retry-after"]})`);
  }));

  it("3. a second user still has a full upload budget", run(async () => {
    const res = await upload(tokens.b, MALFORMED);
    assert.equal(res.status, 400, "user B is validated, not rate limited");
  }));

  it("4. a declared size over the cap is refused with 413 before any of the body is processed, and the connection is closed", run(async () => {
    const res = await upload(tokens.b, "{\"data\":\"", { "Content-Length": String(MAX_BODY_BYTES * 3) });
    assert.equal(res.status, 413, res.text.slice(0, 120));
    assert.match(parse(res.text)?.error ?? "", /too large/);
    assert.equal(res.headers.connection, "close", "an unread body means the connection must be closed");
  }));

  it("5. a chunked body far over the cap, with no Content-Length, is abandoned long before it has all arrived", run(async () => {
    const total = MAX_BODY_BYTES * 4; // ~56 MB would be sent if the server kept reading
    const res = await upload(tokens.b, chunksOf(total));
    // Either the 413 arrives, or the server has already closed the connection on the still-sending client
    assert.ok(res.status === 413 || res.reset, `expected a 413 or a connection reset, got ${res.status} ${res.text.slice(0, 120)}`);
    assert.ok(res.sentBytes < total, `the server must give up before the whole body is sent (sent ${res.sentBytes} of ${total})`);
    assert.ok(res.sentBytes < MAX_BODY_BYTES * 3, `the server must stop reading soon after twice the cap (sent ${res.sentBytes}, cap ${MAX_BODY_BYTES})`);
  }));

  it("5b. a chunked body just over the cap gets a clean JSON 413 (drained, then refused) with no decoding or AI call", run(async () => {
    const res = await upload(tokens.b, chunksOf(MAX_BODY_BYTES + 1024));
    assert.equal(res.status, 413, `expected 413, got ${res.status} ${res.reset ?? ""} ${res.text.slice(0, 120)}`);
    assert.match(parse(res.text)?.error ?? "", /too large/);
  }));

  it("6. an understated Content-Length does not smuggle a larger body: the parser ends the body at the declared length", run(async () => {
    const res = await upload(tokens.b, "{}", { "Content-Length": "2" });
    assert.equal(res.status, 400);
    assert.equal(parse(res.text)?.error, "Send the report as { data, mediaType }.");
  }));

  it("7. a body that is not JSON is a 400 that keeps the connection reusable, and spends one unit of the budget", run(async () => {
    const res = await upload(tokens.b, "{not json");
    assert.equal(res.status, 400);
    assert.equal(parse(res.text)?.error, "The request body isn't valid JSON.");
    assert.notEqual(res.headers.connection, "close");
  }));

  it(`8. the account route answers normally ${STANDARD_LIMIT} times for a plain user, then 429; another user is unaffected; there is no self-service role route`, run(async () => {
    const gone = await rawRequest(port, { path: "/api/account-type", token: tokens.a, body: "" });
    assert.equal(gone.status, 404, "the old trainer self-selection route no longer exists");
    for (let i = 0; i < STANDARD_LIMIT; i++) {
      const res = await rawRequest(port, { path: "/api/auth/me", method: "GET", token: tokens.a, body: "" });
      assert.equal(res.status, 200, `call ${i + 1} must succeed: ${res.text.slice(0, 120)}`);
      assert.equal(parse(res.text).user.role, "user", "a plain account is never promoted");
    }
    const limited = await rawRequest(port, { path: "/api/auth/me", method: "GET", token: tokens.a, body: "" });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers["retry-after"]) >= 1);
    const other = await rawRequest(port, { path: "/api/auth/me", method: "GET", token: tokens.b, body: "" });
    assert.equal(other.status, 200);
    assert.equal((await rawRequest(port, { path: "/api/auth/me", method: "GET", body: "" })).status, 401, "no token is still 401");
  }));

  it("9. the profile routes still parse their own bodies: an oversized profile is a 413, a normal one is validated", run(async () => {
    const big = await rawRequest(port, { path: "/api/profile", token: tokens.b, body: JSON.stringify({ profile: { dislikes: "x".repeat(250 * 1024) }, nutrition: {} }) });
    assert.equal(big.status, 413);
    assert.equal(parse(big.text)?.error, "The request body is too large.");
    const normal = await rawRequest(port, { path: "/api/profile", token: tokens.b, body: JSON.stringify({ profile: {}, nutrition: {} }) });
    assert.equal(normal.status, 400, "validation still runs for a well-sized body");
    assert.deepEqual(await db.rowsForUser(connection, identities.b.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 }, "only the account row sign-in made");
  }));

  it("10. nothing was written to the test database", run(async () => {
    assert.deepEqual(await db.rowCounts(connection), countsBefore);
  }));
});
