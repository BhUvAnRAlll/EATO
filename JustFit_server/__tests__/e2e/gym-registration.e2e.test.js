// Gym registration and approval end to end (Gym Hub ecosystem phase 1, 2026-11-09): test accounts in
// justfit_test against the real Express server. A member registers a gym, adds documents and
// submits; the Super Admin reviews, asks for documents, approves (the applicant becomes its gym
// admin), suspends (portal and check-ins closed, gone from Discover) and reactivates. Attack paths:
// no session, someone else's application, a team account applying, two open applications, editing
// while in review, submitting with things missing, a non-admin deciding, a decision from the wrong
// state or without a reason, a fake document, another applicant's documents, unapproved and
// unpublished gyms in Discover.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n").toString("base64");

describe("gym registration e2e: a member applies, justFit reviews, only approved gyms reach members", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts, documentDir;
  const identities = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const type = response.headers.get("content-type") ?? "";
    let json = null;
    let bytes = null;
    if (type.includes("json")) json = await response.json().catch(() => null);
    else bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, json, bytes, type };
  };
  const run = (fn) => async (t) => {
    if (skipReason) return t.skip(skipReason);
    try { await fn(); } catch (error) { error.message += `\nserver log: ${(server?.logs ?? []).slice(-4).join(" | ")}`; throw error; }
  };
  const decide = (gymId, action, note, token = tokens.admin) => api("POST", `/api/admin/portal/gyms/${gymId}/decision`, token, note === undefined ? { action } : { action, note });

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    documentDir = await fs.mkdtemp(path.join(os.tmpdir(), "justfit-gym-docs-"));
    server = await startTestServer({ ...env, GYM_DOCUMENT_DIR: documentDir });
    try {
      for (const [tag, role] of [["admin", "admin"], ["applicant", "user"], ["other", "user"], ["trainer", "trainer"], ["member", "user"]]) {
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
        const all = Object.values(identities).map((i) => i.id);
        const [brands] = await connection.query("SELECT id FROM gym_brands WHERE applicant_id IN (?) OR created_by IN (?)", [all, all]);
        const brandIds = brands.map((b) => b.id);
        if (brandIds.length) {
          const [gyms] = await connection.query("SELECT id FROM gyms WHERE brand_id IN (?)", [brandIds]);
          const gymIds = gyms.map((g) => g.id);
          if (gymIds.length) {
            for (const table of ["gym_status_history", "gym_documents", "gym_photos", "gym_activity_log", "gym_attendance", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
            await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          }
          await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brandIds]);
        }
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
    if (documentDir) await fs.rm(documentDir, { recursive: true, force: true });
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. who may start an application, and only one at a time", run(async () => {
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await api("GET", "/api/gym-registration", token)).status, 401);
    const empty = await api("GET", "/api/gym-registration", tokens.applicant);
    assert.equal(empty.status, 200, JSON.stringify(empty.json));
    assert.equal(empty.json.canStart, true);
    assert.equal(empty.json.current, null);

    const body = { gymName: "Iron House", area: "Indiranagar", city: "Bengaluru" };
    assert.equal((await api("POST", "/api/gym-registration", tokens.trainer, body)).status, 403, "a team account can't apply");
    assert.equal((await api("POST", "/api/gym-registration", tokens.admin, body)).status, 403);
    for (const bad of [{ ...body, status: "approved" }, { ...body, applicantId: identities.other.id }, { area: "x", city: "y" }, { ...body, gymName: "x".repeat(200) }]) {
      assert.equal((await api("POST", "/api/gym-registration", tokens.applicant, bad)).status, 400, JSON.stringify(bad));
    }
    const made = await api("POST", "/api/gym-registration", tokens.applicant, body);
    assert.equal(made.status, 201, JSON.stringify(made.json));
    state.gym = made.json.id;
    assert.equal(made.json.status, "draft");
    assert.equal(made.json.canSubmit, true);
    assert.ok(made.json.missing.length > 0);
    assert.equal((await api("POST", "/api/gym-registration", tokens.applicant, body)).status, 409, "one open application at a time");
    const [[row]] = await connection.query("SELECT g.status, b.applicant_id FROM gyms g JOIN gym_brands b ON b.id = g.brand_id WHERE g.id = ?", [state.gym]);
    assert.deepEqual({ ...row }, { status: "draft", applicant_id: identities.applicant.id });
  }));

  it("2. nobody else reads or changes it, and it can't be submitted half done", run(async () => {
    for (const [method, route] of [["GET", ""], ["PATCH", ""], ["POST", "/submit"], ["GET", "/documents/1"]]) {
      const r = await api(method, `/api/gym-registration/${state.gym}${route}`, tokens.other, method === "PATCH" ? { about: "Mine now" } : undefined);
      assert.equal(r.status, 404, `${method} ${route}`);
    }
    assert.equal((await api("GET", "/api/gym-registration/1%20OR%201=1", tokens.applicant)).status, 400);
    const early = await api("POST", `/api/gym-registration/${state.gym}/submit`, tokens.applicant);
    assert.equal(early.status, 400);
    assert.match(early.json.error, /address proof/);
  }));

  it("3. the applicant fills it in, adds a document and submits; it is then locked", run(async () => {
    const filled = await api("PATCH", `/api/gym-registration/${state.gym}`, tokens.applicant, {
      legalName: "Iron House Fitness LLP", businessType: "llp", contactName: "Ravi Kumar", contactPhone: "9845012345", contactEmail: "ravi@ironhouse.in",
      address: "12, 80 Feet Road", state: "Karnataka", pincode: "560038", latitude: 12.9719, longitude: 77.6412,
      about: "Strength and conditioning gym.", facilities: ["cardio", "parking"],
      hours: { mon: [["06:00", "22:00"]], tue: [["06:00", "22:00"]], wed: [["06:00", "22:00"]], thu: [["06:00", "22:00"]], fri: [["06:00", "22:00"]], sat: [["07:00", "13:00"]], sun: [] },
    });
    assert.equal(filled.status, 200, JSON.stringify(filled.json));
    assert.deepEqual(filled.json.missing.map((m) => m.text), ["An address proof"]);

    const fake = await api("POST", `/api/gym-registration/${state.gym}/documents`, tokens.applicant, { kind: "address", data: Buffer.from("<script>").toString("base64"), mediaType: "application/pdf" });
    assert.equal(fake.status, 415);
    assert.equal((await api("POST", `/api/gym-registration/${state.gym}/documents`, tokens.other, { kind: "address", data: PDF, mediaType: "application/pdf" })).status, 404);
    const doc = await api("POST", `/api/gym-registration/${state.gym}/documents`, tokens.applicant, { kind: "address", data: PDF, mediaType: "application/pdf" });
    assert.equal(doc.status, 201, JSON.stringify(doc.json));
    state.doc = doc.json.documents[0].id;
    assert.deepEqual(doc.json.missing, []);

    const read = await api("GET", `/api/gym-registration/${state.gym}/documents/${state.doc}`, tokens.applicant);
    assert.equal(read.status, 200);
    assert.equal(read.type, "application/pdf");
    assert.match(read.bytes.toString(), /^%PDF-/);
    assert.equal((await api("GET", `/api/gym-registration/${state.gym}/documents/${state.doc}`, tokens.other)).status, 404);

    const sent = await api("POST", `/api/gym-registration/${state.gym}/submit`, tokens.applicant);
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.equal(sent.json.status, "submitted");
    assert.equal(sent.json.canEdit, false);
    assert.equal((await api("PATCH", `/api/gym-registration/${state.gym}`, tokens.applicant, { about: "Changed" })).status, 409);
    assert.equal((await api("POST", `/api/gym-registration/${state.gym}/documents`, tokens.applicant, { kind: "other", data: PDF, mediaType: "application/pdf" })).status, 409);
    assert.equal((await api("POST", `/api/gym-registration/${state.gym}/submit`, tokens.applicant)).status, 409);
  }));

  it("4. only a justFit admin decides; reasons are required; steps follow the states", run(async () => {
    for (const tag of ["applicant", "other", "trainer"]) assert.equal((await decide(state.gym, "approve", undefined, tokens[tag])).status, 403, tag);
    const list = await api("GET", "/api/admin/portal/gyms?status=review", tokens.admin);
    assert.equal(list.status, 200, JSON.stringify(list.json));
    assert.ok(list.json.gyms.some((g) => g.id === state.gym && g.status === "submitted"));
    assert.ok(list.json.counts.review >= 1);
    assert.equal((await api("GET", "/api/admin/portal/gyms?status=bogus", tokens.admin)).status, 400);

    const app = await api("GET", `/api/admin/portal/gyms/${state.gym}/application`, tokens.admin);
    assert.equal(app.status, 200, JSON.stringify(app.json));
    assert.equal(app.json.applicant.id, identities.applicant.id);
    assert.equal(app.json.contactPhone, "9845012345");
    assert.ok(app.json.actions.includes("approve"));
    const doc = await api("GET", `/api/admin/portal/gyms/${state.gym}/documents/${state.doc}`, tokens.admin);
    assert.equal(doc.status, 200);
    assert.equal((await api("GET", `/api/admin/portal/gyms/${state.gym}/documents/${state.doc}`, tokens.other)).status, 403);

    assert.equal((await decide(state.gym, "reject")).status, 400, "rejecting needs a reason");
    assert.equal((await decide(state.gym, "suspend", "Not approved yet")).status, 409, "only an approved gym is suspended");
    assert.equal((await decide(state.gym, "submit")).status, 400, "the applicant's step");
    const reviewing = await decide(state.gym, "start_review");
    assert.equal(reviewing.status, 200, JSON.stringify(reviewing.json));
    assert.equal(reviewing.json.status, "pending_review");
    const asked = await decide(state.gym, "request_documents", "Please add the shop licence as well.");
    assert.equal(asked.status, 200);
    assert.equal(asked.json.status, "draft");

    const mine = await api("GET", "/api/gym-registration", tokens.applicant);
    assert.equal(mine.json.current.status, "draft");
    assert.equal(mine.json.current.statusNote, "Please add the shop licence as well.");
    assert.equal(mine.json.current.history[0].by, "justFit", "the applicant never sees an admin's name");
    const again = await api("POST", `/api/gym-registration/${state.gym}/documents`, tokens.applicant, { kind: "registration", data: PDF, mediaType: "application/pdf" });
    assert.equal(again.status, 201);
    assert.equal((await api("POST", `/api/gym-registration/${state.gym}/submit`, tokens.applicant)).status, 200);
  }));

  it("5. approving makes the applicant the gym's admin; members see it only once published", run(async () => {
    const approved = await decide(state.gym, "approve", "Welcome to justFit.");
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    assert.equal(approved.json.status, "approved");
    const [[user]] = await connection.query("SELECT role FROM users WHERE id = ?", [identities.applicant.id]);
    assert.equal(user.role, "gym_admin");
    const [[link]] = await connection.query("SELECT kind FROM gym_staff WHERE user_id = ? AND gym_id = ?", [identities.applicant.id, state.gym]);
    assert.equal(link.kind, "owner");
    assert.equal((await decide(state.gym, "approve")).status, 409, "approving twice");

    const portal = await api("GET", "/api/gym/dashboard", tokens.applicant);
    assert.equal(portal.status, 200, JSON.stringify(portal.json));

    // Approved but not published: not in Discover
    let found = await api("GET", "/api/gyms", tokens.member);
    assert.ok(!found.json.gyms.some((g) => g.id === state.gym));
    assert.equal((await api("GET", `/api/gyms/${state.gym}`, tokens.member)).status, 404);
    // Publishing through the portal needs a photo and a phone too; publish the profile as it is
    await connection.query("UPDATE gyms SET published_profile = JSON_OBJECT('about', about, 'facilities', COALESCE(facilities, JSON_ARRAY()), 'custom', JSON_ARRAY(), 'hours', opening_hours, 'closures', JSON_ARRAY(), 'contact', JSON_OBJECT('address', address, 'phone', phone), 'photos', NULL, 'show', NULL), published_at = NOW(3) WHERE id = ?", [state.gym]);
    found = await api("GET", "/api/gyms", tokens.member);
    assert.ok(found.json.gyms.some((g) => g.id === state.gym), "approved and published");
    assert.equal((await api("GET", `/api/gyms/${state.gym}`, tokens.member)).status, 200);

    const [[audited]] = await connection.query("SELECT COUNT(*) AS n FROM admin_audit_log WHERE target_type = 'gym' AND target_id = ? AND action = 'gym.approve'", [String(state.gym)]);
    assert.equal(audited.n, 1);
    const [history] = await connection.query("SELECT action FROM gym_status_history WHERE gym_id = ? ORDER BY id", [state.gym]);
    assert.deepEqual(history.map((h) => h.action), ["create", "submit", "start_review", "request_documents", "submit", "approve"]);
  }));

  it("6. suspending closes the portal and check-ins and hides it; reactivating opens them again", run(async () => {
    const made = await api("POST", "/api/gym/attendance/qr", tokens.applicant);
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const qr = made.json.qr.payload;
    const suspended = await decide(state.gym, "suspend", "Members reported the gym closed without notice.");
    assert.equal(suspended.status, 200, JSON.stringify(suspended.json));
    const portal = await api("GET", "/api/gym/dashboard", tokens.applicant);
    assert.equal(portal.status, 403);
    assert.equal(portal.json.suspended, true);
    assert.match(portal.json.error, /suspended/);
    assert.equal((await api("GET", `/api/gyms/${state.gym}`, tokens.member)).status, 404);
    const found = await api("GET", "/api/gyms", tokens.member);
    assert.ok(!found.json.gyms.some((g) => g.id === state.gym));

    const scan = await api("POST", "/api/attendance/scan", tokens.member, { qr });
    assert.equal(scan.status, 403);
    assert.match(scan.json.error, /closed on justFit/, "check-ins refused while suspended");

    const back = await decide(state.gym, "reactivate");
    assert.equal(back.status, 200);
    assert.equal(back.json.status, "approved");
    assert.equal((await api("GET", "/api/gym/dashboard", tokens.applicant)).status, 200);
    assert.equal((await api("GET", `/api/gyms/${state.gym}`, tokens.member)).status, 200);
    const again = await api("POST", "/api/attendance/scan", tokens.member, { qr });
    assert.doesNotMatch(again.json.error ?? "", /closed on justFit/, "reactivated: the usual membership check again");
  }));

  it("7. a rejected application can be fixed and sent again; a gym made by justFit starts approved", run(async () => {
    const other = await api("POST", "/api/gym-registration", tokens.other, { gymName: "Pulse", area: "Hebbal", city: "Bengaluru" });
    assert.equal(other.status, 201);
    await connection.query("UPDATE gyms SET status = 'submitted' WHERE id = ?", [other.json.id]);
    const rejected = await decide(other.json.id, "reject", "We couldn't verify the address.");
    assert.equal(rejected.status, 200);
    const mine = await api("GET", "/api/gym-registration", tokens.other);
    assert.equal(mine.json.current.status, "rejected");
    assert.equal(mine.json.current.canEdit, true);
    assert.equal(mine.json.canStart, true, "rejected isn't open");
    assert.equal((await api("PATCH", `/api/gym-registration/${other.json.id}`, tokens.other, { about: "Fixed" })).status, 200);

    const made = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name: "Zen", branch: "HSR", area: "HSR", city: "Bengaluru" });
    assert.equal(made.status, 201);
    assert.equal(made.json.gym.status, "approved");
  }));
});
