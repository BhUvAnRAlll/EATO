// Reminder Templates end to end: test accounts in justfit_test against the real Express server.
// The gym admin rewords and resets a branch's reminder texts; every portal login reads them.
// Attack paths: no session, a member account, Staff changing them (with and without areas),
// another gym's admin (their branch's templates are their own), bad kinds and placeholders, SQL
// in the path and the text, an oversized body, and a changed case in the path.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("gym reminder templates e2e: read by every portal login, changed by the gym admin only, per branch", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const empty = { due: null, expiry: null, expired: null, enquiry: null };

  const api = async (method, route, token, payload, raw) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined || raw !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: raw ?? (payload === undefined ? undefined : JSON.stringify(payload)) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const due = "Namaste {name}, {amount} is due {dueBy} at {gym}. Member ID {code}.";

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["staffAll", "user"], ["staffNone", "user"], ["member", "user"]]) {
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
          for (const table of ["gym_reminder_templates", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms with their admins; gym A adds two Staff, one limited to Members; every template is the default", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Just Fit", "Indiranagar"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    for (const tag of ["staffAll", "staffNone"]) {
      const added = await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities[tag].phone, kind: "staff" });
      assert.equal(added.status, 201, JSON.stringify(added.json));
    }
    assert.equal((await api("PUT", `/api/gym/staff/${identities.staffNone.id}/permissions`, tokens.gymA, { areas: ["members"] })).status, 200);

    const owner = await api("GET", "/api/gym/templates", tokens.gymA);
    assert.equal(owner.status, 200, JSON.stringify(owner.json));
    assert.deepEqual(owner.json, { templates: empty, canEdit: true });
    // Staff read them (Send Reminder is used from Members), even with only Members, but can't edit
    for (const tag of ["staffAll", "staffNone"]) {
      const staff = await api("GET", "/api/gym/templates", tokens[tag]);
      assert.equal(staff.status, 200, `${tag}: ${JSON.stringify(staff.json)}`);
      assert.deepEqual(staff.json, { templates: empty, canEdit: false });
    }
  }));

  it("2. no session, a member and a Super Admin are refused", run(async () => {
    assert.equal((await api("GET", "/api/gym/templates", null)).status, 401);
    assert.equal((await api("PUT", "/api/gym/templates/due", null, { text: due })).status, 401);
    assert.equal((await api("GET", "/api/gym/templates", "jfs_not-a-real-token")).status, 401);
    for (const tag of ["member", "admin"]) {
      assert.equal((await api("GET", "/api/gym/templates", tokens[tag])).status, 403, tag);
      assert.equal((await api("PUT", "/api/gym/templates/due", tokens[tag], { text: due })).status, 403, tag);
    }
  }));

  it("3. the gym admin rewords a template, again, and the change is audited", run(async () => {
    const saved = await api("PUT", "/api/gym/templates/due", tokens.gymA, { text: `  ${due}  ` });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.templates, { ...empty, due });
    const again = await api("PUT", "/api/gym/templates/due", tokens.gymA, { text: "Hi {name}, please clear {amount} soon." });
    assert.equal(again.status, 200);
    assert.equal(again.json.templates.due, "Hi {name}, please clear {amount} soon.");
    const [rows] = await connection.query("SELECT body, updated_by FROM gym_reminder_templates WHERE gym_id = ?", [state.gymA]);
    assert.deepEqual(rows, [{ body: "Hi {name}, please clear {amount} soon.", updated_by: identities.gymA.id }], "one row per branch and kind");
    const [audit] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE admin_id = ? AND action = 'gym.template_edit'", [identities.gymA.id]);
    assert.equal(audit[0].n, 2);
    // Staff now read the branch's wording
    assert.equal((await api("GET", "/api/gym/templates", tokens.staffNone)).json.templates.due, "Hi {name}, please clear {amount} soon.");
  }));

  it("4. Staff can't reword or reset, with every area or none", run(async () => {
    for (const tag of ["staffAll", "staffNone"]) {
      const put = await api("PUT", "/api/gym/templates/expiry", tokens[tag], { text: "Hi {name}, renew by {date}." });
      assert.equal(put.status, 403, tag);
      assert.match(put.json.error, /Only the gym admin/);
      assert.equal((await api("DELETE", "/api/gym/templates/due", tokens[tag])).status, 403, tag);
    }
    const [rows] = await connection.query("SELECT kind FROM gym_reminder_templates WHERE gym_id = ?", [state.gymA]);
    assert.deepEqual(rows.map((r) => r.kind), ["due"], "nothing changed");
  }));

  it("5. bad kinds, texts and bodies are 400s (or 413), and change nothing", run(async () => {
    const cases = [
      ["/api/gym/templates/invoice", { text: due }, /isn't one of the reminder templates/],
      ["/api/gym/templates/birthday", { text: "Happy birthday {name}!" }, /isn't one of/],
      [`/api/gym/templates/${encodeURIComponent("due' OR '1'='1")}`, { text: due }, /isn't one of/],
      ["/api/gym/templates/enquiry", { text: "Hi {name}, you owe {amount}." }, /\{amount\} isn't a placeholder/],
      ["/api/gym/templates/expiry", { text: "Hi {name, renew soon please." }, /missing its/],
      ["/api/gym/templates/expiry", { text: "short" }, /at least 10/],
      ["/api/gym/templates/expiry", { text: "a".repeat(301) }, /300 characters/],
      ["/api/gym/templates/expiry", { text: "Hello there friend", kind: "due" }, /Send the template's text/],
      ["/api/gym/templates/expiry", { text: 42 }, /Send the template's text/],
      ["/api/gym/templates/expiry", { text: "Hi\u0000 there friend" }, /characters we can't send/],
    ];
    for (const [route, payload, pattern] of cases) {
      const answer = await api("PUT", route, tokens.gymA, payload);
      assert.equal(answer.status, 400, `${route} ${JSON.stringify(payload).slice(0, 60)}: ${JSON.stringify(answer.json)}`);
      assert.match(answer.json.error, pattern);
    }
    const huge = await api("PUT", "/api/gym/templates/expiry", tokens.gymA, undefined, JSON.stringify({ text: "x".repeat(6000) }));
    assert.equal(huge.status, 413);
    assert.equal((await api("PUT", "/api/gym/templates/expiry", tokens.gymA, undefined, "{not json")).status, 400);
    // The router is strict and case-sensitive
    assert.equal((await api("GET", "/api/gym/Templates", tokens.gymA)).status, 404);
    assert.equal((await api("PUT", "/api/gym/templates/due/", tokens.gymA, { text: due })).status, 404);
    // SQL and markup are stored as plain text
    const sql = "Hi {name}'; DROP TABLE gym_members; -- <b>x</b>";
    const stored = await api("PUT", "/api/gym/templates/expired", tokens.gymA, { text: sql });
    assert.equal(stored.status, 200);
    assert.equal(stored.json.templates.expired, sql);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gym_members'");
    assert.equal(n, 1);
    const [rows] = await connection.query("SELECT kind FROM gym_reminder_templates WHERE gym_id = ? ORDER BY kind", [state.gymA]);
    assert.deepEqual(rows.map((r) => r.kind).sort(), ["due", "expired"]);
  }));

  it("6. each branch has its own: gym B sees defaults and its changes never touch gym A", run(async () => {
    const other = await api("GET", "/api/gym/templates", tokens.gymB);
    assert.deepEqual(other.json, { templates: empty, canEdit: true });
    assert.equal((await api("DELETE", "/api/gym/templates/due", tokens.gymB)).status, 200, "a reset with nothing saved is fine");
    assert.equal((await api("PUT", "/api/gym/templates/due", tokens.gymB, { text: "Just Fit says hi {name}, pay {amount}." })).status, 200);
    const mine = await api("GET", "/api/gym/templates", tokens.gymA);
    assert.equal(mine.json.templates.due, "Hi {name}, please clear {amount} soon.");
  }));

  it("7. Reset to default removes the branch's wording and audits it", run(async () => {
    const before = (await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE admin_id = ? AND action = 'gym.template_edit'", [identities.gymA.id]))[0][0].n;
    const reset = await api("DELETE", "/api/gym/templates/due", tokens.gymA);
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    assert.equal(reset.json.templates.due, null);
    assert.equal((await api("DELETE", "/api/gym/templates/due", tokens.gymA)).status, 200, "resetting twice is harmless");
    const after = (await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE admin_id = ? AND action = 'gym.template_edit'", [identities.gymA.id]))[0][0].n;
    assert.equal(after, before + 1, "only the reset that removed something is audited");
    assert.equal((await api("DELETE", "/api/gym/templates/nope", tokens.gymA)).status, 400);
  }));
});
