// A branch's Gym Profile end to end (Gym Hub phase 2; Gym Profile Management phase 1, 2026-11-09):
// test accounts in justfit_test against the real Express server. The gym admin writes the draft
// (description, facilities of the list and its own, hours and closures, contacts and links, what
// members see), adds, reorders and removes photos, gives plans their details, previews and
// publishes; members see only what was published. Staff do what their Gym Profile options allow.
// Attack paths: no session, a member or a trainer, Staff without the option, another gym's branch
// and photo ids, bad and unexpected fields, SQL in the input, files that aren't photos, the photo
// limit, a member reading a draft photo, publishing an incomplete profile.
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
      { about: null, facilities: [], hours: null, photos: [], maxPhotos: 8, contact: { address: null, phone: null, whatsapp: null, email: null, website: null, instagram: null, facebook: null }, hasLocation: false, hasLogo: false },
    );
    assert.deepEqual(r.json.custom, []);
    assert.deepEqual(r.json.closures, []);
    assert.ok(Object.values(r.json.show).every((on) => on === true), "every section starts on");
    assert.equal(r.json.publishing.state, "draft");
    assert.equal(r.json.publishing.publishedAt, null);
    assert.match(r.json.publishing.problem, /^Add a description, at least one photo/);
    assert.equal(r.json.gym.branch, "Tumkur");
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await api("GET", "/api/gym/profile", token)).status, 401);
    assert.equal((await api("GET", "/api/gym/profile", tokens.member)).status, 403, "a member isn't a portal login");
    assert.equal((await api("GET", "/api/gym/profile", tokens.trainerA)).status, 403, "a trainer isn't either");
  }));

  it("3. the gym admin writes it; Staff with only Gym Profile › See read it but can't change it; other gyms never see it", run(async () => {
    const limited = await api("PUT", `/api/gym/staff/${identities.staffA.id}/permissions`, tokens.gymA, { options: ["profile.view"] });
    assert.equal(limited.status, 200, JSON.stringify(limited.json));
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

  it("7. the draft takes contacts, the gym's own facilities, closures and what members see", run(async () => {
    const t = new Date(Date.now() + 330 * 60000);
    const inDays = (n) => new Date(t.getTime() + n * 86400000).toISOString().slice(0, 10);
    const saved = await api("PATCH", "/api/gym/profile", tokens.gymA, {
      whatsapp: "+91 98765 43210", email: "Desk@Forma.in", website: "forma.in", instagram: "instagram.com/forma.fit", facebook: "",
      custom: [{ name: "Boxing ring", on: true }, { name: "Crèche", on: false }],
      closures: [{ date: inDays(30), note: "Diwali" }, { date: inDays(2), note: null }],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.contact, { address: null, phone: null, whatsapp: "9876543210", email: "desk@forma.in", website: "https://forma.in/", instagram: "https://instagram.com/forma.fit", facebook: null });
    assert.deepEqual(saved.json.custom, [{ name: "Boxing ring", on: true }, { name: "Crèche", on: false }]);
    assert.deepEqual(saved.json.closures.map((c) => c.date), [inDays(2), inDays(30)]);
    assert.ok(saved.json.publishing.editedAt, "the edit time is kept");
    for (const payload of [
      { instagram: "https://evil.example/x" }, { website: "javascript:alert(1)" }, { email: "nope" }, { whatsapp: "12345" },
      { custom: [{ name: "Parking", on: true }] }, { custom: [{ name: "x'); DROP TABLE gyms; --", on: "yes" }] },
      { closures: [{ date: inDays(-1), note: null }] }, { closures: [{ date: "2026-02-30", note: null }] },
      { show: { members: false } }, { show: { pt: "off" } }, { published_profile: {} },
    ]) assert.equal((await api("PATCH", "/api/gym/profile", tokens.gymA, payload)).status, 400, JSON.stringify(payload));
    assert.equal((await api("PATCH", "/api/gym/profile", tokens.staffA, { email: "staff@x.in" })).status, 403, "Staff without Gym Profile › Edit");
  }));

  it("8. photos are reordered with the branch's own ids only, and the first is the cover", run(async () => {
    const before = (await api("GET", "/api/gym/profile", tokens.gymA)).json.photos.map((p) => p.id);
    const reversed = [...before].reverse();
    const done = await api("PUT", "/api/gym/profile/photos/order", tokens.gymA, { ids: reversed });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.deepEqual(done.json.photos.map((p) => p.id), reversed);
    for (const ids of [before.slice(1), [...before.slice(1), 999999], [before[0], ...before.slice(0, -1)], "1,2"]) {
      assert.equal((await api("PUT", "/api/gym/profile/photos/order", tokens.gymA, { ids })).status, 400, JSON.stringify(ids));
    }
    assert.equal((await api("PUT", "/api/gym/profile/photos/order", tokens.gymB, { ids: reversed })).status, 400, "gym B has none of these");
    assert.equal((await api("PUT", "/api/gym/profile/photos/order", tokens.staffA, { ids: before })).status, 403);
    assert.deepEqual((await api("GET", "/api/gym/profile", tokens.gymA)).json.photos.map((p) => p.id), reversed, "nothing changed after the refusals");
  }));

  it("9. draft → publish: members see only the published copy, without the sections switched off", run(async () => {
    // Nothing published yet: members see the name and the plans only
    let page = await api("GET", `/api/gyms/${state.gymA}`, tokens.member);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.equal(page.json.about, null);
    assert.deepEqual(page.json.photos, []);
    assert.equal(page.json.plans.length, 1, "plans come from the price list, published or not");
    const draftPhoto = (await api("GET", "/api/gym/profile", tokens.gymA)).json.photos[0].id;
    assert.equal((await api("GET", `/api/gyms/${state.gymA}/photos/${draftPhoto}`, tokens.member)).status, 404, "a draft photo isn't readable by members");

    // The preview shows the draft to the gym, never to members
    const preview = await api("GET", "/api/gym/profile/preview", tokens.staffA);
    assert.equal(preview.status, 200, "Staff with See can preview");
    assert.equal(preview.json.about, "Two floors, open since 2012.");
    assert.deepEqual(preview.json.customFacilities, ["Boxing ring"]);
    assert.match(preview.json.photos[0].url, /^\/api\/gym\/profile\/photos\//);
    assert.equal((await api("GET", "/api/gym/profile/preview", tokens.member)).status, 403);

    // Publishing an incomplete profile is refused and names what's missing
    const empty = await api("POST", "/api/gym/profile/publish", tokens.gymB);
    assert.equal(empty.status, 400);
    assert.match(empty.json.error, /description, at least one photo, opening hours/);
    const noHours = await api("POST", "/api/gym/profile/publish", tokens.gymA);
    assert.equal(noHours.status, 400, "gym A cleared its hours in test 3");
    assert.match(noHours.json.error, /opening hours/);
    assert.equal((await api("POST", "/api/gym/profile/publish", tokens.staffA)).status, 403, "Staff without Publish");

    const hours = { ...closed(), mon: [["06:00", "21:00"]], sat: [["06:00", "12:00"]] };
    assert.equal((await api("PATCH", "/api/gym/profile", tokens.gymA, { hours, show: { pt: false, links: false } })).status, 200);
    const noPlace = await api("POST", "/api/gym/profile/publish", tokens.gymA);
    assert.equal(noPlace.status, 400);
    assert.match(noPlace.json.error, /address or the place on the map/);
    assert.equal((await api("PATCH", "/api/gym/invoice-details", tokens.gymA, { address: "12 MG Road" })).status, 200);
    const published = await api("POST", "/api/gym/profile/publish", tokens.gymA);
    assert.equal(published.status, 200, JSON.stringify(published.json));
    assert.equal(published.json.publishing.state, "published");
    assert.ok(published.json.publishing.publishedAt);
    assert.equal((await api("POST", "/api/gym/profile/publish", tokens.member)).status, 403);

    page = await api("GET", `/api/gyms/${state.gymA}`, tokens.member);
    assert.equal(page.json.about, "Two floors, open since 2012.");
    assert.deepEqual(page.json.hours, hours);
    assert.deepEqual(page.json.customFacilities, ["Boxing ring"], "a switched-off facility of its own stays out");
    assert.equal(page.json.contact.whatsapp, "9876543210");
    assert.equal(page.json.contact.website, null, "links were switched off");
    assert.deepEqual(page.json.pt, [], "PT was switched off");
    assert.equal(page.json.photos.length, 7);
    assert.ok(page.json.updatedAt);
    const memberPhoto = await api("GET", page.json.photos[0].url, tokens.member);
    assert.equal(memberPhoto.status, 200, "a published photo is readable");
    assert.equal(page.json.photos[0].id, (await api("GET", "/api/gym/profile", tokens.gymA)).json.photos[0].id, "in the published order");

    // A later edit stays in the draft until it's published again
    const edited = await api("PATCH", "/api/gym/profile", tokens.gymA, { about: "Now with a boxing ring." });
    assert.equal(edited.json.publishing.state, "changed");
    assert.equal((await api("GET", `/api/gyms/${state.gymA}`, tokens.member)).json.about, "Two floors, open since 2012.", "members still see the published text");
    const card = (await api("GET", `/api/gyms?search=Forma`, tokens.member)).json.gyms.find((g) => g.id === state.gymA);
    assert.ok(card.coverUrl, "the card shows the published cover");

    // Staff given Publish can publish
    assert.equal((await api("PUT", `/api/gym/staff/${identities.staffA.id}/permissions`, tokens.gymA, { options: ["profile.view", "profile.publish"] })).status, 200);
    assert.equal((await api("POST", "/api/gym/profile/publish", tokens.staffA)).status, 200);
    assert.equal((await api("GET", `/api/gyms/${state.gymA}`, tokens.member)).json.about, "Now with a boxing ring.");

    // Removing a photo takes it away from members at once
    const gone = page.json.photos[1].id;
    assert.equal((await api("DELETE", `/api/gym/profile/photos/${gone}`, tokens.gymA)).status, 200);
    assert.equal((await api("GET", `/api/gyms/${state.gymA}/photos/${gone}`, tokens.member)).status, 404);
    assert.equal((await api("GET", "/api/gym/profile", tokens.gymA)).json.publishing.state, "published", "a removal needs no new publish");

    const [[audit]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'gym.profile_publish' AND target_id = ?", [String(state.gymA)]);
    assert.equal(audit.n, 2, "each publish is audited");
    const [[activity]] = await connection.query("SELECT COUNT(*) AS n FROM gym_activity_log WHERE gym_id = ? AND detail LIKE 'Published%'", [state.gymA]);
    assert.equal(activity.n, 2, "and on the branch's Activity");
    const [[other]] = await connection.query("SELECT published_profile FROM gyms WHERE id = ?", [state.gymB]);
    assert.equal(other.published_profile, null, "the other gym is untouched");
  }));
});
