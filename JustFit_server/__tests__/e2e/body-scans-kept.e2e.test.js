// Kept body scans and the Super Admin's member page (2026-11-10), end to end against justfit_test
// with a fake Forma and a throwaway BODY_SCAN_DIR. Covers: a scan keeps its photos and report; the
// member lists, opens, reads the photos of and deletes only their own (another member's is a 404,
// deleting removes both files); only admins reach every scan, its photos and a member's full
// profile (a member is refused), each look logged once; bad ids and an injection-shaped search
// are harmless.
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const jpeg = (marker) => {
  const bytes = Buffer.alloc(256);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  bytes.write(marker, 16);
  return bytes;
};
const FRONT = jpeg("front-photo");
const SIDE = jpeg("side-photo");
const valid = { front: FRONT.toString("base64"), side: SIDE.toString("base64"), heightCm: 170, weightKg: 70, age: 30, sex: "female" };
const formaResult = { body_fat: { pct: 27.5 }, derived: { fat: 19.3, lean: 50.7, bmi: 24.2 } };

function startFakeForma() {
  const fake = { server: null, url: null };
  fake.server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(formaResult));
    });
  });
  return new Promise((resolve) => fake.server.listen(0, "127.0.0.1", () => {
    fake.url = `http://127.0.0.1:${fake.server.address().port}`;
    resolve(fake);
  }));
}

