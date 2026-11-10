// Trainer diet plans end to end (migration 2027-01-27): test accounts in justfit_test against the
// real Express server. A gym admin adds two trainers; one has a PT client whose account is
// vegetarian with a peanut allergy. The trainer writes a plan with justFit picks; the member sees it
// with the meals that don't suit them hidden, and a notice; once the member shares their answers the
// trainer sees them and can't pick a meal that breaks them. Attack paths: no session, a member or
// another trainer on the trainer routes, SQL in ids, unexpected fields, a pick that isn't on the
// menu, a bad sharing body, and a removed plan the member no longer sees.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("trainer diet plans e2e: a trainer's day of meals with justFit picks", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const tokens = {};
  const state = {};
  const mealId = (name) => `dp-${name}-${runId}`;

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
    put: (route, body) => api("PUT", route, tokens[tag], body),
    del: (route) => api("DELETE", route, tokens[tag]),
  });
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const planFor = (picks) => ({
    note: "Drink 3 L water",
    meals: [
      { slot: "breakfast", time: "08:00", food: "3 idli + sambar", kcal: 350, proteinG: 12, picks: [] },
      { slot: "lunch", time: "13:30", food: "2 roti, dal, paneer sabzi", kcal: 550, proteinG: 28, picks },
      { slot: "evening", food: "Sprouts chaat" },
    ],
  });

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT);
    testAccounts = identitiesFor(env);
    server = await startTestServer(env);
    try {
      for (const [tag, role] of [["admin", "admin"], ["owner", "gym_admin"], ["ravi", "user"], ["meena", "user"], ["member", "user"]]) {
        identities[tag] = await testAccounts.createIdentity(runId, tag, { role });
        const minted = await testAccounts.mintToken(identities[tag].id);
        identities[tag].sessionId = minted.sessionId;
        tokens[tag] = minted.jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = 'Ravi Kumar' WHERE id = ?", [identities.ravi.id]);
    await connection.query("INSERT INTO profiles (user_id, diet, allergies, dislikes) VALUES (?, 'vegetarian', 'peanuts', NULL)", [identities.member.id]);
    for (const [name, diet, ingredients, kcal, protein] of [["paneer", "vegetarian", "paneer, rice", 520, 32], ["chicken", "non-vegetarian", "chicken, rice", 610, 40], ["poha", "vegetarian", "poha, peanuts", 380, 10]]) {
      await connection.query(
        "INSERT INTO meals (id, name, ingredients, diet, calories, protein_g, carbs_g, fat_g, price_paise, is_available) VALUES (?, ?, ?, ?, ?, ?, 50, 15, 19900, TRUE)",
        [mealId(name), `DP ${name} ${runId}`, ingredients, diet, kcal, protein],
      );
    }
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        const gymIds = [state.gym].filter(Boolean);
        if (gymIds.length) {
          const [brands] = await connection.query("SELECT DISTINCT brand_id FROM gyms WHERE id IN (?)", [gymIds]);
          await connection.query("DELETE FROM trainer_diet_plans WHERE gym_id IN (?)", [gymIds]);
          for (const table of ["gym_activity_log", "gym_attendance", "gym_payments", "gym_members", "gym_staff_invites", "gym_staff"]) await connection.query(`DELETE FROM \`${table}\` WHERE gym_id IN (?)`, [gymIds]);
          await connection.query("DELETE FROM gyms WHERE id IN (?)", [gymIds]);
          if (brands.length) await connection.query("DELETE FROM gym_brands WHERE id IN (?)", [brands.map((b) => b.brand_id)]);
        }
        await connection.query("DELETE FROM meals WHERE id LIKE ?", [`dp-%-${runId}`]);
        const all = Object.values(identities).map((i) => i.id);
        await connection.query("DELETE FROM notifications WHERE user_id IN (?)", [all]).catch(() => {});
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

  it("1. a gym, two trainers, and a PT client with Ravi", run(async () => {
    const gym = await as("admin").post("/api/admin/portal/gyms", { name: "Forma", branch: "Tumkur", area: "Batawadi", city: "Tumakuru" });
    state.gym = gym.json.gym.id;
    assert.equal((await as("admin").post(`/api/admin/portal/gyms/${state.gym}/staff`, { phone: identities.owner.phone })).status, 201);
    for (const tag of ["ravi", "meena"]) assert.equal((await as("owner").post("/api/gym/staff", { phone: identities[tag].phone, kind: "trainer" })).status, 201, tag);
    const admitted = await as("owner").post("/api/gym/members", { name: "Arjun M", phone: identities.member.phone, unit: "months", duration: 3, fee: 3000, paid: 3000, method: "cash" });
    assert.equal(admitted.status, 201, JSON.stringify(admitted.json));
    state.client = admitted.json.member.id;
    const pt = await as("owner").post(`/api/gym/members/${state.client}/pt`, { package: "1 Month PT", amount: 2500, method: "online", unit: "months", duration: 1, trainerId: identities.ravi.id });
    assert.equal(pt.status, 200, JSON.stringify(pt.json));
  }));

  it("2. only the client's own trainer reaches the plan", run(async () => {
    const route = `/api/trainer/clients/${state.client}/diet-plan`;
    assert.equal((await api("GET", route, null)).status, 401);
    assert.equal((await as("member").get(route)).status, 403, "a member isn't a trainer");
    assert.equal((await as("owner").get(route)).status, 403, "nor is the gym admin");
    assert.equal((await as("meena").get(route)).status, 404, "another trainer's client");
    assert.equal((await as("meena").put(route, planFor([]))).status, 404);
    assert.equal((await as("ravi").get("/api/trainer/clients/1%20OR%201=1/diet-plan")).status, 400);
    const first = await as("ravi").get(route);
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.plan, null);
    assert.equal(first.json.shared, false);
    assert.equal(first.json.food, null, "no food answers until the member shares");
    assert.ok(first.json.menu.every((m) => m.problem === null), "no checks shown without sharing");
    assert.ok(first.json.menu.some((m) => m.id === mealId("chicken")));
  }));

  it("3. a plan is saved; the member sees it without the meals that don't suit them, and a notice", run(async () => {
    const route = `/api/trainer/clients/${state.client}/diet-plan`;
    for (const bad of [{ ...planFor([]), userId: identities.member.id }, { meals: [] }, planFor(["not-on-menu"])]) {
      const answer = await as("ravi").put(route, bad);
      assert.ok([400, 409].includes(answer.status), JSON.stringify(answer.json));
    }
    const saved = await as("ravi").put(route, planFor([mealId("paneer"), mealId("chicken"), mealId("poha")]));
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.plan.version, 1);
    assert.deepEqual(saved.json.plan.meals.map((m) => m.slot), ["breakfast", "lunch", "evening"]);

    const mine = await as("member").get("/api/membership/diet-plans");
    assert.equal(mine.status, 200, JSON.stringify(mine.json));
    assert.equal(mine.json.plans.length, 1);
    const plan = mine.json.plans[0];
    assert.equal(plan.trainer, "Ravi Kumar");
    assert.equal(plan.note, "Drink 3 L water");
    assert.deepEqual(plan.meals[1].picks.map((m) => m.id), [mealId("paneer")], "chicken (not veg) and poha (peanuts) are hidden");
    assert.equal(plan.hidden, 2);
    const [notes] = await connection.query("SELECT kind, link FROM notifications WHERE user_id = ? AND kind = 'diet.plan'", [identities.member.id]);
    assert.deepEqual(notes.map((n) => [n.kind, n.link]), [["diet.plan", "/coach/meal-plan"]]);
    assert.deepEqual((await as("meena").get("/api/membership/diet-plans")).json.plans, [], "someone else's plans are never shown");
  }));

  it("4. once the member shares, the trainer sees their answers and can't pick against them", run(async () => {
    const route = `/api/trainer/clients/${state.client}/diet-plan`;
    for (const bad of [{ shared: "yes" }, { shared: true, userId: identities.ravi.id }, {}]) assert.equal((await as("member").put("/api/membership/food-sharing", bad)).status, 400);
    assert.equal((await as("ravi").put("/api/membership/food-sharing", { shared: true })).status, 409, "no profile, nothing to share");
    assert.deepEqual((await as("member").put("/api/membership/food-sharing", { shared: true })).json, { shared: true });
    const seen = await as("ravi").get(route);
    assert.deepEqual(seen.json.food, { diet: "vegetarian", allergies: "peanuts", dislikes: null });
    assert.equal(seen.json.menu.find((m) => m.id === mealId("chicken")).problem, "Not vegetarian");
    assert.equal(seen.json.menu.find((m) => m.id === mealId("poha")).problem, "Has peanuts (allergy)");
    const refused = await as("ravi").put(route, planFor([mealId("chicken")]));
    assert.equal(refused.status, 409);
    assert.match(refused.json.error, /doesn't suit Arjun M: not vegetarian/);
    assert.equal((await as("member").get("/api/membership/diet-plans")).json.plans[0].version, 1, "a refused save changes nothing");
    const again = await as("ravi").put(route, planFor([mealId("paneer")]));
    assert.equal(again.json.plan.version, 2);
    const [notes] = await connection.query("SELECT title FROM notifications WHERE user_id = ? AND kind = 'diet.plan' ORDER BY id", [identities.member.id]);
    assert.deepEqual(notes.map((n) => n.title), ["Ravi Kumar shared a diet plan", "Ravi Kumar updated your diet plan"]);
  }));

  it("5. removing the plan takes it off the member's screen", run(async () => {
    const route = `/api/trainer/clients/${state.client}/diet-plan`;
    assert.equal((await as("meena").del(route)).status, 404);
    assert.deepEqual((await as("ravi").del(route)).json, { removed: true });
    assert.deepEqual((await as("member").get("/api/membership/diet-plans")).json.plans, []);
    assert.deepEqual((await as("ravi").del(route)).json, { removed: false });
  }));
});
