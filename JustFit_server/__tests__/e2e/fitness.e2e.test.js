// The Fitness tab's programs end to end: test accounts in justfit_test against the real Express
// server (fake AI). Covers the six sections for home and the center, search, a program's detail,
// doing a session today (it becomes today's day, the plan's own days unchanged), the location
// sheet, the admin's programs (hide, edit, create and rewrite with the AI, audit lines), and the
// attack paths: no or forged session, members on admin routes, bad ids, fields and searches.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const TABLES = ["workout_set_logs", "workout_logs", "workout_day_overrides", "workout_day_exercises", "workout_days", "workout_plans", "workout_profiles", "ai_usage", "profiles"];
const { appDay } = require("./dates.js");

const TODAY = appDay();

describe("fitness e2e: programs, today's session from a program, the location sheet, the admin", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
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
  const programs = (token, query = "") => api("GET", `/api/fitness/programs${query}`, token);
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const newIdentity = async (tag, role) => {
    const identity = await testAccounts.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
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
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" });
    try {
      await newIdentity("a");
      await newIdentity("b");
      await newIdentity("admin", "admin");
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    for (const tag of ["a", "b", "admin"]) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role)", [ids[tag], identities[tag].emailAddress, `Member ${tag}`, tag === "admin" ? "admin" : "user"]);
    }
    await connection.query("INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, workout_frequency) VALUES (?, '1995-05-10', 'female', 'muscle_gain', 165, 60, '3-4')", [ids.a]);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const all = Object.values(ids);
        for (const table of TABLES) await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [all]);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [all]);
        const [made] = await connection.query("SELECT id FROM fitness_programs WHERE created_by IN (?)", [all]);
        if (made.length) {
          const pids = made.map((m) => m.id);
          await connection.query("DELETE FROM fitness_program_exercises WHERE program_id IN (?)", [pids]);
          await connection.query("DELETE FROM fitness_program_sessions WHERE program_id IN (?)", [pids]);
          await connection.query("DELETE FROM fitness_programs WHERE id IN (?)", [pids]);
        }
        await db.deleteUsers(connection, all);
      } catch (error) { problems.push(`rows: ${error.code ?? error.message}`); }
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

  it("1. every route needs a valid session; members can't use the admin's", run(async () => {
    const someId = crypto.randomUUID();
    for (const token of [null, "not-a-jwt"]) {
      assert.equal((await programs(token)).status, 401);
      assert.equal((await api("GET", `/api/fitness/programs/${someId}`, token)).status, 401);
      assert.equal((await api("GET", "/api/fitness/equipment", token)).status, 401);
    }
    for (const [method, route] of [["GET", "/api/admin/portal/programs"], ["POST", "/api/admin/portal/programs"], ["PATCH", `/api/admin/portal/programs/${someId}`], ["POST", `/api/admin/portal/programs/${someId}/sessions`]]) {
      assert.equal((await api(method, route, tokens.a, method === "GET" ? undefined : {})).status, 403, route);
    }
  }));

  it("2. home and the center each show all six sections of free programs, Coming soon until they have video sessions", run(async () => {
    for (const place of ["home", "center"]) {
      const r = await programs(tokens.a, `?place=${place}`);
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.deepEqual(r.json.sections.map((s) => s.id), ["popular", "categories", "build_muscle", "stay_fit", "dance", "workplace"], place);
      const cards = r.json.sections.flatMap((s) => s.programs);
      assert.ok(cards.every((c) => c.sessionCount === 0 && (c.place === place || c.place === "both")), "the starter programs have no sessions until the admin adds videos");
      assert.ok(!JSON.stringify(r.json).match(/premium|price|locked/i), "nothing behind a paywall");
    }
    const home = (await programs(tokens.a, "?place=home")).json.sections.flatMap((s) => s.programs).map((c) => c.title);
    const center = (await programs(tokens.a, "?place=center")).json.sections.flatMap((s) => s.programs).map((c) => c.title);
    assert.ok(home.includes("Fit Mama") && !center.includes("Fit Mama"));
    assert.ok(center.includes("Push Pull Legs") && !home.includes("Push Pull Legs"));
    assert.ok((await count("fitness_programs", "built_in = TRUE", [])) >= 19, "the catalog was added once");
  }));

  it("3. search matches titles, descriptions and section names; SQL and wildcards are plain text", run(async () => {
    const yoga = (await programs(tokens.a, "?place=home&search=yoga")).json;
    assert.ok(yoga.sections.flatMap((s) => s.programs).some((p) => p.title === "Yoga for Beginners"));
    const dance = (await programs(tokens.a, "?place=home&search=dance%20fitness")).json;
    assert.deepEqual(dance.sections.map((s) => s.id), ["dance"]);
    for (const q of ["%", "_", "' OR 1=1 --"]) {
      const r = await programs(tokens.a, `?search=${encodeURIComponent(q)}`);
      assert.equal(r.status, 200);
      assert.equal(r.json.sections.length, 0, q);
    }
  }));

  it("4. a program's detail: only video sessions (none yet); unknown or malformed ids are 404; Do this today is gone", run(async () => {
    const card = (await programs(tokens.a, "?place=home")).json.sections.find((s) => s.id === "categories").programs.find((p) => p.title === "Workout for Beginners");
    const r = await api("GET", `/api/fitness/programs/${card.id}`, tokens.a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.program.sessions, []);
    for (const bad of ["1", "x' OR '1'='1", crypto.randomUUID()]) assert.equal((await api("GET", `/api/fitness/programs/${encodeURIComponent(bad)}`, tokens.a)).status, 404, bad);
    // An exercise session from before 2026-11-03 stays in the table but is never shown or played
    const [[{ id: sessionId }]] = await connection.query("SELECT UUID() AS id");
    await connection.query("INSERT INTO fitness_program_sessions (id, program_id, position, title, minutes) VALUES (?, ?, 0, 'Old exercise session', 20)", [sessionId, card.id]);
    try {
      const again = await api("GET", `/api/fitness/programs/${card.id}`, tokens.a);
      assert.deepEqual(again.json.program.sessions, [], "an exercise session isn't shown");
      assert.equal(again.json.program.sessionCount, 0, "nor counted");
      assert.equal((await api("POST", `/api/fitness/programs/${card.id}/sessions/${sessionId}/today`, tokens.a, { today: TODAY })).status, 404, "Do this today is gone");
      assert.equal((await api("PATCH", `/api/admin/portal/programs/${card.id}/sessions/${sessionId}`, tokens.admin, { minutes: 25 })).status, 404, "nor can the admin edit it");
    } finally {
      await connection.query("DELETE FROM fitness_program_sessions WHERE id = ?", [sessionId]);
    }
  }));

  it("6. the location sheet saves what the member has at home and at their center", run(async () => {
    const before = await api("GET", "/api/fitness/equipment", tokens.a);
    assert.equal(before.status, 200);
    assert.deepEqual({ home: before.json.home, center: before.json.center }, { home: "none", center: "full_gym" });
    const saved = await api("PUT", "/api/fitness/equipment", tokens.a, { home: "some", center: "basic_gym" });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual({ home: saved.json.home, center: saved.json.center }, { home: "some", center: "basic_gym" });
    for (const body of [{ home: "jetpack", center: "full_gym" }, { home: "some" }, { home: "some", center: "full_gym", role: "admin" }]) {
      assert.equal((await api("PUT", "/api/fitness/equipment", tokens.a, body)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual((await api("GET", "/api/fitness/equipment", tokens.b)).json.home, "none", "B's are their own");
  }));

  it("7. the admin hides, edits and creates programs (no AI); each is in the audit log", run(async () => {
    const all = await api("GET", "/api/admin/portal/programs", tokens.admin);
    assert.equal(all.status, 200);
    const target = all.json.programs.find((p) => p.title === "Cardio Rush");
    const hidden = await api("PATCH", `/api/admin/portal/programs/${target.id}`, tokens.admin, { published: false });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.json));
    assert.ok(!(await programs(tokens.a, "?place=home")).json.sections.flatMap((s) => s.programs).some((p) => p.id === target.id), "hidden from members");
    assert.equal((await api("GET", `/api/fitness/programs/${target.id}`, tokens.a)).status, 404);
    await api("PATCH", `/api/admin/portal/programs/${target.id}`, tokens.admin, { published: true, subtitle: "Stamina in 25 minutes" });
    assert.equal((await api("GET", `/api/fitness/programs/${target.id}`, tokens.a)).json.program.subtitle, "Stamina in 25 minutes");

    const made = await api("POST", "/api/admin/portal/programs", tokens.admin, { title: "Morning Mobility", subtitle: "Wake up loose", description: "Easy stretches", section: "stay_fit", place: "home", level: "beginner", kit: "none", icon: "yoga", palette: "mint" });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    assert.deepEqual(made.json.program.sessions, [], "no sessions until the admin adds videos");
    assert.equal(made.json.program.aiDrafted, false);
    assert.ok((await programs(tokens.a, "?place=home&search=mobility")).json.sections.flatMap((s) => s.programs).some((p) => p.title === "Morning Mobility"));

    assert.equal((await api("POST", `/api/admin/portal/programs/${target.id}/redraft`, tokens.admin, { request: "more intervals" })).status, 404, "Rewrite with AI is gone");
    assert.equal(await count("ai_usage", "user_id = ? AND feature = 'fitness_program'", [ids.admin]), 0, "no AI call");
    assert.ok(await count("admin_audit_log", "admin_id = ? AND target_type = 'program'", [ids.admin]) >= 3);

    for (const body of [{ title: "x" }, { price: 99 }, { sessions: 3 }, { section: "vip" }]) {
      assert.equal((await api("PATCH", `/api/admin/portal/programs/${target.id}`, tokens.admin, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await api("PATCH", `/api/admin/portal/programs/${crypto.randomUUID()}`, tokens.admin, { published: true })).status, 404);
  }));

  it("8. a program takes no YouTube link of its own (videos belong to sessions since 2026-11-03)", run(async () => {
    const all = (await api("GET", "/api/admin/portal/programs", tokens.admin)).json.programs;
    const target = all.find((p) => p.title === "Yoga for Beginners");
    const program = (await api("GET", `/api/fitness/programs/${target.id}`, tokens.a)).json.program;
    assert.equal(program.youtube, undefined, "no program-level video");
    assert.ok(program.sessions.every((s) => s.video === null), "the starter sessions have no video");
    for (const youtube of ["dQw4w9WgXcQ", "https://youtube.com/playlist?list=PLabcdefghijklmnop_-12", ""]) {
      assert.equal((await api("PATCH", `/api/admin/portal/programs/${target.id}`, tokens.admin, { youtube })).status, 400, youtube);
    }
    const made = await api("POST", "/api/admin/portal/programs", tokens.admin, { title: "Follow Along", section: "stay_fit", place: "home", level: "beginner", kit: "none", sessions: 1, minutes: 15, youtube: "https://youtu.be/aBcDeFgHiJk" });
    assert.equal(made.status, 400, "a new program can't take one either");
  }));
});
