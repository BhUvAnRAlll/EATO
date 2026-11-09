// Gym Profile phase 2 end to end (2026-11-09): test accounts in justfit_test against the real Express
// server. The gym admin gives plans benefits, marks one Best value, orders them and switches them
// off or archives them; members see only active plans and PT, in the gym's order; the forms and
// join requests can't use an inactive plan. Attack paths: Staff without Add/edit, another gym's
// ids, bad statuses and benefits, SQL in the input, Best value on PT or an inactive plan.
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

describe("gym plans e2e: benefits, best value, order and status; members see only active plans", () => {
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
    photoDir = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-gym-plans-e2e-"));
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
          for (const table of ["gym_activity_log", "gym_enquiry_contacts", "gym_enquiries", "gym_photos", "gym_payments", "gym_members", "gym_catalog_items", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
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

  const plan = (items, name) => items.find((i) => i.name === name);

  it("1. two gyms with their gym admins; Staff at gym A who can only see the plans", run(async () => {
    for (const [key, name, branch] of [["gymA", "Forma", "Tumkur"], ["gymB", "Just Fit", "Indiranagar"]]) {
      const gym = await api("POST", "/api/admin/portal/gyms", tokens.admin, { name, branch, area: branch, city: "Bengaluru" });
      assert.equal(gym.status, 201, JSON.stringify(gym.json));
      state[key] = gym.json.gym.id;
      assert.equal((await api("POST", `/api/admin/portal/gyms/${state[key]}/staff`, tokens.admin, { phone: identities[key].phone })).status, 201);
    }
    // Members see approved, published gyms only (gym registration)
    await db.publishGyms(connection, [state.gymA, state.gymB]);
    assert.equal((await api("POST", "/api/gym/staff", tokens.gymA, { phone: identities.staffA.phone, kind: "staff" })).status, 201);
    assert.equal((await api("PUT", `/api/gym/staff/${identities.staffA.id}/permissions`, tokens.gymA, { options: ["catalog.view"] })).status, 200);
  }));

  it("2. plans take benefits and one Best value a branch; the wrong kinds are refused", run(async () => {
    let r = await api("POST", "/api/gym/catalog", tokens.gymA, { kind: "plan", name: "Monthly", duration: 1, price: 1500 });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const monthly = plan(r.json.items, "Monthly");
    assert.deepEqual([monthly.status, monthly.bestValue, monthly.benefits, monthly.sortOrder], ["active", false, [], 0]);
    r = await api("POST", "/api/gym/catalog", tokens.gymA, { kind: "plan", name: "Annual", duration: 12, price: 12000, benefits: ["Steam bath", " Locker "], bestValue: true });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(plan(r.json.items, "Annual").benefits, ["Steam bath", "Locker"]);
    assert.equal(plan(r.json.items, "Annual").bestValue, true);
    r = await api("POST", "/api/gym/catalog", tokens.gymA, { kind: "plan", name: "Quarterly", duration: 3, price: 4200, bestValue: true });
    assert.equal(plan(r.json.items, "Quarterly").bestValue, true);
    assert.equal(plan(r.json.items, "Annual").bestValue, false, "one Best value a branch");
    r = await api("PATCH", `/api/gym/catalog/${plan(r.json.items, "Annual").id}`, tokens.gymA, { bestValue: true });
    assert.equal(plan(r.json.items, "Annual").bestValue, true);
    assert.equal(plan(r.json.items, "Quarterly").bestValue, false);
    assert.equal((await api("POST", "/api/gym/catalog", tokens.gymA, { kind: "pt", name: "PT 12", duration: 1, price: 5000, benefits: ["12 sessions"] })).status, 201);
    assert.equal((await api("POST", "/api/gym/catalog", tokens.gymB, { kind: "plan", name: "Gold", duration: 6, price: 9000, bestValue: true })).status, 201);
    const a = (await api("GET", "/api/gym/catalog", tokens.gymA)).json.items;
    assert.equal(plan(a, "Annual").bestValue, true, "gym B's Best value never touches gym A's");
    state.plans = Object.fromEntries(a.map((i) => [i.name, i.id]));

    for (const [payload, why] of [
      [{ kind: "pt", name: "PT 6", duration: 1, price: 3000, bestValue: true }, "Best value on PT"],
      [{ kind: "product", name: "Whey", price: 2500, benefits: ["Tasty"] }, "benefits on a product"],
      [{ kind: "plan", name: "X", duration: 1, price: 100, status: "deleted" }, "an unknown status"],
      [{ kind: "plan", name: "X", duration: 1, price: 100, benefits: ["a'); DROP TABLE gyms; --", "a'); DROP TABLE gyms; --"] }, "a benefit twice"],
      [{ kind: "plan", name: "X", duration: 1, price: 100, bestValue: true, status: "inactive" }, "Best value while inactive"],
    ]) assert.equal((await api("POST", "/api/gym/catalog", tokens.gymA, payload)).status, 400, why);
    assert.equal((await api("PATCH", `/api/gym/catalog/${state.plans["PT 12"]}`, tokens.gymA, { bestValue: true })).status, 400, "PT can't be Best value");
    assert.equal((await api("PATCH", `/api/gym/catalog/${state.plans.Monthly}`, tokens.gymB, { status: "inactive" })).status, 404, "another gym's plan");
    assert.equal((await api("PATCH", `/api/gym/catalog/${state.plans.Monthly}`, tokens.staffA, { status: "inactive" })).status, 403, "Staff who can only see");
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM gyms");
    assert.ok(n >= 2, "nothing was dropped");
  }));

  it("3. the gym orders its plans; members see them in that order with the benefits and Best value", run(async () => {
    const ids = [state.plans.Annual, state.plans.Monthly, state.plans.Quarterly];
    const r = await api("PUT", "/api/gym/catalog/order", tokens.gymA, { kind: "plan", ids });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.items.filter((i) => i.kind === "plan").map((i) => i.name), ["Annual", "Monthly", "Quarterly"]);
    for (const [payload, why] of [
      [{ kind: "plan", ids: ids.slice(1) }, "one missing"],
      [{ kind: "plan", ids: [...ids.slice(1), 999999] }, "one not theirs"],
      [{ kind: "plan", ids: [ids[0], ids[0], ids[1]] }, "one twice"],
      [{ kind: "pt", ids }, "plans sent as PT"],
      [{ kind: "plan", ids, gymId: state.gymB }, "an unexpected field"],
    ]) assert.equal((await api("PUT", "/api/gym/catalog/order", tokens.gymA, payload)).status, 400, why);
    assert.equal((await api("PUT", "/api/gym/catalog/order", tokens.gymB, { kind: "plan", ids })).status, 400, "gym B has none of these");
    assert.equal((await api("PUT", "/api/gym/catalog/order", tokens.staffA, { kind: "plan", ids })).status, 403);

    const page = await api("GET", `/api/gyms/${state.gymA}`, tokens.member);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.deepEqual(page.json.plans.map((p) => [p.name, p.bestValue]), [["Annual", true], ["Monthly", false], ["Quarterly", false]]);
    assert.deepEqual(page.json.plans[0].benefits, ["Steam bath", "Locker"]);
    assert.deepEqual(page.json.pt.map((p) => [p.name, p.benefits]), [["PT 12", ["12 sessions"]]]);
  }));

  it("4. an inactive or archived plan leaves members, the forms and join requests; members on it keep it", run(async () => {
    const before = await api("POST", "/api/gym/members", tokens.gymA, { name: "On Quarterly", phone: "9123456780", duration: 3, fee: 4200, paid: 4200, method: "cash", planId: state.plans.Quarterly });
    assert.equal(before.status, 201, JSON.stringify(before.json));

    let r = await api("PATCH", `/api/gym/catalog/${state.plans.Quarterly}`, tokens.gymA, { status: "inactive" });
    assert.equal(plan(r.json.items, "Quarterly").status, "inactive");
    r = await api("PATCH", `/api/gym/catalog/${state.plans.Annual}`, tokens.gymA, { status: "archived" });
    assert.equal(plan(r.json.items, "Annual").status, "archived");
    assert.equal(plan(r.json.items, "Annual").bestValue, false, "archiving takes the Best value mark off");

    const page = (await api("GET", `/api/gyms/${state.gymA}`, tokens.member)).json;
    assert.deepEqual(page.plans.map((p) => p.name), ["Monthly"], "only the active plan");
    const card = (await api("GET", "/api/gyms?search=Forma", tokens.member)).json.gyms.find((g) => g.id === state.gymA);
    assert.equal(card.fromPrice, 1500, "From ₹ counts active plans only");
    assert.equal(card.planCount, 1);

    const admit = await api("POST", "/api/gym/members", tokens.gymA, { name: "New Person", phone: "9123456781", duration: 3, fee: 4200, paid: 4200, method: "cash", planId: state.plans.Quarterly });
    assert.equal(admit.status, 400, "an inactive plan can't be sold");
    const ask = await api("POST", `/api/gyms/${state.gymA}/requests`, tokens.member, { itemId: state.plans.Quarterly });
    assert.equal(ask.status, 400, "nor asked about");
    const [[kept]] = await connection.query("SELECT plan_name FROM gym_members WHERE id = ?", [before.json.member.id]);
    assert.equal(kept.plan_name, "Quarterly", "the member on it keeps their plan");

    r = await api("PATCH", `/api/gym/catalog/${state.plans.Quarterly}`, tokens.gymA, { status: "active" });
    assert.equal(plan(r.json.items, "Quarterly").status, "active");
    assert.deepEqual((await api("GET", `/api/gyms/${state.gymA}`, tokens.member)).json.plans.map((p) => p.name), ["Monthly", "Quarterly"], "back, in its place");
  }));

  it("5. plan changes are on the branch's Activity", run(async () => {
    const [rows] = await connection.query("SELECT target_label, detail FROM gym_activity_log WHERE gym_id = ? AND target_type = 'catalog' ORDER BY id", [state.gymA]);
    const details = rows.map((r) => r.detail ?? "");
    assert.ok(details.some((d) => d.includes("Archived it")), JSON.stringify(details));
    assert.ok(details.some((d) => d.includes("Made it inactive")));
    assert.ok(details.some((d) => d.includes("Marked it best value")));
    assert.ok(rows.some((r) => r.target_label === "Membership plans order"));
  }));
});
