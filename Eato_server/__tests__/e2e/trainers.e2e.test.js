// Trainers end to end: real Clerk development identities (two trainers, a client, another
// member) against the real Express server and the isolated `eato_test` database. Covers:
// trainer profiles and discovery, the connection request and its lock, acceptance from the
// trainer's own account, switching trainers with confirmation, target recommendations (apply,
// "New", the way back), diet plans logged into the Macro diary idempotently, trainer-written
// workouts, disconnecting, and the attack paths: no session, a member saving a trainer
// profile, a client editing their own plan, a trainer touching a non-client, double logs,
// a second connection, spoofed ids in the body.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const TODAY = new Date().toISOString().slice(0, 10);
const CLEANUP_TABLES = ["diet_plan_completions", "diet_plan_meal_items", "diet_plan_meals", "diet_plans", "trainer_target_recommendations", "trainer_connections",
  "trainer_profiles", "trainer_clients", "macro_meal_items", "macro_meal_logs", "workout_day_exercises", "workout_days", "workout_plans", "workout_profiles",
  "messages", "conversation_members", "conversations", "nutrition_targets", "profiles"];
const MEAL = (slot, name) => ({ slot, name, time: "08:00", items: [{ name: "Oats", quantity: 60, unit: "g", kcal: 230, proteinG: 8, carbsG: 40, fatG: 4 }, { name: "Milk", quantity: 200, unit: "ml", kcal: 100, proteinG: 7, carbsG: 10, fatG: 3.5 }] });
const PLAN = { name: "Lean phase", goal: "fat_loss", startDate: TODAY, notes: "Eat slowly.", meals: [["breakfast", "Oats and milk"], ["morning_snack", "Fruit"], ["lunch", "Dal and rice"], ["evening_snack", "Nuts"], ["dinner", "Paneer and veg"]].map(([s, n]) => MEAL(s, n)) };

