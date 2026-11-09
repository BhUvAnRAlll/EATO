// Gym Hub › ask to join end to end (phase 4, 2026-11-09): test accounts in justfit_test against the
// real Express server. A member asks a gym to call them about a plan; it lands in that gym's
// Enquiries (justFit app, the plan, today's call-back) and only there; the member sees where it
// stands, never the gym's notes. Attack paths: no session, someone else's or a made-up plan, a
// product, a name or phone in the body, asking twice, asking while already a member, another
// member's requests, staff choosing "justFit app" themselves.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");
const rules = require("../../gym/rules.js");

describe("gym join requests e2e: a member asks, the gym follows up, nobody else sees it", () => {
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
          for (const table of ["gym_activity_log", "gym_enquiry_contacts", "gym_enquiries", "gym_payments", "gym_members", "gym_catalog_items", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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
    if (problems.length > 0) throw new Error(`cleanup incomplete: ${problems.join("; ")}`);
  });

  it("1. two gyms with plans, a PT package and a product", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Zen Fitness", "Hebbal"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
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

  it("2. bad requests are refused and nothing is written", run(async () => {
    const route = `/api/gyms/${state.gymA}/requests`;
    for (const token of [null, "jfs_not-a-token"]) assert.equal((await api("POST", route, token, { itemId: state.gold })).status, 401);
    for (const [body, status] of [
      [{ itemId: state.zenPlan }, 400], // another gym's plan
      [{ itemId: state.whey }, 400], // a product
      [{ itemId: 999999999 }, 400],
      [{ itemId: state.gold, phone: "9123456789" }, 400],
      [{ itemId: state.gold, name: "Someone Else" }, 400],
      [{ itemId: `${state.gold} OR 1=1` }, 400],
      [{ note: "x".repeat(201) }, 400],
    ]) assert.equal((await api("POST", route, tokens.member, body)).status, status, JSON.stringify(body));
    assert.equal((await api("POST", "/api/gyms/999999999/requests", tokens.member, {})).status, 404);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM gym_enquiries WHERE gym_id IN (?)", [[state.gymA, state.gymB]]);
    assert.equal(n, 0);
  }));

  it("3. the member asks about Gold: it lands in gym A's Enquiries only, with their account's name and number", run(async () => {
    const r = await api("POST", `/api/gyms/${state.gymA}/requests`, tokens.member, { itemId: state.gold, note: "Evenings after 6" });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(r.json.request, { id: r.json.request.id, gym: { id: state.gymA, name: "Forma", branch: "Tumkur" }, planLabel: "Gold · 3 Months · ₹4,500", state: "sent", sentOn: today });
    state.request = r.json.request.id;

    const [[row]] = await connection.query("SELECT full_name, phone, note, status, source, interest, user_id, catalog_item_id, DATE_FORMAT(follow_up_on, '%Y-%m-%d') AS follow FROM gym_enquiries WHERE id = ?", [state.request]);
    assert.deepEqual(row, { full_name: "Daniel Kim", phone: identities.member.phone, note: "Evenings after 6", status: "new", source: "app", interest: "membership", user_id: identities.member.id, catalog_item_id: state.gold, follow: today });

    const today_ = await api("GET", "/api/gym/enquiries?view=today&search=", tokens.gymA);
    assert.equal(today_.status, 200, JSON.stringify(today_.json));
    const seen = today_.json.enquiries.find((e) => e.id === state.request);
    assert.equal(seen.source, "app");
    assert.equal(seen.planLabel, "Gold · 3 Months · ₹4,500");
    const atB = await api("GET", "/api/gym/enquiries?view=all&search=", tokens.gymB);
    assert.equal(atB.json.enquiries.some((e) => e.id === state.request), false, "gym B never sees it");
  }));

  it("4. asking twice is refused; the gym's page and the member's list say it's sent", run(async () => {
    const twice = await api("POST", `/api/gyms/${state.gymA}/requests`, tokens.member, { itemId: state.pt });
    assert.equal(twice.status, 409);
    assert.match(twice.json.error, /already asked Forma/);
    const page = await api("GET", `/api/gyms/${state.gymA}`, tokens.member);
    assert.deepEqual(page.json.you, { memberId: null, request: { id: state.request, gym: { id: state.gymA, name: "Forma", branch: "Tumkur" }, planLabel: "Gold · 3 Months · ₹4,500", state: "sent", sentOn: today } });
    assert.deepEqual((await api("GET", `/api/gyms/${state.gymB}`, tokens.member)).json.you, { memberId: null, request: null });
    const mine = await api("GET", "/api/gyms/requests", tokens.member);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.json.requests.map((x) => x.id), [state.request]);
    assert.ok(!JSON.stringify(mine.json).includes("Evenings after 6"), "the member's list carries no notes");
    assert.deepEqual((await api("GET", "/api/gyms/requests", tokens.other)).json.requests, [], "nobody else's");
    assert.equal((await api("GET", "/api/gyms/requests", null)).status, 401);
  }));

  it("5. the gym follows up: the member sees it, and staff can't make their own enquiry look like the app's", run(async () => {
    // EnquirySheet sends every field back, the source included
    const kept = await api("PATCH", `/api/gym/enquiries/${state.request}`, tokens.gymA, { name: "Daniel Kim", note: "Called, coming Friday", source: "app", followUpOn: rules.addDays(today, 3) });
    assert.equal(kept.status, 200, JSON.stringify(kept.json));
    assert.equal(kept.json.enquiry.source, "app");
    assert.equal((await api("GET", "/api/gyms/requests", tokens.member)).json.requests[0].state, "in_touch");
    assert.ok(!JSON.stringify((await api("GET", `/api/gyms/${state.gymA}`, tokens.member)).json).includes("Called, coming Friday"), "the gym's note stays the gym's");

    const walkIn = await api("POST", "/api/gym/enquiries", tokens.gymA, { name: "Priya", phone: "9123456780", source: "walk_in" });
    assert.equal(walkIn.status, 201, JSON.stringify(walkIn.json));
    assert.equal((await api("PATCH", `/api/gym/enquiries/${walkIn.json.enquiry.id}`, tokens.gymA, { source: "app" })).status, 400);
    assert.equal((await api("POST", "/api/gym/enquiries", tokens.gymA, { name: "Ravi", source: "app" })).status, 400);
  }));

  it("6. once a member there, a plan request is refused but PT can still be asked about", run(async () => {
    const admitted = await api("POST", "/api/gym/members", tokens.gymA, { name: "Daniel Kim", phone: identities.member.phone, duration: 3, fee: 4500, paid: 4500, method: "cash" });
    assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
    const joined = await api("PATCH", `/api/gym/enquiries/${state.request}`, tokens.gymA, { status: "joined", memberId: admitted.json.member.id });
    assert.equal(joined.status, 200, JSON.stringify(joined.json));
    const page = (await api("GET", `/api/gyms/${state.gymA}`, tokens.member)).json;
    assert.equal(page.you.memberId, admitted.json.member.id);
    assert.equal(page.you.request.state, "joined");
    const plan = await api("POST", `/api/gyms/${state.gymA}/requests`, tokens.member, { itemId: state.gold });
    assert.equal(plan.status, 409);
    assert.match(plan.json.error, /already a member at Forma Tumkur/);
    const pt = await api("POST", `/api/gyms/${state.gymA}/requests`, tokens.member, { itemId: state.pt });
    assert.equal(pt.status, 201, JSON.stringify(pt.json));
    assert.equal(pt.json.request.planLabel, "PT · 12 sessions · 1 Month · ₹5,000");
    const [[row]] = await connection.query("SELECT interest FROM gym_enquiries WHERE id = ?", [pt.json.request.id]);
    assert.equal(row.interest, "pt");
  }));

  it("7. a deleted plan keeps its label on the request", run(async () => {
    const r = await api("POST", `/api/gyms/${state.gymB}/requests`, tokens.member, { itemId: state.zenPlan });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal((await api("DELETE", `/api/gym/catalog/${state.zenPlan}`, tokens.gymB)).status, 200, "the request doesn't block deleting the plan");
    const [[row]] = await connection.query("SELECT catalog_item_id, plan_label FROM gym_enquiries WHERE id = ?", [r.json.request.id]);
    assert.deepEqual(row, { catalog_item_id: null, plan_label: "Monthly · 1 Month · ₹2,500" });
  }));
});
