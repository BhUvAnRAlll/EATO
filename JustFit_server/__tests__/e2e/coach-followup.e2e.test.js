// The AI Coach's daily follow-up end to end: test accounts in justfit_test against the real Express
// server, with the fake AI (never a paid model). Covers auth, bad input, the intake first, the
// check-in written once a day (one ai_usage row) and saved in the chat, and one member never
// reading another's.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { appDay } = require("./dates.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const intake = {
  goal: "lose_weight", experience: "beginner", currentlyTraining: false, weekdays: [1, 3, 5], sessionMinutes: 45,
  mainSpot: "home", backupSpot: null, mainEquipment: "none", backupEquipment: null, joints: [], conditions: [],
  limitationNotes: null, cookingTime: "quick", foodBudget: "medium", stress: null, sleep: "7_8", coach: "priya",
  coachStyle: "supportive", planNotes: null, acceptedDisclaimer: true,
};

describe("coach follow-up e2e: the daily check-in", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const ids = {};
  const tokens = {};
  const today = appDay();

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const aiCalls = async (userId) => (await connection.query("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND feature = 'coach_followup'", [userId]))[0][0].n;
  const logMeal = async (userId, date, kcal, proteinG) => {
    const id = crypto.randomUUID();
    await connection.query("INSERT INTO macro_meal_logs (id, user_id, log_date, slot, title, logged_at) VALUES (?, ?, ?, 'lunch', 'Dal rice', NOW(3))", [id, userId, date]);
    await connection.query(
      "INSERT INTO macro_meal_items (macro_meal_id, user_id, position, name, quantity, unit, kcal, protein_g, carbs_g, fat_g) VALUES (?, ?, 0, 'Dal rice', 1, 'bowl', ?, ?, 200, 50)",
      [id, userId, kcal, proteinG],
    );
  };

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
    // Member A: vegetarian, targets, two weigh-ins and a meal today. B: the intake only.
    for (const tag of ["a", "b"]) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user') ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)", [ids[tag], identities[tag].emailAddress, `Member ${tag}`]);
    }
    await connection.query("INSERT INTO profiles (user_id, goal, weight_kg, diet, allergies) VALUES (?, 'fat_loss', 79, 'vegetarian', '')", [ids.a]);
    await connection.query(
      "INSERT INTO nutrition_targets (user_id, formula, config_version, inputs, calculated_at, calories, protein_g, carbs_g, fat_g) VALUES (?, 'justfit-calculator', 'test', '{}', NOW(), 2000, 120, 220, 60)",
      [ids.a],
    );
    await connection.query("INSERT INTO weigh_ins (user_id, logged_on, weight_kg) VALUES (?, ?, 80.5), (?, ?, 79)", [ids.a, appDay(-20), ids.a, today]);
    await logMeal(ids.a, today, 1800, 90);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of ["coach_chat_messages", "coach_chats", "ai_usage", "macro_meal_items", "macro_meal_logs", "weigh_ins", "nutrition_targets", "coach_profiles", "profiles"]) {
          await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [Object.values(ids)]);
        }
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

  it("1. needs a valid session", run(async () => {
    for (const token of [null, "not-a-jwt"]) assert.equal((await api("POST", "/api/coach/followup", token, { date: today })).status, 401);
  }));

  it("2. bad input is refused, and a member without the intake is told to answer it", run(async () => {
    const forged = await api("POST", "/api/coach/followup", tokens.a, { date: today, userId: ids.b });
    assert.equal(forged.status, 400);
    assert.match(forged.json.error, /Unexpected field: userId/);
    assert.equal((await api("POST", "/api/coach/followup", tokens.a, { date: "2020-01-01" })).status, 400);
    assert.equal((await api("POST", "/api/coach/followup", tokens.a, { date: "today' OR 1=1 --" })).status, 400);
    const early = await api("POST", "/api/coach/followup", tokens.a, { date: today });
    assert.equal(early.status, 400);
    assert.equal(await aiCalls(ids.a), 0);
  }));

  it("3. the check-in is written once a day and saved in the chat", run(async () => {
    assert.equal((await api("PUT", "/api/coach/intake", tokens.a, intake)).status, 200);
    const first = await api("POST", "/api/coach/followup", tokens.a, { date: today });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.message.role, "coach");
    assert.match(first.json.message.text, /test follow-up/);
    const again = await api("POST", "/api/coach/followup", tokens.a, { date: today });
    assert.equal(again.status, 200);
    assert.equal(again.json.message.id, first.json.message.id);
    assert.equal(await aiCalls(ids.a), 1);
    const chat = await api("GET", "/api/coach/chat", tokens.a);
    assert.equal(chat.status, 200);
    assert.deepEqual(chat.json.messages.map((m) => m.id), [first.json.message.id]);
  }));

  it("4. one member never sees another's check-in", run(async () => {
    assert.equal((await api("PUT", "/api/coach/intake", tokens.b, intake)).status, 200);
    const chat = await api("GET", "/api/coach/chat", tokens.b);
    assert.equal(chat.json.messages.length, 0);
    const own = await api("POST", "/api/coach/followup", tokens.b, { date: today });
    assert.equal(own.status, 200);
    const a = await api("GET", "/api/coach/chat", tokens.a);
    assert.ok(!a.json.messages.some((m) => m.id === own.json.message.id));
  }));
});
