// WhatsApp agent, phase B: every gym gets exactly one connection row (disconnected) and one
// agent row (disabled) when it's created, repeating provisioning changes nothing, two gyms stay
// separate, gym-owned rows can't be removed by deleting a member, and a member's own plan and
// link-code rows go with them. Real Clerk test identities, the real server, `eato_test` only.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");
const { provisionAgent } = require("../../whatsapp/provision.js");

const CLEANUP_TABLES = ["whatsapp_link_codes", "gym_member_plans", "whatsapp_agent_settings", "whatsapp_connections", "gym_members", "gyms"];

describe("whatsapp e2e: agent provisioning per gym", () => {
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
  const newIdentity = async (tag, role) => {
    const identity = await clerk.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const rowsFor = async (gymId) => {
    const [[c]] = await connection.query("SELECT COUNT(*) AS n, MAX(status) AS status, MAX(phone_number_id) AS phone FROM whatsapp_connections WHERE gym_id = ?", [gymId]);
    const [[a]] = await connection.query("SELECT COUNT(*) AS n, MAX(agent_status) AS status FROM whatsapp_agent_settings WHERE gym_id = ?", [gymId]);
    return { connections: c.n, connection: c.status, phone: c.phone, agents: a.n, agent: a.status };
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      await newIdentity("platform", "admin");
      for (const tag of ["ownerA", "ownerB", "member"]) await newIdentity(tag);
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?)", [ids[tag], identities[tag].emailAddress, `Member ${tag}`, tag === "platform" ? "admin" : "user"]);
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
      try { await clerk.revokeSession(identities[tag].sessionId).catch(() => {}); await clerk.deleteUser(identities[tag].id); } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeClerkError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. two gyms registered through the existing admin flow each get one disconnected connection and one disabled agent", async () => {
    for (const [key, name, owner] of [["gymA", "Gym Alpha", "ownerA"], ["gymB", "Gym Beta", "ownerB"]]) {
      const created = await api("POST", "/api/gyms", tokens.platform, { name, location: "Indiranagar", ownerEmail: identities[owner].emailAddress });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      state[key] = created.json.gym.id;
      assert.deepEqual(await rowsFor(state[key]), { connections: 1, connection: "disconnected", phone: null, agents: 1, agent: "disabled" });
    }
    assert.notEqual(state.gymA, state.gymB);
  });

  test("2. provisioning again (a retry or the migration back-fill) never adds a second row or resets settings", async () => {
    await connection.query("UPDATE whatsapp_agent_settings SET agent_status = 'testing' WHERE gym_id = ?", [state.gymA]);
    await provisionAgent(connection, state.gymA);
    await provisionAgent(connection, state.gymA);
    await connection.query("INSERT IGNORE INTO whatsapp_connections (gym_id) SELECT id FROM gyms");
    await connection.query("INSERT IGNORE INTO whatsapp_agent_settings (gym_id) SELECT id FROM gyms");
    assert.deepEqual(await rowsFor(state.gymA), { connections: 1, connection: "disconnected", phone: null, agents: 1, agent: "testing" }, "kept, not reset");
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM whatsapp_connections");
    assert.equal(n, 2, "one per gym, two gyms");
  });

  test("3. a WhatsApp number can belong to one gym only", async () => {
    await connection.query("UPDATE whatsapp_connections SET phone_number_id = '1100000001' WHERE gym_id = ?", [state.gymA]);
    await assert.rejects(
      connection.query("UPDATE whatsapp_connections SET phone_number_id = '1100000001' WHERE gym_id = ?", [state.gymB]),
      (error) => error.code === "ER_DUP_ENTRY",
    );
    assert.equal((await rowsFor(state.gymB)).phone, null);
  });

  test("4. a member's plan and link codes go with the member; the gym's rows stay; a plan's dates must make sense", async () => {
    await connection.query("INSERT INTO gym_member_plans (gym_id, user_id, plan_name, starts_on, ends_on) VALUES (?, ?, 'Quarterly', '2026-10-01', '2026-12-31')", [state.gymA, ids.member]);
    await connection.query("INSERT INTO whatsapp_link_codes (gym_id, user_id, code_hash, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL 10 MINUTE)", [state.gymA, ids.member, "a".repeat(64)]);
    await assert.rejects(
      connection.query("INSERT INTO gym_member_plans (gym_id, user_id, plan_name, starts_on, ends_on) VALUES (?, ?, 'Backwards', '2026-12-31', '2026-01-01')", [state.gymA, ids.member]),
      (error) => /chk_member_plans_dates/.test(error.message),
    );
    await db.deleteUsers(connection, [ids.member]);
    const [[plans]] = await connection.query("SELECT COUNT(*) AS n FROM gym_member_plans WHERE user_id = ?", [ids.member]);
    const [[codes]] = await connection.query("SELECT COUNT(*) AS n FROM whatsapp_link_codes WHERE user_id = ?", [ids.member]);
    assert.deepEqual([plans.n, codes.n], [0, 0]);
    assert.equal((await rowsFor(state.gymA)).connections, 1, "the gym's connection is untouched");
    delete ids.member; // already removed
  });

  test("5. a gym with WhatsApp rows can't be hard-deleted by accident", async () => {
    await assert.rejects(connection.query("DELETE FROM gyms WHERE id = ?", [state.gymB]), (error) => error.code === "ER_ROW_IS_REFERENCED_2");
  });
});
