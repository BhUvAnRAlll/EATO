// Home's jiggle mode end to end (2026-11-09): a gym admin and a Staff login each arrange the
// Today tiles at their branch (PUT /api/gym/home-tiles) and read their own order back on the
// dashboard; nobody else's changes. Attack paths: no session, a member (no gym), a missing or
// repeated tile, an unknown tile or field, SQL in a tile id, and nothing written to the Activity log.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const TILES = ["admission", "renewal", "enquiry", "due-paid", "pt", "product"];

describe("gym Home tiles e2e: each login's own order of the Today tiles", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, text };
  };
  const as = (tag) => ({
    get: (route) => api("GET", route, tokens[tag]),
    post: (route, body) => api("POST", route, tokens[tag], body ?? {}),
    put: (route, body) => api("PUT", route, tokens[tag], body),
  });
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
      for (const [tag, role] of [["admin", "admin"], ["owner", "gym_admin"], ["ownerB", "gym_admin"], ["staffer", "user"], ["member", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const gymIds = [state.gymA, state.gymB].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_staff_invites", "gym_staff"]) {
            await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          }
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((b) => b.brand_id)]);
        }
        const all = Object.values(identities).map((i) => i.id);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [all]);
        await db.deleteUsers(connection, all);
      } catch (error) { problems.push(`rows: ${error.code ?? error.message}`); }
    }
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

  const saved = async (tag, gym) => (await connection.query("SELECT home_tiles FROM gym_staff WHERE user_id = ? AND gym_id = ?", [identities[tag].id, gym]))[0][0]?.home_tiles ?? null;

  it("1. two branches of two gyms, a gym admin each and a Staff login", run(async () => {
    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    assert.equal(a.status, 201, JSON.stringify(a.json));
    state.gymA = a.json.gym.id;
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Just Fit", branch: "Indiranagar", area: "Indiranagar", city: "Bengaluru" });
    state.gymB = b.json.gym.id;
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.owner.phone })).status, 201);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/staff`, { phone: identities.ownerB.phone })).status, 201);
    assert.equal((await as("owner").post("/api/gym/staff", { phone: identities.staffer.phone, kind: "staff" })).status, 201);
  }));

  it("2. the dashboard starts with the usual order", run(async () => {
    const home = await as("owner").get("/api/gym/dashboard");
    assert.equal(home.status, 200);
    assert.equal(home.json.tileOrder, null);
  }));

  it("3. a gym admin saves an order and reads it back; the Staff login and the other gym keep theirs", run(async () => {
    const order = ["pt", "admission", "product", "renewal", "enquiry", "due-paid"];
    const put = await as("owner").put("/api/gym/home-tiles", { order });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    assert.deepEqual(put.json.order, order);
    assert.deepEqual((await as("owner").get("/api/gym/dashboard")).json.tileOrder, order);
    assert.equal((await as("staffer").get("/api/gym/dashboard")).json.tileOrder, null);
    assert.equal((await as("ownerB").get("/api/gym/dashboard")).json.tileOrder, null);
    assert.deepEqual(JSON.parse(JSON.stringify(await saved("owner", state.gymA))), order);
  }));

  it("4. a Staff login arranges its own, without any area", run(async () => {
    await connection.query("UPDATE gym_staff SET permissions = ? WHERE user_id = ? AND gym_id = ?", [JSON.stringify([]), identities.staffer.id, state.gymA]);
    const order = [...TILES].reverse();
    assert.equal((await as("staffer").put("/api/gym/home-tiles", { order })).status, 200);
    assert.deepEqual((await as("staffer").get("/api/gym/dashboard")).json.tileOrder, order);
    assert.notDeepEqual((await as("owner").get("/api/gym/dashboard")).json.tileOrder, order);
  }));

  it("5. refuses no session, a member, and bad orders, writing nothing", run(async () => {
    const before = JSON.stringify(await saved("owner", state.gymA));
    assert.equal((await api("PUT", "/api/gym/home-tiles", null, { order: TILES })).status, 401);
    assert.equal((await as("member").put("/api/gym/home-tiles", { order: TILES })).status, 403);
    for (const body of [
      {},
      { order: TILES.slice(1) },
      { order: [...TILES.slice(1), "pt"] },
      { order: [...TILES.slice(1), "wallet"] },
      { order: [...TILES.slice(1), "pt' OR '1'='1"] },
      { order: "admission,renewal" },
      { order: TILES, userId: identities.ownerB.id },
      { order: [...TILES, "admission"] },
    ]) {
      const answer = await as("owner").put("/api/gym/home-tiles", body);
      assert.equal(answer.status, 400, JSON.stringify(body));
      assert.ok(typeof answer.json?.error === "string");
    }
    assert.equal(JSON.stringify(await saved("owner", state.gymA)), before);
  }));

  it("6. arranging isn't recorded on Activity", run(async () => {
    const [[row]] = await connection.query("SELECT COUNT(*) AS n FROM gym_activity_log WHERE gym_id = ? AND detail LIKE '%tile%'", [state.gymA]);
    assert.equal(row.n, 0);
  }));
});
