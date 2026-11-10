// Setup's personal-only save, Profile › Food preferences and the AI Coach intake's profile answers
// (2026-11-10) end to end against justfit_test. Covers: a save without targets; a second
// personal-only save keeps the saved goal and food answers and recalculates calculated targets;
// the food route changes only food and refuses unexpected fields; the intake saves activity,
// health and food to the profile and works out the targets in the same transaction (never
// pregnancy for a man, a health tick sends the target to a professional, a failed intake writes
// nothing); and every route is the caller's own.
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const personal = (overrides = {}) => ({
  fullName: "Onboard Tester", dob: "02/04/1996", gender: "female", heightCm: "165", weightKg: "62", phone: "", email: "",
  goal: null, activity: null, healthFlags: [], diet: null, cuisines: [], dislikes: "", allergies: "", mealsPerDay: null,
  bodyFatPercent: "", age: "30", workoutFrequency: null, workoutType: null, workoutTime: null, ...overrides,
});
const intake = (profile, overrides = {}) => ({
  goal: "lose_weight", experience: "beginner", currentlyTraining: false, weekdays: [1, 3, 5], sessionMinutes: 45,
  mainSpot: "home", backupSpot: null, mainEquipment: "none", backupEquipment: null, joints: [], conditions: [],
  limitationNotes: null, cookingTime: "quick", foodBudget: "medium", stress: null, sleep: null, coach: "priya",
  coachStyle: "supportive", planNotes: null, acceptedDisclaimer: true, profile, ...overrides,
});
const answers = { activity: "lightly_active", healthFlags: [], diet: "vegetarian", cuisines: ["South Indian"], dislikes: "", allergies: "peanuts", mealsPerDay: "3" };

