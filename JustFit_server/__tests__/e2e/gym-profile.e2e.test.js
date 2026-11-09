// A branch's public profile end to end (Gym Hub phase 2, 2026-11-09): test accounts in
// justfit_test against the real Express server. The gym admin writes the description, facilities
// and opening hours, adds and removes gallery photos and gives plans their details; Staff read it
// only. Attack paths: no session, a member or a trainer, Staff writing, another gym's branch and
// photo ids, bad and unexpected fields, SQL in the input, files that aren't photos, the photo limit.
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
const { png, body } = require("./images.js");

describe("gym public profile e2e: the gym admin writes it, Staff read it, and it stays at its branch", () => {
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
    if (type.startsWith("image/")) return { status: response.status, type, bytes: Buffer.from(await response.arrayBuffer()) };
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const photoFiles = () => fs.readdirSync(photoDir).filter((f) => !f.startsWith("."));
  const closed = () => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });
  const run = (fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { error.message += `\nserver log: ${(server?.logs ?? []).slice(-4).join(" | ")}`; throw error; }
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-gym-photos-e2e-"));
    server = await startTestServer({ ...env, GYM_PHOTO_DIR: photoDir });
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["staffA", "user"], ["trainerA", "user"], ["member", "user"]]) {
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
          for (const table of ["gym_activity_log", "gym_photos", "gym_catalog_items", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
    if (photoDir) fs.rmSync(photoDir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms with their gym admins; Staff and a trainer at gym A", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Just Fit", "Indiranagar"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.staffA.phone, kind: "staff" })).status, 201);
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.trainerA.phone, kind: "trainer" })).status, 201);
  }));

  it("2. a new branch's profile is empty, and says what it reuses", run(async () => {
    const r = await api("GET", "/api/gym/profile", tokens.gymA);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(
      { about: r.json.about, facilities: r.json.facilities, hours: r.json.hours, photos: r.json.photos, maxPhotos: r.json.maxPhotos, contact: r.json.contact, hasLocation: r.json.hasLocation, hasLogo: r.json.hasLogo },
      { about: null, facilities: [], hours: null, photos: [], maxPhotos: 8, contact: { address: null, phone: null }, hasLocation: false, hasLogo: false },
    );
    assert.equal(r.json.gym.branch, "Tumkur");
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await api("GET", "/api/gym/profile", token)).status, 401);
    assert.equal((await api("GET", "/api/gym/profile", tokens.member)).status, 403, "a member isn't a portal login");
    assert.equal((await api("GET", "/api/gym/profile", tokens.trainerA)).status, 403, "a trainer isn't either");
  }));

  it("3. the gym admin writes it; Staff read it but can't change it; other gyms never see it", run(async () => {
    const hours = { ...closed(), mon: [["05:30", "11:00"], ["16:00", "22:00"]], sun: [["06:00", "10:00"]] };
    const saved = await api("PATCH", "/api/gym/profile", tokens.gymA, { about: "Two floors, open since 2012.", facilities: ["parking", "cardio"], hours });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.about, "Two floors, open since 2012.");
    assert.deepEqual(saved.json.facilities, ["cardio", "parking"]);
    assert.deepEqual(saved.json.hours, hours);

    const asStaff = await api("GET", "/api/gym/profile", tokens.staffA);
    assert.equal(asStaff.status, 200);
    assert.equal(asStaff.json.about, "Two floors, open since 2012.");
    assert.equal((await api("PATCH", "/api/gym/profile", tokens.staffA, { about: "Staff wrote this" })).status, 403);
    assert.equal((await api("GET", "/api/gym/profile", tokens.gymB)).json.about, null, "gym B's own, empty profile");

    // Only the given field changes; clearing works
    const cleared = await api("PATCH", "/api/gym/profile", tokens.gymA, { hours: null });
    assert.equal(cleared.json.hours, null);
    assert.deepEqual(cleared.json.facilities, ["cardio", "parking"]);

    const [[row]] = await connection.query("SELECT about FROM gyms WHERE id = ?", [state.gymB]);
    assert.equal(row.about, null, "nothing written to the other gym");
    const [[audit]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE admin_id = ? AND action = 'gym.edit'", [identities.gymA.id]);
    assert.ok(audit.n >= 2, "edits are audited");
    const [[logged]] = await connection.query("SELECT COUNT(*) AS n FROM gym_activity_log WHERE gym_id = ? AND target_type = 'settings'", [state.gymA]);
    assert.ok(logged.n >= 2, "and on the branch's Activity");
  }));

  it("4. bad input is refused with a 400 and changes nothing", run(async () => {
    const bad = [
      {}, { gymId: state.gymB, about: "x" }, { about: "x".repeat(501) }, { facilities: ["pool"] }, { facilities: "cardio" },
      { facilities: ["cardio'); DROP TABLE gyms; --"] }, { hours: { mon: [] } }, { hours: { ...closed(), tue: [["11:00", "05:00"]] } },
      { hours: { ...closed(), tue: [["5:00", "11:00"]] } }, { about: "bell\u0007" },
    ];
    for (const payload of bad) assert.equal((await api("PATCH", "/api/gym/profile", tokens.gymA, payload)).status, 400, JSON.stringify(payload));
    const r = await api("GET", "/api/gym/profile", tokens.gymA);
    assert.equal(r.json.about, "Two floors, open since 2012.");
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM gyms WHERE id IN (?)", [[state.gymA, state.gymB]]);
    assert.equal(n, 2);
  }));

  it("5. photos: checked by their bytes, read at their branch only, up to 8, files cleaned up", run(async () => {
    const photo = body(png(800, 600), "image/png");
    assert.equal((await api("POST", "/api/gym/profile/photos", tokens.staffA, photo)).status, 403, "Staff can't add");
    assert.equal((await api("POST", "/api/gym/profile/photos", null, photo)).status, 401);
    assert.equal((await api("POST", "/api/gym/profile/photos", tokens.gymA, body(png(100, 100), "image/png"))).status, 400, "too small");
    assert.equal((await api("POST", "/api/gym/profile/photos", tokens.gymA, body(Buffer.from("not an image at all"), "image/png"))).status, 415);
    assert.equal((await api("POST", "/api/gym/profile/photos", tokens.gymA, body(png(800, 600), "image/jpeg"))).status, 415, "the label must match the bytes");
    assert.equal((await api("POST", "/api/gym/profile/photos", tokens.gymA, { ...photo, gymId: state.gymB })).status, 400);
    assert.deepEqual(photoFiles(), [], "a refused upload leaves no file");

    const added = await api("POST", "/api/gym/profile/photos", tokens.gymA, photo);
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.equal(added.json.photos.length, 1);
    const first = added.json.photos[0];
    assert.match(first.url, new RegExp(`^/api/gym/profile/photos/${first.id}\\?v=`));
    const read = await api("GET", first.url, tokens.staffA);
    assert.equal(read.status, 200, "Staff see the gallery");
    assert.equal(read.type, "image/png");
    assert.equal(read.bytes.length, png(800, 600).length);
    assert.equal((await api("GET", `/api/gym/profile/photos/${first.id}`, tokens.gymB)).status, 404, "another gym can't read it");
    assert.equal((await api("DELETE", `/api/gym/profile/photos/${first.id}`, tokens.gymB)).status, 404, "or delete it");
    for (const id of ["abc", "0", "1%20OR%201=1"]) assert.equal((await api("GET", `/api/gym/profile/photos/${id}`, tokens.gymA)).status, 400, id);

    for (let i = 1; i < 8; i += 1) assert.equal((await api("POST", "/api/gym/profile/photos", tokens.gymA, photo)).status, 201);
    const ninth = await api("POST", "/api/gym/profile/photos", tokens.gymA, photo);
    assert.equal(ninth.status, 400);
    assert.match(ninth.json.error, /up to 8/);
    assert.equal(photoFiles().length, 8, "the refused ninth left no file");

    assert.equal((await api("DELETE", `/api/gym/profile/photos/${first.id}`, tokens.staffA)).status, 403);
    const removed = await api("DELETE", `/api/gym/profile/photos/${first.id}`, tokens.gymA);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.photos.length, 7);
    assert.equal(photoFiles().length, 7, "its file is gone");
    assert.equal((await api("GET", `/api/gym/profile/photos/${first.id}`, tokens.gymA)).status, 404);
  }));

  it("6. plans and PT packages carry details; products don't", run(async () => {
    const plan = await api("POST", "/api/gym/catalog", tokens.gymA, { kind: "plan", name: "Gold", duration: 3, price: 4500, details: "Steam bath included. Morning batch only." });
    assert.equal(plan.status, 201, JSON.stringify(plan.json));
    const gold = plan.json.items.find((i) => i.name === "Gold");
    assert.equal(gold.details, "Steam bath included. Morning batch only.");
    assert.equal((await api("POST", "/api/gym/catalog", tokens.gymA, { kind: "product", name: "Whey", price: 2500, details: "1 kg" })).status, 400);
    const edited = await api("PATCH", `/api/gym/catalog/${gold.id}`, tokens.gymA, { details: "" });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.items.find((i) => i.id === gold.id).details, null);
    assert.equal((await api("PATCH", `/api/gym/catalog/${gold.id}`, tokens.gymB, { details: "Not yours" })).status, 404);
  }));
});
