// "Rebuild my plan" end to end: real Clerk development identities against the real Express
// server and the isolated eato_test database. Covers the saved answers the flow starts from
// (setup profile values where nothing was saved), rebuilding the plan from all thirteen answers
// (calibrated level written back, the old plan kept as superseded), safety mode for an injury,
// the plan overview the reveal reads, every refusal word for word, a trainer's plan staying
// put, and the attack paths: no or forged session, another member's plan, unexpected fields,
// out-of-range values, SQL in input.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const WORKOUT_TABLES = ["workout_set_logs", "workout_logs", "workout_day_overrides", "workout_day_exercises", "workout_days", "workout_plans", "workout_profiles", "profiles"];
const utcDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const TODAY = utcDay();

describe("workout e2e: rebuild my plan from thirteen answers", () => {
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
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const qs = (params) => "?" + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const home = (token, date, dates = [date]) => api("GET", `/api/workout/home${qs({ date, dates: dates.join(","), today: TODAY })}`, token);
  const ensure = (token) => api("POST", "/api/workout/plan/ensure", token, { today: TODAY });
  const inputs = (token) => api("GET", `/api/workout/recreate${qs({ today: TODAY })}`, token);
  const rebuild = (token, body) => api("POST", "/api/workout/recreate", token, body);
  const overview = (token) => api("GET", "/api/workout/plan/overview", token);
  const answers = (overrides = {}) => ({
    today: TODAY, gender: "female", ageYears: 29, weightKg: 62.5, heightCm: 165, bodyType: "average", goal: "lose_weight",
    weekdays: [1, 3, 5], pace: "standard", fitnessBase: 2, squatScore: 3, pushScore: 3, pullScore: 3, seriousInjury: false, ...overrides,
  });
  const activePlan = async (userId) => (await connection.query("SELECT id, goal, level, split, source, days_per_week FROM workout_plans WHERE user_id = ? AND status = 'active'", [userId]))[0][0] ?? null;
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const refused = (response, message) => {
    assert.equal(response.status, 400, JSON.stringify(response.json));
    if (message instanceof RegExp) assert.match(response.json.error, message);
    else assert.equal(response.json.error, message);
    // Case-sensitive: the spec's own "Select at least 3 days" is fine, SQL keywords are not
    assert.doesNotMatch(response.json.error, /\bSELECT\b|\bsql\b|\bstack\b|at \//);
  };
  const newIdentity = async (tag) => {
    const identity = await clerk.createIdentity(runId, tag);
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
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
      await newIdentity("a");
      await newIdentity("b");
      await newIdentity("c"); // signed up, never finished setup: no profile row
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, 'Member C', 'user')", [ids.c, identities.c.emailAddress]);
    for (const tag of ["a", "b"]) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user')", [ids[tag], identities[tag].emailAddress, `Member ${tag.toUpperCase()}`]);
      await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency) VALUES (?, '1995-05-10', 'male', 'muscle_gain', 175, 70, '3-4')", [ids[tag]]);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of WORKOUT_TABLES) await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [Object.values(ids)]);
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

  it("1. every route needs a valid session and writes nothing without one", run(async () => {
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      assert.equal((await inputs(token)).status, 401);
      assert.equal((await rebuild(token, answers())).status, 401);
      assert.equal((await overview(token)).status, 401);
    }
    assert.equal(await count("workout_plans", "1 = ?", [1]), 0);
    assert.equal(await count("workout_profiles", "1 = ?", [1]), 0);
  }));

  it("2. the flow starts from the setup profile where nothing was saved", run(async () => {
    const r = await inputs(tokens.a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.hasPlan, false);
    assert.equal(r.json.trainerManaged, false);
    assert.deepEqual(r.json.units, { weight: "kg", height: "cm" });
    const a = r.json.answers;
    assert.deepEqual({ gender: a.gender, weight: a.weightKg, height: a.heightCm, goal: a.goal }, { gender: "male", weight: 70, height: 175, goal: "build_muscle" });
    assert.ok(Number.isInteger(a.ageYears) && a.ageYears >= 30, "age from the date of birth");
    for (const key of ["bodyType", "weekdays", "pace", "fitnessBase", "squatScore", "pushScore", "pullScore", "seriousInjury"]) assert.equal(a[key], null, `${key} was never asked`);
    refused(await overview(tokens.a), "No active plan");
  }));

  it("3. rebuilding saves all thirteen answers and makes a calibrated plan; the old one is kept", run(async () => {
    assert.ok([200, 201].includes((await ensure(tokens.a)).status));
    const old = await activePlan(ids.a);
    const r = await rebuild(tokens.a, answers());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    // (2 + 3 + 3 + 3) / 4 = 2.75: intermediate
    assert.deepEqual({ level: r.json.level, goal: r.json.goal, days: r.json.daysPerWeek, review: r.json.requiresProfessionalReview }, { level: "intermediate", goal: "lose_weight", days: 3, review: false });
    const plan = await activePlan(ids.a);
    assert.equal(plan.id, r.json.planId);
    assert.deepEqual({ source: plan.source, split: plan.split }, { source: "member", split: "auto" }, "the flow always uses the automatic split");
    const [[stale]] = await connection.query("SELECT status FROM workout_plans WHERE id = ?", [old.id]);
    assert.equal(stale.status, "superseded");
    const [[saved]] = await connection.query("SELECT * FROM workout_profiles WHERE user_id = ?", [ids.a]);
    assert.deepEqual(
      { gender: saved.gender, age: saved.age_years, weight: saved.weight_kg, height: saved.height_cm, body: saved.body_type, goal: saved.goal, pace: saved.pace, base: saved.fitness_base, squat: saved.squat_score, push: saved.push_score, pull: saved.pull_score, injury: saved.serious_injury, split: saved.split, experience: saved.experience },
      { gender: "female", age: 29, weight: 62.5, height: 165, body: "average", goal: "lose_weight", pace: "standard", base: 2, squat: 3, push: 3, pull: 3, injury: 0, split: "auto", experience: "intermediate" },
    );
    const again = await inputs(tokens.a);
    assert.equal(again.json.answers.bodyType, "average", "next time the flow starts from what was saved");
    assert.equal(again.json.hasPlan, true);
  }));

  it("4. a serious injury puts the plan in safety mode at beginner level", run(async () => {
    const r = await rebuild(tokens.a, answers({ fitnessBase: 4, squatScore: 4, pushScore: 4, pullScore: 4, seriousInjury: true }));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.level, "beginner");
    assert.equal(r.json.requiresProfessionalReview, true);
    const [[saved]] = await connection.query("SELECT experience FROM workout_profiles WHERE user_id = ?", [ids.a]);
    assert.equal(saved.experience, "beginner", "the calibrated level is written back");
  }));

  it("5. the overview is read from the saved plan", run(async () => {
    assert.equal((await rebuild(tokens.a, answers({ weekdays: [1, 2, 4, 5], pace: "brisk" }))).status, 200);
    const r = await overview(tokens.a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const plan = await activePlan(ids.a);
    assert.deepEqual({ goal: r.json.goal, level: r.json.level, days: r.json.daysPerWeek, pace: r.json.pace, split: r.json.split }, { goal: plan.goal, level: plan.level, days: 4, pace: "brisk", split: "auto" });
    assert.deepEqual(r.json.sessions.map((s) => s.weekday), [1, 2, 4, 5], "sessions Monday first");
    for (const s of r.json.sessions) {
      const [[n]] = await connection.query("SELECT COUNT(*) AS n FROM workout_day_exercises WHERE day_id = ? AND section = 'workout'", [s.dayId]);
      assert.equal(s.exerciseCount, n.n, "exercise counts are the workout section only");
      assert.ok(s.minutes > 0 && s.title);
    }
    assert.equal(r.json.firstSession.weekday, 1);
    assert.ok(r.json.firstSession.exercises.length > 0 && r.json.firstSession.exercises.every((e) => e.name && Array.isArray(e.sets)));
  }));

  it("6. every answer is checked with the flow's words, and nothing is saved on a refusal", run(async () => {
    const plansBefore = await count("workout_plans", "1 = ?", [1]);
    const [[before]] = await connection.query("SELECT updated_at, goal FROM workout_profiles WHERE user_id = ?", [ids.a]);
    const cases = [
      [{ gender: "robot" }, "Pick your gender"],
      [{ ageYears: 12 }, "Enter an age between 13 and 100"],
      [{ ageYears: 29.5 }, "Enter an age between 13 and 100"],
      [{ weightKg: 301 }, "Enter a weight between 25 and 300 kg"],
      [{ weightKg: "70" }, "Enter a weight between 25 and 300 kg"],
      [{ heightCm: 99 }, "Enter a height between 100 and 250 cm"],
      [{ bodyType: "blob" }, "Pick the closest body type"],
      [{ goal: "get_huge" }, "Pick a goal"],
      [{ weekdays: [1, 3] }, "Select at least 3 days (2 chosen)"],
      [{ weekdays: [1, 1, 3] }, /different days/],
      [{ pace: "warp" }, "Pick a pace"],
      [{ fitnessBase: 5 }, "Pick the statement that fits you"],
      [{ squatScore: 0 }, "Pick a range"],
      [{ pullScore: "3" }, "Pick a range"],
      [{ seriousInjury: "no" }, "Answer yes or no"],
      [{ goal: "lose_weight' OR '1'='1" }, "Pick a goal"],
      [{ userId: ids.b }, /Unexpected field: userId/],
      [{ split: "upper_lower" }, /Unexpected field: split/],
      [{ today: utcDay(-5) }, /server's date/],
    ];
    for (const [change, message] of cases) refused(await rebuild(tokens.a, answers(change)), message);
    assert.equal((await rebuild(tokens.a, "{not json")).status, 400);
    assert.equal((await rebuild(tokens.a, JSON.stringify({ ...answers(), pad: "x".repeat(8 * 1024) }))).status, 413, "an oversized body is refused");
    assert.equal(await count("workout_plans", "1 = ?", [1]), plansBefore, "no refusal made a plan");
    const [[after]] = await connection.query("SELECT updated_at, goal FROM workout_profiles WHERE user_id = ?", [ids.a]);
    assert.deepEqual(after, before, "no refusal saved an answer");
  }));

  it("7. a trainer's plan can't be rebuilt; a member without setup can't either; others are untouched", run(async () => {
    assert.ok([200, 201].includes((await ensure(tokens.b)).status));
    const planB = await activePlan(ids.b);
    await connection.query("UPDATE workout_plans SET source = 'trainer' WHERE id = ?", [planB.id]);
    try {
      assert.equal((await inputs(tokens.b)).json.trainerManaged, true);
      refused(await rebuild(tokens.b, answers()), "Your trainer manages your current plan, so it cannot be recreated here.");
      assert.equal((await activePlan(ids.b)).id, planB.id);
      assert.equal(await count("workout_profiles", "user_id = ?", [ids.b]), 0);
    } finally {
      await connection.query("UPDATE workout_plans SET source = 'engine' WHERE id = ?", [planB.id]);
    }
    refused(await rebuild(tokens.c, answers()), "Profile missing");
    assert.equal(await count("workout_plans", "user_id = ?", [ids.c]), 0);

    assert.equal((await rebuild(tokens.a, answers({ goal: "build_muscle" }))).status, 200);
    assert.equal((await activePlan(ids.b)).id, planB.id, "A's rebuild never touches B's plan");
  }));
});