describe("onboarding profile e2e: personal-only setup, food preferences, the coach intake's profile answers", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};

  const call = async (token, method, url, body) => {
    const response = await fetch(`${server.baseUrl}${url}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, body: json };
  };
  const newIdentity = async (tag) => {
    const identity = await testAccounts.createIdentity(runId, tag, {});
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    tokens[tag] = jwt;
  };
  const row = async (tag, sql) => (await connection.query(sql, [identities[tag].id]))[0][0];
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const tag of ["asha", "ravi", "pregnant", "nobody"]) await newIdentity(tag);
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
  });

  after(async () => {
    const problems = [];
    if (testAccounts) for (const tag of Object.keys(identities)) {
      try {
        await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. setup's personal details save without targets; Home's day has none", run(async () => {
    const r = await call(tokens.asha, "POST", "/api/profile", { profile: personal() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await db.rowsForUser(connection, identities.asha.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 1, users: 1 });
    const p = await row("asha", "SELECT profile_complete, goal, height_cm FROM profiles WHERE user_id = ?");
    assert.deepEqual({ complete: p.profile_complete, goal: p.goal, height: Number(p.height_cm) }, { complete: 1, goal: null, height: 165 });
    assert.equal((await call(tokens.asha, "POST", "/api/profile", { profile: personal({ heightCm: "90" }) })).status, 400);
    assert.equal((await call(null, "POST", "/api/profile", { profile: personal() })).status, 401);
  }));

  it("2. Food preferences changes only the food answers, for the caller, and refuses unexpected fields", run(async () => {
    const food = { diet: "vegan", cuisines: ["North Indian"], dislikes: "okra", allergies: "", mealsPerDay: "4" };
    const r = await call(tokens.asha, "PUT", "/api/profile/food", food);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const p = await row("asha", "SELECT diet, cuisines, dislikes, allergies, meals_per_day, height_cm FROM profiles WHERE user_id = ?");
    assert.deepEqual({ diet: p.diet, dislikes: p.dislikes, allergies: p.allergies, meals: p.meals_per_day, height: Number(p.height_cm) }, { diet: "vegan", dislikes: "okra", allergies: null, meals: "4", height: 165 });
    assert.equal((await call(tokens.asha, "PUT", "/api/profile/food", { ...food, heightCm: 200 })).status, 400, "only food fields");
    assert.equal((await call(tokens.asha, "PUT", "/api/profile/food", { ...food, diet: "keto" })).status, 400);
    assert.equal((await call(tokens.nobody, "PUT", "/api/profile/food", food)).status, 400, "no profile yet");
    assert.equal((await call(null, "PUT", "/api/profile/food", food)).status, 401);
  }));

  it("3. the coach intake saves activity, health and food and works the targets out in code", run(async () => {
    const r = await call(tokens.asha, "PUT", "/api/coach/intake", intake(answers));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.targets, "set");
    const p = await row("asha", "SELECT goal, activity, diet, allergies, meals_per_day FROM profiles WHERE user_id = ?");
    assert.deepEqual({ goal: p.goal, activity: p.activity, diet: p.diet, allergies: p.allergies, meals: p.meals_per_day }, { goal: "fat_loss", activity: "lightly_active", diet: "vegetarian", allergies: "peanuts", meals: "3" });
    const t = await row("asha", "SELECT calories, source, calculated FROM nutrition_targets WHERE user_id = ?");
    assert.equal(t.source, "calculated");
    assert.ok(t.calories >= 1000 && t.calories <= 5000);
    const back = await call(tokens.asha, "GET", "/api/coach/intake");
    assert.equal(back.body.profile.activity, "lightly_active");
    assert.equal(back.body.gender, "female");
  }));

  it("4. a second personal-only save keeps the saved answers and recalculates the targets from the new weight", run(async () => {
    const before = await row("asha", "SELECT calories FROM nutrition_targets WHERE user_id = ?");
    const r = await call(tokens.asha, "POST", "/api/profile", { profile: personal({ weightKg: "80" }) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const p = await row("asha", "SELECT goal, activity, diet, allergies FROM profiles WHERE user_id = ?");
    assert.deepEqual({ goal: p.goal, activity: p.activity, diet: p.diet, allergies: p.allergies }, { goal: "fat_loss", activity: "lightly_active", diet: "vegetarian", allergies: "peanuts" }, "nothing the save didn't carry is wiped");
    const after = await row("asha", "SELECT calories, inputs FROM nutrition_targets WHERE user_id = ?");
    const inputs = typeof after.inputs === "string" ? JSON.parse(after.inputs) : after.inputs;
    assert.equal(inputs.weightKg, 80, "the targets follow the new weight");
    assert.ok(after.calories > before.calories);
  }));

  it("5. a man is never saved as pregnant; a health tick sends the target to a professional", run(async () => {
    await call(tokens.ravi, "POST", "/api/profile", { profile: personal({ fullName: "Ravi Kumar", gender: "male", heightCm: "175", weightKg: "75" }) });
    const r = await call(tokens.ravi, "PUT", "/api/coach/intake", intake({ ...answers, healthFlags: ["pregnant", "breastfeeding"] }, { goal: "build_muscle" }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.targets, "set");
    const p = await row("ravi", "SELECT health_flags, goal FROM profiles WHERE user_id = ?");
    assert.deepEqual(typeof p.health_flags === "string" ? JSON.parse(p.health_flags) : p.health_flags, []);
    assert.equal(p.goal, "muscle_gain");

    await call(tokens.pregnant, "POST", "/api/profile", { profile: personal({ fullName: "Meena Iyer" }) });
    const g = await call(tokens.pregnant, "PUT", "/api/coach/intake", intake({ ...answers, healthFlags: ["pregnant"] }));
    assert.equal(g.status, 200);
    assert.equal(g.body.targets, "needs_professional");
    assert.deepEqual(await db.rowsForUser(connection, identities.pregnant.id), { nutrition_targets: 0, body_composition_reports: 0, profiles: 1, users: 1 }, "no calculated target");
  }));

  it("6. bad profile answers write nothing at all; without a profile the intake is refused", run(async () => {
    const before = await row("ravi", "SELECT coach FROM coach_profiles WHERE user_id = ?");
    for (const bad of [{ ...answers, activity: null }, { ...answers, diet: "keto" }, { ...answers, role: "admin" }, { ...answers, mealsPerDay: "' OR 1=1 --" }]) {
      assert.equal((await call(tokens.ravi, "PUT", "/api/coach/intake", intake(bad, { coach: "arjun" }))).status, 400, JSON.stringify(bad));
    }
    assert.equal((await row("ravi", "SELECT coach FROM coach_profiles WHERE user_id = ?")).coach, before.coach, "the coach answers weren't changed either");
    const none = await call(tokens.nobody, "PUT", "/api/coach/intake", intake(answers));
    assert.equal(none.status, 400);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM coach_profiles WHERE user_id = ?", [identities.nobody.id]))[0][0].n, 0, "rolled back");
  }));
});
