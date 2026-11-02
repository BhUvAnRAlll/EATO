// Fitness categories end to end: the admin creates, edits, reorders, hides and deletes the Fitness
// tab's categories (Admin › Programs › Categories) and moves programs between them; members see
// the categories in that order with their names and card layouts. Against the real Express server
// and the isolated justfit_test database. Covers the attack paths too: no or forged session,
// members on the admin's routes, bad names, keys and fields, deleting a built-in category or one
// with programs, and two creates at once.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const BUILT_IN = ["popular", "categories", "build_muscle", "stay_fit", "dance", "workplace"];

describe("fitness categories e2e: the admin's categories, and the Fitness tab members see", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, program;
  const identities = {};
  const ids = {};
  const tokens = {};

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : typeof payload === "string" ? payload : JSON.stringify(payload) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const S = "/api/admin/portal/sections";
  const admin = (method, route, payload) => api(method, route, tokens.admin, payload);
  const memberTab = async (query = "") => (await api("GET", `/api/fitness/programs?place=home${query}`, tokens.member)).json;
  const audits = async () => (await connection.query("SELECT action, target_id FROM admin_audit_log WHERE admin_id = ? AND target_type = 'section' ORDER BY id", [ids.admin]))[0].map((r) => `${r.action}:${r.target_id}`);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" });
    try {
      for (const [tag, role] of [["member", undefined], ["admin", "admin"]]) {
        const identity = await testAccounts.createIdentity(runId, tag, role ? { role } : undefined);
        const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        ids[tag] = identity.id;
        tokens[tag] = jwt;
        await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)", [identity.id, identity.emailAddress, `Category ${tag}`, role ?? "user"]);
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [Object.values(ids)]);
        // Programs go back to their built-in categories, then the admin's categories are removed
        await connection.query("UPDATE fitness_programs p SET p.section = 'stay_fit' WHERE p.section NOT IN (?)", [BUILT_IN]);
        await connection.query("DELETE FROM fitness_sections WHERE built_in = FALSE");
        await db.deleteUsers(connection, Object.values(ids));
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
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  it("1. the category routes need a session; members can't use them", run(async () => {
    for (const token of [null, "jfs_forged-token-that-was-never-issued"]) assert.equal((await api("GET", S, token)).status, 401);
    for (const [method, route] of [["GET", S], ["POST", S], ["PATCH", `${S}/stay_fit`], ["POST", `${S}/stay_fit/move`], ["DELETE", `${S}/stay_fit`]]) {
      assert.equal((await api(method, route, tokens.member, method === "GET" || method === "DELETE" ? undefined : { title: "Mine" })).status, 403, `${method} ${route}`);
    }
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM fitness_sections WHERE built_in = FALSE"))[0][0].n, 0);
  }));

  it("2. the six built-in categories, in order, with their programs; members see the same names and layouts", run(async () => {
    const r = await admin("GET", S);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.sections.map((s) => s.id), BUILT_IN);
    assert.ok(r.json.sections.every((s) => s.builtIn && s.published && s.programCount > 0));
    assert.deepEqual(r.json.sections.map((s) => s.layout), ["poster", "tile", "tile", "tile", "wide", "wide"]);
    const tab = await memberTab();
    assert.deepEqual(tab.sections.map((s) => s.id), BUILT_IN.filter((id) => tab.sections.some((s) => s.id === id)));
    assert.equal(tab.sections[0].layout, "poster");
    const card = tab.sections[0].programs[0];
    assert.equal(card.sectionTitle, "Popular Programs");
    program = card;
  }));

  it("3. the admin creates a category at the end; the key comes from the name; duplicates and bad fields are refused", run(async () => {
    const r = await admin("POST", S, { title: "Yoga & Mobility", note: "Stretch, breathe, move better", layout: "wide" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual({ ...r.json.section }, { id: "yoga_mobility", title: "Yoga & Mobility", note: "Stretch, breathe, move better", layout: "wide", position: 6, published: true, builtIn: false, programCount: 0 });
    assert.equal((await admin("POST", S, { title: "yoga & MOBILITY" })).status, 400, "the same name in other letters");
    const second = await admin("POST", S, { title: "Yoga Mobility" });
    assert.equal(second.json.section.id, "yoga_mobility_2", "a free key when the first is taken");
    for (const body of [{}, { title: "x" }, { title: "Ok", layout: "grid" }, { title: "Ok", builtIn: true }, { title: "Ok", slug: "popular" }, { title: "Ok", position: 0 }, "{not json"]) {
      const bad = await admin("POST", S, body);
      assert.equal(bad.status, 400, `${JSON.stringify(body)} → ${JSON.stringify(bad.json)}`);
    }
    // An empty category isn't on the Fitness tab
    assert.equal((await memberTab()).sections.some((s) => s.id === "yoga_mobility"), false);
    assert.deepEqual(await audits(), ["section.create:yoga_mobility", "section.create:yoga_mobility_2"]);
  }));

  it("4. a program moved into the new category shows there for members, last, with its layout; an unknown category is refused", run(async () => {
    const moved = await admin("PATCH", `/api/admin/portal/programs/${program.id}`, { section: "yoga_mobility" });
    assert.equal(moved.status, 200, JSON.stringify(moved.json));
    assert.equal(moved.json.program.sectionTitle, "Yoga & Mobility");
    const tab = await memberTab();
    const last = tab.sections.at(-1);
    assert.deepEqual({ id: last.id, title: last.title, note: last.note, layout: last.layout }, { id: "yoga_mobility", title: "Yoga & Mobility", note: "Stretch, breathe, move better", layout: "wide" });
    assert.deepEqual(last.programs.map((p) => p.id), [program.id]);
    for (const section of ["nope", "VIP!", "../popular"]) {
      const r = await admin("PATCH", `/api/admin/portal/programs/${program.id}`, { section });
      assert.equal(r.status, 400, `${section} → ${JSON.stringify(r.json)}`);
    }
    const [[row]] = await connection.query("SELECT section FROM fitness_programs WHERE id = ?", [program.id]);
    assert.equal(row.section, "yoga_mobility");
    // Searching by the category's name finds the program
    assert.ok((await memberTab("&search=mobility")).sections.some((s) => s.programs.some((p) => p.id === program.id)));
  }));

  it("5. edits and order reach members: rename, new layout, moved up; the list stays numbered 0, 1, 2…", run(async () => {
    const edited = await admin("PATCH", `${S}/yoga_mobility`, { title: "Yoga", layout: "poster" });
    assert.equal(edited.status, 200, JSON.stringify(edited.json));
    const up = await admin("POST", `${S}/yoga_mobility/move`, { direction: "up" });
    assert.equal(up.status, 200, JSON.stringify(up.json));
    const order = up.json.sections.map((s) => s.id);
    assert.ok(order.indexOf("yoga_mobility") < order.indexOf("yoga_mobility_2"), "it moved above the other new one");
    assert.deepEqual(up.json.sections.map((s) => s.position), order.map((_, i) => i));
    // To the top, a step at a time (the first one up again changes nothing)
    for (let i = 0; i < 8; i += 1) assert.equal((await admin("POST", `${S}/yoga_mobility/move`, { direction: "up" })).status, 200);
    const tab = await memberTab();
    assert.deepEqual({ id: tab.sections[0].id, title: tab.sections[0].title, layout: tab.sections[0].layout }, { id: "yoga_mobility", title: "Yoga", layout: "poster" });
    for (const body of [{ direction: "left" }, { direction: "up", steps: 3 }, {}]) assert.equal((await admin("POST", `${S}/yoga_mobility/move`, body)).status, 400);
    assert.equal((await admin("POST", `${S}/no_such_one/move`, { direction: "up" })).status, 404);
    assert.equal((await admin("PATCH", `${S}/${encodeURIComponent("x' OR 1=1 --")}`, { title: "Hacked" })).status, 404);
    assert.equal((await admin("PATCH", `${S}/stay_fit`, { title: "Yoga" })).status, 400, "another category's name");
  }));

  it("6. a hidden category and its programs leave the Fitness tab (and its search) until shown again", run(async () => {
    assert.equal((await admin("PATCH", `${S}/yoga_mobility`, { published: false })).status, 200);
    let tab = await memberTab();
    assert.equal(tab.sections.some((s) => s.id === "yoga_mobility"), false);
    assert.equal(tab.sections.some((s) => s.programs.some((p) => p.id === program.id)), false);
    assert.equal((await memberTab("&search=yoga")).sections.some((s) => s.programs.some((p) => p.id === program.id)), false);
    assert.equal((await admin("PATCH", `${S}/yoga_mobility`, { published: true })).status, 200);
    tab = await memberTab();
    assert.equal(tab.sections[0].id, "yoga_mobility");
    assert.ok((await audits()).includes("section.hide:yoga_mobility") && (await audits()).includes("section.show:yoga_mobility"));
  }));

  it("7. built-in categories can be renamed and hidden but never deleted", run(async () => {
    const renamed = await admin("PATCH", `${S}/workplace`, { title: "Office Fitness" });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
    assert.ok((await memberTab()).sections.some((s) => s.id === "workplace" && s.title === "Office Fitness"));
    const del = await admin("DELETE", `${S}/workplace`);
    assert.equal(del.status, 400);
    assert.match(del.json.error, /Hide it instead/);
    assert.equal((await admin("PATCH", `${S}/workplace`, { title: "Workplace Wellness" })).status, 200);
  }));

  it("8. a category with programs can't be deleted; once empty it can, and only once", run(async () => {
    const busy = await admin("DELETE", `${S}/yoga_mobility`);
    assert.equal(busy.status, 400);
    assert.match(busy.json.error, /Move its 1 program/);
    // A direct delete is refused by the database too
    await assert.rejects(connection.query("DELETE FROM fitness_sections WHERE slug = 'yoga_mobility'"), (error) => error.code === "ER_ROW_IS_REFERENCED_2");
    assert.equal((await admin("PATCH", `/api/admin/portal/programs/${program.id}`, { section: "popular" })).status, 200);
    const gone = await admin("DELETE", `${S}/yoga_mobility`);
    assert.equal(gone.status, 200, JSON.stringify(gone.json));
    assert.equal(gone.json.sections.some((s) => s.id === "yoga_mobility"), false);
    assert.equal((await admin("DELETE", `${S}/yoga_mobility`)).status, 404);
    assert.ok((await audits()).includes("section.delete:yoga_mobility"));
    assert.equal((await memberTab()).sections.find((s) => s.id === "popular").programs.some((p) => p.id === program.id), true);
  }));

  it("9. two creates with the same name at once make one category", run(async () => {
    const [x, y] = await Promise.all([admin("POST", S, { title: "Pilates" }), admin("POST", S, { title: "Pilates" })]);
    assert.deepEqual([x.status, y.status].sort(), [201, 400]);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM fitness_sections WHERE title = 'Pilates'"))[0][0].n, 1);
  }));
});
