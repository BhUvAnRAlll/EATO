// Per-user rate limiting on the Express profile routes, against the isolated test server
// (port from .env.test, database eato_test) with genuine sessions. The test server
// is started fresh here, so its in-memory counters start empty.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const { rateLimits } = require("../../rateLimit.js");

const LIMIT = rateLimits.standard.limit;

describe("rate limiting e2e: one budget per verified user on /api/profile", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};

  const api = async (method, path, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* non-JSON body */ }
    return { status: response.status, json, retryAfter: response.headers.get("retry-after") };
  };
  const newIdentity = async (tag) => {
    const identity = await testAccounts.createIdentity(runId, tag);
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    tokens[tag] = jwt;
  };
  const cleanupIdentity = async (tag) => {
    const identity = identities[tag];
    if (!identity) return;
    await db.deleteUsers(connection, [identity.id]);
    if (identity.sessionId) await testAccounts.revokeSession(identity.sessionId).catch(() => {});
    await testAccounts.deleteUser(identity.id);
    delete identities[tag];
    delete tokens[tag];
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    testAccounts = identitiesFor(env);
    await testAccounts.sweepOrphans();
    server = await startTestServer(env);
    try { await newIdentity("a"); await newIdentity("b"); } catch (error) { throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`); }
  });

  after(async () => {
    const problems = [];
    if (connection && testAccounts) {
      for (const tag of Object.keys(identities)) {
        try { await cleanupIdentity(tag); } catch (error) { problems.push(`${tag}: ${identities[tag]?.id} (${JSON.stringify(describeIdentityError(error))})`); }
      }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE; orphaned test identifiers:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  it(`1. the first ${LIMIT} requests in a minute succeed; the next is a JSON 429 with Retry-After`, run(async () => {
    for (let i = 0; i < LIMIT; i++) {
      const { status } = await api("GET", "/api/profile", tokens.a);
      assert.equal(status, 200, `request ${i + 1} of ${LIMIT} must still be within the budget`);
    }
    const limited = await api("GET", "/api/profile", tokens.a);
    assert.equal(limited.status, 429);
    assert.match(limited.json.error, /^Too many requests\. Please try again in \d+ seconds?\.$/);
    const retryAfter = Number(limited.retryAfter);
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= rateLimits.standard.windowMs / 1000, `Retry-After must be a sensible number of seconds (got ${limited.retryAfter})`);
  }));

  it("2. the budget is shared by GET and POST: a save from the limited user is refused and writes nothing", run(async () => {
    const { status } = await api("POST", "/api/profile", tokens.a, { profile: {}, nutrition: {} });
    assert.equal(status, 429, "the POST must be refused by the limiter, before validation");
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 }, "only the account row sign-in made");
  }));

  it("3. another user is unaffected: budgets are keyed by the verified user id", run(async () => {
    const { status, json } = await api("GET", "/api/profile", tokens.b);
    assert.equal(status, 200);
    assert.deepEqual(json, { profile: null, nutrition: null });
  }));

  it("4. unauthenticated and malformed-token requests are still 401 (rejected before any budget)", run(async () => {
    assert.equal((await api("GET", "/api/profile", null)).status, 401);
    assert.equal((await api("GET", "/api/profile", "not.a.token")).status, 401);
    assert.equal((await api("POST", "/api/profile", null, { profile: {}, nutrition: {} })).status, 401);
  }));

  it("5. a normal request from a user under the budget still validates and answers as before", run(async () => {
    const { status, json } = await api("POST", "/api/profile", tokens.b, { profile: {}, nutrition: {} });
    assert.equal(status, 400, "validation still runs for a user within the budget");
    assert.equal(typeof json.error, "string");
    assert.deepEqual(await db.rowsForUser(connection, identities.b.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 }, "only the account row sign-in made");
  }));
});
