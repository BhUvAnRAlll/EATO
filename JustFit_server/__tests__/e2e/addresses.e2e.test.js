// Delivery addresses end to end: test accounts in justfit_test against the real Express server.
// A member saves, edits, selects and deletes addresses; the selected one is kept on the server;
// the pincode list decides what is deliverable. Attack paths: no session, another member's ids,
// bad and extra fields (a userId in the body), SQL in the text and the path, an oversized body,
// and the 20-address limit.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const addresses = require("../../addresses/service");

describe("delivery addresses e2e: each member's own, one selected, pincode-checked", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  // Pincodes made up for this run, so nothing real is touched
  const DELIVERS = "599101";
  const ELSEWHERE = "599102";

  const api = async (method, route, token, payload, raw) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined || raw !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: raw ?? (payload === undefined ? undefined : JSON.stringify(payload)) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const address = (over = {}) => ({
    kind: "home", receiverName: "Ravi Kumar", receiverPhone: "9876543210", house: "Flat 4B, Sai Residency", street: "MG Road, Batawadi",
    landmark: "Opposite SIT", city: "Tumakuru", pincode: DELIVERS, formattedAddress: "Sai Residency, MG Road, Batawadi, Tumakuru",
    latitude: 13.3392, longitude: 77.1017, instructions: "Ring the bell", ...over,
  });

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const tag of ["memberA", "memberB"]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role: "user" });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("INSERT INTO delivery_pincodes (pincode, area) VALUES (?, 'Test area')", [DELIVERS]);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const all = Object.values(identities).map((i) => i.id);
        if (all.length) await connection.query("DELETE FROM user_addresses WHERE user_id IN (?)", [all]);
        await connection.query("DELETE FROM delivery_pincodes WHERE pincode IN (?)", [[DELIVERS, ELSEWHERE]]);
        if (all.length) await db.deleteUsers(connection, all);
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

  it("1. signed in only; an empty book; the pincode check follows the list", run(async () => {
    for (const [method, route] of [["GET", "/api/addresses"], ["POST", "/api/addresses"], ["GET", `/api/addresses/serviceable?pincode=${DELIVERS}`], ["DELETE", "/api/addresses/1"]]) {
      assert.equal((await api(method, route, null)).status, 401, `${method} ${route}`);
      assert.equal((await api(method, route, "jfs_not-a-real-token")).status, 401);
    }
    const empty = await api("GET", "/api/addresses", tokens.memberA);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json, { addresses: [], selectedId: null, max: 20 });
    assert.deepEqual((await api("GET", `/api/addresses/serviceable?pincode=${DELIVERS}`, tokens.memberA)).json, { pincode: DELIVERS, deliverable: true, area: "Test area" });
    assert.equal((await api("GET", `/api/addresses/serviceable?pincode=${ELSEWHERE}`, tokens.memberA)).json.deliverable, false);
    assert.equal((await api("GET", "/api/addresses/serviceable?pincode=12345", tokens.memberA)).status, 400);
    assert.equal((await api("GET", "/api/addresses/serviceable?pincode=599101'%20OR%201=1--", tokens.memberA)).status, 400);
  }));

  it("2. the first address is selected; a later one only when asked; deliverable follows the pincode", run(async () => {
    const first = await api("POST", "/api/addresses", tokens.memberA, address());
    assert.equal(first.status, 201, JSON.stringify(first.json));
    state.home = first.json.savedId;
    assert.equal(first.json.selectedId, state.home);
    const home = first.json.addresses[0];
    assert.equal(home.isDefault, true);
    assert.equal(home.deliverable, true);
    assert.equal(home.deliveryArea, "Test area");
    assert.equal(home.receiverPhone, "9876543210");
    assert.equal(home.latitude, 13.3392);

    const work = await api("POST", "/api/addresses", tokens.memberA, address({ kind: "work", pincode: ELSEWHERE, landmark: "", instructions: "" }));
    assert.equal(work.status, 201);
    state.work = work.json.savedId;
    assert.equal(work.json.selectedId, state.home, "a second address doesn't take over by itself");
    const saved = work.json.addresses.find((a) => a.id === state.work);
    assert.equal(saved.deliverable, false);
    assert.equal(saved.landmark, null);

    const other = await api("POST", "/api/addresses", tokens.memberA, address({ kind: "other", makeDefault: true }));
    state.other = other.json.savedId;
    assert.equal(other.json.selectedId, state.other);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM user_addresses WHERE user_id = ? AND is_default = 1", [identities.memberA.id]);
    assert.equal(n, 1, "one selected address");
    // Persisted: a fresh read (as after a restart) still has it
    assert.equal((await api("GET", "/api/addresses", tokens.memberA)).json.selectedId, state.other);
  }));

  it("3. bad input is refused; SQL stays text; identity comes from the session only", run(async () => {
    for (const bad of [address({ kind: "office" }), address({ receiverPhone: "12345" }), address({ pincode: "000000" }), address({ latitude: 51.5, longitude: -0.12 }), { ...address(), userId: identities.memberB.id }]) {
      assert.equal((await api("POST", "/api/addresses", tokens.memberA, bad)).status, 400, JSON.stringify(bad).slice(0, 80));
    }
    assert.equal((await api("POST", "/api/addresses", tokens.memberA, undefined, "{not json")).status, 400);
    assert.equal((await api("POST", "/api/addresses", tokens.memberA, undefined, JSON.stringify(address({ instructions: "x".repeat(6000) })))).status, 413);
    const sql = "1'; DROP TABLE user_addresses;--";
    const edited = await api("PUT", `/api/addresses/${state.work}`, tokens.memberA, address({ kind: "work", house: sql, pincode: ELSEWHERE }));
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
    assert.equal(edited.json.addresses.find((a) => a.id === state.work).house, sql);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM user_addresses WHERE user_id = ?", [identities.memberA.id]);
    assert.equal(n, 3, "the table is still there");
    for (const route of ["/api/addresses/1%20OR%201=1", "/api/addresses/0", "/api/addresses/abc"]) assert.equal((await api("DELETE", route, tokens.memberA)).status, 400);
  }));

  it("4. another member's address reads as missing, and their book stays empty", run(async () => {
    for (const [method, route, payload] of [["PUT", `/api/addresses/${state.home}`, address()], ["DELETE", `/api/addresses/${state.home}`], ["POST", `/api/addresses/${state.home}/default`]]) {
      const answer = await api(method, route, tokens.memberB, payload);
      assert.equal(answer.status, 404, `${method} ${route}`);
    }
    assert.deepEqual((await api("GET", "/api/addresses", tokens.memberB)).json.addresses, []);
    const [[row]] = await connection.query("SELECT house FROM user_addresses WHERE id = ?", [state.home]);
    assert.equal(row.house, "Flat 4B, Sai Residency", "untouched");
  }));

  it("5. select another; deleting the selected one selects the most recently added one left", run(async () => {
    const picked = await api("POST", `/api/addresses/${state.home}/default`, tokens.memberA);
    assert.equal(picked.status, 200);
    assert.equal(picked.json.selectedId, state.home);
    const gone = await api("DELETE", `/api/addresses/${state.home}`, tokens.memberA);
    assert.equal(gone.status, 200);
    assert.ok(!gone.json.addresses.some((a) => a.id === state.home));
    assert.equal(gone.json.selectedId, state.other, "the Other address was added last");
    assert.equal((await api("DELETE", `/api/addresses/${state.home}`, tokens.memberA)).status, 404, "already gone");
  }));

  it("6. checkout's check refuses an address justFit doesn't deliver to, and another member's", run(async () => {
    const pool = { query: (...args) => connection.query(...args) };
    await assert.rejects(addresses.deliverableAddress(pool, identities.memberA.id, state.work), /don't deliver to 599102/);
    assert.equal((await addresses.deliverableAddress(pool, identities.memberA.id, state.other)).pincode, DELIVERS);
    await assert.rejects(addresses.deliverableAddress(pool, identities.memberB.id, state.other), /isn't saved on your account/);
  }));

  it("7. at most 20 addresses a member", run(async () => {
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM user_addresses WHERE user_id = ?", [identities.memberA.id]);
    for (let i = Number(n); i < 20; i += 1) assert.equal((await api("POST", "/api/addresses", tokens.memberA, address({ house: `House ${i}` }))).status, 201);
    const over = await api("POST", "/api/addresses", tokens.memberA, address({ house: "One too many" }));
    assert.equal(over.status, 409);
    assert.match(over.json.error, /keep 20 addresses/);
  }));
});
