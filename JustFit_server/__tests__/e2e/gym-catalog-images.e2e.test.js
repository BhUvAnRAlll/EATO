// Catalogue item images end to end: test accounts in justfit_test against the real Express server,
// the files in a throwaway folder (CATALOG_IMAGE_DIR). A gym admin adds a plan, uploads, reads,
// replaces and removes its image, and deleting the item deletes the file. Attack paths: no session,
// a member account, a gym admin of another gym (their item ids are 404s and leave no file), bad and
// oversized images, and SQL in the item id.
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

describe("catalogue images e2e: upload, read, replace, remove, and only at the item's gym", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, imageDir;
  const identities = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const type = response.headers.get("content-type") ?? "";
    if (type.startsWith("image/")) return { status: response.status, type, bytes: Buffer.from(await response.arrayBuffer()), cache: response.headers.get("cache-control") };
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const files = () => fs.readdirSync(imageDir).filter((f) => !f.startsWith("."));
  const itemOf = (answer, id) => answer.json.items.find((i) => i.id === id);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-catalog-images-e2e-"));
    server = await startTestServer({ ...env, CATALOG_IMAGE_DIR: imageDir });
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
          for (const table of ["gym_activity_log", "gym_catalog_items", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
        await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms, each with a gym admin and a plan in its catalogue", run(async () => {
    for (const [key, name, branch, tag] of [["gymA", "Forma", "Tumkur", "gymA"], ["gymB", "Just Fit", "Indiranagar", "gymB"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[tag].phone })).status, 201);
      const added = await api("POST", "/api/gym/catalog", tokens[tag], { kind: "plan", name: `3 Months ${branch}`, duration: 3, unit: "months", price: 4500 });
      assert.equal(added.status, 201, JSON.stringify(added.json));
      const item = added.json.items.find((i) => i.name === `3 Months ${branch}`);
      assert.equal(item.imageUrl, null, "no image yet");
      state[`${key}Item`] = item.id;
    }
  }));

  it("2. the gym admin uploads, reads and replaces a plan's image; the old file goes", run(async () => {
    const id = state.gymAItem;
    const first = png(400, 240, [10, 120, 200]); // a brochure is not square
    const put = await api("PUT", `/api/gym/catalog/${id}/image`, tokens.gymA, body(first, "image/png"));
    assert.equal(put.status, 200, JSON.stringify(put.json));
    const url = itemOf(put, id).imageUrl;
    assert.match(url, new RegExp(`^/api/gym/catalog/${id}/image\\?v=[0-9a-f]{8}$`));
    assert.equal(files().length, 1);

    const read = await api("GET", url, tokens.gymA);
    assert.equal(read.status, 200);
    assert.equal(read.type, "image/png");
    assert.ok(read.bytes.equals(first), "the same bytes back");
    assert.match(read.cache, /^private/);
    assert.equal(itemOf(await api("GET", "/api/gym/catalog", tokens.gymA), id).imageUrl, url, "the list carries it too");

    const replaced = await api("PUT", `/api/gym/catalog/${id}/image`, tokens.gymA, body(png(300, 300), "image/png"));
    assert.equal(replaced.status, 200);
    assert.notEqual(itemOf(replaced, id).imageUrl, url, "a new image, a new URL");
    assert.equal(files().length, 1, "the replaced file was deleted");
    state.url = itemOf(replaced, id).imageUrl;
  }));

  it("3. only signed-in staff of the item's gym; another gym's ids are 404s and write nothing", run(async () => {
    const id = state.gymAItem;
    const image = body(png(200, 200), "image/png");
    for (const token of [null, "not-a-token"]) {
      assert.equal((await api("GET", state.url, token)).status, 401);
      assert.equal((await api("PUT", `/api/gym/catalog/${id}/image`, token, image)).status, 401);
    }
    assert.equal((await api("GET", state.url, tokens.member)).status, 403, "a member account");
    assert.equal((await api("PUT", `/api/gym/catalog/${id}/image`, tokens.member, image)).status, 403);
    assert.equal((await api("GET", state.url, tokens.gymB)).status, 404, "another gym's admin can't read it");
    assert.equal((await api("PUT", `/api/gym/catalog/${id}/image`, tokens.gymB, image)).status, 404, "or replace it");
    assert.equal((await api("DELETE", `/api/gym/catalog/${id}/image`, tokens.gymB)).status, 404, "or remove it");
    assert.equal(files().length, 1, "the refused upload left no file");
    assert.equal((await api("GET", state.url, tokens.gymA)).status, 200, "still there for its own gym");
    for (const bad of ["1%20OR%201=1", "0", "abc"]) assert.equal((await api("GET", `/api/gym/catalog/${bad}/image`, tokens.gymA)).status, 400, bad);
  }));

  it("4. bad images are refused before anything is written", run(async () => {
    const id = state.gymBItem;
    const cases = [
      [{ data: "x", mediaType: "image/png", itemId: state.gymAItem }, 400],
      [body(Buffer.from("%PDF-1.4 ..............."), "application/pdf"), 415],
      [body(png(200, 200), "image/jpeg"), 415],
      [body(png(40, 400), "image/png"), 400],
    ];
    for (const [payload, status] of cases) assert.equal((await api("PUT", `/api/gym/catalog/${id}/image`, tokens.gymB, payload)).status, status, JSON.stringify(payload).slice(0, 60));
    const huge = await api("PUT", `/api/gym/catalog/${id}/image`, tokens.gymB, body(png(200, 200, undefined, 4.5 * 1024 * 1024), "image/png"));
    assert.equal(huge.status, 413);
    assert.equal(files().length, 1);
    assert.equal(itemOf(await api("GET", "/api/gym/catalog", tokens.gymB), id).imageUrl, null);
  }));

  it("5. removing the image deletes its file; deleting an item with an image deletes that file too", run(async () => {
    const id = state.gymAItem;
    const removed = await api("DELETE", `/api/gym/catalog/${id}/image`, tokens.gymA);
    assert.equal(removed.status, 200);
    assert.equal(itemOf(removed, id).imageUrl, null);
    assert.equal(files().length, 0);
    assert.equal((await api("GET", state.url, tokens.gymA)).status, 404);
    assert.equal((await api("DELETE", `/api/gym/catalog/${id}/image`, tokens.gymA)).status, 200, "removing none is fine");
    const [[row]] = await connection.query("SELECT image_key FROM gym_catalog_items WHERE id = ?", [id]);
    assert.equal(row.image_key, null);

    assert.equal((await api("PUT", `/api/gym/catalog/${id}/image`, tokens.gymA, body(png(200, 200), "image/png"))).status, 200);
    assert.equal(files().length, 1);
    const deleted = await api("DELETE", `/api/gym/catalog/${id}`, tokens.gymA);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
    assert.equal(deleted.json.removedImage, undefined, "the answer is the catalogue alone");
    assert.equal(itemOf(deleted, id), undefined);
    assert.equal(files().length, 0, "the item's file went with it");
  }));
});
