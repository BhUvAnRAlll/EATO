// Gym Hub › Discover Gyms end to end (phase 3, 2026-11-09): test accounts in justfit_test against
// the real Express server. Two gym admins fill in their public profiles; a member finds the gyms,
// filters and sorts them, and opens one with its photos, logo and plans. Attack paths: no session,
// bad and unexpected query fields, SQL in the search, another branch's photo by id, a gym that
// doesn't exist, and nothing private (members, payments, staff) in any answer.
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

describe("gym discover e2e: members find gyms, compare plans, and see only what gyms chose to show", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, photoDir, logoDir;
  const identities = {};
  const tokens = {};
  const state = {};
  const TUMKUR = { latitude: 13.3379, longitude: 77.1173 };

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
    logoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-gym-logos-e2e-"));
    server = await startTestServer({ ...env, GYM_PHOTO_DIR: photoDir, GYM_LOGO_DIR: logoDir });
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["member", "user"]]) {
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
          for (const table of ["gym_activity_log", "gym_photos", "gym_catalog_items", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
    for (const dir of [photoDir, logoDir]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms fill in their profiles; gym A has a member with a payment", run(async () => {
    for (const [key, name, branch, area, city] of [["gymA", "Forma", "Tumkur", "SIT Road", "Tumakuru"], ["gymB", "Zen Fitness", "Hebbal", "Hebbal", "Bengaluru"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area, city });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    // Gym A: everything, with its place on the map and the invoice address and phone
    const hours = { ...closed(), mon: [["05:30", "10:30"], ["16:30", "21:30"]] };
    assert.equal((await api("PATCH", "/api/gym/profile", tokens.gymA, { about: "Two floors.", types: ["women", "gym"], facilities: ["cardio", "parking"], hours })).status, 200);
    assert.equal((await api("PATCH", "/api/gym/profile", tokens.gymA, { types: ["gym", "yoga", "dance", "women"] })).status, 400, "up to three kinds");
    assert.equal((await api("PATCH", "/api/gym/profile", tokens.gymA, { types: ["sauna"] })).status, 400);
    assert.equal((await api("PATCH", "/api/gym/invoice-details", tokens.gymA, { address: "12, SIT Main Road", phone: "9876543210" })).status, 200);
    assert.equal((await api("PUT", "/api/gym/attendance/location", tokens.gymA, { latitude: TUMKUR.latitude, longitude: TUMKUR.longitude, radiusM: 100 })).status, 200);
    const photo = await api("POST", "/api/gym/profile/photos", tokens.gymA, body(png(800, 600), "image/png"));
    assert.equal(photo.status, 201, JSON.stringify(photo.json));
    state.photoA = photo.json.photos[0].id;
    assert.equal((await api("PUT", "/api/gym/logo", tokens.gymA, body(png(200, 80), "image/png"))).status, 200);
    for (const item of [
      { kind: "plan", name: "Monthly", duration: 1, price: 1500 },
      { kind: "plan", name: "Annual", duration: 12, price: 12000, details: "Steam bath included." },
      { kind: "pt", name: "PT 12 sessions", duration: 1, price: 5000 },
      { kind: "product", name: "Whey", price: 2500 },
    ]) assert.equal((await api("POST", "/api/gym/catalog", tokens.gymA, item)).status, 201);
    const member = await api("POST", "/api/gym/members", tokens.gymA, { name: "Private Person", phone: "9123456789", duration: 3, fee: 4500, paid: 4000, method: "cash", dueBy: "2027-01-15" });
    assert.equal(member.status, 201, JSON.stringify(member.json));
    // Gym B: facilities and a dearer plan only
    assert.equal((await api("PATCH", "/api/gym/profile", tokens.gymB, { facilities: ["parking"] })).status, 200);
    assert.equal((await api("POST", "/api/gym/catalog", tokens.gymB, { kind: "plan", name: "Monthly", duration: 1, price: 2500 })).status, 201);
    const photoB = await api("POST", "/api/gym/profile/photos", tokens.gymB, body(png(800, 600), "image/png"));
    state.photoB = photoB.json.photos[0].id;
    // Members see only published profiles (Gym Profile, 2026-11-09): gym A publishes through the
    // portal; gym B's partial profile is published as the 2026-12-21 migration publishes one
    const published = await api("POST", "/api/gym/profile/publish", tokens.gymA);
    assert.equal(published.status, 200, JSON.stringify(published.json));
    await connection.query("UPDATE gyms SET published_profile = JSON_OBJECT('about', about, 'facilities', COALESCE(facilities, JSON_ARRAY()), 'custom', JSON_ARRAY(), 'hours', opening_hours, 'closures', JSON_ARRAY(), 'contact', JSON_OBJECT('address', address, 'phone', phone), 'photos', NULL, 'show', NULL), published_at = NOW(3) WHERE id IN (?)", [[state.gymB]]);
  }));

  it("2. a member lists every gym, the filled-in one first, with nothing private", run(async () => {
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await api("GET", "/api/gyms", token)).status, 401);
    const r = await api("GET", "/api/gyms", tokens.member);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const ours = r.json.gyms.filter((g) => [state.gymA, state.gymB].includes(g.id));
    assert.deepEqual(ours.map((g) => g.id), [state.gymA, state.gymB]);
    const a = ours[0];
    assert.deepEqual(
      { name: a.name, branch: a.branch, city: a.city, facilities: a.facilities, fromPrice: a.fromPrice, planCount: a.planCount, distanceKm: a.distanceKm },
      { name: "Forma", branch: "Tumkur", city: "Tumakuru", facilities: ["cardio", "parking"], fromPrice: 1000, planCount: 2, distanceKm: null },
    );
    assert.match(a.coverUrl, new RegExp(`^/api/gyms/${state.gymA}/photos/${state.photoA}\\?v=`));
    assert.match(a.logoUrl, new RegExp(`^/api/gyms/${state.gymA}/logo\\?v=`));
    assert.deepEqual(r.json.priceCaps, [1000, 1500, 2000, 3000, 5000]);
    const text = JSON.stringify(r.json);
    for (const secret of ["Private Person", "9123456789", identities.gymA.phone, "latitude"]) assert.ok(!text.includes(secret), `no ${secret}`);
  }));

  it("3. search, filters and distance", run(async () => {
    const ids = async (query) => {
      const r = await api("GET", `/api/gyms?${query}`, tokens.member);
      assert.equal(r.status, 200, `${query}: ${JSON.stringify(r.json)}`);
      return r.json.gyms.filter((g) => [state.gymA, state.gymB].includes(g.id)).map((g) => g.id);
    };
    assert.deepEqual(await ids("search=forma"), [state.gymA]);
    assert.deepEqual(await ids("search=bengaluru"), [state.gymB]);
    assert.deepEqual(await ids("search=hebbal%20zen"), [state.gymB]);
    assert.deepEqual(await ids("search=nowhere"), []);
    assert.deepEqual(await ids("facilities=cardio"), [state.gymA]);
    assert.deepEqual(await ids("facilities=parking"), [state.gymA, state.gymB]);
    assert.deepEqual(await ids("maxPrice=2000"), [state.gymA]);
    // The kind of gym (G16): only once published, and only the kinds the gym picked
    assert.deepEqual(await ids("type=women"), [state.gymA]);
    assert.deepEqual(await ids("type=yoga"), []);
    const card = (await api("GET", "/api/gyms?search=forma", tokens.member)).json.gyms.find((g) => g.id === state.gymA);
    assert.deepEqual(card.types, ["gym", "women"]);
    const near = await api("GET", `/api/gyms?sort=distance&lat=${TUMKUR.latitude}&lng=${TUMKUR.longitude}`, tokens.member);
    assert.equal(near.status, 200);
    const nearA = near.json.gyms.find((g) => g.id === state.gymA);
    assert.equal(nearA.distanceKm, 0);
    assert.equal(near.json.gyms.find((g) => g.id === state.gymB).distanceKm, null, "no place on the map, no distance");
    assert.equal(near.json.gyms[0].id, state.gymA, "nearest first");
    // A search that looks like SQL is only words that match nothing
    assert.deepEqual(await ids(`search=${encodeURIComponent("' OR 1=1 --")}`), []);
    for (const query of ["gymId=2", "facilities=pool", "maxPrice=999", "sort=price", "type=swimming", "sort=distance", "lat=51.5&lng=-0.1", "page=0", `search=${"x".repeat(61)}`, "search=a&search=b"]) {
      assert.equal((await api("GET", `/api/gyms?${query}`, tokens.member)).status, 400, query);
    }
  }));

  it("4. a gym's page: profile, contact, hours, photos and plans to compare; nothing private", run(async () => {
    const r = await api("GET", `/api/gyms/${state.gymA}`, tokens.member);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const g = r.json;
    assert.equal(g.about, "Two floors.");
    assert.deepEqual(g.types, ["gym", "women"]);
    assert.deepEqual(g.contact, { address: "12, SIT Main Road", phone: "9876543210", whatsapp: null, email: null, website: null, instagram: null, facebook: null });
    assert.ok(g.updatedAt, "when the gym last published");
    assert.deepEqual(g.location, TUMKUR);
    assert.deepEqual(g.hours.mon, [["05:30", "10:30"], ["16:30", "21:30"]]);
    assert.equal(g.photos.length, 1);
    assert.deepEqual(g.plans.map((p) => [p.name, p.months, p.price, p.perMonth, p.savesPerMonth, p.details]), [
      ["Monthly", 1, 1500, 1500, 0, null],
      ["Annual", 12, 12000, 1000, 500, "Steam bath included."],
    ]);
    assert.deepEqual(g.pt.map((p) => p.name), ["PT 12 sessions"]);
    const text = JSON.stringify(g);
    for (const secret of ["Private Person", "9123456789", "Whey", "gstin", "sms_credits", identities.gymA.phone]) assert.ok(!text.includes(secret), `no ${secret}`);

    const b = (await api("GET", `/api/gyms/${state.gymB}`, tokens.member)).json;
    assert.deepEqual([b.about, b.hours, b.location, b.logoUrl, b.contact.address, b.contact.phone], [null, null, null, null, null, null]);
    assert.equal((await api("GET", "/api/gyms/999999999", tokens.member)).status, 404);
    for (const id of ["abc", "0", "1%20OR%201=1"]) assert.equal((await api("GET", `/api/gyms/${id}`, tokens.member)).status, 400, id);
  }));

  it("5. photos and the logo by their gym only", run(async () => {
    const photo = await api("GET", `/api/gyms/${state.gymA}/photos/${state.photoA}`, tokens.member);
    assert.equal(photo.status, 200);
    assert.equal(photo.type, "image/png");
    assert.equal(photo.bytes.length, png(800, 600).length);
    assert.equal((await api("GET", `/api/gyms/${state.gymA}/photos/${state.photoB}`, tokens.member)).status, 404, "B's photo under A's path");
    assert.equal((await api("GET", `/api/gyms/${state.gymA}/photos/${state.photoA}`, null)).status, 401);
    const logo = await api("GET", `/api/gyms/${state.gymA}/logo`, tokens.member);
    assert.equal(logo.status, 200);
    assert.equal(logo.bytes.length, png(200, 80).length);
    assert.equal((await api("GET", `/api/gyms/${state.gymB}/logo`, tokens.member)).status, 404);
    assert.equal((await api("GET", `/api/gyms/${state.gymA}/Logo`, tokens.member)).status, 404, "paths are case-sensitive");
  }));
});
