// Program cover photos end to end: the admin adds, replaces and removes a program's cover
// (Admin › Programs), members read it on the Fitness tab, against the real Express server and the
// isolated justfit_test database, with the covers in a throwaway folder (COVER_DIR). Covers the
// attack paths too: no or forged session, members on the admin's routes, files that aren't
// photos, wrong labels, too big or too small, unknown programs, and a hidden program's cover.
// The program page's own photo (hero, 2026-11-03) is checked the same way, and kept apart from the cover.
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
const { png, jpegHeader, body } = require("./images.js");

describe("program covers e2e: the admin's upload, replace and remove; members read published ones", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, coverDir, program;
  const identities = {};
  const ids = {};
  const tokens = {};

  const api = async (method, route, token, payload, { raw = false } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : typeof payload === "string" ? payload : JSON.stringify(payload) });
    if (raw) return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const coverRoute = (id = program.id) => `/api/admin/portal/programs/${id}/cover`;
  const files = () => fs.readdirSync(coverDir).sort();
  const row = async () => (await connection.query("SELECT cover_key, cover_updated_at FROM fitness_programs WHERE id = ?", [program.id]))[0][0];
  const memberCard = async (token = tokens.member) => {
    const r = await api("GET", "/api/fitness/programs?place=home", token);
    return r.json.sections.flatMap((s) => s.programs).find((p) => p.id === program.id);
  };
  const audits = async () => (await connection.query("SELECT action FROM admin_audit_log WHERE admin_id = ? AND target_id = ? ORDER BY id", [ids.admin, program.id]))[0].map((r) => r.action);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    coverDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-covers-e2e-"));
    server = await startTestServer({ ...env, AI_PROVIDER: "fake", COVER_DIR: coverDir });
    try {
      for (const [tag, role] of [["member", undefined], ["admin", "admin"]]) {
        const identity = await testAccounts.createIdentity(runId, tag, role ? { role } : undefined);
        const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        ids[tag] = identity.id;
        tokens[tag] = jwt;
        await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)", [identity.id, identity.emailAddress, `Cover ${tag}`, role ?? "user"]);
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    // A published home program from the starter catalog (added the first time programs are read)
    const list = await api("GET", "/api/admin/portal/programs", tokens.admin);
    program = list.json.programs.find((p) => p.published && p.place !== "center");
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const all = Object.values(ids);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [all]);
        await connection.query("UPDATE fitness_programs SET cover_key = NULL, cover_updated_at = NULL, hero_key = NULL, hero_updated_at = NULL");
        await db.deleteUsers(connection, all);
      } catch (error) { problems.push(`rows: ${error.code ?? error.message}`); }
    }
    if (testAccounts) for (const tag of Object.keys(identities)) {
      try {
        if (identities[tag].sessionId) await testAccounts.revokeSession(identities[tag].sessionId).catch(() => {});
        await testAccounts.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeIdentityError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (coverDir) fs.rmSync(coverDir, { recursive: true, force: true });
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  it("1. every cover route needs a session; members can't use the admin's", run(async () => {
    assert.ok(program, "a starter program to work on");
    const photo = body(png(640, 360), "image/png");
    for (const token of [null, "jfs_forged-token-that-was-never-issued"]) {
      assert.equal((await api("PUT", coverRoute(), token, photo)).status, 401);
      assert.equal((await api("DELETE", coverRoute(), token)).status, 401);
      assert.equal((await api("GET", `/api/fitness/programs/${program.id}/cover`, token)).status, 401);
    }
    assert.equal((await api("PUT", coverRoute(), tokens.member, photo)).status, 403);
    assert.equal((await api("DELETE", coverRoute(), tokens.member)).status, 403);
    assert.equal((await api("GET", coverRoute(), tokens.member)).status, 403);
    assert.deepEqual(files(), [], "nothing was written");
    assert.equal((await row()).cover_key, null);
  }));

  it("2. without a cover the card has none, and reading it is a 404", run(async () => {
    assert.equal((await memberCard()).coverUrl, null);
    assert.equal((await api("GET", `/api/fitness/programs/${program.id}/cover`, tokens.member)).status, 404);
  }));

  it("3. the admin adds a cover; members get it on the card and read the same bytes", run(async () => {
    const photo = png(640, 360);
    const r = await api("PUT", coverRoute(), tokens.admin, body(photo, "image/png"));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.match(r.json.program.coverUrl, new RegExp(`^/api/admin/portal/programs/${program.id}/cover\\?v=\\d+$`));
    const { cover_key: key } = await row();
    assert.deepEqual(files(), [key]);
    const card = await memberCard();
    assert.match(card.coverUrl, new RegExp(`^/api/fitness/programs/${program.id}/cover\\?v=\\d+$`));
    const got = await api("GET", card.coverUrl, tokens.member, undefined, { raw: true });
    assert.equal(got.status, 200);
    assert.equal(Buffer.compare(got.bytes, photo), 0);
    assert.equal(got.headers.get("content-type"), "image/png");
    assert.equal(got.headers.get("x-content-type-options"), "nosniff");
    assert.match(got.headers.get("cache-control"), /^private/);
    assert.match(got.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.deepEqual(await audits(), ["program.cover_add"]);
  }));

  it("4. replacing makes a new file and URL, deletes the old file only after the switch", run(async () => {
    const before = await row();
    const oldUrl = (await memberCard()).coverUrl;
    const r = await api("PUT", coverRoute(), tokens.admin, body(jpegHeader(1280, 720), "image/jpeg"));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const now = await row();
    assert.notEqual(now.cover_key, before.cover_key);
    assert.match(now.cover_key, /\.jpg$/);
    assert.deepEqual(files(), [now.cover_key], "the old file is gone");
    assert.notEqual((await memberCard()).coverUrl, oldUrl, "a new URL, so no cache shows the old cover");
    const got = await api("GET", (await memberCard()).coverUrl, tokens.member, undefined, { raw: true });
    assert.equal(got.headers.get("content-type"), "image/jpeg");
    // Two replacements at once: one wins, and only its file is left
    const [x, y] = await Promise.all([png(800, 450, [10, 10, 10]), png(800, 450, [250, 250, 250])].map((p) => api("PUT", coverRoute(), tokens.admin, body(p, "image/png"))));
    assert.deepEqual([x.status, y.status], [200, 200]);
    assert.deepEqual(files(), [(await row()).cover_key]);
    assert.deepEqual((await audits()).slice(1), ["program.cover_replace", "program.cover_replace", "program.cover_replace"]);
  }));

  it("5. bad uploads are refused with one line, and the cover and files stay as they were", run(async () => {
    const before = await row();
    const cases = [
      [body(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"), "image/png"), 415],
      [body(Buffer.from("%PDF-1.7"), "application/pdf"), 415],
      [body(png(640, 360), "image/webp"), 415],
      [body(png(100, 100), "image/png"), 400],
      [body(jpegHeader(9000, 4000), "image/jpeg"), 400],
      [{ ...body(png(640, 360), "image/png"), path: "../../.env" }, 400],
      [{ data: "not base64!!", mediaType: "image/png" }, 400],
      [{}, 400],
      ["{not json", 400],
      [body(png(640, 360, undefined, 2 * 1024 * 1024), "image/png"), 413],
    ];
    for (const [payload, status] of cases) {
      const r = await api("PUT", coverRoute(), tokens.admin, payload);
      assert.equal(r.status, status, `${JSON.stringify(payload).slice(0, 60)} → ${JSON.stringify(r.json)}`);
      assert.equal(typeof r.json?.error, "string");
    }
    const huge = await api("PUT", coverRoute(), tokens.admin, { data: "A".repeat(4 * 1024 * 1024), mediaType: "image/png" });
    assert.equal(huge.status, 413);
    // Unknown or malformed program ids: nothing is written
    assert.equal((await api("PUT", coverRoute(crypto.randomUUID()), tokens.admin, body(png(640, 360), "image/png"))).status, 404);
    assert.equal((await api("PUT", coverRoute("../../etc"), tokens.admin, body(png(640, 360), "image/png"))).status, 404);
    assert.equal((await api("PUT", coverRoute(encodeURIComponent("x' OR 1=1 --")), tokens.admin, body(png(640, 360), "image/png"))).status, 404);
    assert.deepEqual({ ...(await row()) }, { ...before });
    assert.deepEqual(files(), [before.cover_key]);
  }));

  it("6. a hidden program's cover is the admin's only", run(async () => {
    const memberUrl = (await memberCard()).coverUrl;
    await connection.query("UPDATE fitness_programs SET published = FALSE WHERE id = ?", [program.id]);
    try {
      assert.equal((await api("GET", memberUrl, tokens.member)).status, 404);
      assert.equal((await api("GET", coverRoute(), tokens.admin, undefined, { raw: true })).status, 200);
    } finally {
      await connection.query("UPDATE fitness_programs SET published = TRUE WHERE id = ?", [program.id]);
    }
  }));

  it("7. removing the cover deletes its file; the card shows the gradient again", run(async () => {
    const r = await api("DELETE", coverRoute(), tokens.admin);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.program.coverUrl, null);
    assert.equal((await row()).cover_key, null);
    assert.deepEqual(files(), []);
    assert.equal((await memberCard()).coverUrl, null);
    assert.equal((await api("GET", `/api/fitness/programs/${program.id}/cover`, tokens.member)).status, 404);
    // Removing again is fine and changes nothing
    assert.equal((await api("DELETE", coverRoute(), tokens.admin)).status, 200);
    assert.equal((await audits()).at(-1), "program.cover_remove");
    assert.equal((await audits()).filter((a) => a === "program.cover_remove").length, 1);
  }));

  // ---- the program page's photo (hero) ----
  const heroRoute = (id = program.id) => `/api/admin/portal/programs/${id}/hero`;
  const memberDetail = async (token = tokens.member) => (await api("GET", `/api/fitness/programs/${program.id}`, token)).json.program;

  it("8. every page-photo route needs a session; members can't use the admin's; bad uploads are refused", run(async () => {
    const photo = body(png(640, 360), "image/png");
    for (const token of [null, "jfs_forged-token-that-was-never-issued"]) {
      assert.equal((await api("PUT", heroRoute(), token, photo)).status, 401);
      assert.equal((await api("DELETE", heroRoute(), token)).status, 401);
      assert.equal((await api("GET", `/api/fitness/programs/${program.id}/hero`, token)).status, 401);
    }
    assert.equal((await api("PUT", heroRoute(), tokens.member, photo)).status, 403);
    assert.equal((await api("DELETE", heroRoute(), tokens.member)).status, 403);
    assert.equal((await api("GET", heroRoute(), tokens.member)).status, 403);
    // Not a photo, a label that lies, too small, an unknown or malformed program
    assert.equal((await api("PUT", heroRoute(), tokens.admin, body(Buffer.from("<script>alert(1)</script>"), "image/png"))).status, 415);
    assert.equal((await api("PUT", heroRoute(), tokens.admin, body(png(640, 360), "image/jpeg"))).status, 415);
    assert.equal((await api("PUT", heroRoute(), tokens.admin, { ...body(png(640, 360), "image/png"), path: "../../.env" })).status, 400);
    assert.equal((await api("PUT", heroRoute(), tokens.admin, body(png(100, 60), "image/png"))).status, 400);
    assert.equal((await api("PUT", heroRoute(crypto.randomUUID()), tokens.admin, photo)).status, 404);
    assert.equal((await api("PUT", "/api/admin/portal/programs/1%27%20OR%201%3D1/hero", tokens.admin, photo)).status, 404);
    assert.deepEqual(files(), [], "nothing was written");
    assert.equal((await memberDetail()).heroUrl, null);
    assert.equal((await api("GET", `/api/fitness/programs/${program.id}/hero`, tokens.member)).status, 404);
  }));

  it("9. the admin adds and replaces the page photo; members read it; the cover stays apart", run(async () => {
    const first = png(800, 450, [10, 120, 60]);
    const added = await api("PUT", heroRoute(), tokens.admin, body(first, "image/png"));
    assert.equal(added.status, 200, JSON.stringify(added.json));
    assert.match(added.json.program.heroUrl, new RegExp(`^/api/admin/portal/programs/${program.id}/hero\\?v=\\d+$`));
    assert.equal(added.json.program.coverUrl, null, "the card's cover is untouched");
    const detail = await memberDetail();
    assert.match(detail.heroUrl, new RegExp(`^/api/fitness/programs/${program.id}/hero\\?v=\\d+$`));
    assert.equal(detail.coverUrl, null);
    assert.equal((await memberCard()).coverUrl, null, "the card doesn't show the page photo");
    const got = await api("GET", detail.heroUrl, tokens.member, undefined, { raw: true });
    assert.equal(got.status, 200);
    assert.equal(Buffer.compare(got.bytes, first), 0);
    assert.equal(got.headers.get("x-content-type-options"), "nosniff");
    const [[{ hero_key: oldKey }]] = await connection.query("SELECT hero_key FROM fitness_programs WHERE id = ?", [program.id]);
    assert.deepEqual(files(), [oldKey]);
    // A cover beside it: two files, each its own
    const cover = await api("PUT", coverRoute(), tokens.admin, body(png(640, 360), "image/png"));
    assert.equal(cover.status, 200);
    assert.equal(cover.json.program.heroUrl, added.json.program.heroUrl, "a new cover leaves the page photo as it was");
    assert.equal(files().length, 2);
    // Replacing the page photo deletes only its old file
    const second = png(900, 500, [200, 40, 40]);
    const replaced = await api("PUT", heroRoute(), tokens.admin, body(second, "image/png"));
    assert.equal(replaced.status, 200);
    assert.notEqual(replaced.json.program.heroUrl, added.json.program.heroUrl);
    assert.ok(!files().includes(oldKey), "the old page photo's file is gone");
    assert.equal(files().length, 2, "the cover's file is still there");
    assert.equal(Buffer.compare((await api("GET", (await memberDetail()).heroUrl, tokens.member, undefined, { raw: true })).bytes, second), 0);
    const actions = await audits();
    assert.ok(actions.includes("program.hero_add") && actions.includes("program.hero_replace"), actions.join(", "));
  }));

  it("10. a hidden program's page photo is the admin's only; removing it deletes its file only", run(async () => {
    const memberUrl = (await memberDetail()).heroUrl;
    await connection.query("UPDATE fitness_programs SET published = FALSE WHERE id = ?", [program.id]);
    try {
      assert.equal((await api("GET", memberUrl, tokens.member)).status, 404);
      assert.equal((await api("GET", heroRoute(), tokens.admin, undefined, { raw: true })).status, 200);
    } finally {
      await connection.query("UPDATE fitness_programs SET published = TRUE WHERE id = ?", [program.id]);
    }
    const r = await api("DELETE", heroRoute(), tokens.admin);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.program.heroUrl, null);
    assert.ok(r.json.program.coverUrl, "the cover stays");
    assert.equal(files().length, 1, "only the cover's file is left");
    assert.equal((await api("GET", `/api/fitness/programs/${program.id}/hero`, tokens.member)).status, 404);
    assert.equal((await audits()).at(-1), "program.hero_remove");
    // Tidy up the cover this test added
    assert.equal((await api("DELETE", coverRoute(), tokens.admin)).status, 200);
    assert.deepEqual(files(), []);
  }));
});
