// Genuine authenticated onboarding tests: test accounts with real
// sessions in justfit_test, calling the real Express server (index.js) over HTTP, writing to
// the isolated `justfit_test` database as the `justfit_test` account. Nothing here can reach
// the application database: the account has no privileges on it.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const nutrition = require("../../../JustFit_client/src/lib/nutrition/index.ts");

// The setup answers and the record exactly as the targets screen would send them
const inputs = { age: 30, gender: "female", heightCm: 165, weightKg: 60, activityLevel: "lightly_active", fitnessGoal: "maintenance", healthFlags: [] };
const birth = new Date(); birth.setFullYear(birth.getFullYear() - inputs.age);
const pad = (n) => String(n).padStart(2, "0");
const dob = `${pad(birth.getDate())}/${pad(birth.getMonth() + 1)}/${birth.getFullYear()}`;
const profileFor = (fullName, overrides = {}) => ({
  fullName, dob, gender: "female", phone: "9000000001", email: "typed-and-ignored@example.com", goal: "maintenance",
  heightCm: "165", weightKg: "60", bodyFatPercent: "", age: "30", activity: "lightly_active", healthFlags: [], diet: "vegan",
  cuisines: ["South Indian"], dislikes: "", allergies: "", workoutFrequency: "3-4", workoutType: "home", workoutTime: "evening", mealsPerDay: "3",
  ...overrides,
});
const calculation = nutrition.calculateTargets(inputs);
assert.equal(calculation.status, "ok");
const record = nutrition.createTargetRecord(inputs, calculation);

