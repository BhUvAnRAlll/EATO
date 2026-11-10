// Super Admin › Meals › Delivery areas (addresses/areas.js, 2026-11-10) end to end against
// justfit_test: only an admin reaches the routes; a pincode is added once, renamed, switched off
// (a member's address there then reads as not delivered to) and removed; bad input, unknown
// fields and injection-shaped values are refused; every change is in the admin log.
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("delivery areas e2e: /api/admin/kitchen/delivery-areas", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};

  const call = async (token, method, url, body) => {
    const response = await fetch(`${server.baseUrl}/api/admin/kitchen${url}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, body: json };
  };
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
      for (const [tag, role] of [["admin", "admin"], ["member", "user"]]) {
        const identity = await testAccounts.createIdentity(runId, tag, { role });
        const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        tokens[tag] = jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
  });

  after(async () => {
    if (connection) await connection.query("DELETE FROM delivery_pincodes WHERE pincode IN ('560001', '560002')").catch(() => {});
    for (const tag of Object.keys(identities)) {
      await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
      await testAccounts.deleteUser(identities[tag].id).catch(() => {});
    }
    if (server) await server.stop();
    if (connection) await connection.end();
  });

  it("1. only an admin reaches the routes", run(async () => {
    assert.equal((await call(null, "GET", "/delivery-areas")).status, 401);
    assert.equal((await call(tokens.member, "GET", "/delivery-areas")).status, 403);
    assert.equal((await call(tokens.member, "POST", "/delivery-areas", { pincode: "560001" })).status, 403);
    assert.equal((await call(tokens.admin, "GET", "/delivery-areas")).status, 200);
  }));

  it("2. adds a pincode once, with its area name; bad and unexpected input is refused", run(async () => {
    const r = await call(tokens.admin, "POST", "/delivery-areas", { pincode: "560001", area: "  MG   Road " });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const added = r.body.areas.find((a) => a.pincode === "560001");
    assert.deepEqual({ area: added.area, active: added.active, kitchens: added.kitchens, addresses: added.addresses }, { area: "MG Road", active: true, kitchens: [], addresses: 0 });
    assert.equal((await call(tokens.admin, "POST", "/delivery-areas", { pincode: "560001" })).status, 409, "only once");
    for (const bad of [{ pincode: "56001" }, { pincode: "060001" }, { pincode: "56000a" }, { pincode: "560002' OR '1'='1" }, { pincode: "560002", area: "x".repeat(81) }, { pincode: "560002", active: true }, []]) {
      assert.equal((await call(tokens.admin, "POST", "/delivery-areas", bad)).status, 400, JSON.stringify(bad));
    }
    const [[count]] = await connection.query("SELECT COUNT(*) AS n FROM delivery_pincodes WHERE pincode = '560002'");
    assert.equal(Number(count.n), 0);
  }));

  it("3. renames, switches off and on; a member's address there follows", run(async () => {
    await connection.query(
      "INSERT INTO user_addresses (user_id, receiver_name, receiver_phone, house, street, city, pincode, formatted_address, latitude, longitude, kind, is_default) VALUES (?, 'Asha', '9876543210', '12', 'MG Road', 'Bengaluru', '560001', 'MG Road, Bengaluru', 12.975, 77.606, 'home', 1)",
      [identities.member.id],
    );
    const renamed = await call(tokens.admin, "PUT", "/delivery-areas/560001", { area: "MG Road East" });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.areas.find((a) => a.pincode === "560001").addresses, 1);
    const off = await call(tokens.admin, "PUT", "/delivery-areas/560001", { active: false });
    assert.equal(off.body.areas.find((a) => a.pincode === "560001").active, false);
    const book = await fetch(`${server.baseUrl}/api/addresses`, { headers: { Authorization: `Bearer ${tokens.member}` } }).then((x) => x.json());
    assert.equal(book.addresses[0].deliverable, false, "off: the member's address isn't delivered to");
    await call(tokens.admin, "PUT", "/delivery-areas/560001", { active: true });
    const again = await fetch(`${server.baseUrl}/api/addresses`, { headers: { Authorization: `Bearer ${tokens.member}` } }).then((x) => x.json());
    assert.equal(again.addresses[0].deliverable, true);
    assert.equal((await call(tokens.admin, "PUT", "/delivery-areas/560001", {})).status, 400, "nothing to change");
    assert.equal((await call(tokens.admin, "PUT", "/delivery-areas/560001", { active: "yes" })).status, 400);
    assert.equal((await call(tokens.admin, "PUT", "/delivery-areas/999999", { active: false })).status, 404);
    assert.equal((await call(tokens.admin, "PUT", "/delivery-areas/abc", { active: false })).status, 404);
  }));

  it("4. removes it; every change is in the admin log", run(async () => {
    assert.equal((await call(tokens.admin, "DELETE", "/delivery-areas/560001")).status, 200);
    assert.equal((await call(tokens.admin, "DELETE", "/delivery-areas/560001")).status, 404);
    const [log] = await connection.query("SELECT action FROM admin_audit_log WHERE admin_id = ? ORDER BY created_at", [identities.admin.id]);
    assert.deepEqual(log.map((l) => l.action), ["meal.delivery_area_add", "meal.delivery_area_edit", "meal.delivery_area_edit", "meal.delivery_area_edit", "meal.delivery_area_remove"]);
  }));
});
