// Gym roles end to end (Gym Hub ecosystem, 2026-11-10): test accounts in justfit_test against the
// real Express server. The gym admin adds Staff as Receptionist or Attendance Staff; they get exactly
// that role's options, the team reads them back as that role, an invite keeps its role, a changed
// login reads as Custom, and the server enforces the role. Attack paths: an unknown role, a role for
// a trainer, Staff adding staff.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("gym roles e2e: Staff added as a role get exactly its options", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const run = (fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { error.message += `\nserver log: ${(server?.logs ?? []).slice(-4).join(" | ")}`; throw error; }
  };
  const presets = require("../../gym/rolePresets.js");

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["staffA", "user"], ["member", "user"], ["desk", "user"], ["door", "user"]]) {
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
          for (const table of ["gym_activity_log", "gym_membership_pauses", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
        if (identities[tag].sessionId) await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${error.message}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. a gym and its admin", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Zen", "Hebbal"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
  }));

  it("2. bad roles are refused", run(async () => {
    for (const body of [
      { phone: identities.desk.phone, kind: "staff", preset: "owner" },
      { phone: identities.desk.phone, kind: "staff", preset: "superadmin" },
      { phone: identities.desk.phone, kind: "trainer", preset: "receptionist" },
    ]) assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, body)).status, 400, JSON.stringify(body));
  }));

  it("3. a Receptionist gets exactly its options and reads back as one", run(async () => {
    const added = await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.desk.phone, kind: "staff", preset: "receptionist" });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const desk = added.json.team.find((m) => m.id === identities.desk.id);
    assert.equal(desk.role, "receptionist");
    assert.deepEqual([...desk.options].sort(), [...presets.presetOptions("receptionist")].sort());
    assert.ok(added.json.roles.some((r) => r.id === "manager"));
    // The server holds them to it: the desk can collect dues but not see the Wallet or add staff
    const deskToken = (await testAccounts.mintToken(identities.desk.id)).jwt;
    assert.equal((await api("GET", "/api/gym/members", deskToken)).status, 200);
    assert.equal((await api("GET", "/api/gym/wallet", deskToken)).status, 403);
    assert.equal((await api("POST", "/api/gym/staff", deskToken, { phone: identities.door.phone, kind: "staff", preset: "attendance" })).status, 403);
  }));

  it("4. changed by hand it reads as Custom; an Attendance Staff role is enforced", run(async () => {
    assert.equal((await api("PUT", `/api/gym/staff/${identities.desk.id}/permissions`, tokens.gymA, { options: [...presets.presetOptions("receptionist"), "payments.wallet"] })).status, 200);
    const team = await api("GET", "/api/gym/staff", tokens.gymA);
    assert.equal(team.json.team.find((m) => m.id === identities.desk.id).role, "custom");

    const door = await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.door.phone, kind: "staff", preset: "attendance" });
    assert.equal(door.status, 201, JSON.stringify(door.json));
    const doorToken = (await testAccounts.mintToken(identities.door.id)).jwt;
    assert.equal((await api("GET", "/api/gym/attendance", doorToken)).status, 200);
    assert.equal((await api("GET", "/api/gym/enquiries", doorToken)).status, 403);
    assert.equal((await api("GET", "/api/gym/payments", doorToken)).status, 403);
  }));

  it("5. an invite keeps its role", run(async () => {
    const phone = `+9198${String(Date.now()).slice(-8)}`;
    const invited = await api("POST", "/api/gym/staff", tokens.gymA, { phone, kind: "staff", preset: "manager" });
    assert.equal(invited.status, 202, JSON.stringify(invited.json));
    const invite = invited.json.invites.at(-1);
    assert.equal(invite.role, "manager");
    const [[row]] = await connection.query("SELECT permissions FROM gym_staff_invites WHERE id = ?", [invite.id]);
    const stored = typeof row.permissions === "string" ? JSON.parse(row.permissions) : row.permissions;
    assert.deepEqual([...stored].sort(), [...presets.presetOptions("manager")].sort());
  }));
});
