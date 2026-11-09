// The gym portal's SMS end to end (Send Bulk SMS, Auto Reminders, the member list's reminder,
// Message Logs, Super Admin credits): test accounts in justfit_test against the real Express
// server with the fake SMS provider (nothing real is sent). Attack paths: no session, the wrong
// role, another gym's member, unexpected fields (a gym id), SQL in ids and pages, sending with no
// credits, a provider failure (the credit goes back), a double run of the job (each reminder once),
// and sending switched off.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");
const gymSms = require("../../gym/sms.js");
const { createGymSmsSender } = require("../../gym/smsSender.js");

describe("gym SMS e2e: credits, reminders, manual sends and logs", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, pool, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();
  const phone = () => `9${String(crypto.randomInt(0, 1e9)).padStart(9, "0")}`;

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
    post: (route, body) => api("POST", route, tokens[tag], body ?? {}),
    patch: (route, body) => api("PATCH", route, tokens[tag], body),
  });
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const credits = async (gymId) => (await connection.query("SELECT sms_credits FROM gyms WHERE id = ?", [gymId]))[0][0].sms_credits;
  const outbox = () => {
    const file = path.join(server.outbox, "gym-sms.jsonl");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const admit = async (tag, fields) => {
    const r = await as(tag).post("/api/gym/members", { unit: "months", duration: 1, fee: 1000, paid: 1000, method: "cash", ...fields });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json.member;
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    pool = mysql.createPool({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectionLimit: 4, decimalNumbers: true });
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
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
          for (const table of ["gym_activity_log", "gym_sms_log", "gym_sms_settings", "gym_attendance", "gym_payments", "gym_enquiries", "gym_catalog_items", "gym_members", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
    if (pool) await pool.end();
    if (connection) await connection.end();
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms, their admins, and members due each kind of reminder", run(async () => {
    const a = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    state.gymA = a.json.gym.id;
    assert.equal(a.json.smsCredits, 0, "a new branch starts with no credits");
    const b = await as("admin").post("/api/admin/portal/gyms", { name: "Just Fit", branch: "Indiranagar", area: "Indiranagar", city: "Bengaluru" });
    state.gymB = b.json.gym.id;
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/staff`, { phone: identities.gymA.phone })).status, 201);
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/staff`, { phone: identities.gymB.phone })).status, 201);

    state.priya = await admit("gymA", { name: "Priya Sharma", phone: phone() });
    state.karthik = await admit("gymA", { name: "Karthik Raja", phone: phone() });
    state.sneha = await admit("gymA", { name: "Sneha Iyer", phone: phone(), fee: 1500, paid: 500, dueBy: rules.addDays(today, 7) });
    state.divya = await admit("gymA", { name: "Divya Menon", phone: phone(), dob: `${Number(today.slice(0, 4)) - 25}${today.slice(4)}` });
    state.nophone = await admit("gymA", { name: "No Phone" });
    state.bob = await admit("gymB", { name: "Bob at B", phone: phone() });
    // Plan ends: Priya and No Phone tomorrow, Karthik three days ago, the rest well ahead
    await connection.query("UPDATE gym_members SET expires_on = ? WHERE id IN (?)", [rules.addDays(today, 1), [state.priya.id, state.nophone.id]]);
    await connection.query("UPDATE gym_members SET expires_on = ? WHERE id = ?", [rules.addDays(today, -3), state.karthik.id]);
    await connection.query("UPDATE gym_members SET expires_on = ? WHERE id IN (?)", [rules.addDays(today, 40), [state.sneha.id, state.divya.id]]);
  }));

  it("2. SMS routes need a session and a gym admin", run(async () => {
    for (const token of [null, "not-a-token"]) assert.equal((await api("GET", "/api/gym/sms", token)).status, 401);
    for (const tag of ["member", "admin"]) {
      assert.equal((await as(tag).get("/api/gym/sms")).status, 403, `${tag} is refused`);
      assert.equal((await as(tag).post("/api/gym/sms/send", { group: "due" })).status, 403);
    }
    // Only justFit admins add credits
    assert.equal((await as("gymA").post(`/api/admin/portal/gyms/${state.gymA}/sms-credits`, { credits: 100 })).status, 403);
    assert.equal((await api("POST", `/api/admin/portal/gyms/${state.gymA}/sms-credits`, null, { credits: 100 })).status, 401);
    assert.equal(await credits(state.gymA), 0);
  }));

  it("3. the overview: no credits, everything off, previews and group sizes", run(async () => {
    const r = await as("gymA").get("/api/gym/sms");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.credits, 0);
    assert.equal(r.json.sending, true, "the fake provider is on in tests");
    assert.deepEqual(r.json.reminders.map((x) => [x.kind, x.on]), [["expiry", false], ["expired", false], ["due", false], ["birthday", false]]);
    assert.equal(r.json.reminders[0].title, "Membership Expiry Reminder");
    assert.match(r.json.reminders[0].preview, /^Hi Priya, your membership at Forma Tumkur ends on/);
    // No Phone is left out: nobody to text
    assert.deepEqual(Object.fromEntries(r.json.groups.map((g) => [g.id, g.count])), { expiring: 1, expired: 1, due: 1, birthday: 1 });
  }));

  it("4. with no credits nothing is sent and nothing is written", run(async () => {
    const send = await as("gymA").post("/api/gym/sms/send", { group: "due" });
    assert.equal(send.status, 409);
    assert.match(send.json.error, /no SMS credits/);
    assert.equal((await as("gymA").post(`/api/gym/members/${state.karthik.id}/sms`, { kind: "expired" })).status, 409);
    assert.equal(await count("gym_sms_log", "gym_id = ?", [state.gymA]), 0);
    assert.equal(outbox().length, 0);
  }));

  it("5. the Super Admin adds credits (checked and audited)", run(async () => {
    const admin = as("admin");
    for (const bad of [{ credits: 0 }, { credits: "50" }, { credits: 100001 }, { credits: 5, gymId: state.gymB }]) {
      assert.equal((await admin.post(`/api/admin/portal/gyms/${state.gymA}/sms-credits`, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await admin.post("/api/admin/portal/gyms/999999/sms-credits", { credits: 5 })).status, 404);
    const r = await admin.post(`/api/admin/portal/gyms/${state.gymA}/sms-credits`, { credits: 3 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.smsCredits, 3);
    assert.equal(await credits(state.gymB), 0, "only that branch");
    assert.equal(await count("admin_audit_log", "admin_id = ? AND action = 'gym.sms_credits' AND target_id = ?", [identities.admin.id, String(state.gymA)]), 1);
  }));

  it("6. Manual Send to a group: one credit per SMS, logged, the right message", run(async () => {
    const gym = as("gymA");
    for (const bad of [{}, { group: "everyone" }, { group: "due", gymId: state.gymB }, { group: "due' OR 1=1 --" }]) {
      assert.equal((await gym.post("/api/gym/sms/send", bad)).status, 400, JSON.stringify(bad));
    }
    const r = await gym.post("/api/gym/sms/send", { group: "due" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { sent: 1, failed: 0, skipped: 0, credits: 2 });
    const [sent] = outbox();
    assert.equal(sent.phone, state.sneha.phone.slice(3));
    assert.equal(sent.kind, "due");
    assert.deepEqual(sent.values, ["Sneha", "1,000", "Forma Tumkur", state.sneha.code]);
    const [[log]] = await connection.query("SELECT kind, source, status, credits, sent_by, auto_key FROM gym_sms_log WHERE gym_id = ?", [state.gymA]);
    assert.deepEqual({ ...log }, { kind: "due", source: "manual", status: "sent", credits: 1, sent_by: identities.gymA.id, auto_key: null });
  }));

  it("7. one member's reminder: own gym only, a phone, something owed for a due reminder", run(async () => {
    const gym = as("gymA");
    const r = await gym.post(`/api/gym/members/${state.karthik.id}/sms`, { kind: "expired" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { sent: 1, credits: 1 });
    assert.equal(outbox().at(-1).kind, "expired");
    assert.equal((await gym.post(`/api/gym/members/${state.bob.id}/sms`, { kind: "expiry" })).status, 404, "another gym's member");
    assert.equal((await gym.post(`/api/gym/members/${state.nophone.id}/sms`, { kind: "expiry" })).status, 409, "no phone");
    assert.equal((await gym.post(`/api/gym/members/${state.priya.id}/sms`, { kind: "due" })).status, 409, "owes nothing");
    assert.equal((await gym.post("/api/gym/members/1%20OR%201=1/sms", { kind: "expiry" })).status, 400);
    assert.equal((await gym.post(`/api/gym/members/${state.priya.id}/sms`, { kind: "expiry", phone: "9000000000" })).status, 400, "no number from the app");
    assert.equal(await credits(state.gymA), 1, "refused sends cost nothing");
  }));

  it("8. a provider failure gives the credit back and is logged as failed", run(async () => {
    server.failSmsTo(state.priya.phone.slice(3));
    const r = await as("gymA").post(`/api/gym/members/${state.priya.id}/sms`, { kind: "expiry" });
    server.failSmsTo(state.priya.phone.slice(3), false);
    assert.equal(r.status, 502);
    assert.match(r.json.error, /credit was given back/);
    assert.equal(await credits(state.gymA), 1);
    const [[log]] = await connection.query("SELECT status, credits, error FROM gym_sms_log WHERE member_id = ? ORDER BY id DESC LIMIT 1", [state.priya.id]);
    assert.deepEqual({ ...log }, { status: "failed", credits: 0, error: "fake-failure" });
  }));

  it("9. running out part way: what can't be paid for is skipped", run(async () => {
    await connection.query("UPDATE gym_members SET due_amount = 500, due_by = ? WHERE id = ?", [rules.addDays(today, 5), state.priya.id]);
    const r = await as("gymA").post("/api/gym/sms/send", { group: "due" });
    await connection.query("UPDATE gym_members SET due_amount = 0, due_by = NULL WHERE id = ?", [state.priya.id]);
    assert.deepEqual(r.json, { sent: 1, failed: 0, skipped: 1, credits: 0 });
  }));

  it("10. Auto Reminders switches: checked, per branch", run(async () => {
    const gym = as("gymA");
    for (const bad of [{}, { expiry: "on" }, { weekly: true }, { expiry: true, gymId: state.gymB }]) {
      assert.equal((await gym.patch("/api/gym/sms/settings", bad)).status, 400, JSON.stringify(bad));
    }
    const r = await gym.patch("/api/gym/sms/settings", { expiry: true, expired: true, due: true, birthday: true });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.reminders.every((x) => x.on));
    assert.deepEqual((await gym.patch("/api/gym/sms/settings", { birthday: false })).json.reminders.map((x) => x.on), [true, true, true, false]);
    await gym.patch("/api/gym/sms/settings", { birthday: true });
    assert.ok((await as("gymB").get("/api/gym/sms")).json.reminders.every((x) => !x.on), "the other gym is untouched");
  }));

  it("11. the reminder job sends each switched-on reminder once", run(async () => {
    await as("admin").post(`/api/admin/portal/gyms/${state.gymA}/sms-credits`, { credits: 10 });
    await as("admin").post(`/api/admin/portal/gyms/${state.gymB}/sms-credits`, { credits: 10 });
    const sender = createGymSmsSender({ SMS_PROVIDER: "fake", NODE_ENV: "test", DB_NAME: "justfit_test", SMS_FAKE_OUTBOX: server.outbox });
    const before = outbox().length;
    const first = await gymSms.runAutoReminders(pool, sender, today);
    assert.deepEqual(first, { sent: 4, failed: 0, skipped: 0 }, "Priya's expiry, Karthik's expired, Sneha's due, Divya's birthday");
    const sent = outbox().slice(before);
    assert.deepEqual(sent.map((s) => s.kind).sort(), ["birthday", "due", "expired", "expiry"]);
    assert.ok(!sent.some((s) => s.phone === state.bob.phone.slice(3)), "gym B has nothing switched on");
    const [keys] = await connection.query("SELECT kind, auto_key FROM gym_sms_log WHERE gym_id = ? AND source = 'auto' ORDER BY kind", [state.gymA]);
    assert.deepEqual(keys.map((k) => [k.kind, k.auto_key]), [
      ["expiry", `expiry:${rules.addDays(today, 1)}`], ["expired", `expired:${rules.addDays(today, -3)}`],
      ["due", `due:${require("../../gym/smsRules").weekOf(today)}`], ["birthday", `birthday:${today.slice(0, 4)}`],
    ]);
    assert.equal(await credits(state.gymA), 6);
    // Again (the next hour, or a second server): nothing more
    assert.deepEqual(await gymSms.runAutoReminders(pool, sender, today), { sent: 0, failed: 0, skipped: 0 });
    assert.equal(await credits(state.gymA), 6);
    assert.equal(await credits(state.gymB), 10);
  }));

  it("12. Message Logs: newest first, this gym only, no phone numbers", run(async () => {
    const r = await as("gymA").get("/api/gym/sms/logs");
    assert.equal(r.status, 200);
    const total = await count("gym_sms_log", "gym_id = ?", [state.gymA]);
    assert.equal(r.json.logs.length, total);
    assert.ok(r.json.logs.every((l, i, all) => i === 0 || all[i - 1].id > l.id));
    assert.deepEqual(Object.keys(r.json.logs[0]).sort(), ["at", "code", "id", "kind", "name", "source", "status", "text"]);
    assert.ok(!JSON.stringify(r.json).includes(state.priya.phone.slice(3)));
    assert.ok(r.json.logs.some((l) => l.status === "failed" && l.name === "Priya Sharma"));
    assert.equal(r.json.next, null);
    const older = await as("gymA").get(`/api/gym/sms/logs?before=${r.json.logs[1].id}`);
    assert.equal(older.json.logs.length, total - 2);
    assert.deepEqual((await as("gymB").get("/api/gym/sms/logs")).json.logs, []);
    for (const bad of ["?before=0", "?before=1%20OR%201=1", "?page=2"]) assert.equal((await as("gymA").get(`/api/gym/sms/logs${bad}`)).status, 400, bad);
  }));

  it("13. with SMS switched off the portal is told, and sends answer 503", run(async () => {
    await server.stop();
    server = await startTestServer(env, { sms: "off" });
    const r = await as("gymA").get("/api/gym/sms");
    assert.equal(r.status, 200);
    assert.equal(r.json.sending, false);
    assert.equal(r.json.credits, 6);
    assert.equal((await as("gymA").post("/api/gym/sms/send", { group: "due" })).status, 503);
    assert.equal((await as("gymA").post(`/api/gym/members/${state.sneha.id}/sms`, { kind: "due" })).status, 503);
    assert.equal(await credits(state.gymA), 6, "nothing was charged");
  }));
});
