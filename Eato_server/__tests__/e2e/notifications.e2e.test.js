// The bell end to end: real Clerk development identities against the real Express server and
// the isolated `eato_test` database. Each notification comes from the route that causes it
// (a friend accepting, a trainer accepting and sharing a plan, a gym approval, an RSVP), and
// shows only to the member it concerns. Covers the actionable counts on the badge, blocking,
// and no session.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const TODAY = new Date().toISOString().slice(0, 10);
const CLEANUP_TABLES = ["gym_event_rsvps", "gym_events", "gym_members", "whatsapp_agent_settings", "whatsapp_connections", "gym_visits", "gym_scan_failures", "gyms", "diet_plan_meal_items", "diet_plan_meals", "diet_plans", "trainer_target_recommendations",
  "trainer_connections", "trainer_profiles", "trainer_clients", "workout_day_exercises", "workout_days", "workout_plans", "community_friendships", "community_blocks", "nutrition_targets", "profiles"];
const FOOD = { name: "Oats", quantity: 60, unit: "g", kcal: 230, proteinG: 8, carbsG: 40, fatG: 4 };

describe("notifications e2e: the bell for friends, trainers and gyms", () => {
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
    patch: (route, body) => api("PATCH", route, tokens[tag], body),
    del: (route) => api("DELETE", route, tokens[tag]),
  });
  const newIdentity = async (tag, role) => {
    const identity = await clerk.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const bell = async (tag) => {
    const res = await as(tag).get("/api/community/notifications");
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json;
  };
  const types = (activity) => activity.map((a) => a.type);

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
      await newIdentity("tara", "trainer");
      await newIdentity("platform", "admin");
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    const names = { a: "Asha Rao", b: "Bilal Khan", tara: "Tara Trainer", platform: "Platform Admin" };
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [ids[tag], identities[tag].emailAddress, names[tag], tag === "tara" ? "trainer" : tag === "platform" ? "admin" : "user"]);
    }
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

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. the bell needs a valid session, and starts empty", async () => {
    assert.equal((await api("GET", "/api/community/notifications", null)).status, 401);
    assert.equal((await api("GET", "/api/community/notifications", "not-a-jwt")).status, 401);
    const empty = await bell("a");
    assert.deepEqual({ followRequests: empty.followRequests, friendRequests: empty.friendRequests, gymRequests: empty.gymRequests, requestCount: empty.requestCount, activity: empty.activity },
      { followRequests: [], friendRequests: [], gymRequests: [], requestCount: 0, activity: [] });
  });

  test("2. a friend request counts on the badge; its acceptance notifies the sender only", async () => {
    await as("a").post(`/api/community/friends/${ids.b}/request`);
    const bBell = await bell("b");
    assert.deepEqual(bBell.friendRequests.map((r) => r.member.id), [ids.a]);
    assert.equal(bBell.requestCount, 1, "an incoming request is something to act on");
    assert.equal((await bell("a")).requestCount, 0, "the sender has nothing to act on");
    await as("b").post(`/api/community/friends/${ids.a}/accept`);
    assert.equal((await bell("b")).requestCount, 0);
    const aBell = await bell("a");
    assert.deepEqual(types(aBell.activity), ["friend_accepted"]);
    assert.equal(aBell.activity[0].member.id, ids.b);
    assert.equal(Object.hasOwn(aBell.activity[0].member, "email"), false);
    assert.equal(types((await bell("b")).activity).includes("friend_accepted"), false, "the one who accepted isn't told about it");
  });

  test("3. a trainer accepting and sharing a plan, a workout and targets notifies the client only", async () => {
    assert.equal((await as("tara").put("/api/trainers/me/profile", { title: "Strength coach", specialties: ["strength", "nutrition"], bio: "Eight years coaching lifters of every level.", offersNutrition: true })).status, 200);
    await as("a").post(`/api/trainers/${ids.tara}/connect`);
    await as("tara").post(`/api/trainers/me/requests/${ids.a}/accept`);
    const meals = ["breakfast", "morning_snack", "lunch", "evening_snack", "dinner"].map((slot) => ({ slot, name: slot, time: "08:00", items: [FOOD] }));
    assert.equal((await as("tara").put(`/api/trainers/me/clients/${ids.a}/plan`, { name: "Lean phase", goal: "fat_loss", startDate: TODAY, meals })).status, 200);
    assert.equal((await as("tara").put(`/api/trainers/me/clients/${ids.a}/recommendation`, { calories: 2100, proteinG: 160, carbsG: 220, fatG: 60 })).status, 200);
    const exercise = (await as("tara").get("/api/trainers/library")).json.exercises[0];
    assert.equal((await as("tara").put(`/api/trainers/me/clients/${ids.a}/workout`, { today: TODAY, name: "Upper/lower", goal: "build_muscle", level: "beginner", days: [{ weekday: 1, title: "Upper", exercises: [{ exerciseId: exercise.id, sets: [{ reps: 8 }], restSec: 60 }] }] })).status, 200);
    const got = types((await bell("a")).activity);
    for (const kind of ["trainer_accepted", "plan_updated", "recommendation", "workout_updated"]) assert.ok(got.includes(kind), `${kind} in ${got}`);
    const recommendation = (await bell("a")).activity.find((x) => x.type === "recommendation");
    assert.equal(recommendation.preview, "recommended 2100 kcal a day");
    assert.deepEqual(types((await bell("b")).activity), [], "another member sees none of it");
    // An applied recommendation is no longer news
    await connection.query("INSERT INTO nutrition_targets (user_id, formula, config_version, inputs, calculated, calculated_at, calories, protein_g, carbs_g, fat_g) VALUES (?, 'eato-calculator', 'test', ?, NULL, NOW(), 2400, 140, 290, 75)",
      [ids.a, JSON.stringify({ weightKg: 70, fitnessGoal: "muscle_gain" })]);
    assert.equal((await as("a").post("/api/trainers/me/recommendation/apply")).status, 200);
    assert.equal(types((await bell("a")).activity).includes("recommendation"), false);
  });

  test("4. a gym join request counts for its admins; the approval notifies the member; an instant join doesn't", async () => {
    const created = await as("platform").post("/api/gyms", { name: "Quiet Strength", ownerEmail: identities.b.emailAddress, visibility: "private" });
    state.gym = created.json.gym.id;
    await as("a").post(`/api/gyms/${state.gym}/join`);
    const bBell = await bell("b");
    assert.deepEqual(bBell.gymRequests, [{ gymId: state.gym, gymName: "Quiet Strength", waiting: 1, latestAt: bBell.gymRequests[0].latestAt }]);
    assert.equal(bBell.requestCount, 1);
    assert.deepEqual((await bell("a")).gymRequests, [], "only the gym's admins see its requests");
    // Approved a while after asking (an approval, not an instant join)
    await connection.query("UPDATE gym_members SET requested_at = NOW() - INTERVAL 1 MINUTE WHERE gym_id = ? AND user_id = ?", [state.gym, ids.a]);
    assert.equal((await as("b").patch(`/api/gyms/${state.gym}/members/${ids.a}`, { status: "active" })).status, 200);
    assert.equal((await bell("b")).requestCount, 0);
    const approval = (await bell("a")).activity.find((x) => x.type === "gym_approved");
    assert.ok(approval, "the member is told");
    assert.equal(approval.gymId, state.gym);
    assert.equal(approval.preview, "Your request to join Quiet Strength was approved");
    const open = await as("platform").post("/api/gyms", { name: "Open Iron", ownerEmail: identities.b.emailAddress });
    await as("tara").post(`/api/gyms/${open.json.gym.id}/join`);
    assert.equal(types((await bell("tara")).activity).includes("gym_approved"), false, "joining instantly isn't an approval");
  });

  test("5. an RSVP notifies the event's host; a block hides the member's activity", async () => {
    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const event = await as("b").post(`/api/gyms/${state.gym}/events`, { title: "Deadlift clinic", description: "Form check", date, startTime: "07:00", endTime: "08:00", location: "Main floor" });
    assert.equal(event.status, 201, JSON.stringify(event.json));
    assert.equal((await as("a").post(`/api/gyms/${state.gym}/events/${event.json.event.id}/rsvp`)).status, 200);
    const rsvp = (await bell("b")).activity.find((x) => x.type === "rsvp");
    assert.ok(rsvp);
    assert.equal(rsvp.member.id, ids.a);
    assert.equal(rsvp.preview, "is going to Deadlift clinic");
    assert.equal(types((await bell("a")).activity).includes("rsvp"), false, "the one going isn't told");
    // Blocking hides what the blocked member did
    assert.equal((await as("b").post(`/api/community/profiles/${ids.a}/block`)).status, 200);
    try {
      assert.equal(types((await bell("b")).activity).includes("rsvp"), false);
      assert.equal(types((await bell("a")).activity).includes("friend_accepted"), false, "and the friendship the block ended");
    } finally {
      await as("b").del(`/api/community/profiles/${ids.a}/block`);
    }
  });
});