describe("kept body scans and the admin's member page e2e", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-scans-"));
  let skipReason = null;
  let env, connection, server, testAccounts, fake;
  const identities = {};
  const tokens = {};
  let scanId = null;

  const call = async (token, method, url, body) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = response.headers.get("content-type") || "";
    const payload = type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, body: payload, headers: response.headers };
  };
  const newIdentity = async (tag, role = "user") => {
    const identity = await testAccounts.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    tokens[tag] = jwt;
  };
  const files = () => fs.readdirSync(scanDir).filter((f) => !f.endsWith(".part"));
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    fake = await startFakeForma();
    server = await startTestServer({ ...env, FORMA_SCAN_URL: fake.url, BODY_SCAN_DIR: scanDir });
    try {
      await newIdentity("member");
      await newIdentity("other");
      await newIdentity("admin", "admin");
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = 'Scan Member' WHERE id = ?", [identities.member.id]);
    await connection.query(
      `INSERT INTO profiles (user_id, dob, gender, goal, height_cm, weight_kg, activity, health_flags, diet, cuisines, allergies, meals_per_day, profile_complete)
       VALUES (?, '1996-04-02', 'female', 'fat_loss', 170, 70, 'lightly_active', '["medical_condition"]', 'vegetarian', '["South Indian"]', 'peanuts', '3', TRUE)`,
      [identities.member.id],
    );
    await connection.query("INSERT INTO weigh_ins (user_id, logged_on, weight_kg) VALUES (?, CURDATE(), 70)", [identities.member.id]);
  });

  after(async () => {
    const problems = [];
    if (testAccounts) for (const tag of Object.keys(identities)) {
      try {
        await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (fake?.server) await new Promise((resolve) => fake.server.close(resolve));
    if (connection) await connection.end();
    fs.rmSync(scanDir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. a scan keeps both photos and its report, and answers the scan's id", run(async () => {
    const r = await call(tokens.member, "POST", "/api/body-composition/scan", valid);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.scanId, /^[0-9a-f-]{36}$/);
    scanId = r.body.scanId;
    assert.equal(files().length, 2, "both photo files are on disk");
    const [[row]] = await connection.query("SELECT user_id, body_fat_percent, sex, age, front_key, side_key FROM body_scans WHERE id = ?", [scanId]);
    assert.equal(row.user_id, identities.member.id, "kept for the session's member, never one from the body");
    assert.equal(Number(row.body_fat_percent), 27.5);
    assert.ok(files().includes(row.front_key) && files().includes(row.side_key));
  }));

  it("2. the member lists and opens their own scan and reads its photos, never cached", run(async () => {
    const list = await call(tokens.member, "GET", "/api/body-composition/scans");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.scans.map((s) => s.id), [scanId]);
    assert.equal("front_key" in list.body.scans[0], false, "file names never leave the server");
    const one = await call(tokens.member, "GET", `/api/body-composition/scans/${scanId}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.scan.report.fatMassKg, 19.3);
    const front = await call(tokens.member, "GET", `/api/body-composition/scans/${scanId}/photo/front`);
    assert.equal(front.status, 200);
    assert.ok(Buffer.compare(front.body, FRONT) === 0, "the front photo comes back byte for byte");
    assert.equal(front.headers.get("cache-control"), "private, no-store");
    const side = await call(tokens.member, "GET", `/api/body-composition/scans/${scanId}/photo/side`);
    assert.ok(Buffer.compare(side.body, SIDE) === 0);
  }));

  it("3. another member gets a 404 for the scan, its photos and deleting it; no session is a 401", run(async () => {
    assert.deepEqual((await call(tokens.other, "GET", "/api/body-composition/scans")).body.scans, []);
    for (const [method, url] of [["GET", `/api/body-composition/scans/${scanId}`], ["GET", `/api/body-composition/scans/${scanId}/photo/front`], ["DELETE", `/api/body-composition/scans/${scanId}`]]) {
      assert.equal((await call(tokens.other, method, url)).status, 404, `${method} ${url}`);
      assert.equal((await call(null, method, url)).status, 401);
    }
    for (const bad of ["not-a-uuid", "../etc/passwd", `${scanId}' OR '1'='1`]) {
      assert.equal((await call(tokens.member, "GET", `/api/body-composition/scans/${encodeURIComponent(bad)}`)).status, 404);
    }
    assert.equal((await call(tokens.member, "GET", `/api/body-composition/scans/${scanId}/photo/back`)).status, 404);
    assert.equal(files().length, 2, "nothing was deleted");
  }));

  it("4. only an admin reaches every scan, its photos and a member's full profile", run(async () => {
    for (const url of ["/api/admin/portal/body-scans", `/api/admin/portal/body-scans/${scanId}`, `/api/admin/portal/body-scans/${scanId}/photo/front`, `/api/admin/portal/users/${identities.member.id}/profile`]) {
      assert.equal((await call(tokens.member, "GET", url)).status, 403, url);
    }
    const list = await call(tokens.admin, "GET", "/api/admin/portal/body-scans");
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.scans[0].member.name, "Scan Member");
    const found = await call(tokens.admin, "GET", `/api/admin/portal/body-scans?search=${encodeURIComponent("Scan Mem")}`);
    assert.equal(found.body.total, 1);
    for (const search of ["' OR 1=1 --", "%", "_"]) assert.equal((await call(tokens.admin, "GET", `/api/admin/portal/body-scans?search=${encodeURIComponent(search)}`)).body.total, 0, search);
    assert.equal((await call(tokens.admin, "GET", "/api/admin/portal/body-scans?page=0")).status, 400);
    assert.equal((await call(tokens.admin, "GET", "/api/admin/portal/body-scans?sort=name")).status, 400);

    const photo = await call(tokens.admin, "GET", `/api/admin/portal/body-scans/${scanId}/photo/side`);
    assert.ok(Buffer.compare(photo.body, SIDE) === 0);
    await call(tokens.admin, "GET", `/api/admin/portal/body-scans/${scanId}/photo/front`);
    const [[{ views }]] = await connection.query("SELECT COUNT(*) AS views FROM admin_audit_log WHERE admin_id = ? AND action = 'user.scan_view' AND target_id = ?", [identities.admin.id, identities.member.id]);
    assert.equal(Number(views), 1, "looking at a scan's photos is logged once an hour");
  }));

  it("5. the admin's member page carries every field, the scans and recent activity", run(async () => {
    const r = await call(tokens.admin, "GET", `/api/admin/portal/users/${identities.member.id}/profile`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = r.body.member;
    assert.equal(m.contact.phone, identities.member.phone);
    assert.equal(m.contact.email, identities.member.emailAddress);
    assert.equal(m.profile.dob, "1996-04-02");
    assert.equal(m.profile.gender, "female");
    assert.deepEqual(m.profile.healthFlags, ["medical_condition"]);
    assert.equal(m.profile.diet, "vegetarian");
    assert.deepEqual(m.profile.cuisines, ["South Indian"]);
    assert.equal(m.profile.allergies, "peanuts");
    assert.equal(m.profile.mealsPerDay, "3");
    assert.equal(m.coach, null);
    assert.deepEqual(m.scans.map((s) => s.id), [scanId]);
    const kinds = new Set(m.activity.map((a) => a.kind));
    for (const kind of ["sign_in", "weigh_in", "body_scan"]) assert.ok(kinds.has(kind), `activity has ${kind}`);
    await call(tokens.admin, "GET", `/api/admin/portal/users/${identities.member.id}/profile`);
    const [[{ views }]] = await connection.query("SELECT COUNT(*) AS views FROM admin_audit_log WHERE admin_id = ? AND action = 'user.profile_view'", [identities.admin.id]);
    assert.equal(Number(views), 1, "opening a member's full profile is logged once an hour");
    assert.equal((await call(tokens.admin, "GET", "/api/admin/portal/users/nobody_here/profile")).status, 404);
  }));

  it("6. the member deletes their scan: the row and both files go", run(async () => {
    const r = await call(tokens.member, "DELETE", `/api/body-composition/scans/${scanId}`);
    assert.equal(r.status, 200);
    assert.equal(files().length, 0, "both photo files are deleted");
    const [[{ remaining }]] = await connection.query("SELECT COUNT(*) AS remaining FROM body_scans WHERE id = ?", [scanId]);
    assert.equal(Number(remaining), 0);
    assert.equal((await call(tokens.admin, "GET", `/api/admin/portal/body-scans/${scanId}`)).status, 404, "gone for the admin too");
  }));
});
