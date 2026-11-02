// The AI Coach's Insights tab end to end: test accounts in justfit_test against the real Express
// server, with the fake AI (never a paid model). Covers the week's numbers from real rows (meals,
// targets, weigh-ins), the empty state, the review written once and served from coach_insights after
// (one ai_usage row), refresh at most once a day, a weight change in the profile adding a weigh-in,
// and the attack paths: no session, unexpected fields (a user id), bad weeks and dates, and one
// member never seeing another's numbers or review.
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

describe("coach insights e2e: the week's numbers and the coach's review", () => {
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
  const aiCalls = async (userId) => (await connection.query("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND feature = 'coach_insights'", [userId]))[0][0].n;
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
        for (const table of ["coach_insights", "ai_usage", "macro_meal_items", "macro_meal_logs", "weigh_ins", "nutrition_targets", "coach_profiles", "profiles"]) {
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

  it("1. both routes need a valid session", run(async () => {
    for (const token of [null, "not-a-jwt"]) {
      assert.equal((await api("GET", `/api/coach/insights?today=${today}`, token)).status, 401);
      assert.equal((await api("POST", "/api/coach/insights/review", token, { today })).status, 401);
    }
  }));

  it("2. bad input is refused with a plain message", run(async () => {
    assert.equal((await api("GET", `/api/coach/insights?today=${today}&week=next`, tokens.a)).status, 400);
    assert.equal((await api("GET", "/api/coach/insights?today=2020-01-01", tokens.a)).status, 400);
    const forged = await api("POST", "/api/coach/insights/review", tokens.a, { today, userId: ids.b });
    assert.equal(forged.status, 400);
    assert.match(forged.json.error, /Unexpected field: userId/);
  }));

  it("3. the week's numbers come from the member's own rows", run(async () => {
    await api("PUT", "/api/coach/intake", tokens.a, intake);
    const r = await api("GET", `/api/coach/insights?today=${today}`, tokens.a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.week.today, today);
    assert.equal(r.json.nutrition.daysLogged, 1);
    assert.equal(r.json.nutrition.avg.kcal, 1800);
    assert.equal(r.json.nutrition.macros.proteinG.percent, 75);
    assert.equal(r.json.nutrition.macros.proteinG.verdict, "low");
    assert.deepEqual(r.json.weight.current, { date: today, kg: 79 });
    assert.equal(r.json.weight.change, -1.5);
    assert.equal(r.json.weight.direction, "lose");
    assert.equal(r.json.review, null);
    assert.equal(r.json.canReview, true);
  }));

  it("4. a member with nothing logged gets empty sections, never zeros or made-up values", run(async () => {
    await api("PUT", "/api/coach/intake", tokens.b, intake);
    const r = await api("GET", `/api/coach/insights?today=${today}`, tokens.b);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.nutrition, null);
    assert.equal(r.json.weight, null);
    assert.equal(r.json.canReview, false);
    const review = await api("POST", "/api/coach/insights/review", tokens.b, { today });
    assert.equal(review.status, 400);
    assert.match(review.json.error, /Log a meal/);
    assert.equal(await aiCalls(ids.b), 0, "no AI call without data");
  }));

  it("5. the review is written once and served from the database after", run(async () => {
    const first = await api("POST", "/api/coach/insights/review", tokens.a, { today });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.match(first.json.review.summary, /test review/);
    assert.ok(first.json.review.tips.length >= 1);
    assert.equal(first.json.review.stale, false);
    assert.equal(first.json.review.canRefresh, false);
    const again = await api("POST", "/api/coach/insights/review", tokens.a, { today });
    assert.equal(again.json.review.createdAt, first.json.review.createdAt);
    const read = await api("GET", `/api/coach/insights?today=${today}`, tokens.a);
    assert.equal(read.json.review.summary, first.json.review.summary);
    assert.equal(await aiCalls(ids.a), 1, "one AI call for the week");
  }));

  it("6. a refresh with new data is allowed once a day", run(async () => {
    await logMeal(ids.a, today, 400, 30);
    const stale = await api("GET", `/api/coach/insights?today=${today}`, tokens.a);
    assert.equal(stale.json.review.stale, true, "the numbers moved since the review");
    const refused = await api("POST", "/api/coach/insights/review", tokens.a, { today, refresh: true });
    assert.equal(refused.status, 429);
    assert.match(refused.json.error, /tomorrow/);
    // As if the review had been written yesterday
    await connection.query("UPDATE coach_insights SET made_on = ? WHERE user_id = ?", [appDay(-1), ids.a]);
    const refreshed = await api("POST", "/api/coach/insights/review", tokens.a, { today, refresh: true });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.json));
    assert.equal(refreshed.json.review.stale, false);
    assert.equal(await aiCalls(ids.a), 2);
  }));

  it("7. one member never sees another's numbers or review", run(async () => {
    const b = await api("GET", `/api/coach/insights?today=${today}`, tokens.b);
    assert.equal(b.json.review, null);
    assert.equal(b.json.nutrition, null);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM coach_insights WHERE user_id = ?", [ids.b]);
    assert.equal(n, 0);
  }));

  it("8. last week has its own numbers (nothing logged there)", run(async () => {
    const r = await api("GET", `/api/coach/insights?today=${today}&week=last`, tokens.a);
    assert.equal(r.status, 200);
    assert.equal(r.json.week.elapsed, 7);
    assert.equal(r.json.nutrition, null);
    assert.equal(r.json.review, null);
    // The weight shown is the one known by the end of that week
    assert.equal(r.json.weight.current.kg, 80.5);
  }));
});
