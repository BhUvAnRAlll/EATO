// Kitchens and the meal-operations dashboard end to end (Meal Operations phase 1, 2026-11-10):
// test accounts in justfit_test against the real Express server. The Super Admin adds a kitchen
// with a photo, edits it, changes its status with a reason, keeps its staff roster, and reads the
// day's dashboard and its Excel report. Attack paths: no session, a member on every route, bad
// and unexpected fields, SQL in ids and searches, a fake photo, a duplicate name or staff number,
// another kitchen's staff id.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const { png } = require("./images.js");

describe("kitchens e2e: the Super Admin's kitchens, roster and meal-operations dashboard", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, photoDir;
  const identities = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("json")) return { status: response.status, type, bytes: Buffer.from(await response.arrayBuffer()), disposition: response.headers.get("content-disposition") };
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const week = (sessions) => Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, sessions]));
  const kitchen = (over = {}) => ({
    name: `Koramangala Kitchen ${runId}`, contactName: "Suresh Rao", phone: "9876543210", email: null, address: "12, 5th Block, 80 Feet Road",
    area: "Koramangala", city: "Bengaluru", pincode: "560095", latitude: 12.9352, longitude: 77.6245, hours: week([["06:00", "22:00"]]),
    pincodes: ["560095", "560034"], maxDailyOrders: 400, prepCapacity: 120, radiusKm: 6, ...over,
  });
  const base = "/api/admin/kitchen";

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-kitchen-photos-"));
    server = await startTestServer({ ...env, MEAL_PHOTO_DIR: photoDir });
    try {
      for (const [tag, role] of [["admin", "admin"], ["member", "user"]]) {
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
        await connection.query("DELETE FROM kitchens WHERE name LIKE ?", [`%${runId}%`]);
        const all = Object.values(identities).map((i) => i.id);
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
    if (photoDir) fs.rmSync(photoDir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. signed in admins only", run(async () => {
    for (const [method, route, body] of [
      ["GET", `${base}/dashboard`], ["GET", `${base}/report`], ["GET", `${base}/kitchens`], ["POST", `${base}/kitchens`, kitchen()],
      ["GET", `${base}/kitchens/1`], ["PUT", `${base}/kitchens/1`, kitchen()], ["POST", `${base}/kitchens/1/status`, { status: "active" }],
      ["POST", `${base}/kitchens/1/staff`, { name: "Anita", phone: "9123456780", role: "chef", available: true }], ["DELETE", `${base}/kitchens/1/staff/1`],
    ]) {
      assert.equal((await api(method, route, null, body)).status, 401, `${method} ${route}`);
      assert.equal((await api(method, route, tokens.member, body)).status, 403, `member ${method} ${route}`);
    }
  }));

  it("2. adds a kitchen with a photo; bad kitchens and fake photos are refused", run(async () => {
    const fake = await api("POST", `${base}/kitchens`, tokens.admin, { ...kitchen(), photo: { data: Buffer.from("not an image").toString("base64"), mediaType: "image/png" } });
    assert.equal(fake.status, 415);
    for (const bad of [kitchen({ phone: "123" }), kitchen({ pincodes: [] }), kitchen({ radiusKm: 99 }), kitchen({ status: "inactive" }), kitchen({ name: "x' OR '1'='1" , pincode: "1" }), kitchen({ hours: week([["23:00", "01:00"]]) })]) {
      assert.equal((await api("POST", `${base}/kitchens`, tokens.admin, bad)).status, 400, JSON.stringify(bad).slice(0, 80));
    }
    const added = await api("POST", `${base}/kitchens`, tokens.admin, { ...kitchen(), photo: { data: png(800, 450).toString("base64"), mediaType: "image/png" } });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const k = added.json.kitchen;
    state.id = k.id;
    assert.match(k.code, /^KIT-\d{4}$/);
    assert.equal(k.status, "active");
    assert.deepEqual(k.pincodes, ["560034", "560095"]);
    assert.match(k.photoUrl, new RegExp(`^/api/admin/kitchen/kitchens/${k.id}/photo\\?v=`));
    assert.equal(fs.readdirSync(photoDir).length, 1, "a refused kitchen left no file");
    const pic = await api("GET", k.photoUrl, tokens.admin);
    assert.equal(pic.status, 200);
    assert.equal(pic.type, "image/png");
    assert.equal((await api("GET", k.photoUrl, tokens.member)).status, 403, "members never read kitchen photos");
    assert.equal((await api("POST", `${base}/kitchens`, tokens.admin, kitchen())).status, 409, "the name is taken");
    const [[audit]] = await connection.query("SELECT action, target_type FROM admin_audit_log WHERE target_id = ? ORDER BY created_at DESC LIMIT 1", [String(k.id)]);
    assert.deepEqual({ ...audit }, { action: "kitchen.create", target_type: "kitchen" });
  }));

  it("3. lists, searches and edits; the old photo goes when removed", run(async () => {
    const second = await api("POST", `${base}/kitchens`, tokens.admin, kitchen({ name: `Indiranagar Kitchen ${runId}`, area: "Indiranagar", pincodes: ["560038"] }));
    assert.equal(second.status, 201);
    state.otherId = second.json.kitchen.id;
    const all = await api("GET", `${base}/kitchens`, tokens.admin);
    assert.equal(all.json.counts.active, 2);
    const found = await api("GET", `${base}/kitchens?search=560038`, tokens.admin);
    assert.deepEqual(found.json.kitchens.map((x) => x.id), [state.otherId], "a pincode it serves finds it");
    assert.equal((await api("GET", `${base}/kitchens?search=${encodeURIComponent("%' OR '1'='1")}`, tokens.admin)).json.kitchens.length, 0);
    assert.equal((await api("GET", `${base}/kitchens?status=closed`, tokens.admin)).status, 400);
    assert.equal((await api("GET", `${base}/kitchens?sort=name`, tokens.admin)).status, 400);
    for (const bad of ["0", "abc", "1%20OR%201=1"]) assert.equal((await api("GET", `${base}/kitchens/${bad}`, tokens.admin)).status, 400);
    assert.equal((await api("GET", `${base}/kitchens/999999`, tokens.admin)).status, 404);

    const edited = await api("PUT", `${base}/kitchens/${state.id}`, tokens.admin, { ...kitchen({ maxDailyOrders: 500, pincodes: ["560095"] }), removePhoto: true });
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
    assert.equal(edited.json.kitchen.maxDailyOrders, 500);
    assert.deepEqual(edited.json.kitchen.pincodes, ["560095"]);
    assert.equal(edited.json.kitchen.photoUrl, null);
    assert.equal(fs.readdirSync(photoDir).length, 0, "the removed photo's file is gone");
    assert.equal((await api("PUT", `${base}/kitchens/${state.id}`, tokens.admin, kitchen({ name: `Indiranagar Kitchen ${runId}` }))).status, 409);
  }));

  it("4. status changes need a reason (except active) and are audited", run(async () => {
    const id = state.id;
    assert.equal((await api("POST", `${base}/kitchens/${id}/status`, tokens.admin, { status: "maintenance" })).status, 400);
    assert.equal((await api("POST", `${base}/kitchens/${id}/status`, tokens.admin, { status: "gone", note: "nope nope" })).status, 400);
    const closed = await api("POST", `${base}/kitchens/${id}/status`, tokens.admin, { status: "temporarily_closed", note: "Festival holiday" });
    assert.equal(closed.json.kitchen.status, "temporarily_closed");
    assert.equal(closed.json.kitchen.statusNote, "Festival holiday");
    assert.equal(closed.json.kitchen.openNow, false);
    const back = await api("POST", `${base}/kitchens/${id}/status`, tokens.admin, { status: "active" });
    assert.equal(back.json.kitchen.statusNote, null);
    const [actions] = await connection.query("SELECT action FROM admin_audit_log WHERE target_type = 'kitchen' AND target_id = ? ORDER BY created_at", [String(id)]);
    assert.deepEqual(actions.map((a) => a.action).slice(-2), ["kitchen.temporarily_closed", "kitchen.active"]);
  }));

  it("5. the staff roster: add, edit, remove, scoped to the kitchen", run(async () => {
    const id = state.id;
    const added = await api("POST", `${base}/kitchens/${id}/staff`, tokens.admin, { name: "Anita Sharma", phone: "+91 91234 56780", role: "manager", available: true });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const person = added.json.kitchen.staff[0];
    assert.deepEqual({ name: person.name, phone: person.phone, role: person.role }, { name: "Anita Sharma", phone: "9123456780", role: "manager" });
    assert.equal((await api("POST", `${base}/kitchens/${id}/staff`, tokens.admin, { name: "Again", phone: "9123456780", role: "chef", available: true })).status, 409);
    assert.equal((await api("POST", `${base}/kitchens/${id}/staff`, tokens.admin, { name: "Ravi", phone: "9123456781", role: "owner", available: true })).status, 400);
    assert.equal((await api("POST", `${base}/kitchens/999999/staff`, tokens.admin, { name: "Ravi", phone: "9123456781", role: "chef", available: true })).status, 404);
    const edited = await api("PUT", `${base}/kitchens/${id}/staff/${person.id}`, tokens.admin, { name: "Anita Sharma", phone: "9123456780", role: "chef", available: false, note: "Evening shift" });
    assert.equal(edited.json.kitchen.staff[0].available, false);
    assert.equal((await api("PUT", `${base}/kitchens/${state.otherId}/staff/${person.id}`, tokens.admin, { name: "X Y", phone: "9123456780", role: "chef", available: true })).status, 404, "another kitchen's staff id");
    assert.equal((await api("DELETE", `${base}/kitchens/${state.otherId}/staff/${person.id}`, tokens.admin)).status, 404);
    const removed = await api("DELETE", `${base}/kitchens/${id}/staff/${person.id}`, tokens.admin);
    assert.equal(removed.json.kitchen.staff.length, 0);
  }));

  it("6. the dashboard and its Excel report", run(async () => {
    const today = await api("GET", `${base}/dashboard`, tokens.admin);
    assert.equal(today.status, 200, JSON.stringify(today.json));
    assert.equal(today.json.kitchens.counts.active, 2);
    assert.equal(today.json.kitchens.activeCapacity, 900);
    assert.equal(today.json.orders.subscription, null);
    assert.equal(typeof today.json.revenue.amount, "number");
    for (const bad of ["2026-02-30", "yesterday", "1999-01-01"]) assert.equal((await api("GET", `${base}/dashboard?day=${bad}`, tokens.admin)).status, 400);
    assert.equal((await api("GET", `${base}/dashboard?kitchen=1`, tokens.admin)).status, 400);
    const report = await api("GET", `${base}/report?day=${today.json.day}`, tokens.admin);
    assert.equal(report.status, 200);
    assert.match(report.type, /spreadsheetml/);
    assert.equal(report.bytes.subarray(0, 2).toString(), "PK", "an xlsx is a zip");
    assert.match(report.disposition, /meal-orders-\d{4}-\d{2}-\d{2}\.xlsx/);
    const csv = await api("GET", `${base}/report?day=${today.json.day}&format=csv`, tokens.admin);
    assert.match(csv.bytes.toString("utf8"), /Order,Delivery day,Meal time/);
    assert.equal((await api("GET", `${base}/report?format=pdf`, tokens.admin)).status, 400);
  }));
});
