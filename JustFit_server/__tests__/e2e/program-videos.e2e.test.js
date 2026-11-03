// Session videos end to end (2026-11-03): a program's sessions are YouTube videos the admin adds
// (a link, embedded, never an uploaded file), edits, reorders and deletes; no AI writes sessions
// and there is no Do this today. Members see each session's video with its creator
// (read from the YouTube Data API, here a local fake that answers like it). Against the real
// Express server and the isolated justfit_test database. Covers the attack paths too: no session,
// members on the admin's routes, playlists, files and other links, another program's session,
// malformed IDs, the program-level link (gone), and YouTube failing or its answers expiring.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const http = require("node:http");
const mysql = require("mysql2/promise");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const KEY = "test-youtube-key";
const VIDEO = "singlevid01";

// Answers like the YouTube Data API's /videos: every 11-character ID but "deadvideo00" is public
function fakeYouTube() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fake");
    calls.push({ path: url.pathname, key: url.searchParams.get("key") });
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.searchParams.get("key") !== KEY) return send(403, { error: { message: "bad key" } });
    if (url.pathname !== "/videos") return send(404, {});
    const ids = (url.searchParams.get("id") ?? "").split(",").filter((id) => id !== "deadvideo00");
    send(200, { items: ids.map((id) => ({ id, snippet: { title: "A workout", channelTitle: id === VIDEO ? "Solo Channel" : "Uploader" }, contentDetails: { duration: "PT20M" }, status: { privacyStatus: "public" } })) });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

