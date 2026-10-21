// The gym assistant's owner side end to end, with the test-only fake AI: real Clerk development
// identities against the real Express server and the isolated `eato_test` database. Covers a
// question the assistant can't answer reaching the team, custom answers being used first (and
// switched off), replies reaching only the asker (their Ask chat and bell), dismissing, one reply
// per question, who may do what, input checks, another gym's data looking missing, and the counts
// on Home and the Community tab.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const CLEANUP_TABLES = ["gym_assistant_questions", "gym_faqs", "whatsapp_usage", "gym_notices", "gym_visits", "gym_scan_failures", "whatsapp_agent_settings", "whatsapp_connections", "gym_members", "gyms"];

describe("owner assistant e2e: questions for the team and custom answers", () => {
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
    del: (route) => api("DELETE", route, tokens[tag]),
  });
  const route = (path, gym = state.gym) => `/api/owner/gyms/${gym}${path}`;
  const ask = (tag, question) => as(tag).post(`/api/gyms/${state.gym}/assistant`, { question });
  const replies = async (tag) => (await as(tag).get("/api/community/notifications")).json.activity.filter((a) => a.type === "gym_reply");

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" }); // never a paid model in tests
    try {
      for (const tag of ["owner", "admin", "coach", "member", "other", "otherOwner"]) {
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
    const a = await as("platform").post("/api/gyms", { name: `Assistant Gym ${runId}`, ownerEmail: identities.owner.emailAddress });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.gym = a.json.gym.id;
    const b = await as("platform").post("/api/gyms", { name: `Other Assistant Gym ${runId}`, ownerEmail: identities.otherOwner.emailAddress });
    state.otherGym = b.json.gym.id;
    for (const [tag, role] of [["admin", "admin"], ["coach", "trainer"], ["member", "member"], ["other", "member"]]) {
      await connection.query("INSERT INTO gym_members (gym_id, user_id, role, status, joined_at) VALUES (?, ?, ?, 'active', NOW())", [state.gym, ids[tag], role]);
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

  test("1. a question the assistant can't answer reaches the team; one it can answer doesn't", async () => {
    const res = await ask("member", "Do you have a student discount for college kids?");
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.escalated, true);
    await ask("other", "Can I bring a friend along before they sign up?");
    const list = await as("owner").get(route("/questions"));
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.open.map((q) => q.asker.id), [ids.member, ids.other], "oldest first");
    assert.equal(list.json.open[0].question, "Do you have a student discount for college kids?");
    assert.equal(list.json.open[0].aiReply, "I'm not sure about that. A team member will follow up.");
    const home = await as("owner").get(route("/summary"));
    assert.equal(home.json.attention.questionsForTeam, 2);
    assert.equal((await as("owner").get(route("/community"))).json.counts.questionsToAnswer, 2);
  });

  test("2. a custom answer is used first, and switching it off sends questions to the team again", async () => {
    const created = await as("owner").post(route("/faqs"), { question: "Student discount", answer: "Students get 20% off with a valid college ID." });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const answered = await ask("member", "Is there a student discount?");
    assert.equal(answered.json.reply, "Students get 20% off with a valid college ID.");
    assert.equal(answered.json.escalated, false);
    assert.equal((await as("owner").get(route("/questions"))).json.open.length, 2, "nothing new for the team");
    assert.equal((await as("admin").patch(route(`/faqs/${created.json.faq.id}`), { active: false })).json.faq.active, false);
    assert.equal((await ask("member", "Is there a student discount?")).json.escalated, true);
    assert.equal((await as("owner").get(route("/faqs"))).json.faqs.length, 1);
    assert.equal((await as("owner").del(route(`/faqs/${created.json.faq.id}`))).status, 200);
    assert.deepEqual((await as("owner").get(route("/faqs"))).json.faqs, []);
  });

  test("3. a reply reaches only the asker: their Ask chat and their bell; once only", async () => {
    const [first] = (await as("owner").get(route("/questions"))).json.open;
    const res = await as("owner").post(route(`/questions/${first.id}/reply`), { answer: "Yes, 15% off for students." });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.question.status, "answered");
    assert.equal(res.json.question.answeredBy, "owner person");
    assert.equal((await as("admin").post(route(`/questions/${first.id}/reply`), { answer: "Again" })).status, 409);
    const chat = await as("member").get(`/api/owner/my-questions/${state.gym}`);
    const mine = chat.json.questions.find((q) => q.id === first.id);
    assert.equal(mine.answer, "Yes, 15% off for students.");
    assert.equal(Object.hasOwn(mine, "answeredBy"), false, "the asker sees the team's reply, not who wrote it");
    const [bell] = await replies("member");
    assert.equal(bell.preview, "Yes, 15% off for students.");
    assert.equal(bell.gymId, state.gym);
    assert.deepEqual(await replies("other"), [], "nobody else is told");
    const otherChat = await as("other").get(`/api/owner/my-questions/${state.gym}`);
    assert.equal(otherChat.json.questions.some((q) => q.id === first.id), false, "askers only see their own questions");
  });

  test("4. dismissing closes a question without a reply; handled questions move to the closed list", async () => {
    const open = (await as("owner").get(route("/questions"))).json.open;
    const target = open.find((q) => q.asker.id === ids.other);
    assert.equal((await as("admin").post(route(`/questions/${target.id}/dismiss`))).status, 200);
    assert.equal((await as("admin").post(route(`/questions/${target.id}/dismiss`))).status, 409);
    assert.equal((await as("owner").post(route(`/questions/${target.id}/reply`), { answer: "Late" })).status, 409);
    const list = (await as("owner").get(route("/questions"))).json;
    assert.ok(list.closed.some((q) => q.id === target.id && q.status === "dismissed"));
    assert.ok(list.closed.some((q) => q.status === "answered"));
  });

  test("5. only the gym's owner, admins and platform admins see questions and edit custom answers", async () => {
    assert.equal((await api("GET", route("/questions"), null)).status, 401);
    assert.equal((await api("GET", "/api/owner/my-questions/" + state.gym, null)).status, 401);
    const [q] = (await as("owner").get(route("/questions"))).json.open;
    for (const tag of ["coach", "member", "otherOwner"]) {
      assert.equal((await as(tag).get(route("/questions"))).status, 403, tag);
      assert.equal((await as(tag).get(route("/faqs"))).status, 403, tag);
      assert.equal((await as(tag).post(route("/faqs"), { question: "Hours", answer: "6 to 10" })).status, 403, tag);
      if (q) assert.equal((await as(tag).post(route(`/questions/${q.id}/reply`), { answer: "x" })).status, 403, tag);
    }
    assert.equal((await as("platform").get(route("/questions"))).status, 200);
    // Another gym's question or answer looks missing from this gym
    await connection.query("INSERT INTO gym_assistant_questions (id, gym_id, user_id, question) VALUES (?, ?, ?, 'Elsewhere?')", [state.otherQ = crypto.randomUUID(), state.otherGym, ids.otherOwner]);
    assert.equal((await as("owner").post(route(`/questions/${state.otherQ}/reply`), { answer: "Not mine" })).status, 404);
    const theirs = await as("otherOwner").post(route("/faqs", state.otherGym), { question: "Parking", answer: "Free" });
    assert.equal((await as("owner").patch(route(`/faqs/${theirs.json.faq.id}`), { answer: "Paid" })).status, 404);
    assert.equal((await as("owner").del(route(`/faqs/${theirs.json.faq.id}`))).status, 404);
  });

  test("6. replies and custom answers are checked", async () => {
    assert.equal((await as("owner").post(route("/faqs"), { question: "Hours", answer: "6 to 10" })).status, 201);
    await ask("member", "HUMAN_PLEASE talk to someone");
    const [open] = (await as("owner").get(route("/questions"))).json.open;
    for (const body of [{}, { answer: "" }, { answer: "x".repeat(1001) }, { answer: "ok", extra: 1 }, []]) {
      assert.equal((await as("owner").post(route(`/questions/${open.id}/reply`), body)).status, 400, JSON.stringify(body).slice(0, 40));
    }
    for (const body of [{}, { question: "Hours" }, { question: "x".repeat(201), answer: "y" }, { question: "a", answer: "x".repeat(1001) }, { question: "a", answer: "b", position: 1 }, { question: "a", answer: "b", active: "yes" }]) {
      assert.equal((await as("owner").post(route("/faqs"), body)).status, 400, JSON.stringify(body).slice(0, 40));
    }
    const faq = (await as("owner").get(route("/faqs"))).json.faqs[0];
    assert.equal((await as("owner").patch(route(`/faqs/${faq.id}`), {})).status, 400, "nothing to change");
    assert.equal((await as("owner").patch(route("/faqs/not-a-uuid"), { answer: "x" })).status, 400);
    assert.equal((await as("owner").post(route("/questions/1%27%20OR%201%3D1/reply"), { answer: "x" })).status, 400);
  });
});