describe("onboarding e2e: sessions → Express → justfit_test", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {}; // tag → { id, emailAddress, sessionId }
  const tokens = {}; // tag → session JWT (never logged)

  const api = async (method, path, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* non-JSON body */ }
    return { status: response.status, json };
  };
  const newIdentity = async (tag) => {
    const identity = await testAccounts.createIdentity(runId, tag);
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    tokens[tag] = jwt;
    return identities[tag];
  };
  // Removes everything one identity owns: rows (test account's own DELETE), session, user
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
    try {
      connection = await db.connect(env);
    } catch (error) {
      skipReason = `test database unreachable (${error?.code ?? "refused"})`;
      return;
    }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    const swept = await testAccounts.sweepOrphans();
    if (swept.length > 0) console.log(`swept ${swept.length} orphaned test identities from earlier runs`);
    server = await startTestServer(env);
    try {
      await newIdentity("a");
      await newIdentity("b");
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
  });

  after(async () => {
    const problems = [];
    if (connection && testAccounts) {
      for (const tag of Object.keys(identities)) {
        try { await cleanupIdentity(tag); } catch (error) { problems.push(`${tag}: ${identities[tag]?.id} (${JSON.stringify(describeIdentityError(error))})`); }
      }
      try {
        assert.deepEqual(await db.rowCounts(connection), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 0 });
      } catch (error) { problems.push(`rows left in justfit_test: ${error.message.split("\n")[0]}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) {
      // Ids only: no emails, tokens or row contents
      console.error("CLEANUP INCOMPLETE; orphaned test identifiers:", problems.join("; "));
      throw new Error("cleanup incomplete");
    }
  });

  it("1. a signed-in user with no profile loads nulls", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const { status, json } = await api("GET", "/api/profile", tokens.a);
    assert.equal(status, 200);
    assert.deepEqual(json, { profile: null, nutrition: null });
  });

  it("2. missing, malformed and unknown-key tokens are rejected", async (t) => {
    if (skipReason) return t.skip(skipReason);
    assert.equal((await api("GET", "/api/profile", null)).status, 401);
    assert.equal((await api("GET", "/api/profile", "not.a.token")).status, 401);
    assert.equal((await api("POST", "/api/profile", "eyJhbGciOiJSUzI1NiIsImtpZCI6Im5vcGUifQ.eyJzdWIiOiJ1c2VyX3gifQ.sig", { profile: {}, nutrition: {} })).status, 401);
    // Only the two test accounts' own rows (made at sign-in): the rejected requests wrote nothing
    assert.deepEqual(await db.rowCounts(connection), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 2 });
  });

  it("3. finishing setup saves the profile and targets for the verified user", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const { status, json } = await api("POST", "/api/profile", tokens.a, { profile: profileFor("E2E A"), nutrition: record });
    assert.equal(status, 200, JSON.stringify(json));
    assert.deepEqual(json, { saved: true });
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 });
    const [[row]] = await connection.query("SELECT email, role FROM users WHERE id = ?", [identities.a.id]);
    assert.equal(row.email, identities.a.emailAddress, "email must come from the account, not the typed field");
    assert.equal(row.role, "user");
  });

  it("4. reloading returns the saved profile and a record the app's verifier accepts", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const { status, json } = await api("GET", "/api/profile", tokens.a);
    assert.equal(status, 200);
    assert.equal(json.profile.fullName, "E2E A");
    assert.equal(json.profile.email, identities.a.emailAddress);
    assert.equal(json.profile.goal, "maintenance");
    assert.equal(json.profile.diet, "vegan");
    assert.equal(json.profile.profileComplete, true);
    assert.equal(json.nutrition.active.calories, record.active.calories);
    const verified = nutrition.verifyStoredRecord(json.nutrition);
    assert.ok(verified.ok, "verifyStoredRecord: " + (verified.error ?? "stale"));
  });

  it("5. repeating the save, and saving a changed answer, never duplicates rows", async (t) => {
    if (skipReason) return t.skip(skipReason);
    assert.equal((await api("POST", "/api/profile", tokens.a, { profile: profileFor("E2E A"), nutrition: record })).status, 200);
    assert.equal((await api("POST", "/api/profile", tokens.a, { profile: profileFor("E2E A", { diet: "vegetarian" }), nutrition: record })).status, 200);
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 0, profiles: 1, users: 1 });
    assert.equal((await api("GET", "/api/profile", tokens.a)).json.profile.diet, "vegetarian");
  });

  it("6. users are isolated: B sees nothing of A and cannot claim A's report", async (t) => {
    if (skipReason) return t.skip(skipReason);
    assert.deepEqual((await api("GET", "/api/profile", tokens.b)).json, { profile: null, nutrition: null });
    // A saves again with a confirmed uploaded report, which becomes A's report row
    const upload = { ...nutrition.manualBodyFatReport(60, 25), id: crypto.randomUUID(), source: "upload", format: "inbody", confirmed: true, confirmedAt: new Date().toISOString() };
    const withReport = { ...inputs, bodyComposition: upload };
    const calc = nutrition.calculateTargets(withReport);
    assert.equal(calc.status, "ok");
    const reportRecord = nutrition.createTargetRecord(withReport, calc);
    assert.equal((await api("POST", "/api/profile", tokens.a, { profile: profileFor("E2E A", { bodyFatPercent: "25" }), nutrition: reportRecord })).status, 200);
    assert.deepEqual(await db.rowsForUser(connection, identities.a.id), { nutrition_targets: 1, body_composition_reports: 1, profiles: 1, users: 1 });
    // B tries to save the same report under B's identity
    const rejected = await api("POST", "/api/profile", tokens.b, { profile: profileFor("E2E B", { bodyFatPercent: "25" }), nutrition: reportRecord });
    assert.equal(rejected.status, 400);
    assert.match(rejected.json.error, /different account/);
    // B's account row exists from sign-in; the rejected save must add nothing to it (transaction rolled back)
    assert.deepEqual(await db.rowsForUser(connection, identities.b.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 1 }, "the rejected save must leave B nothing (transaction rolled back)");
    const [[owner]] = await connection.query("SELECT user_id FROM body_composition_reports WHERE id = ?", [upload.id]);
    assert.equal(owner.user_id, identities.a.id);
    // B's own save works and A's data is untouched
    assert.equal((await api("POST", "/api/profile", tokens.b, { profile: profileFor("E2E B"), nutrition: record })).status, 200);
    assert.equal((await api("GET", "/api/profile", tokens.b)).json.profile.email, identities.b.emailAddress);
    assert.equal((await api("GET", "/api/profile", tokens.a)).json.profile.fullName, "E2E A");
  });

  it("7. a revoked session is rejected at once, and an expired one once it expires", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const second = await testAccounts.mintToken(identities.a.id);
    assert.equal((await api("GET", "/api/profile", second.jwt)).status, 200, "a token from a second session works");
    await testAccounts.revokeSession(second.sessionId);
    await assert.rejects(testAccounts.tokenFor(second.sessionId), "a revoked session has no live token");
    assert.equal((await api("GET", "/api/profile", second.jwt)).status, 401, "sessions live in the database: revoked means rejected now");
    const short = await testAccounts.mintToken(identities.a.id, 2);
    assert.equal((await api("GET", "/api/profile", short.jwt)).status, 200, "a short session works until it expires");
    await new Promise((r) => setTimeout(r, 3500));
    assert.equal((await api("GET", "/api/profile", short.jwt)).status, 401, "expired token must be rejected");
    assert.equal((await api("GET", "/api/profile", tokens.a)).status, 200, "A's original session is unaffected");
  });

  it("8. cleanup works after a simulated failed run: rows, session and user are gone", async (t) => {
    if (skipReason) return t.skip(skipReason);
    const c = await newIdentity("c");
    assert.equal((await api("POST", "/api/profile", tokens.c, { profile: profileFor("E2E C"), nutrition: record })).status, 200);
    assert.equal((await db.rowsForUser(connection, c.id)).users, 1);
    // "the run died here"; the cleanup routine must still fully reverse it
    await cleanupIdentity("c");
    assert.deepEqual(await db.rowsForUser(connection, c.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 0, users: 0 });
    assert.equal(await testAccounts.userExists(c.id), false);
  });
});