describe("session videos e2e: the admin's sessions, each with one embedded YouTube video", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, youtube, testAccounts, program, other;
  const identities = {};
  const ids = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const sessionsRoute = (id = program.id) => `/api/admin/portal/programs/${id}/sessions`;
  const add = (body, { id = program.id, token = tokens.admin } = {}) => api("POST", sessionsRoute(id), token, body);
  const edit = (sessionId, body, { id = program.id, token = tokens.admin } = {}) => api("PATCH", `${sessionsRoute(id)}/${sessionId}`, token, body);
  const remove = (sessionId, { id = program.id, token = tokens.admin } = {}) => api("DELETE", `${sessionsRoute(id)}/${sessionId}`, token);
  const move = (sessionId, direction, { id = program.id, token = tokens.admin } = {}) => api("POST", `${sessionsRoute(id)}/${sessionId}/move`, token, { direction });
  const memberView = async (token = tokens.member, id = program.id) => (await api("GET", `/api/fitness/programs/${id}`, token)).json.program;
  const audits = async () => (await connection.query("SELECT action FROM admin_audit_log WHERE admin_id = ? ORDER BY id", [ids.admin]))[0].map((r) => r.action);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    youtube = await fakeYouTube();
    server = await startTestServer({ ...env, AI_PROVIDER: "fake", YOUTUBE_API_URL: youtube.url, YOUTUBE_API_KEY: KEY });
    try {
      for (const [tag, role] of [["member", undefined], ["admin", "admin"]]) {
        const identity = await testAccounts.createIdentity(runId, tag, role ? { role } : undefined);
        const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        ids[tag] = identity.id;
        tokens[tag] = jwt;
        await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)", [identity.id, identity.emailAddress, `Video ${tag}`, role ?? "user"]);
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    const list = (await api("GET", "/api/admin/portal/programs", tokens.admin)).json.programs;
    program = list.find((p) => p.title === "Yoga for Beginners");
    other = list.find((p) => p.title === "Workout for Beginners");
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const all = Object.values(ids);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [all]);
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
    if (youtube) await new Promise((r) => youtube.server.close(r));
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  it("1. the session routes need a session and the admin; members can't use them", run(async () => {
    assert.ok(program && other, "two starter programs to work on");
    const body = { title: "Day 1", minutes: 15, youtube: VIDEO };
    assert.deepEqual((await memberView()).sessions, [], "a starter program has no sessions until the admin adds videos");
    const first = crypto.randomUUID();
    for (const token of [null, "jfs_forged-token-that-was-never-issued"]) {
      assert.equal((await add(body, { token })).status, 401);
      assert.equal((await edit(first, { minutes: 20 }, { token })).status, 401);
      assert.equal((await remove(first, { token })).status, 401);
      assert.equal((await move(first, "down", { token })).status, 401);
    }
    assert.equal((await add(body, { token: tokens.member })).status, 403);
    assert.equal((await edit(first, { minutes: 20 }, { token: tokens.member })).status, 403);
    assert.equal((await remove(first, { token: tokens.member })).status, 403);
    assert.equal((await move(first, "down", { token: tokens.member })).status, 403);
    assert.deepEqual((await memberView()).sessions, [], "nothing changed");
  }));

  it("2. the admin adds a video session at the end; members see its video and creator, and no exercises", run(async () => {
    const before = youtube.calls.length;
    const r = await add({ title: "Day 1: gentle core", minutes: 15, youtube: `https://www.youtube.com/watch?v=${VIDEO}` });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.program.videoError, undefined);
    const added = r.json.program.sessions.at(-1);
    assert.equal(r.json.program.sessions.length, 1);
    assert.deepEqual(added, { id: added.id, title: "Day 1: gentle core", minutes: 15, video: { id: VIDEO, channel: "Solo Channel" } });
    assert.equal(youtube.calls.length, before + 1, "YouTube is asked once, for the creator");
    assert.ok(youtube.calls.every((c) => c.key === KEY) && !JSON.stringify(r.json).includes(KEY), "the key goes to YouTube, never to the app");
    state.video = added.id;

    const asked = youtube.calls.length;
    const mine = (await memberView()).sessions.at(-1);
    assert.deepEqual(mine.video, { id: VIDEO, channel: "Solo Channel" });
    assert.equal(youtube.calls.length, asked, "members read the saved copy, never YouTube");
    assert.equal((await audits()).at(-1), "program.session_add");
  }));

  it("3. only one YouTube video's link: playlists, files, other sites and stray fields are refused", run(async () => {
    for (const body of [
      { title: "Day 2", minutes: 15, youtube: "https://www.youtube.com/playlist?list=PLpa0d6IJAhbjxlK1l2-WcD5F64jNg58t0" },
      { title: "Day 2", minutes: 15, youtube: "https://cdn.example.com/workout.mp4" },
      { title: "Day 2", minutes: 15, youtube: "javascript:alert(1)" },
      { title: "Day 2", minutes: 15 },
      { title: "Day 2", minutes: 15, youtube: VIDEO, data: "AAAA", mediaType: "video/mp4" },
      { title: "Day 2", minutes: 15, youtube: VIDEO, programId: other.id },
      { title: "'; DROP TABLE fitness_program_sessions; --", minutes: 900, youtube: VIDEO },
    ]) {
      assert.equal((await add(body)).status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal((await memberView()).sessions.length, 1, "nothing was added");
    // The program-level link is gone
    assert.equal((await api("PATCH", `/api/admin/portal/programs/${program.id}`, tokens.admin, { youtube: VIDEO })).status, 400);
    assert.equal((await api("POST", `/api/admin/portal/programs/${program.id}/videos/refresh`, tokens.admin)).status, 404);
  }));

  it("4. unknown, malformed and other programs' sessions are 404", run(async () => {
    assert.equal((await add({ title: "Day 2", minutes: 15, youtube: VIDEO }, { id: crypto.randomUUID() })).status, 404);
    assert.equal((await edit(state.video, { minutes: 20 }, { id: other.id })).status, 404, "a session of another program");
    assert.equal((await remove(state.video, { id: other.id })).status, 404);
    assert.equal((await move(state.video, "up", { id: other.id })).status, 404);
    for (const bad of ["1%27%20OR%201%3D1", "not-a-uuid", crypto.randomUUID()]) assert.equal((await edit(bad, { minutes: 20 })).status, 404, bad);
    assert.deepEqual((await memberView(tokens.member, other.id)).sessions, []);
  }));

  it("5. Do this today is gone", run(async () => {
    const r = await api("POST", `/api/fitness/programs/${program.id}/sessions/${state.video}/today`, tokens.member, { today: new Date().toISOString().slice(0, 10) });
    assert.equal(r.status, 404);
  }));

  it("6. editing: a new title and minutes, a new video; a session always keeps one", run(async () => {
    const renamed = await edit(state.video, { title: "Day 1: core and breath", minutes: 20 });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.deepEqual(renamed.json.program.sessions[0], { id: state.video, title: "Day 1: core and breath", minutes: 20, video: { id: VIDEO, channel: "Solo Channel" } }, "the video stays");
    const swapped = await edit(state.video, { youtube: "https://youtu.be/aBcDeFgHiJk" });
    assert.deepEqual(swapped.json.program.sessions[0].video, { id: "aBcDeFgHiJk", channel: "Uploader" }, "a new video's creator is read again");
    assert.equal((await edit(state.video, { youtube: "" })).status, 400, "the video can't be taken off");
    assert.equal((await edit(state.video, { youtube: VIDEO })).status, 200);
    assert.ok((await audits()).includes("program.session_edit"));
  }));

  it("7. moving up and down; deleting closes the gap, down to no sessions", run(async () => {
    const order = async () => (await memberView()).sessions.map((s) => s.id);
    const second = (await add({ title: "Day 2", minutes: 10, youtube: "zzzzzzzzzzz" })).json.program.sessions.at(-1).id;
    const third = (await add({ title: "Day 3", minutes: 10, youtube: "yyyyyyyyyyy" })).json.program.sessions.at(-1).id;
    assert.deepEqual(await order(), [state.video, second, third]);
    assert.equal((await move(third, "up")).status, 200);
    assert.deepEqual(await order(), [state.video, third, second]);
    assert.equal((await move(state.video, "up")).status, 200, "the first can't go further: nothing changes");
    assert.deepEqual(await order(), [state.video, third, second]);
    assert.equal((await move(third, "sideways")).status, 400);

    const gone = await remove(third);
    assert.equal(gone.status, 200);
    assert.deepEqual(gone.json.program.sessions.map((s) => s.id), [state.video, second]);
    assert.equal((await audits()).at(-1), "program.session_remove");
    const [[{ gaps }]] = await connection.query("SELECT COUNT(*) - (MAX(position) + 1) AS gaps FROM fitness_program_sessions WHERE program_id = ?", [program.id]);
    assert.equal(Number(gaps), 0, "positions run 0, 1, 2…");
    assert.equal((await remove(second)).status, 200);

    // A program can have no sessions at all (members see Coming soon)
    const solo = (await api("POST", "/api/admin/portal/programs", tokens.admin, { title: "Solo Program", section: "stay_fit", place: "home", level: "beginner", kit: "none" })).json.program;
    const one = (await add({ title: "Only", minutes: 10, youtube: VIDEO }, { id: solo.id })).json.program.sessions[0].id;
    const r = await remove(one, { id: solo.id });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.program.sessions, []);
  }));

  it("8. Rewrite with AI is gone", run(async () => {
    assert.equal((await api("POST", `/api/admin/portal/programs/${program.id}/redraft`, tokens.admin, { request: "" })).status, 404);
    assert.equal((await memberView()).sessions.length, 1, "the sessions stay as they are");
  }));

  it("9. when YouTube can't be asked the session is saved without a creator, and the reason is given", run(async () => {
    const r = await add({ title: "Day 3", minutes: 15, youtube: "deadvideo00" });
    assert.equal(r.status, 201);
    assert.match(r.json.program.videoError, /private or was removed/);
    assert.deepEqual(r.json.program.sessions.at(-1).video, { id: "deadvideo00", channel: null });
    assert.equal((await remove(r.json.program.sessions.at(-1).id)).status, 200);
  }));

  it("10. YouTube's answers expire: the creator is read again before 25 days, hidden and wiped at 30", run(async () => {
    const { refreshStale } = require("../../fitness/youtubeRefresh");
    const pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectionLimit: 2 });
    try {
      const age = (days) => connection.query("UPDATE fitness_program_sessions SET youtube_synced_at = NOW() - INTERVAL ? DAY WHERE id = ?", [days, state.video]);
      const video = async () => (await memberView()).sessions.find((s) => s.id === state.video).video;
      await age(31);
      assert.deepEqual(await video(), { id: VIDEO, channel: null }, "the video is ours and stays; the old creator isn't shown");

      const noKey = await refreshStale(pool, { NODE_ENV: "test" });
      assert.equal(noKey.refreshed, 0);
      const [[row]] = await connection.query("SELECT youtube_channel FROM fitness_program_sessions WHERE id = ?", [state.video]);
      assert.equal(row.youtube_channel, null, "wiped without a key");

      await age(26);
      const withKey = await refreshStale(pool, { NODE_ENV: "test", YOUTUBE_API_KEY: KEY, YOUTUBE_API_URL: youtube.url });
      assert.ok(withKey.refreshed >= 1);
      assert.deepEqual(await video(), { id: VIDEO, channel: "Solo Channel" });
    } finally {
      await pool.end();
    }
  }));
});
