// The owner portal's Review tab end to end: real Clerk development identities against the real
// Express server and the isolated `eato_test` database. Covers who may review (the gym's owner and
// admins, and platform admins; never trainers, members or another gym), held posts (approve,
// reject), reported posts (keep dismisses the reports, remove takes the post down and marks them
// reviewed, so both leave the open queue), reporters staying anonymous, another gym's posts looking
// missing, and the "review posts first" switch.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const CLEANUP_TABLES = ["community_reports", "community_posts", "gym_notices", "gym_visits", "gym_scan_failures", "whatsapp_agent_settings", "whatsapp_connections", "gym_members", "gym_assistant_questions", "gyms"];

describe("owner review e2e: held posts and reported posts", () => {
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
    patch: (route, body) => api("PATCH", route, tokens[tag], body),
  });
  const route = (path, gym = state.gym) => `/api/owner/gyms/${gym}${path}`;
  const post = async (tag, gym, status, body) => {
    const id = crypto.randomUUID();
    await connection.query("INSERT INTO community_posts (id, user_id, gym_id, review_status, body) VALUES (?, ?, ?, ?, ?)", [id, ids[tag], gym, status, body]);
    return id;
  };
  const report = (tag, postId, reason) => connection.query("INSERT INTO community_reports (id, reporter_id, post_id, reason) VALUES (UUID(), ?, ?, ?)", [ids[tag], postId, reason]);
  const postRow = async (id) => (await connection.query("SELECT review_status, deleted_at FROM community_posts WHERE id = ?", [id]))[0][0];
  const reportStatuses = async (id) => (await connection.query("SELECT status FROM community_reports WHERE post_id = ? ORDER BY status", [id]))[0].map((r) => r.status);

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      for (const tag of ["owner", "admin", "coach", "member", "reporter", "otherOwner"]) {
        const identity = await clerk.createIdentity(runId, tag.toLowerCase(), { role: tag === "coach" ? "trainer" : undefined });
        const { sessionId, jwt } = await clerk.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        ids[tag] = identity.id;
        tokens[tag] = jwt;
      }
      const platform = await clerk.createIdentity(runId, "platform", { role: "admin" });
      const minted = await clerk.mintToken(platform.id);
      identities.platform = { ...platform, sessionId: minted.sessionId };
      ids.platform = platform.id;
      tokens.platform = minted.jwt;
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user')", [ids[tag], identities[tag].emailAddress, `${tag} person`]);
    }
    const a = await as("platform").post("/api/gyms", { name: `Review Gym ${runId}`, ownerEmail: identities.owner.emailAddress });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.gym = a.json.gym.id;
    const b = await as("platform").post("/api/gyms", { name: `Other Review Gym ${runId}`, ownerEmail: identities.otherOwner.emailAddress });
    state.otherGym = b.json.gym.id;
    for (const [tag, role] of [["admin", "admin"], ["coach", "trainer"], ["member", "member"], ["reporter", "member"]]) {
      await connection.query("INSERT INTO gym_members (gym_id, user_id, role, status, joined_at) VALUES (?, ?, ?, 'active', NOW())", [state.gym, ids[tag], role]);
    }
    state.held1 = await post("member", state.gym, "pending", "Selling three unopened tubs of whey");
    state.held2 = await post("member", state.gym, "pending", "Anyone up for a 5 am run?");
    // held1 waited longer (posts made in the same second would otherwise tie)
    await connection.query("UPDATE community_posts SET created_at = NOW() - INTERVAL 1 HOUR WHERE id = ?", [state.held1]);
    state.live = await post("member", state.gym, "published", "Leg day done");
    state.rude = await post("member", state.gym, "published", "Something rude");
    await report("reporter", state.live, "Spam");
    await report("coach", state.live, "Spam");
    await report("reporter", state.rude, "Harassment");
    state.otherPost = await post("otherOwner", state.otherGym, "pending", "Another gym's post");
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

  test("1. review needs a session and the gym's owner, an admin or a platform admin", async () => {
    assert.equal((await api("GET", route("/review"), null)).status, 401);
    assert.equal((await api("POST", route(`/review/posts/${state.held1}/approve`), "not-a-jwt")).status, 401);
    for (const tag of ["coach", "member", "otherOwner"]) {
      assert.equal((await as(tag).get(route("/review"))).status, 403, tag);
      assert.equal((await as(tag).post(route(`/review/posts/${state.held1}/approve`))).status, 403, tag);
      assert.equal((await as(tag).post(route(`/review/posts/${state.rude}/remove`))).status, 403, tag);
      assert.equal((await as(tag).patch(route("/review/settings"), { postModeration: true })).status, 403, tag);
    }
    for (const tag of ["owner", "admin", "platform"]) assert.equal((await as(tag).get(route("/review"))).status, 200, tag);
    assert.equal((await postRow(state.held1)).review_status, "pending", "nothing changed");
  });

  test("2. the review lists held posts oldest first, and reported posts with reasons and a count but no reporters", async () => {
    const res = await as("owner").get(route("/review"));
    assert.deepEqual(res.json.pending.map((p) => p.id), [state.held1, state.held2]);
    assert.equal(res.json.pending[0].author.id, ids.member);
    const live = res.json.reported.find((r) => r.post.id === state.live);
    assert.equal(live.reports, 2);
    assert.deepEqual(live.reasons, ["Spam"], "the same reason once");
    assert.equal(JSON.stringify(res.json).includes(ids.reporter), false, "reporters stay anonymous");
    assert.equal(res.json.reported.some((r) => r.post.id === state.otherPost), false);
    assert.equal(res.json.postModeration, false);
  });

  test("3. approve publishes a held post; reject removes one; neither works twice or on a live post", async () => {
    const approved = await as("owner").post(route(`/review/posts/${state.held1}/approve`));
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    assert.equal((await postRow(state.held1)).review_status, "published");
    assert.equal((await as("owner").post(route(`/review/posts/${state.held1}/approve`))).status, 409);
    assert.equal((await as("admin").post(route(`/review/posts/${state.held1}/reject`))).status, 409, "a live post is removed from Reported instead");
    const rejected = await as("admin").post(route(`/review/posts/${state.held2}/reject`));
    assert.equal(rejected.status, 200);
    assert.ok((await postRow(state.held2)).deleted_at);
    assert.equal((await as("admin").post(route(`/review/posts/${state.held2}/approve`))).status, 404, "a removed post is gone");
  });

  test("4. another gym's post, a made-up id or a bad id can't be touched from this gym", async () => {
    for (const action of ["approve", "reject", "keep", "remove"]) {
      assert.equal((await as("owner").post(route(`/review/posts/${state.otherPost}/${action}`))).status, 404, action);
      assert.equal((await as("owner").post(route(`/review/posts/${crypto.randomUUID()}/${action}`))).status, 404, action);
      assert.equal((await as("owner").post(route(`/review/posts/1%27%20OR%201%3D1/${action}`))).status, 400, action);
    }
    assert.equal((await postRow(state.otherPost)).review_status, "pending");
    assert.equal((await postRow(state.otherPost)).deleted_at, null);
  });

  test("5. keep dismisses a post's open reports; it leaves the admin queue but stays live", async () => {
    const kept = await as("owner").post(route(`/review/posts/${state.live}/keep`));
    assert.equal(kept.status, 200, JSON.stringify(kept.json));
    assert.equal(kept.json.dismissed, 2);
    assert.deepEqual(await reportStatuses(state.live), ["dismissed", "dismissed"]);
    assert.equal((await postRow(state.live)).deleted_at, null);
    assert.equal((await as("owner").post(route(`/review/posts/${state.live}/keep`))).status, 409, "no open reports left");
    const open = (await connection.query("SELECT COUNT(*) AS n FROM community_reports WHERE status = 'open' AND post_id = ?", [state.live]))[0][0].n;
    assert.equal(open, 0, "nothing left for JustFit's admin queue");
  });

  test("6. remove takes a reported post down and marks its reports reviewed, together", async () => {
    const removed = await as("platform").post(route(`/review/posts/${state.rude}/remove`));
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.ok((await postRow(state.rude)).deleted_at);
    assert.deepEqual(await reportStatuses(state.rude), ["reviewed"]);
    assert.equal((await as("owner").post(route(`/review/posts/${state.rude}/remove`))).status, 404);
    const res = await as("owner").get(route("/review"));
    assert.deepEqual(res.json.reported, []);
    assert.deepEqual(res.json.pending, []);
  });

  test("7. the review-first switch is checked and saved", async () => {
    for (const body of [{}, { postModeration: "yes" }, { postModeration: true, extra: 1 }, []]) {
      assert.equal((await as("owner").patch(route("/review/settings"), body)).status, 400, JSON.stringify(body));
    }
    assert.deepEqual((await as("admin").patch(route("/review/settings"), { postModeration: true })).json, { postModeration: true });
    assert.equal((await connection.query("SELECT post_moderation FROM gyms WHERE id = ?", [state.gym]))[0][0].post_moderation, 1);
    assert.equal((await as("owner").get(route("/review"))).json.postModeration, true);
  });
});