describe("trainers e2e: profiles, connections, recommendations, diet and workout plans", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, clerk;
  const identities = {};
  const ids = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const as = (tag) => ({
    get: (route) => api("GET", route, tokens[tag]),
    post: (route, body) => api("POST", route, tokens[tag], body),
    put: (route, body) => api("PUT", route, tokens[tag], body),
    del: (route, body) => api("DELETE", route, tokens[tag], body),
  });
  const newIdentity = async (tag, role) => {
    const identity = await clerk.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const targetRow = async (userId) => (await connection.query("SELECT calories, protein_g, carbs_g, fat_g, source FROM nutrition_targets WHERE user_id = ?", [userId]))[0][0];
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      await newIdentity("tara", "trainer");
      await newIdentity("vik", "trainer");
      await newIdentity("client");
      await newIdentity("other");
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    const names = { tara: "Tara Trainer", vik: "Vikram Coach", client: "Chitra Client", other: "Omar Other" };
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [ids[tag], identities[tag].emailAddress, names[tag], ["tara", "vik"].includes(tag) ? "trainer" : "user"]);
    }
    // The client finished setup: a profile and a calculated target the calculator can work with
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, activity, workout_frequency, health_flags) VALUES (?, '1995-05-10', 'female', 'muscle_gain', 165, 70, 'moderately_active', '3-4', '[]')", [ids.client]);
    const inputs = JSON.stringify({ weightKg: 70, heightCm: 165, age: 31, gender: "female", fitnessGoal: "muscle_gain", activityLevel: "moderately_active" });
    const calculated = JSON.stringify({ rmrFormula: "mifflin_st_jeor", report: null, rmr: 1450, tdee: 2250, targetCalories: 2400, displayCalories: 2400, macros: { proteinG: 140, carbsG: 290, fatG: 75 } });
    await connection.query(
      "INSERT INTO nutrition_targets (user_id, formula, config_version, inputs, calculated, calculated_at, calories, protein_g, carbs_g, fat_g, source) VALUES (?, 'eato-calculator', 'test', ?, ?, NOW(), 2400, 140, 290, 75, 'calculated')",
      [ids.client, inputs, calculated],
    );
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of CLEANUP_TABLES) await connection.query("DELETE FROM `" + table + "`");
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

  // A failure carries the server's last error lines (a 500 says nothing on its own)
  const test = (name, fn) => it(name, async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) {
      const errors = (server?.logs ?? []).filter((line) => line.includes('"error"')).slice(-2);
      if (errors.length > 0) error.message += `\nserver: ${errors.join("\n")}`;
      throw error;
    }
  });

  test("1. every trainer route needs a valid session", async () => {
    for (const token of [null, "not-a-jwt"]) {
      for (const [method, route] of [["GET", "/api/trainers"], ["GET", `/api/trainers/${ids.tara}`], ["POST", `/api/trainers/${ids.tara}/connect`], ["GET", "/api/trainers/me/connection"], ["PUT", "/api/trainers/me/profile"], ["GET", "/api/trainers/me/clients"], ["GET", `/api/trainers/me/plan?date=${TODAY}`]]) {
        assert.equal((await api(method, route, token, method === "GET" ? undefined : {})).status, 401, `${method} ${route}`);
      }
    }
  });

  test("2. only trainers save a trainer profile; members see the basics, the rest is locked", async () => {
    const profile = { title: "Strength coach", specialties: ["strength", "nutrition"], yearsExperience: 8, bio: "Eight years coaching lifters of every level.", coachingMode: "both", offersNutrition: true, availability: "Mon–Sat, 6–10am", approach: "Progressive overload, patiently.", qualifications: ["ACE CPT"], languages: ["English", "Kannada"] };
    assert.equal((await as("client").put("/api/trainers/me/profile", profile)).status, 403, "a member can't become a trainer by saving a profile");
    const saved = await as("tara").put("/api/trainers/me/profile", profile);
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.profile.locked, false);
    assert.equal((await as("vik").put("/api/trainers/me/profile", { title: "Yoga and mobility", specialties: ["yoga"], bio: "Breathe, move, recover: mobility for lifters.", offersNutrition: false })).status, 200);
    assert.equal((await as("tara").put("/api/trainers/me/profile", { ...profile, userId: ids.client })).status, 400, "unexpected fields");
    // Discovery: both trainers, with the specialty filter and a search
    const all = await as("client").get("/api/trainers");
    assert.deepEqual(all.json.trainers.map((t) => t.member.id).sort(), [ids.tara, ids.vik].sort());
    assert.deepEqual((await as("client").get("/api/trainers?specialty=yoga")).json.trainers.map((t) => t.member.id), [ids.vik]);
    assert.deepEqual((await as("client").get("/api/trainers?search=strength")).json.trainers.map((t) => t.member.id), [ids.tara]);
    assert.equal((await as("client").get("/api/trainers?search=%25")).json.trainers.length, 0, "a wildcard is matched literally");
    assert.equal((await as("client").get("/api/trainers?specialty=pilates")).status, 400);
    // The basics show; the approach, qualifications and languages are locked until accepted
    const seen = (await as("client").get(`/api/trainers/${ids.tara}`)).json.trainer;
    assert.equal(seen.title, "Strength coach");
    assert.equal(seen.locked, true);
    assert.equal(seen.approach, null);
    assert.equal(seen.qualifications, null);
    assert.equal(seen.connection, "none");
    assert.equal(Object.hasOwn(seen.member, "email"), false);
    assert.equal((await as("client").get(`/api/trainers/${ids.other}`)).status, 404, "a member isn't a trainer");
  });

  test("3. a request waits for the trainer; everything stays locked; the trainer accepts from their own account", async () => {
    const asked = await as("client").post(`/api/trainers/${ids.tara}/connect`);
    assert.equal(asked.status, 200, JSON.stringify(asked.json));
    assert.equal(asked.json.state, "requested");
    assert.equal((await as("client").post(`/api/trainers/${ids.tara}/connect`)).json.state, "requested", "asking twice changes nothing");
    assert.equal((await as("client").post(`/api/trainers/${ids.client}/connect`)).status, 400, "not yourself");
    assert.equal((await as("client").post(`/api/trainers/${ids.other}/connect`)).status, 404);
    assert.equal(await count("trainer_connections", "client_id = ?", [ids.client]), 1);
    // Locked while it waits
    const trainer = (await as("client").get(`/api/trainers/${ids.tara}`)).json.trainer;
    assert.equal(trainer.connection, "requested");
    assert.equal(trainer.locked, true);
    assert.equal(trainer.messageLockReason, "Messaging unlocks when Tara accepts your request.");
    assert.equal((await as("client").post("/api/community/conversations", { userId: ids.tara })).status, 403, "no messaging yet");
    assert.equal((await as("client").get(`/api/trainers/me/plan?date=${TODAY}`)).json.plan, null);
    assert.equal((await as("client").get("/api/trainers/me/recommendation")).json.recommendation, null);
    // Only the trainer asked can answer, from their own account
    assert.deepEqual((await as("tara").get("/api/trainers/me/requests")).json.requests.map((r) => r.member.id), [ids.client]);
    assert.equal((await as("vik").post(`/api/trainers/me/requests/${ids.client}/accept`)).status, 404, "another trainer can't accept it");
    assert.equal((await as("client").post(`/api/trainers/me/requests/${ids.client}/accept`)).status, 403, "a member can't");
    assert.equal((await as("tara").get(`/api/trainers/me/clients/${ids.client}`)).status, 404, "not a client until accepted");
    const accepted = await as("tara").post(`/api/trainers/me/requests/${ids.client}/accept`);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
    assert.equal(await count("trainer_clients", "trainer_id = ? AND client_id = ?", [ids.tara, ids.client]), 1, "the server-side assignment exists");
    const mine = (await as("client").get("/api/trainers/me/connection")).json;
    assert.equal(mine.state, "connected");
    assert.equal(mine.trainer.member.id, ids.tara);
    assert.equal(mine.messageLockReason, null);
    // Unlocked: the full profile and messaging, both ways
    const unlocked = (await as("client").get(`/api/trainers/${ids.tara}`)).json.trainer;
    assert.equal(unlocked.locked, false);
    assert.equal(unlocked.approach, "Progressive overload, patiently.");
    const chat = await as("client").post("/api/community/conversations", { userId: ids.tara });
    assert.equal(chat.status, 200, JSON.stringify(chat.json));
    state.chat = chat.json.conversation.id;
    assert.equal((await as("client").post(`/api/community/conversations/${state.chat}/messages`, { body: "Hi coach" })).status, 201);
    assert.equal((await as("tara").post(`/api/community/conversations/${state.chat}/messages`, { body: "Welcome!" })).status, 201);
    assert.equal((await as("other").post("/api/community/conversations", { userId: ids.tara })).status, 403, "coaching unlocks messaging only for the client");
    assert.deepEqual((await as("tara").get("/api/trainers/me/clients")).json.clients.map((c) => c.member.id), [ids.client]);
    const detail = await as("tara").get(`/api/trainers/me/clients/${ids.client}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.client.weightKg, 70);
    assert.equal(detail.json.client.targets.kcal, 2400);
    assert.equal(Object.hasOwn(detail.json.client, "email"), false);
    assert.equal((await as("vik").get(`/api/trainers/me/clients/${ids.client}`)).status, 404, "another trainer learns nothing");
  });

  test("4. a recommendation: New until applied; applied with the trainer's grams; a way back; a newer one is New again", async () => {
    const rec = { calories: 2100, proteinG: 160, carbsG: 220, fatG: 60, note: "Cutting phase, keep protein high" };
    assert.equal((await as("vik").put(`/api/trainers/me/clients/${ids.client}/recommendation`, rec)).status, 404, "only the connected trainer");
    assert.equal((await as("client").put(`/api/trainers/me/clients/${ids.client}/recommendation`, rec)).status, 403);
    assert.equal((await as("tara").put(`/api/trainers/me/clients/${ids.client}/recommendation`, { ...rec, calories: 700 })).status, 400);
    assert.equal((await as("tara").put(`/api/trainers/me/clients/${ids.client}/recommendation`, rec)).status, 200);
    const before = await targetRow(ids.client);
    assert.equal(before.source, "calculated", "nothing changes until the member applies it");
    const mine = (await as("client").get("/api/trainers/me/recommendation")).json;
    assert.equal(mine.recommendation.isNew, true);
    assert.equal(mine.recommendation.calories, 2100);
    assert.equal(mine.targets.source, "calculated");
    const applied = await as("client").post("/api/trainers/me/recommendation/apply");
    assert.equal(applied.status, 200, JSON.stringify(applied.json));
    assert.equal(applied.json.recommendation.isNew, false);
    assert.deepEqual({ ...(await targetRow(ids.client)) }, { calories: 2100, protein_g: 160, carbs_g: 220, fat_g: 60, source: "trainer_adjusted" }, "the trainer's exact grams");
    assert.equal(applied.json.targets.lockedByTrainer, true);
    assert.equal((await as("client").post("/api/macro/targets/reset")).status, 400, "the plain reset stays blocked while a trainer's target is active");
    // A newer recommendation: New again, the old target still active until applied
    assert.equal((await as("tara").put(`/api/trainers/me/clients/${ids.client}/recommendation`, { ...rec, calories: 2000 })).status, 200);
    assert.equal((await as("client").get("/api/trainers/me/recommendation")).json.recommendation.isNew, true);
    assert.equal((await targetRow(ids.client)).calories, 2100, "not applied silently");
    // The way back, then forward again
    const restored = await as("client").post("/api/trainers/me/targets/restore");
    assert.equal(restored.status, 200, JSON.stringify(restored.json));
    assert.deepEqual({ ...(await targetRow(ids.client)) }, { calories: 2400, protein_g: 140, carbs_g: 290, fat_g: 75, source: "calculated" }, "back to the member's own target");
    assert.equal((await as("client").post("/api/trainers/me/targets/restore")).status, 400, "nothing to restore now");
    assert.equal((await as("client").post("/api/trainers/me/recommendation/apply")).json.targets.kcal, 2000);
    assert.equal((await as("other").post("/api/trainers/me/recommendation/apply")).status, 404, "no trainer, nothing to apply");
  });

  test("5. the diet plan: written by the connected trainer only; logged into the diary once per tap", async () => {
    assert.equal((await as("client").put(`/api/trainers/me/clients/${ids.client}/plan`, PLAN)).status, 403, "a client can't write their own plan");
    assert.equal((await as("vik").put(`/api/trainers/me/clients/${ids.client}/plan`, PLAN)).status, 404, "a trainer can't write a non-client's plan");
    assert.equal((await as("tara").put(`/api/trainers/me/clients/${ids.client}/plan`, { ...PLAN, meals: PLAN.meals.slice(0, 3) })).status, 400);
    const written = await as("tara").put(`/api/trainers/me/clients/${ids.client}/plan`, PLAN);
    assert.equal(written.status, 200, JSON.stringify(written.json));
    assert.equal(written.json.plan.meals.length, 5);
    assert.equal(written.json.plan.meals[0].totals.kcal, 330);
    // Replacing it supersedes the first; exactly one active plan
    const again = await as("tara").put(`/api/trainers/me/clients/${ids.client}/plan`, { ...PLAN, name: "Lean phase v2" });
    assert.equal(again.status, 200);
    assert.equal(await count("diet_plans", "client_id = ? AND status = 'active'", [ids.client]), 1);
    assert.equal(await count("diet_plans", "client_id = ?", [ids.client]), 2);
    const plan = (await as("client").get(`/api/trainers/me/plan?date=${TODAY}`)).json;
    assert.equal(plan.plan.name, "Lean phase v2");
    assert.equal(plan.progress.mealsDone, 0);
    assert.equal(plan.progress.plannedKcal, 1650);
    const breakfast = plan.plan.meals[0];
    state.breakfast = breakfast.id;
    assert.equal(breakfast.status, "pending");
    assert.equal((await as("other").get(`/api/trainers/me/plan?date=${TODAY}`)).json.plan, null, "no trainer, no plan");
    // Logging: the diary gets one meal with source 'plan'; a repeated tap returns the same log
    const logged = await as("client").post(`/api/trainers/me/plan/meals/${breakfast.id}/log`, { date: TODAY, servings: [1.5, 0] });
    assert.equal(logged.status, 201, JSON.stringify(logged.json));
    assert.equal(logged.json.alreadyLogged, false);
    assert.deepEqual(logged.json.totals, { kcal: 345, proteinG: 12, carbsG: 60, fatG: 6 }, "scaled by the servings; the skipped food is left out");
    const repeat = await as("client").post(`/api/trainers/me/plan/meals/${breakfast.id}/log`, { date: TODAY, servings: [1, 1] });
    assert.equal(repeat.json.alreadyLogged, true);
    assert.equal(repeat.json.logId, logged.json.logId);
    assert.equal(await count("macro_meal_logs", "user_id = ? AND source = 'plan'", [ids.client]), 1, "one diary row");
    const [[diaryRow]] = await connection.query("SELECT slot, title, plan_log_key FROM macro_meal_logs WHERE id = ?", [logged.json.logId]);
    assert.deepEqual({ ...diaryRow }, { slot: "breakfast", title: "Oats and milk", plan_log_key: `${TODAY}:${breakfast.id}:1` });
    // Racing taps: still one row
    const raced = await Promise.all([0, 1, 2].map(() => as("client").post(`/api/trainers/me/plan/meals/${plan.plan.meals[2].id}/log`, { date: TODAY })));
    assert.ok(raced.every((r) => r.status === 201), JSON.stringify(raced.map((r) => r.status)));
    assert.equal(await count("macro_meal_logs", "user_id = ? AND plan_log_key LIKE ?", [ids.client, `${TODAY}:${plan.plan.meals[2].id}:%`]), 1);
    // A deliberate repeat, and the day as the member sees it in the Macro diary
    assert.equal((await as("client").post(`/api/trainers/me/plan/meals/${breakfast.id}/log`, { date: TODAY, again: true })).json.loggedCount, 2);
    assert.equal(await count("macro_meal_logs", "user_id = ? AND source = 'plan'", [ids.client]), 3);
    const day = await as("client").get(`/api/macro/day?date=${TODAY}`);
    assert.equal(day.status, 200);
    assert.ok(day.json.meals.some((m) => m.source === "plan" && m.title === "Oats and milk"), "the plan meal is in the diary");
    // Mark done without logging
    assert.equal((await as("client").post(`/api/trainers/me/plan/meals/${plan.plan.meals[1].id}/done`, { date: TODAY })).json.done, true);
    const after = (await as("client").get(`/api/trainers/me/plan?date=${TODAY}`)).json;
    assert.deepEqual(after.plan.meals.map((m) => m.status), ["logged", "done", "logged", "pending", "pending"]);
    assert.equal(after.progress.mealsDone, 3);
    assert.equal((await as("client").del(`/api/trainers/me/plan/meals/${plan.plan.meals[1].id}/done`, { date: TODAY })).json.done, false);
    // Other days, other members' meals, bad input
    assert.equal((await as("client").post(`/api/trainers/me/plan/meals/${breakfast.id}/log`, { date: "2026-01-01" })).status, 400, "today only");
    assert.equal((await as("other").post(`/api/trainers/me/plan/meals/${breakfast.id}/log`, { date: TODAY })).status, 404, "another member's plan meal");
    assert.equal((await as("client").post(`/api/trainers/me/plan/meals/${breakfast.id}/log`, { date: TODAY, servings: [0.3, 1] })).status, 400);
    assert.equal((await as("client").post(`/api/trainers/me/plan/meals/${breakfast.id}/log`, { date: TODAY, userId: ids.other })).status, 400);
  });

  test("6. the trainer's workout supersedes the client's active plan; exercises must be in the library", async () => {
    const ensured = await as("client").post("/api/workout/plan/ensure", { today: TODAY });
    assert.equal(ensured.status, 201, JSON.stringify(ensured.json)); // 201: the engine made the plan
    const library = await as("tara").get("/api/trainers/library");
    assert.equal(library.status, 200);
    assert.equal((await as("client").get("/api/trainers/library")).status, 403, "the editor's library is for trainers");
    const [a, b] = library.json.exercises;
    const workout = { today: TODAY, name: "Upper/lower, Tara", goal: "build_muscle", level: "intermediate", note: "Week 1: learn the movements.", days: [
      { weekday: 1, title: "Upper", sessionType: "upper", exercises: [{ exerciseId: a.id, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }], restSec: 90, role: "main", repsMin: 6, repsMax: 10 }] },
      { weekday: 4, title: "Lower", sessionType: "lower", exercises: [{ exerciseId: b.id, sets: [{ reps: 10 }, { reps: 10 }], restSec: 60 }] },
    ] };
    assert.equal((await as("vik").put(`/api/trainers/me/clients/${ids.client}/workout`, workout)).status, 404);
    assert.equal((await as("tara").put(`/api/trainers/me/clients/${ids.client}/workout`, { ...workout, days: [{ ...workout.days[0], exercises: [{ exerciseId: crypto.randomUUID(), sets: [{ reps: 8 }] }] }] })).status, 400, "not in the library");
    assert.equal((await as("tara").put(`/api/trainers/me/clients/${ids.client}/workout`, { ...workout, today: "2026-01-01" })).status, 400, "starts today");
    const written = await as("tara").put(`/api/trainers/me/clients/${ids.client}/workout`, workout);
    assert.equal(written.status, 200, JSON.stringify(written.json));
    const [plans] = await connection.query("SELECT source, status, created_by, trainer_note, days_per_week FROM workout_plans WHERE user_id = ? ORDER BY created_at", [ids.client]);
    assert.deepEqual(plans.map((p) => [p.source, p.status]), [["engine", "superseded"], ["trainer", "active"]]);
    assert.equal(plans[1].created_by, ids.tara);
    assert.equal(plans[1].trainer_note, "Week 1: learn the movements.");
    assert.equal(plans[1].days_per_week, 2);
    assert.equal(await count("workout_day_exercises", "plan_id = ?", [written.json.workout.id]), 2);
    const home = await as("client").get(`/api/workout/home?date=${TODAY}&dates=${TODAY}&today=${TODAY}`);
    assert.equal(home.status, 200, JSON.stringify(home.json));
    assert.equal(home.json.plan.name, "Upper/lower, Tara", "the Fitness tab shows the trainer's plan");
    assert.equal((await as("client").get("/api/trainers/me/connection")).json.workout.note, "Week 1: learn the movements.");
  });

  test("7. switching trainers needs confirmation and ends the old coaching; disconnecting restores the member's targets", async () => {
    const blocked = await as("client").post(`/api/trainers/${ids.vik}/connect`);
    assert.equal(blocked.status, 409, "one trainer at a time");
    assert.match(blocked.json.error, /already have a trainer/);
    assert.equal((await as("client").get("/api/trainers/me/connection")).json.state, "connected", "nothing changed");
    assert.equal((await as("client").get(`/api/trainers/${ids.vik}`)).json.trainer.otherTrainer.id, ids.tara, "the app knows whom the switch would drop");
    assert.equal((await targetRow(ids.client)).source, "trainer_adjusted");
    const switched = await as("client").post(`/api/trainers/${ids.vik}/connect`, { replace: true });
    assert.equal(switched.status, 200, JSON.stringify(switched.json));
    assert.equal(switched.json.state, "requested");
    assert.equal(switched.json.trainer.member.id, ids.vik);
    // Tara's coaching ended: the assignment, the plan and the workout are gone, the target is the member's own
    assert.equal(await count("trainer_clients", "trainer_id = ? AND client_id = ?", [ids.tara, ids.client]), 0);
    assert.equal(await count("diet_plans", "client_id = ? AND status = 'active'", [ids.client]), 0);
    assert.equal(await count("workout_plans", "user_id = ? AND status = 'active'", [ids.client]), 0, "the trainer's workout is superseded; the engine makes a new one next time");
    assert.deepEqual({ ...(await targetRow(ids.client)) }, { calories: 2400, protein_g: 140, carbs_g: 290, fat_g: 75, source: "calculated" });
    assert.equal(await count("macro_meal_logs", "user_id = ? AND source = 'plan'", [ids.client]), 3, "logged meals stay in the diary");
    assert.equal((await as("tara").get(`/api/trainers/me/clients/${ids.client}`)).status, 404, "Tara can't reach her former client");
    assert.equal((await as("tara").put(`/api/trainers/me/clients/${ids.client}/plan`, PLAN)).status, 404);
    assert.equal((await as("client").post(`/api/community/conversations/${state.chat}/messages`, { body: "still there?" })).status, 403, "messaging locks again; history stays");
    assert.equal((await as("client").get(`/api/community/conversations/${state.chat}/messages`)).status, 200);
    // Cancel the new request, then connect with Vikram and let him end it from his side
    assert.equal((await as("client").del("/api/trainers/me/connection")).json.state, "none");
    await as("client").post(`/api/trainers/${ids.vik}/connect`);
    await as("vik").post(`/api/trainers/me/requests/${ids.client}/accept`);
    assert.equal((await as("client").get("/api/trainers/me/connection")).json.state, "connected");
    assert.equal((await as("tara").del(`/api/trainers/me/clients/${ids.client}`)).status, 404, "not Vikram's former colleague's call");
    assert.equal((await as("vik").del(`/api/trainers/me/clients/${ids.client}`)).status, 200);
    assert.equal((await as("client").get("/api/trainers/me/connection")).json.state, "none");
    assert.equal((await as("client").del("/api/trainers/me/connection")).status, 404, "nothing to end");
    // A declined request leaves the member free to ask again
    await as("client").post(`/api/trainers/${ids.tara}/connect`);
    assert.equal((await as("tara").post(`/api/trainers/me/requests/${ids.client}/decline`)).status, 200);
    assert.equal((await as("client").get("/api/trainers/me/connection")).json.state, "none");
    assert.equal((await as("client").post(`/api/trainers/${ids.tara}/connect`)).json.state, "requested");
    assert.equal(await count("trainer_connections", "client_id = ? AND status IN ('requested', 'connected')", [ids.client]), 1, "one open row, ever");
  });

  test("8. a trainer who stops accepting clients can't be asked; bad ids are 400s", async () => {
    assert.equal((await as("vik").put("/api/trainers/me/profile", { title: "Yoga and mobility", specialties: ["yoga"], bio: "Breathe, move, recover: mobility for lifters.", acceptingClients: false })).status, 200);
    assert.equal((await as("other").post(`/api/trainers/${ids.vik}/connect`)).status, 409);
    assert.equal((await as("other").get("/api/trainers")).json.trainers.some((t) => t.member.id === ids.vik), false, "not listed while closed");
    for (const bad of ["x", "user_' OR 1=1 --", "../../etc"]) {
      assert.equal((await as("other").post(`/api/trainers/${encodeURIComponent(bad)}/connect`)).status, 400, bad);
      assert.equal((await as("tara").get(`/api/trainers/me/clients/${encodeURIComponent(bad)}`)).status, 400, bad);
    }
    assert.equal((await as("other").post(`/api/trainers/${ids.tara}/connect`, { replace: "yes" })).status, 400);
    assert.equal((await as("other").post(`/api/trainers/${ids.tara}/connect`, { clientId: ids.client })).status, 400);
  });
});
