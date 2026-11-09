// Trainer profiles end to end (Gym Profile phase 3, 2026-11-09): test accounts in justfit_test
// against the real Express server. The gym admin writes a profile for each trainer login at the
// branch and switches it on; members see it on the gym's page at every branch the trainer works at.
// Attack paths: no session, a member or a trainer in the portal, Staff without the option, another
// gym's trainer, a member reading a hidden trainer's photo, a nameless trainer, bad input, SQL in it.
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

describe("trainer profiles e2e: the gym writes them, members see the ones switched on at that branch", () => {
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
    photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-trainer-photos-e2e-"));
    server = await startTestServer({ ...env, GYM_PHOTO_DIR: photoDir, TRAINER_PHOTO_DIR: photoDir });
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["staffA", "user"], ["trainerA", "user"], ["trainerB", "user"], ["trainerZ", "user"], ["member", "user"]]) {
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
        const gymIds = [state.gymA, state.gymB, state.kunigal].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_enquiry_contacts", "gym_enquiries", "gym_photos", "gym_payments", "gym_members", "gym_catalog_items", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gym_trainer_profiles WHERE brand_id IN (?)", [brands.map((b) => b.brand_id).concat(0)]);
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

  const week = () => ({ ...closed(), mon: [["06:00", "10:00"]], wed: [["17:00", "21:00"]] });
  const trainerOf = (json, tag) => json.trainers.find((t) => t.userId === identities[tag].id);

  it("1. two gyms; at gym A Staff who can only see the profile and two trainers (one without a name); gym B has its own", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Just Fit", "Indiranagar"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.staffA.phone, kind: "staff" })).status, 201);
    assert.equal((await api("PUT", `/api/gym/staff/${identities.staffA.id}/permissions`, tokens.gymA, { options: ["profile.view"] })).status, 200);
    for (const tag of ["trainerA", "trainerB"]) assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities[tag].phone, kind: "trainer" })).status, 201);
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymB, { phone: identities.trainerZ.phone, kind: "trainer" })).status, 201);
    await connection.query("UPDATE users SET full_name = 'Ravi Kumar' WHERE id = ?", [identities.trainerA.id]);
    await connection.query("UPDATE users SET full_name = NULL WHERE id = ?", [identities.trainerB.id]);
  }));

  it("2. the branch's trainers are listed with empty profiles; nobody else reads them", run(async () => {
    const r = await api("GET", "/api/gym/profile/trainers", tokens.gymA);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.trainers.map((t) => t.name).sort(), ["Ravi Kumar", null].sort());
    const ravi = trainerOf(r.json, "trainerA");
    assert.deepEqual([ravi.specializations, ravi.years, ravi.active, ravi.photoUrl], [[], null, false, null]);
    assert.match(ravi.phone, /^\+91 ••••• •\d{4}$/, "the number is masked");
    assert.equal((await api("GET", "/api/gym/profile/trainers", tokens.staffA)).status, 200, "Staff with See read them");
    assert.equal((await api("GET", "/api/gym/profile/trainers", null)).status, 401);
    for (const tag of ["member", "trainerA"]) assert.equal((await api("GET", "/api/gym/profile/trainers", tokens[tag])).status, 403, tag);
    assert.deepEqual((await api("GET", "/api/gym/profile/trainers", tokens.gymB)).json.trainers.map((t) => t.userId), [identities.trainerZ.id], "gym B sees only its own");
  }));

  it("3. the gym admin writes a profile; bad input, Staff without the option and another gym are refused", run(async () => {
    const saved = await api("PUT", `/api/gym/profile/trainers/${identities.trainerA.id}`, tokens.gymA, {
      specializations: ["Strength training", " Weight  loss "], years: 6, certifications: ["ACE CPT"], bio: "Helps beginners lift safely.", availability: week(),
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const ravi = trainerOf(saved.json, "trainerA");
    assert.deepEqual([ravi.specializations, ravi.years, ravi.certifications, ravi.active], [["Strength training", "Weight loss"], 6, ["ACE CPT"], false]);
    assert.deepEqual(ravi.availability, week());

    for (const payload of [{}, { years: 61 }, { specializations: ["x"] }, { bio: "x".repeat(501) }, { availability: { mon: [] } }, { active: "yes" }, { userId: identities.trainerZ.id, years: 1 }, { certifications: ["a'); DROP TABLE gyms; --", "a'); DROP TABLE gyms; --"] }]) {
      assert.equal((await api("PUT", `/api/gym/profile/trainers/${identities.trainerA.id}`, tokens.gymA, payload)).status, 400, JSON.stringify(payload));
    }
    const nameless = await api("PUT", `/api/gym/profile/trainers/${identities.trainerB.id}`, tokens.gymA, { active: true });
    assert.equal(nameless.status, 400, "a trainer without a name can't be shown");
    assert.match(nameless.json.error, /added their name/);
    assert.equal((await api("PUT", `/api/gym/profile/trainers/${identities.trainerA.id}`, tokens.staffA, { years: 7 })).status, 403, "Staff with only See");
    assert.equal((await api("PUT", `/api/gym/profile/trainers/${identities.trainerZ.id}`, tokens.gymA, { years: 1 })).status, 404, "gym B's trainer");
    assert.equal((await api("PUT", `/api/gym/profile/trainers/${identities.staffA.id}`, tokens.gymA, { years: 1 })).status, 404, "Staff aren't trainers");
    assert.equal((await api("PUT", `/api/gym/profile/trainers/${identities.trainerA.id}`, tokens.gymB, { years: 1 })).status, 404, "nor is gym A's trainer gym B's");
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM gym_trainer_profiles WHERE user_id = ?", [identities.trainerZ.id]);
    assert.equal(n, 0, "nothing written for the other gym's trainer");
  }));

  it("4. photos: checked from their bytes, the trainer's branch only; members see a trainer once switched on", run(async () => {
    const url = `/api/gym/profile/trainers/${identities.trainerA.id}/photo`;
    assert.equal((await api("PUT", url, tokens.gymA, body(Buffer.from("not an image"), "image/png"))).status, 415);
    assert.equal((await api("PUT", url, tokens.staffA, body(png(400, 400), "image/png"))).status, 403);
    const added = await api("PUT", url, tokens.gymA, body(png(400, 400), "image/png"));
    assert.equal(added.status, 200, JSON.stringify(added.json));
    assert.ok(trainerOf(added.json, "trainerA").photoUrl);
    assert.equal((await api("GET", url, tokens.staffA)).status, 200);
    assert.equal((await api("GET", url, tokens.gymB)).status, 404);

    // Hidden: not on the gym's page
    let page = (await api("GET", `/api/gyms/${state.gymA}`, tokens.member)).json;
    assert.deepEqual(page.trainers, []);
    const [[{ id: profileId }]] = await connection.query("SELECT id FROM gym_trainer_profiles WHERE user_id = ?", [identities.trainerA.id]);
    assert.equal((await api("GET", `/api/gyms/${state.gymA}/trainers/${profileId}/photo`, tokens.member)).status, 404, "a hidden trainer's photo");

    assert.equal((await api("PUT", `/api/gym/profile/trainers/${identities.trainerA.id}`, tokens.gymA, { active: true })).status, 200);
    page = (await api("GET", `/api/gyms/${state.gymA}`, tokens.member)).json;
    assert.equal(page.trainers.length, 1);
    const shown = page.trainers[0];
    assert.deepEqual([shown.id, shown.name, shown.years, shown.specializations], [profileId, "Ravi Kumar", 6, ["Strength training", "Weight loss"]]);
    assert.ok(!JSON.stringify(shown).includes(identities.trainerA.id), "never the account's id");
    assert.ok(!JSON.stringify(page.trainers).includes(identities.trainerA.phone), "nor the number");
    const photo = await api("GET", shown.photoUrl, tokens.member);
    assert.equal(photo.status, 200);
    assert.equal(photo.type, "image/png");
    assert.equal((await api("GET", `/api/gyms/${state.gymB}/trainers/${profileId}/photo`, tokens.member)).status, 404, "not at a branch they don't work at");
    assert.deepEqual((await api("GET", `/api/gyms/${state.gymB}`, tokens.member)).json.trainers, []);
  }));

  it("5. a second branch shows the same profile; the gym can hide the Trainers section; removing the trainer takes them off", run(async () => {
    const added = await api("POST", `/api/admin/portal/gyms/${state.gymA}/branches`, tokens.admin, { branch: "Kunigal", area: "Main Road", city: "Kunigal" });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    state.kunigal = added.json.branch?.id ?? added.json.gym?.id;
    assert.ok(state.kunigal, JSON.stringify(added.json));
    await connection.query("INSERT INTO gym_staff (user_id, gym_id, kind) VALUES (?, ?, 'owner'), (?, ?, 'trainer')", [identities.gymA.id, state.kunigal, identities.trainerA.id, state.kunigal]);
    assert.deepEqual((await api("GET", `/api/gyms/${state.kunigal}`, tokens.member)).json.trainers.map((t) => t.name), ["Ravi Kumar"], "the same profile at the other branch");

    // What members see › Trainers off, published
    await connection.query("UPDATE gyms SET published_profile = JSON_OBJECT('about', 'x', 'facilities', JSON_ARRAY(), 'custom', JSON_ARRAY(), 'hours', NULL, 'closures', JSON_ARRAY(), 'contact', JSON_OBJECT(), 'photos', NULL, 'show', JSON_OBJECT('trainers', false)) WHERE id = ?", [state.gymA]);
    assert.deepEqual((await api("GET", `/api/gyms/${state.gymA}`, tokens.member)).json.trainers, [], "the section is off");
    await connection.query("UPDATE gyms SET published_profile = NULL WHERE id = ?", [state.gymA]);

    const removed = await api("DELETE", `/api/gym/staff/${identities.trainerA.id}`, tokens.gymA);
    assert.equal(removed.status, 200, JSON.stringify(removed.json));
    assert.deepEqual((await api("GET", `/api/gyms/${state.gymA}`, tokens.member)).json.trainers, [], "off the branch they left");
    assert.equal((await api("GET", `/api/gyms/${state.kunigal}`, tokens.member)).json.trainers.length, 1, "still at the branch they work at");

    const [[logged]] = await connection.query("SELECT COUNT(*) AS n FROM gym_activity_log WHERE gym_id = ? AND target_label = 'Trainer profile'", [state.gymA]);
    assert.ok(logged.n >= 3, "profile changes are on Activity");
  }));
});
