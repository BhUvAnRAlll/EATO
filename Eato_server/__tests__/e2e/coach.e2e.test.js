// The AI Coach intake end to end: real Clerk development identities against the real Express
// server and the isolated eato_test database. Covers the prefill from setup and the workout
// profile, saving and replacing the answers, and the attack paths: no or forged session,
// another member's answers, unexpected fields (including a user id), bad options, SQL in text.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const answers = (over = {}) => ({
  goal: "lose_weight", experience: "beginner", currentlyTraining: false, weekdays: [1, 3, 5], sessionMinutes: 45,
  mainSpot: "home", backupSpot: "gym", mainEquipment: "none", backupEquipment: "full_gym", joints: ["knees"], conditions: [],
  limitationNotes: null, cookingTime: "quick", foodBudget: "medium", stress: null, sleep: "7_8", coach: "priya",
  coachStyle: "supportive", planNotes: null, acceptedDisclaimer: true, ...over,
});

describe("coach e2e: the intake, its prefill, and who may see it", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, clerk;
  const identities = {};
  const ids = {};
  const tokens = {};

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const rows = async () => (await connection.query("SELECT COUNT(*) AS n FROM coach_profiles"))[0][0].n;
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      for (const tag of ["a", "b"]) {
        const identity = await clerk.createIdentity(runId, tag);
        const { sessionId, jwt } = await clerk.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        ids[tag] = identity.id;
        tokens[tag] = jwt;
      }
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    // Member A finished setup (muscle gain, gym) and has a workout profile; B has neither
    await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, 'Member A', 'user')", [ids.a, identities.a.emailAddress]);
    await connection.query("INSERT INTO profiles (user_id, goal, workout_type) VALUES (?, 'muscle_gain', 'gym')", [ids.a]);
    await connection.query("INSERT INTO workout_profiles (user_id, experience, weekdays) VALUES (?, 'intermediate', '[2,4,6]')", [ids.a]);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of ["coach_profiles", "workout_profiles", "profiles"]) await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [Object.values(ids)]);
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

  it("1. both routes need a valid session", run(async () => {
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      assert.equal((await api("GET", "/api/coach/intake", token)).status, 401);
      assert.equal((await api("PUT", "/api/coach/intake", token, answers())).status, 401);
    }
    assert.equal(await rows(), 0, "nothing was written");
  }));

  it("2. before the intake: no answers, and a prefill from what setup and the workout profile know", run(async () => {
    const a = await api("GET", "/api/coach/intake", tokens.a);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.deepEqual(a.json, { intake: null, prefill: { goal: "build_muscle", mainSpot: "gym", experience: "intermediate", weekdays: [2, 4, 6] } });
    // B has no users row, no setup and no workout profile yet
    const b = await api("GET", "/api/coach/intake", tokens.b);
    assert.deepEqual(b.json, { intake: null, prefill: {} });
  }));

  it("3. saving stores the caller's answers once; a second save replaces them", run(async () => {
    const first = await api("PUT", "/api/coach/intake", tokens.b, answers({ limitationNotes: "Robert'); DROP TABLE coach_profiles;--" }));
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.intake.coach, "priya");
    assert.equal(first.json.intake.limitationNotes, "Robert'); DROP TABLE coach_profiles;--", "stored as text, never run");
    assert.deepEqual(first.json.intake.weekdays, [1, 3, 5]);

    const second = await api("PUT", "/api/coach/intake", tokens.b, answers({ coach: "arjun", coachStyle: "direct", backupSpot: null, backupEquipment: null }));
    assert.equal(second.status, 200, JSON.stringify(second.json));
    assert.equal(await rows(), 1, "one row per member");
    const [[row]] = await connection.query("SELECT user_id, coach, backup_spot, disclaimer_accepted_at FROM coach_profiles");
    assert.deepEqual({ user: row.user_id, coach: row.coach, backup: row.backup_spot }, { user: ids.b, coach: "arjun", backup: null });
    assert.ok(row.disclaimer_accepted_at instanceof Date);

    const read = await api("GET", "/api/coach/intake", tokens.b);
    assert.equal(read.json.intake.coachStyle, "direct");
  }));

  it("4. a member only ever sees and writes their own answers", run(async () => {
    const a = await api("GET", "/api/coach/intake", tokens.a);
    assert.equal(a.json.intake, null, "B's answers never reach A");
    const sneaky = await api("PUT", "/api/coach/intake", tokens.a, { ...answers(), userId: ids.b });
    assert.equal(sneaky.status, 400);
    const [[row]] = await connection.query("SELECT coach FROM coach_profiles WHERE user_id = ?", [ids.b]);
    assert.equal(row.coach, "arjun", "B's row is untouched");
  }));

  it("5. bad answers are 400s with one friendly line, never 500s, and write nothing", run(async () => {
    const before = await rows();
    const cases = [
      answers({ acceptedDisclaimer: false }),
      answers({ goal: "fly" }),
      answers({ coach: "' OR 1=1 --" }),
      answers({ weekdays: [] }),
      answers({ weekdays: ["1"] }),
      answers({ sessionMinutes: 50 }),
      answers({ mainSpot: "gym", mainEquipment: "none" }),
      answers({ backupSpot: "home", mainSpot: "home" }),
      answers({ joints: ["neck"] }),
      answers({ limitationNotes: 42 }),
    ];
    for (const body of cases) {
      const r = await api("PUT", "/api/coach/intake", tokens.a, body);
      assert.equal(r.status, 400, JSON.stringify(r.json));
      assert.equal(typeof r.json.error, "string");
    }
    assert.equal((await api("PUT", "/api/coach/intake", tokens.a, "{not json")).status, 400);
    assert.equal((await api("PUT", "/api/coach/intake", tokens.a, { ...answers(), planNotes: "x".repeat(20 * 1024) })).status, 413);
    assert.equal(await rows(), before);
  }));
});
