// Gym Hub › Book a free trial end to end (2026-11-10): test accounts in justfit_test against the real
// Express server. A member asks a gym for a trial with their details; it lands in that gym's
// Enquiries only; the gym books a time (the member sees it and is told), then marks it done. Attack
// paths: no session, a phone or user id in the body, bad details and days, asking twice, another
// gym booking it, a member calling the gym route, another member cancelling it.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("gym free trials e2e: a member asks, the gym books it, nobody else sees it", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const today = rules.todayInIndia();

  const api = async (method, route, token, payload) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
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
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["gymA", "gym_admin"], ["gymB", "gym_admin"], ["member", "user"], ["other", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = ? WHERE id = ?", ["Daniel Kim", identities.member.id]);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const gymIds = [state.gymA, state.gymB].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_activity_log", "gym_enquiry_contacts", "gym_enquiries", "gym_payments", "gym_members", "gym_catalog_items", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((b) => b.brand_id)]);
        }
        const all = Object.values(identities).map((i) => i.id);
        await connection.query("DELETE FROM admin_audit_log WHERE admin_id IN (?)", [all]);
        await connection.query("DELETE FROM notifications WHERE user_id IN (?)", [all]).catch(() => {});
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
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms with plans, a PT package and a product", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Zen Fitness", "Hebbal"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    // Members see approved, published gyms only (gym registration)
    await db.publishGyms(connection, [state.gymA, state.gymB]);
    const add = async (tag, item) => {
      const r = await api("POST", "/api/gym/catalog", tokens[tag], item);
      assert.equal(r.status, 201, JSON.stringify(r.json));
      return r.json.items.find((i) => i.name === item.name).id;
    };
    state.gold = await add("gymA", { kind: "plan", name: "Gold", duration: 3, price: 4500 });
    state.pt = await add("gymA", { kind: "pt", name: "12 sessions", duration: 1, price: 5000 });
    state.whey = await add("gymA", { kind: "product", name: "Whey", price: 2500 });
    state.zenPlan = await add("gymB", { kind: "plan", name: "Monthly", duration: 1, price: 2500 });
  }));

  const body = (extra = {}) => ({ name: "Daniel Kim", age: 27, gender: "male", goal: "build_muscle", experience: "some", day: rules.todayInIndia(), time: "evening", note: "After work", ...extra });

  it("2. bad trial requests are refused and nothing is written", run(async () => {
    const route = `/api/gyms/${state.gymA}/trials`;
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await api("POST", route, token, body())).status, 401);
    for (const bad of [
      body({ phone: "9123456789" }),
      body({ userId: identities.other.id }),
      body({ name: "" }),
      body({ age: 5 }),
      body({ age: "27 OR 1=1" }),
      body({ gender: "robot" }),
      body({ day: "2020-01-01" }),
      body({ day: "2099-01-01" }),
      body({ time: "midnight" }),
      body({ note: "x".repeat(201) }),
    ]) assert.equal((await api("POST", route, tokens.member, bad)).status, 400, JSON.stringify(bad));
    assert.equal((await api("POST", "/api/gyms/999999999/trials", tokens.member, body())).status, 404);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM gym_enquiries WHERE gym_id IN (?)", [[state.gymA, state.gymB]]);
    assert.equal(n, 0);
  }));

  it("3. the member asks for a trial: it lands in gym A's Enquiries with their details and their own number", run(async () => {
    const r = await api("POST", `/api/gyms/${state.gymA}/trials`, tokens.member, body());
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.request.trial.status, "requested");
    assert.equal(r.json.request.trial.at, null);
    assert.match(r.json.request.trial.preferred, /evening$/);
    state.trial = r.json.request.id;
    const [[row]] = await connection.query("SELECT full_name, phone, interest, source, trial_status, user_id FROM gym_enquiries WHERE id = ?", [state.trial]);
    assert.deepEqual(row, { full_name: "Daniel Kim", phone: identities.member.phone, interest: "trial", source: "app", trial_status: "requested", user_id: identities.member.id });
    const list = await api("GET", "/api/gym/enquiries?view=today&search=", tokens.gymA);
    const seen = list.json.enquiries.find((e) => e.id === state.trial);
    assert.equal(seen.trial.details.goal, "build_muscle");
    assert.equal(seen.trial.details.age, 27);
    const atB = await api("GET", "/api/gym/enquiries?view=all&search=", tokens.gymB);
    assert.ok(!atB.json.enquiries.some((e) => e.id === state.trial));
    const [[notice]] = await connection.query("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'gym.trial_request'", [identities.gymA.id]);
    assert.equal(notice.n, 1);
  }));

  it("4. asking twice is refused", run(async () => {
    assert.equal((await api("POST", `/api/gyms/${state.gymA}/trials`, tokens.member, body())).status, 409);
  }));

  it("5. the gym books the trial; the member sees the time and is told; another gym can't touch it", run(async () => {
    const route = `/api/gym/enquiries/${state.trial}/trial`;
    assert.equal((await api("PUT", route, tokens.gymB, { day: today, time: "18:30" })).status, 404);
    assert.equal((await api("PUT", route, tokens.gymA, { day: today, time: "25:00" })).status, 400);
    assert.equal((await api("PUT", route, tokens.gymA, { day: "2020-01-01", time: "18:30" })).status, 400);
    assert.equal((await api("PUT", route, tokens.member, { day: today, time: "18:30" })).status, 403);
    const booked = await api("PUT", route, tokens.gymA, { day: today, time: "18:30" });
    assert.equal(booked.status, 200, JSON.stringify(booked.json));
    assert.equal(booked.json.enquiry.trial.status, "scheduled");
    assert.equal(booked.json.enquiry.trial.at.time, "18:30");
    assert.equal(booked.json.enquiry.status, "follow_up");
    const page = await api("GET", `/api/gyms/${state.gymA}`, tokens.member);
    assert.equal(page.json.you.request.trial.status, "scheduled");
    assert.match(page.json.you.request.trial.at.text, /6:30 PM$/);
    const [[notice]] = await connection.query("SELECT title, link FROM notifications WHERE user_id = ? AND kind = 'trial.scheduled'", [identities.member.id]);
    assert.equal(notice.title, "Your free trial is booked");
    assert.equal(notice.link, `/gym-hub/gyms/${state.gymA}`);
  }));

  it("6. the gym marks it done; the enquiry stays open to convert", run(async () => {
    const route = `/api/gym/enquiries/${state.trial}/trial/outcome`;
    assert.equal((await api("POST", route, tokens.gymA, { outcome: "maybe" })).status, 400);
    const done = await api("POST", route, tokens.gymA, { outcome: "done" });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal(done.json.enquiry.trial.status, "done");
    assert.equal(done.json.enquiry.status, "follow_up");
  }));

  it("7. another member can't cancel it; the member cancels their own open trial", run(async () => {
    const r = await api("POST", `/api/gyms/${state.gymB}/trials`, tokens.member, body({ time: "morning" }));
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const route = `/api/gyms/${state.gymB}/trials/${r.json.request.id}`;
    assert.equal((await api("DELETE", route, tokens.other)).status, 404);
    assert.equal((await api("DELETE", route, tokens.member)).status, 200);
    assert.equal((await api("DELETE", route, tokens.member)).status, 404);
    const mine = await api("GET", "/api/gyms/requests", tokens.member);
    assert.equal(mine.json.requests.find((q) => q.id === r.json.request.id).trial.status, "cancelled");
    const others = await api("GET", "/api/gyms/requests", tokens.other);
    assert.equal(others.json.requests.length, 0);
  }));
});
