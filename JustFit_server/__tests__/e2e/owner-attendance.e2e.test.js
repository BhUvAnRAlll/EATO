// QR attendance end to end: test accounts in justfit_test against the real Express server and
// the isolated `justfit_test` database. Covers the member's pass (their own, short-lived, unforgeable),
// verification and every refusal (bad code, expired, another gym's member, pending, suspended,
// expired package, already in), each recorded as a failed scan; checking in (once, even when two
// check-ins race); who may scan (owner and admins, never members); the check-out QR
// (switch, regenerate, members checking themselves out); staff check-out; and the counts and lists.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

const CLEANUP_TABLES = ["gym_visits", "gym_scan_failures", "gym_member_plans", "whatsapp_agent_settings", "whatsapp_connections", "gym_members", "gym_notices", "gym_assistant_questions", "gyms"];

describe("owner attendance e2e: passes, check-in, check-out and the front desk lists", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const ids = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const as = (tag) => ({
    get: (route) => api("GET", route, tokens[tag]),
    post: (route, body) => api("POST", route, tokens[tag], body),
    patch: (route, body) => api("PATCH", route, tokens[tag], body),
  });
  const newIdentity = async (tag, role) => {
    const identity = await testAccounts.createIdentity(runId, tag, { role });
    const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const passOf = async (tag) => {
    const res = await as(tag).get("/api/owner/me/pass");
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return res.json.pass;
  };
  const failures = async () => (await connection.query("SELECT reason, user_id FROM gym_scan_failures WHERE gym_id = ? ORDER BY created_at, id", [state.gym]))[0];
  const visitsOf = async (tag) => (await connection.query("SELECT id, checked_out_at, checkout_method FROM gym_visits WHERE gym_id = ? AND user_id = ?", [state.gym, ids[tag]]))[0];
  const route = (path) => `/api/owner/gyms/${state.gym}${path}`;

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const tag of ["owner", "admin", "regular", "member", "pending", "suspended", "lapsed", "other"]) await newIdentity(tag);
      await newIdentity("platform", "admin");
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    for (const tag of Object.keys(ids)) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user') ON DUPLICATE KEY UPDATE email = VALUES(email), full_name = VALUES(full_name), role = IF(role = 'user', VALUES(role), role)", [ids[tag], identities[tag].emailAddress, `${tag[0].toUpperCase()}${tag.slice(1)} Person`]);
    }
    const created = await as("platform").post("/api/gyms", { name: `Attendance Gym ${runId}`, ownerEmail: identities.owner.emailAddress });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    state.gym = created.json.gym.id;
    const other = await as("platform").post("/api/gyms", { name: `Other Gym ${runId}`, ownerEmail: identities.other.emailAddress });
    state.otherGym = other.json.gym.id;
    const add = (tag, role, status = "active") => connection.query(
      "INSERT INTO gym_members (gym_id, user_id, role, status, requested_at, joined_at) VALUES (?, ?, ?, ?, NOW(), IF(? = 'active', NOW(), NULL))",
      [state.gym, ids[tag], role, status, status],
    );
    await add("admin", "admin");
    await add("regular", "member");
    await add("member", "member");
    await add("pending", "member", "pending");
    await add("suspended", "member", "suspended");
    await add("lapsed", "member");
    await connection.query(
      "INSERT INTO gym_member_plans (gym_id, user_id, plan_name, status, starts_on, ends_on) VALUES (?, ?, 'Standard', 'active', CURDATE() - INTERVAL 40 DAY, CURDATE() - INTERVAL 2 DAY), (?, ?, 'Unlimited', 'active', CURDATE() - INTERVAL 20 DAY, CURDATE() + INTERVAL 5 DAY)",
      [state.gym, ids.lapsed, state.gym, ids.member],
    );
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of CLEANUP_TABLES) await connection.query("DELETE FROM `" + table + "`");
        await db.deleteUsers(connection, Object.values(ids));
      } catch (error) { problems.push(`rows: ${error.code}`); }
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

  const test = (name, fn) => it(name, async (t) => { if (skipReason) return t.skip(skipReason); await fn(); });

  test("1. every attendance route needs a valid session", async () => {
    for (const [method, path] of [["GET", "/api/owner/me/pass"], ["GET", "/api/owner/me/visit"], ["POST", "/api/owner/me/checkout"],
      ["POST", route("/attendance/verify")], ["POST", route("/attendance/checkin")], ["GET", route("/attendance/today")], ["GET", route("/checkout-qr")]]) {
      assert.equal((await api(method, path, null, method === "POST" ? { code: "x" } : undefined)).status, 401, path);
    }
  });

  test("2. a pass is the caller's own and short-lived; the front desk sees who it names", async () => {
    const res = await as("member").get("/api/owner/me/pass");
    assert.match(res.json.pass, new RegExp(`^JF1\\.${ids.member}\\.\\d+\\.`));
    const seconds = (new Date(res.json.expiresAt).getTime() - Date.now()) / 1000;
    assert.ok(seconds > 100 && seconds <= 121, `about two minutes: ${seconds}`);
    const verified = await as("owner").post(route("/attendance/verify"), { code: res.json.pass });
    assert.equal(verified.status, 200, JSON.stringify(verified.json));
    assert.equal(verified.json.eligible, true);
    assert.equal(verified.json.member.member.id, ids.member);
    assert.equal(verified.json.member.plan.name, "Unlimited");
    assert.equal(verified.json.renewalWarning, true, "the package ends this week");
    assert.equal(Object.hasOwn(verified.json.member.member, "email"), false);
    assert.equal((await failures()).length, 0, "an eligible scan isn't a failure");
  });

  test("3. every refusal is explained and recorded as a failed scan", async () => {
    const verify = (code) => as("owner").post(route("/attendance/verify"), { code });
    const forged = (await passOf("member")).replace(/\.[^.]+$/, ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const expired = `JF1.${ids.member}.1700000000.${"A".repeat(43)}`;
    const cases = [
      ["hello", "invalid"], [forged, "invalid"], [expired, "invalid"], ["' OR 1=1 --", "invalid"],
      [await passOf("other"), "not_member"], [await passOf("pending"), "inactive"], [await passOf("suspended"), "inactive"], [await passOf("lapsed"), "inactive"],
    ];
    for (const [code, reason] of cases) {
      const res = await verify(code);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.equal(res.json.eligible, false, code);
      assert.equal(res.json.reason, reason, code);
      assert.ok(res.json.message);
    }
    const notMember = await verify(await passOf("other"));
    assert.equal(notMember.json.member, null, "someone from another gym stays anonymous here");
    const lapsed = await verify(await passOf("lapsed"));
    assert.equal(lapsed.json.member.plan.name, "Standard", "the desk sees why: the package expired");
    const recorded = await failures();
    assert.equal(recorded.length, cases.length + 2);
    assert.deepEqual(recorded.slice(0, 4).map((f) => [f.reason, f.user_id]), Array(4).fill(["invalid", null]));
    assert.equal(recorded.find((f) => f.reason === "not_member").user_id, null, "no link to another gym's member");
    for (const body of [{}, { code: "" }, { code: 7 }, { code: "x", extra: 1 }, []]) assert.equal((await as("owner").post(route("/attendance/verify"), body)).status, 400, JSON.stringify(body));
  });

  test("4. only the owner, gym admins and platform admins run the front desk", async () => {
    const code = await passOf("member");
    for (const tag of ["regular", "member", "pending"]) {
      assert.equal((await as(tag).post(route("/attendance/verify"), { code })).status, 403, tag);
      assert.equal((await as(tag).post(route("/attendance/checkin"), { code })).status, 403, tag);
      assert.equal((await as(tag).get(route("/attendance/today"))).status, 403, tag);
      assert.equal((await as(tag).get(route("/checkout-qr"))).status, 403, tag);
    }
    assert.equal((await as("other").post(route("/attendance/checkin"), { code })).status, 403, "another gym's owner");
    assert.equal((await visitsOf("member")).length, 0);
  });

  test("5. checking in happens once, even when two check-ins race", async () => {
    const code = await passOf("member");
    const [a, b] = await Promise.all([as("owner").post(route("/attendance/checkin"), { code }), as("admin").post(route("/attendance/checkin"), { code })]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409], JSON.stringify([a.json, b.json]));
    assert.equal((await visitsOf("member")).length, 1);
    const again = await as("owner").post(route("/attendance/checkin"), { code: await passOf("member") });
    assert.equal(again.status, 409);
    assert.match(again.json.error, /Already checked in/);
    const verifyAgain = await as("owner").post(route("/attendance/verify"), { code: await passOf("member") });
    assert.equal(verifyAgain.json.reason, "already_in");
    // Refused check-ins are refused at the check-in step too, not only at verification
    assert.equal((await as("owner").post(route("/attendance/checkin"), { code: await passOf("lapsed") })).status, 409);
    assert.equal((await as("owner").post(route("/attendance/checkin"), { code: "junk" })).status, 409);
    assert.equal((await visitsOf("lapsed")).length, 0);
    // The member sees their session
    const mine = await as("member").get("/api/owner/me/visit");
    assert.equal(mine.json.visit.gym.id, state.gym);
  });

  test("6. the Check-in tab and today's list show who's in, with counts", async () => {
    const res = await as("owner").get(route("/attendance/today"));
    assert.equal(res.status, 200);
    assert.equal(res.json.counts.inNow, 1);
    assert.equal(res.json.counts.checkinsToday, 1);
    assert.equal(res.json.counts.completedToday, 0);
    assert.ok(res.json.counts.failedToday >= 10);
    assert.deepEqual(res.json.inNow.map((v) => v.member.id), [ids.member]);
    assert.ok(res.json.activity.some((a) => a.kind === "in" && a.member.id === ids.member));
    assert.ok(res.json.activity.some((a) => a.kind === "failed" && a.reason === "invalid"));
    assert.deepEqual((await as("admin").get(route("/attendance/visits?filter=in"))).json.visits.map((v) => v.member.id), [ids.member]);
    assert.deepEqual((await as("admin").get(route("/attendance/visits?filter=out"))).json.visits, []);
    assert.deepEqual((await as("admin").get(route("/attendance/visits?search=Member"))).json.visits.length, 1);
    assert.deepEqual((await as("admin").get(route("/attendance/visits?search=%25"))).json.visits, [], "% is a literal, not a wildcard");
    assert.equal((await as("admin").get(route("/attendance/visits?filter=everyone"))).status, 400);
    const visit = res.json.inNow[0];
    const detail = await as("owner").get(route(`/attendance/visits/${visit.id}`));
    assert.equal(detail.json.visit.checkedInBy, "Owner Person");
    assert.equal((await as("owner").get(route(`/attendance/visits/${crypto.randomUUID()}`))).status, 404);
    assert.equal((await as("other").get(`/api/owner/gyms/${state.otherGym}/attendance/visits/${visit.id}`)).status, 404, "another gym can't read this visit");
  });

  test("7. the check-out QR: made on first use, switched off and on, regenerated; members check themselves out", async () => {
    const qr = await as("owner").get(route("/checkout-qr"));
    assert.equal(qr.status, 200);
    assert.equal(qr.json.enabled, true);
    assert.match(qr.json.qrText, /^JUSTFIT-OUT-[A-HJ-NP-Z2-9]{12}$/);
    assert.equal((await as("admin").get(route("/checkout-qr"))).json.code, qr.json.code, "the same code until regenerated");

    assert.equal((await as("owner").patch(route("/checkout-qr"), { enabled: false })).json.enabled, false);
    const off = await as("member").post("/api/owner/me/checkout", { code: qr.json.qrText });
    assert.equal(off.status, 409);
    assert.match(off.json.error, /switched off/);
    for (const body of [{ enabled: "no" }, {}, { enabled: true, code: "x" }]) assert.equal((await as("owner").patch(route("/checkout-qr"), body)).status, 400);
    await as("owner").patch(route("/checkout-qr"), { enabled: true });

    const rotated = await as("owner").post(route("/checkout-qr/rotate"));
    assert.notEqual(rotated.json.code, qr.json.code);
    assert.equal((await as("member").post("/api/owner/me/checkout", { code: qr.json.qrText })).status, 400, "the old code stops working");
    assert.equal((await as("member").post("/api/owner/me/checkout", { code: "JUSTFIT-OUT-ZZZZZZZZZZZZ" })).status, 400);
    assert.equal((await as("member").post("/api/owner/me/checkout", { code: "not a code" })).status, 400);
    assert.equal((await as("regular").post("/api/owner/me/checkout", { code: rotated.json.qrText })).status, 409, "not checked in");

    const out = await as("member").post("/api/owner/me/checkout", { code: rotated.json.qrText });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    assert.equal(out.json.gym.id, state.gym);
    const [visit] = await visitsOf("member");
    assert.equal(visit.checkout_method, "qr");
    assert.equal((await as("member").get("/api/owner/me/visit")).json.visit, null);
    assert.equal((await as("member").post("/api/owner/me/checkout", { code: rotated.json.qrText })).status, 409, "checking out twice");
    assert.equal((await as("owner").get(route("/checkout-qr"))).json.checkoutsToday, 1);
    assert.equal((await as("owner").get(route("/attendance/today"))).json.counts.completedToday, 1);
  });

  test("8. staff can end a visit once; the member can check in again after leaving", async () => {
    const checkedIn = await as("owner").post(route("/attendance/checkin"), { code: await passOf("member") });
    assert.equal(checkedIn.status, 201, JSON.stringify(checkedIn.json));
    const id = checkedIn.json.visit.id;
    assert.equal((await as("regular").post(route(`/attendance/visits/${id}/checkout`))).status, 403);
    const ended = await as("admin").post(route(`/attendance/visits/${id}/checkout`));
    assert.equal(ended.status, 200);
    assert.equal(ended.json.visit.checkoutMethod, "staff");
    assert.equal(ended.json.visit.checkedOutBy, "Admin Person");
    assert.equal((await as("admin").post(route(`/attendance/visits/${id}/checkout`))).status, 409);
    assert.equal((await visitsOf("member")).length, 2, "two visits today, both ended");
  });
});
