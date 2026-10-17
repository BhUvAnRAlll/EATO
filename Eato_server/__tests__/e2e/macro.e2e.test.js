// The Macro diary end to end: real Clerk development identities against the real Express
// server and the isolated eato_test database. Covers logging a meal, the day view, week
// grading, recent meals, the period summary, adjusting targets, water, deleting, favourites, and the attack paths: no or forged session,
// another member's meal or favourite, other days, malformed ids and dates, SQL in input.
//
//   yarn test:e2e      (needs Eato_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { clerkFor, describeClerkError } = require("./clerk-identities.js");

const MACRO_TABLES = ["macro_meal_items", "macro_meal_logs", "macro_favorite_foods", "macro_water_logs", "macro_hydration_days", "macro_hydration_preferences", "nutrition_targets", "profiles"];
const utcDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const TODAY = utcDay();
const food = (over = {}) => ({ name: "Paneer tikka bowl", quantity: 350, unit: "g", kcal: 480, proteinG: 32, carbsG: 40, fatG: 18, ...over });

describe("macro e2e: meals, the day view, favourites and who may see them", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, clerk;
  const identities = {};
  const ids = {};
  const tokens = {};
  const state = {};

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const logMeal = (token, over = {}) => api("POST", "/api/macro/meals", token, { date: TODAY, slot: "lunch", title: "Paneer tikka bowl", loggedAt: Date.now(), items: [food()], ...over });
  const count = async (table, where, params) => (await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params))[0][0].n;
  const newIdentity = async (tag) => {
    const identity = await clerk.createIdentity(runId, tag);
    const { sessionId, jwt } = await clerk.mintToken(identity.id);
    identities[tag] = { ...identity, sessionId };
    ids[tag] = identity.id;
    tokens[tag] = jwt;
  };
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in eato_test`);
    clerk = clerkFor(env.CLERK_SECRET_KEY);
    server = await startTestServer(env);
    try {
      await newIdentity("a");
      await newIdentity("b");
    } catch (error) {
      throw new Error(`Clerk could not create a test identity or session: ${JSON.stringify(describeClerkError(error))}`);
    }
    for (const tag of ["a", "b"]) {
      await connection.query("INSERT INTO users (id, email, full_name, role) VALUES (?, ?, ?, 'user')", [ids[tag], identities[tag].emailAddress, `Member ${tag.toUpperCase()}`]);
    }
    // Member A finished setup: an active target of 2000 kcal
    await connection.query(
      `INSERT INTO nutrition_targets (user_id, formula, config_version, inputs, calculated_at, calories, protein_g, carbs_g, fat_g)
       VALUES (?, 'eato-calculator', 'test', '{}', NOW(), 2000, 150, 200, 60)`,
      [ids.a],
    );
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        for (const table of MACRO_TABLES) await connection.query("DELETE FROM `" + table + "` WHERE user_id IN (?)", [Object.values(ids)]);
        await db.deleteUsers(connection, Object.values(ids));
      } catch (error) { problems.push(`rows: ${error.code}`); }
    }
    if (clerk) for (const tag of Object.keys(identities)) {
      try {
        if (identities[tag].sessionId) await clerk.revokeSession(identities[tag].sessionId).catch(() => {});
        await clerk.deleteUser(identities[tag].id);
      } catch (error) { problems.push(`${tag}: ${JSON.stringify(describeClerkError(error))}`); }
    }
    if (server) await server.stop();
    if (connection) await connection.end();
    if (problems.length > 0) { console.error("CLEANUP INCOMPLETE:", problems.join("; ")); throw new Error("cleanup incomplete"); }
  });

  it("1. every macro route needs a valid session", run(async () => {
    const fake = crypto.randomUUID();
    for (const token of [null, "not-a-jwt", "eyJhbGciOiJSUzI1NiJ9.e30.invalid"]) {
      assert.equal((await api("GET", `/api/macro/day?date=${TODAY}`, token)).status, 401);
      assert.equal((await api("GET", `/api/macro/progress?dates=${TODAY}`, token)).status, 401);
      assert.equal((await api("GET", `/api/macro/recent?today=${TODAY}`, token)).status, 401);
      assert.equal((await api("GET", "/api/macro/favorites", token)).status, 401);
      assert.equal((await logMeal(token)).status, 401);
      assert.equal((await api("DELETE", `/api/macro/meals/${fake}`, token)).status, 401);
      assert.equal((await api("POST", "/api/macro/favorites/toggle", token, { name: "x", items: [food()] })).status, 401);
      assert.equal((await api("POST", `/api/macro/favorites/${fake}/log`, token, { date: TODAY, slot: "lunch", loggedAt: Date.now() })).status, 401);
    }
    assert.equal(await count("macro_meal_logs", "1 = ?", [1]), 0, "nothing was written");
  }));

  it("2. an empty day shows the target; a member without setup has no target", run(async () => {
    const a = await api("GET", `/api/macro/day?date=${TODAY}`, tokens.a);
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.deepEqual(a.json, { date: TODAY, targets: { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 }, totals: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, burned: 0, meals: [] });
    const b = await api("GET", `/api/macro/day?date=${TODAY}`, tokens.b);
    assert.equal(b.json.targets, null);
  }));

  it("3. logging a meal: one transaction, totals summed from the foods, the owner from the session", run(async () => {
    const loggedAt = Date.now() - 60_000;
    const saved = await logMeal(tokens.a, { slot: "breakfast", title: "Poha and chai", loggedAt, items: [food({ name: "Poha", kcal: 250, proteinG: 5, carbsG: 45, fatG: 6 }), food({ name: "Chai", quantity: 1, unit: "cup", kcal: 90, proteinG: 3, carbsG: 12, fatG: 3 })] });
    assert.equal(saved.status, 201, JSON.stringify(saved.json));
    assert.match(saved.json.mealId, /^[0-9a-f-]{36}$/);
    state.breakfast = saved.json.mealId;
    const [[row]] = await connection.query("SELECT user_id, source, slot, DATE_FORMAT(log_date, '%Y-%m-%d') AS d FROM macro_meal_logs WHERE id = ?", [state.breakfast]);
    assert.deepEqual(row, { user_id: ids.a, source: "manual", slot: "breakfast", d: TODAY });
    assert.equal(await count("macro_meal_items", "macro_meal_id = ? AND user_id = ?", [state.breakfast, ids.a]), 2);

    const lunch = await logMeal(tokens.a, { slot: "lunch", title: "Paneer tikka bowl" });
    assert.equal(lunch.status, 201);
    state.lunch = lunch.json.mealId;

    const day = (await api("GET", `/api/macro/day?date=${TODAY}`, tokens.a)).json;
    assert.deepEqual(day.meals.map((m) => m.title), ["Poha and chai", "Paneer tikka bowl"], "in the order they were eaten");
    assert.deepEqual(day.meals[0].items.map((i) => i.name), ["Poha", "Chai"], "foods keep their order");
    assert.deepEqual(day.meals[0].totals, { kcal: 340, proteinG: 8, carbsG: 57, fatG: 9 });
    assert.deepEqual(day.totals, { kcal: 820, proteinG: 40, carbsG: 97, fatG: 27 });
    assert.equal(day.meals[0].loggedAt, new Date(loggedAt).toISOString());
    assert.deepEqual((await api("GET", `/api/macro/day?date=${TODAY}`, tokens.b)).json.meals, [], "another member sees none of it");
  }));

  it("4. the week strip grades each day against the target", run(async () => {
    const dates = [utcDay(-2), utcDay(-1), TODAY];
    const res = await api("GET", `/api/macro/progress?dates=${dates.join(",")}`, tokens.a);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json.days.map((d) => [d.date, d.kcal, d.status]), [[dates[0], 0, "none"], [dates[1], 0, "none"], [TODAY, 820, "low"]]);
    // Two more meals take today past 90% of 2000
    await logMeal(tokens.a, { slot: "dinner", title: "Dal rice", items: [food({ name: "Dal rice", kcal: 700 })] });
    await logMeal(tokens.a, { slot: "snack", title: "Banana", items: [food({ name: "Banana", quantity: 1, unit: "piece", kcal: 300 })] });
    const after = (await api("GET", `/api/macro/progress?dates=${TODAY}`, tokens.a)).json.days[0];
    assert.equal(after.kcal, 1820);
    assert.equal(after.status, "complete");
    assert.equal(after.target, 2000);
    assert.equal((await api("GET", `/api/macro/progress?dates=${TODAY}`, tokens.b)).json.days[0].status, "none", "no meals and no target for B");
  }));

  it("5. recent meals are the caller's own, newest first, limited", run(async () => {
    const res = await api("GET", `/api/macro/recent?today=${TODAY}&limit=2`, tokens.a);
    assert.equal(res.status, 200);
    assert.equal(res.json.meals.length, 2);
    assert.ok(res.json.meals[0].loggedAt >= res.json.meals[1].loggedAt);
    assert.equal((await api("GET", `/api/macro/recent?today=${TODAY}`, tokens.a)).json.meals.length, 4);
    assert.equal((await api("GET", `/api/macro/recent?today=${TODAY}`, tokens.b)).json.meals.length, 0);
  }));

  it("6. only the owner deletes a meal; anyone else gets the same 'not found' as a missing one", run(async () => {
    const other = await api("DELETE", `/api/macro/meals/${state.lunch}`, tokens.b);
    assert.equal(other.status, 404);
    assert.equal(other.json.error, "Meal not found");
    assert.equal((await api("DELETE", `/api/macro/meals/${crypto.randomUUID()}`, tokens.a)).json.error, "Meal not found", "identical answer for a missing meal");
    assert.equal(await count("macro_meal_logs", "id = ?", [state.lunch]), 1, "B's attempt changed nothing");
    const mine = await api("DELETE", `/api/macro/meals/${state.lunch}`, tokens.a);
    assert.equal(mine.status, 200);
    assert.equal(await count("macro_meal_logs", "id = ?", [state.lunch]), 0);
    assert.equal(await count("macro_meal_items", "macro_meal_id = ?", [state.lunch]), 0, "its foods went with it");
    assert.equal((await api("DELETE", `/api/macro/meals/${state.lunch}`, tokens.a)).status, 404, "a second delete is a 404");
  }));

  it("7. favourites: the heart toggles by source key, plain saves add, removal is owner-only", run(async () => {
    const key = `meal:${state.breakfast}`;
    const on = await api("POST", "/api/macro/favorites/toggle", tokens.a, { name: "Poha and chai", items: [food({ name: "Poha", kcal: 250 })], sourceKey: key });
    assert.equal(on.status, 200, JSON.stringify(on.json));
    assert.equal(on.json.favorited, true);
    state.favorite = on.json.favoriteId;
    const off = await api("POST", "/api/macro/favorites/toggle", tokens.a, { name: "Poha and chai", items: [food()], sourceKey: key });
    assert.deepEqual(off.json, { favorited: false });
    assert.equal(await count("macro_favorite_foods", "user_id = ?", [ids.a]), 0);
    const again = await api("POST", "/api/macro/favorites/toggle", tokens.a, { name: "Poha and chai", items: [food({ name: "Poha", kcal: 250, proteinG: 5, carbsG: 45, fatG: 6 })], sourceKey: key });
    state.favorite = again.json.favoriteId;
    // Two plain saves (no key) are two rows
    await api("POST", "/api/macro/favorites/toggle", tokens.a, { name: "Protein shake", items: [food({ name: "Shake", kcal: 200 })] });
    await api("POST", "/api/macro/favorites/toggle", tokens.a, { name: "Protein shake", items: [food({ name: "Shake", kcal: 200 })] });
    const list = (await api("GET", "/api/macro/favorites", tokens.a)).json.favorites;
    assert.equal(list.length, 3);
    assert.equal(list.find((f) => f.id === state.favorite).totals.kcal, 250);
    assert.deepEqual((await api("GET", "/api/macro/favorites", tokens.b)).json.favorites, [], "B sees none of A's favourites");
    // B can't remove A's favourite
    assert.equal((await api("DELETE", `/api/macro/favorites/${list[0].id}`, tokens.b)).status, 404);
    assert.equal(await count("macro_favorite_foods", "id = ?", [list[0].id]), 1);
    assert.equal((await api("DELETE", `/api/macro/favorites/${list[0].id}`, tokens.a)).status, 200);
  }));

  it("8. logging a favourite copies it into today; another member's favourite id is 'not found' and leaks nothing", run(async () => {
    const stolen = await api("POST", `/api/macro/favorites/${state.favorite}/log`, tokens.b, { date: TODAY, slot: "lunch", loggedAt: Date.now() });
    assert.equal(stolen.status, 404);
    assert.equal(stolen.json.error, "Favourite not found");
    assert.equal(await count("macro_meal_logs", "user_id = ?", [ids.b]), 0, "nothing was copied into B's day");
    const logged = await api("POST", `/api/macro/favorites/${state.favorite}/log`, tokens.a, { date: TODAY, slot: "snack", loggedAt: Date.now() });
    assert.equal(logged.status, 201, JSON.stringify(logged.json));
    const [[row]] = await connection.query("SELECT title, source, slot FROM macro_meal_logs WHERE id = ?", [logged.json.mealId]);
    assert.deepEqual(row, { title: "Poha and chai", source: "favorite", slot: "snack" });
  }));

  it("9. other days, bad input and SQL in any field are 400s, never 500s, and write nothing", run(async () => {
    const before = await count("macro_meal_logs", "user_id = ?", [ids.a]);
    const refused = await logMeal(tokens.a, { date: utcDay(-3) });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error, "Meals can only be logged for today");
    assert.equal((await logMeal(tokens.a, { date: utcDay(3) })).status, 400, "nor the future");
    for (const bad of [
      { items: [] }, { items: Array.from({ length: 51 }, () => food()) }, { slot: "brunch" }, { title: "  " },
      { items: [food({ kcal: 99999 })] }, { items: [food({ quantity: -1 })] }, { loggedAt: "now" },
      { source: "favorite" }, { userId: ids.b }, { date: "2026-10-14' OR '1'='1" },
      { title: "Robert'); DROP TABLE macro_meal_logs; --", items: [food({ name: "x'; DELETE FROM users; --", kcal: 6000 })] },
    ]) {
      const res = await logMeal(tokens.a, bad);
      assert.equal(res.status, 400, `${JSON.stringify(bad).slice(0, 80)} → ${res.status} ${JSON.stringify(res.json)}`);
    }
    for (const raw of ["not json", "[]", "null", "\"x\""]) assert.equal((await api("POST", "/api/macro/meals", tokens.a, raw)).status, 400, `${raw} is a 400`);
    assert.equal((await api("POST", "/api/macro/meals", tokens.a, JSON.stringify({ ...food(), pad: "x".repeat(70 * 1024) }))).status, 413, "an oversized body is refused");
    // SQL text stored as data
    const hostile = "Robert'); DROP TABLE macro_meal_logs; --";
    const stored = await logMeal(tokens.a, { title: hostile, items: [food({ name: hostile })] });
    assert.equal(stored.status, 201);
    assert.equal((await connection.query("SELECT title FROM macro_meal_logs WHERE id = ?", [stored.json.mealId]))[0][0].title, hostile);
    assert.equal(await count("macro_meal_logs", "user_id = ?", [ids.a]), before + 1, "only the valid meal was written");
    // Malformed ids and queries
    for (const bad of ["1", "' OR 1=1 --", "..%2F..%2Fetc"]) {
      assert.equal((await api("DELETE", `/api/macro/meals/${encodeURIComponent(bad)}`, tokens.a)).status, 400);
      assert.equal((await api("POST", `/api/macro/favorites/${encodeURIComponent(bad)}/log`, tokens.a, { date: TODAY, slot: "lunch", loggedAt: Date.now() })).status, 400);
    }
    for (const query of ["date=", "date=yesterday", `date=${encodeURIComponent("2026-10-14' OR 1=1")}`]) assert.equal((await api("GET", `/api/macro/day?${query}`, tokens.a)).status, 400);
    assert.equal((await api("GET", `/api/macro/progress?dates=${Array.from({ length: 41 }, () => TODAY).join(",")}`, tokens.a)).status, 400);
    assert.equal((await api("GET", `/api/macro/recent?today=${TODAY}&limit=500`, tokens.a)).status, 400);
    assert.equal((await api("GET", `/api/macro/recent?today=2020-01-01`, tokens.a)).status, 400);
  }));

  it("11. the period summary averages each day, keeps a 7-day trend, and counts only the caller's meals", run(async () => {
    // Past days can't be logged through the API (today only), so the history is written directly
    const seed = async (userId, date, kcal, p, c, f) => {
      const [[{ id }]] = await connection.query("SELECT UUID() AS id");
      await connection.query("INSERT INTO macro_meal_logs (id, user_id, log_date, slot, title, logged_at) VALUES (?, ?, ?, 'lunch', 'seeded', NOW(3))", [id, userId, date]);
      await connection.query("INSERT INTO macro_meal_items (macro_meal_id, user_id, position, name, quantity, unit, kcal, protein_g, carbs_g, fat_g) VALUES (?, ?, 0, 'seeded', 1, 'serving', ?, ?, ?, ?)", [id, userId, kcal, p, c, f]);
    };
    await seed(ids.a, utcDay(-1), 1500, 100, 150, 50);
    await seed(ids.a, utcDay(-5), 1000, 60, 120, 30);
    await seed(ids.a, utcDay(-20), 2100, 150, 200, 70); // inside the month, outside the week
    await seed(ids.b, utcDay(-1), 4999, 999, 999, 999); // another member's day never counts

    // What the database says A ate on each of the last 30 days
    const [rows] = await connection.query(
      "SELECT DATE_FORMAT(m.log_date, '%Y-%m-%d') AS d, SUM(i.kcal) AS kcal, SUM(i.protein_g) AS p FROM macro_meal_logs m JOIN macro_meal_items i ON i.macro_meal_id = m.id WHERE m.user_id = ? GROUP BY m.log_date",
      [ids.a],
    );
    const eaten = new Map(rows.map((r) => [r.d, { kcal: Number(r.kcal), p: Number(r.p) }]));
    const sumOver = (days, key) => Array.from({ length: days }, (_, i) => eaten.get(utcDay(-i))?.[key] ?? 0).reduce((a, b) => a + b, 0);

    for (const [period, days] of [["today", 1], ["week", 7], ["month", 30]]) {
      const res = await api("GET", `/api/macro/summary?period=${period}&today=${TODAY}`, tokens.a);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      const summary = res.json.summary;
      assert.equal(summary.period, period);
      assert.equal(summary.days, days);
      assert.equal(summary.avg.kcal, Math.round(sumOver(days, "kcal") / days), `${period}: average kcal per day`);
      assert.equal(summary.avg.proteinG, Math.round((sumOver(days, "p") / days) * 10) / 10, `${period}: average protein per day`);
      assert.deepEqual(summary.targets, { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
      // The trend is always the last 7 days, oldest first, whatever the period
      assert.deepEqual(summary.trend.map((d) => d.date), Array.from({ length: 7 }, (_, i) => utcDay(i - 6)));
      assert.equal(summary.trend[5].kcal, 1500, "yesterday");
      assert.equal(summary.trend[1].kcal, 1000, "five days ago");
      assert.equal(summary.trendAvg, Math.round(summary.trend.reduce((a, d) => a + d.kcal, 0) / 7));
    }
    const month = (await api("GET", `/api/macro/summary?period=month&today=${TODAY}`, tokens.a)).json.summary;
    const week = (await api("GET", `/api/macro/summary?period=week&today=${TODAY}`, tokens.a)).json.summary;
    assert.ok(month.avg.kcal * 30 - week.avg.kcal * 7 >= 2100 - 30, "the day 20 days ago counts in the month, not the week");

    // B has no target: no summary, so the screen shows its set-up state
    assert.deepEqual((await api("GET", `/api/macro/summary?period=week&today=${TODAY}`, tokens.b)).json, { summary: null });
    for (const query of ["period=year&today=" + TODAY, "period=week", "period=week&today=2020-01-01", `period=${encodeURIComponent("week' OR 1=1")}&today=${TODAY}`, ""]) {
      assert.equal((await api("GET", `/api/macro/summary?${query}`, tokens.a)).status, 400, `${query} is refused`);
    }
    assert.equal((await api("GET", `/api/macro/summary?period=week&today=${TODAY}`, null)).status, 401);
  }));

  it("9b. quick double saves both succeed (no deadlock), and a quantity that rounds to 0 is a 400", run(async () => {
    // Two saves for the same day at once: the member's row is locked, so they queue instead of
    // deadlocking on gap locks (which answered one of them with a 500)
    const [first, second] = await Promise.all([logMeal(tokens.b, { title: "Race one" }), logMeal(tokens.b, { title: "Race two" })]);
    assert.equal(first.status, 201, JSON.stringify(first.json));
    assert.equal(second.status, 201, JSON.stringify(second.json));
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM macro_meal_logs WHERE user_id = ? AND title LIKE 'Race %'", [ids.b]);
    assert.equal(n, 2);
    const tiny = await logMeal(tokens.b, { items: [food({ quantity: 0.004 })] });
    assert.equal(tiny.status, 400, JSON.stringify(tiny.json));
    assert.match(tiny.json.error, /quantity/i);
  }));

  it("10. a day holds at most 50 meals", run(async () => {
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM macro_meal_logs WHERE user_id = ? AND log_date = ?", [ids.a, TODAY]);
    for (let i = n; i < 50; i++) await connection.query("INSERT INTO macro_meal_logs (user_id, log_date, slot, title, logged_at) VALUES (?, ?, 'snack', 'filler', NOW(3))", [ids.a, TODAY]);
    const res = await logMeal(tokens.a);
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "Too many meals logged for one day");
  }));

  it("12. targets: read, set by hand (typed macros win, the rest follow the goal), limits, reset, and a trainer's target stays locked", run(async () => {
    const inputs = JSON.stringify({ age: 30, gender: "female", heightCm: 165, weightKg: 70, activityLevel: "lightly_active", fitnessGoal: "fat_loss" });
    const calculated = JSON.stringify({ rmrFormula: "mifflin_st_jeor", report: null, rmr: 1400, tdee: 1925, targetCalories: 1525, displayCalories: 1550, macros: { proteinG: 140, carbsG: 146, fatG: 43 } });
    await connection.query("UPDATE nutrition_targets SET inputs = ?, calculated = ?, calories = 2000, protein_g = 150, carbs_g = 200, fat_g = 60, source = 'calculated', reason = NULL, set_by = NULL WHERE user_id = ?", [inputs, calculated, ids.a]);
    const row = async (userId) => (await connection.query("SELECT calories, protein_g, carbs_g, fat_g, source, reason, set_by FROM nutrition_targets WHERE user_id = ?", [userId]))[0][0];

    for (const token of [null, "not-a-jwt"]) {
      assert.equal((await api("GET", "/api/macro/targets", token)).status, 401);
      assert.equal((await api("PUT", "/api/macro/targets", token, { kcal: 2200 })).status, 401);
      assert.equal((await api("POST", "/api/macro/targets/reset", token)).status, 401);
    }

    const before = await api("GET", "/api/macro/targets", tokens.a);
    assert.equal(before.status, 200, JSON.stringify(before.json));
    assert.deepEqual(
      { status: before.json.status, kcal: before.json.kcal, isManual: before.json.isManual, canReset: before.json.canReset, lockedByTrainer: before.json.lockedByTrainer, calculated: before.json.calculated },
      { status: "ready", kcal: 2000, isManual: false, canReset: false, lockedByTrainer: false, calculated: { kcal: 1550, proteinG: 140, carbsG: 146, fatG: 43 } },
    );

    // Calories only: the macros follow the calculator's split for the goal
    const set = await api("PUT", "/api/macro/targets", tokens.a, { kcal: 2200 });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual({ kcal: set.json.kcal, p: set.json.proteinG, c: set.json.carbsG, f: set.json.fatG, isManual: set.json.isManual, canReset: set.json.canReset }, { kcal: 2200, p: 138, c: 275, f: 61, isManual: true, canReset: true });
    assert.deepEqual(await row(ids.a), { calories: 2200, protein_g: 138, carbs_g: 275, fat_g: 61, source: "user_adjusted", reason: "Set on the Macro tab", set_by: ids.a });
    // A typed macro wins; the ones left out keep the split
    const typed = await api("PUT", "/api/macro/targets", tokens.a, { kcal: 2200, proteinG: 160.4 });
    assert.deepEqual({ p: typed.json.proteinG, c: typed.json.carbsG, f: typed.json.fatG }, { p: 160, c: 275, f: 61 });

    // Limits and bad input: 400s that change nothing
    const kept = await row(ids.a);
    for (const [body, message] of [
      [{ kcal: 999 }, /between 1000 and 5000/], [{ kcal: 5001 }, /between 1000 and 5000/], [{}, /Enter your daily calories/], [{ kcal: "2000" }, /Enter your daily calories/],
      [{ kcal: 2000, proteinG: 601 }, /Macro grams out of range/], [{ kcal: 2000, fatG: -1 }, /Macro grams out of range/], [{ kcal: 2000, carbsG: "50" }, /Macro grams out of range/],
      [{ kcal: 2000, userId: ids.b }, /unexpected field: userId/], [[2000], /as an object/],
    ]) {
      const res = await api("PUT", "/api/macro/targets", tokens.a, body);
      assert.equal(res.status, 400, `${JSON.stringify(body)} → ${res.status}`);
      assert.match(res.json.error, message);
    }
    assert.deepEqual(await row(ids.a), kept, "nothing changed");

    // Reset: back to the calculated numbers
    const reset = await api("POST", "/api/macro/targets/reset", tokens.a);
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    assert.deepEqual({ kcal: reset.json.kcal, p: reset.json.proteinG, isManual: reset.json.isManual, canReset: reset.json.canReset }, { kcal: 1550, p: 140, isManual: false, canReset: false });
    assert.deepEqual(await row(ids.a), { calories: 1550, protein_g: 140, carbs_g: 146, fat_g: 43, source: "calculated", reason: null, set_by: null });

    // B never finished setup: nothing to adjust, and nothing is created
    assert.deepEqual((await api("GET", "/api/macro/targets", tokens.b)).json, { status: "incomplete" });
    for (const [method, route, body] of [["PUT", "/api/macro/targets", { kcal: 2000 }], ["POST", "/api/macro/targets/reset", undefined]]) {
      const res = await api(method, route, tokens.b, body);
      assert.equal(res.status, 400);
      assert.equal(res.json.error, "Complete your profile before adjusting targets");
    }
    assert.equal(await row(ids.b), undefined, "no target row was created for B");

    // A trainer's target is locked for the member
    await connection.query(
      "INSERT INTO nutrition_targets (user_id, formula, config_version, inputs, calculated, calculated_at, calories, protein_g, carbs_g, fat_g, source, reason, set_by) VALUES (?, 'eato-calculator', 'test', ?, ?, NOW(), 1800, 130, 180, 60, 'trainer_adjusted', 'Cutting phase', ?)",
      [ids.b, inputs, calculated, ids.a],
    );
    const locked = await api("GET", "/api/macro/targets", tokens.b);
    assert.equal(locked.json.lockedByTrainer, true);
    assert.equal(locked.json.canReset, false);
    for (const [method, route, body] of [["PUT", "/api/macro/targets", { kcal: 2400 }], ["POST", "/api/macro/targets/reset", undefined]]) {
      const res = await api(method, route, tokens.b, body);
      assert.equal(res.status, 400);
      assert.equal(res.json.error, "Your trainer set this target. Ask them to change it.");
    }
    assert.deepEqual(await row(ids.b), { calories: 1800, protein_g: 130, carbs_g: 180, fat_g: 60, source: "trainer_adjusted", reason: "Cutting phase", set_by: ids.a }, "the trainer's target is untouched");
    assert.equal((await row(ids.a)).calories, 1550, "and A's is untouched by B's attempts");
  }));

  it("13. water: an estimate from the profile, today only, one target per day, owner-only removal, limits and reminders", run(async () => {
    // A has a profile (82 kg, very active: 82 × 30 + 750 = 3210 → 3.2 L); B has none (70 kg fallback, 2.1 L)
    await connection.query("INSERT INTO profiles (user_id, weight_kg, activity, health_flags) VALUES (?, 82, 'very_active', '[]')", [ids.a]);
    const day = async (token, date = TODAY) => (await api("GET", `/api/macro/water?date=${date}`, token)).json;

    for (const token of [null, "not-a-jwt"]) {
      assert.equal((await api("GET", `/api/macro/water?date=${TODAY}`, token)).status, 401);
      assert.equal((await api("POST", "/api/macro/water", token, { date: TODAY, amountMl: 250 })).status, 401);
      assert.equal((await api("DELETE", `/api/macro/water/${crypto.randomUUID()}`, token)).status, 401);
      assert.equal((await api("PUT", "/api/macro/water/reminders", token, { remindersEnabled: false })).status, 401);
    }

    const empty = await day(tokens.a);
    assert.deepEqual({ targetMl: empty.targetMl, base: empty.baseTargetMl, activity: empty.activityAdjustmentMl, consumed: empty.consumedMl, fallbacks: empty.usedFallbacks, entries: empty.entries.length }, { targetMl: 3200, base: 2460, activity: 750, consumed: 0, fallbacks: false, entries: 0 });
    assert.deepEqual(empty.preferences, { remindersEnabled: true, intervalHours: 2, startHour: 8, endHour: 20 }, "default reminder settings");
    const fallback = await day(tokens.b);
    assert.deepEqual({ targetMl: fallback.targetMl, fallbacks: fallback.usedFallbacks }, { targetMl: 2100, fallbacks: true });

    // Logging: the first entry writes the day's target; amounts are clamped into 10–3000 ml
    const glass = await api("POST", "/api/macro/water", tokens.a, { date: TODAY, amountMl: 250, source: "quick_add", label: "Glass" });
    assert.equal(glass.status, 201, JSON.stringify(glass.json));
    assert.equal((await api("POST", "/api/macro/water", tokens.a, { date: TODAY, amountMl: 99999, source: "custom" })).json.amountMl, 3000, "clamped to 3000");
    assert.equal((await api("POST", "/api/macro/water", tokens.a, { date: TODAY, amountMl: 1 })).json.amountMl, 10, "clamped to 10");
    let a = await day(tokens.a);
    assert.equal(a.consumedMl, 3260);
    assert.equal(a.remainingMl, 0);
    assert.deepEqual(a.entries.map((e) => e.amountMl).sort((x, y) => x - y), [10, 250, 3000]);
    assert.equal(a.entries.find((e) => e.amountMl === 250).label, "Glass");
    const [[cache]] = await connection.query("SELECT target_ml, consumed_ml FROM macro_hydration_days WHERE user_id = ? AND log_date = ?", [ids.a, TODAY]);
    assert.deepEqual(cache, { target_ml: 3200, consumed_ml: 3260 }, "the day row holds the target and the consumed cache");

    // The day keeps the target it showed even when the profile changes
    await connection.query("UPDATE profiles SET weight_kg = 50 WHERE user_id = ?", [ids.a]);
    assert.equal((await day(tokens.a)).targetMl, 3200);
    assert.equal((await day(tokens.a, utcDay(-1))).targetMl, 2300, "a day with nothing logged shows today's estimate (50 × 30 + 750 = 2.25 → 2.3 L)");

    // Today only, and bad input is refused
    for (const [body, pattern] of [
      [{ date: utcDay(-3), amountMl: 250 }, /only be logged for today/], [{ date: utcDay(3), amountMl: 250 }, /only be logged for today/],
      [{ date: TODAY }, /how much water/], [{ date: TODAY, amountMl: "250" }, /how much water/], [{ date: TODAY, amountMl: 250, source: "workout" }, /source/],
      [{ date: TODAY, amountMl: 250, userId: ids.b }, /unexpected field: userId/], [{ date: "2026-10-14' OR 1=1", amountMl: 250 }, /YYYY-MM-DD/], [{ date: TODAY, amountMl: 250, label: 5 }, /label/],
    ]) {
      const res = await api("POST", "/api/macro/water", tokens.a, body);
      assert.equal(res.status, 400, `${JSON.stringify(body)} → ${res.status}`);
      assert.match(res.json.error, pattern);
    }
    assert.equal((await day(tokens.a)).entries.length, 3, "nothing was added");

    // Removal: only the owner; someone else's entry answers like a missing one
    const entryId = a.entries.find((e) => e.amountMl === 3000).id;
    const stolen = await api("DELETE", `/api/macro/water/${entryId}`, tokens.b);
    assert.equal(stolen.status, 404);
    assert.equal(stolen.json.error, "Entry not found");
    assert.equal((await api("DELETE", `/api/macro/water/${crypto.randomUUID()}`, tokens.a)).json.error, "Entry not found");
    assert.equal((await api("DELETE", `/api/macro/water/${encodeURIComponent("1 OR 1=1")}`, tokens.a)).status, 400);
    assert.equal((await api("DELETE", `/api/macro/water/${entryId}`, tokens.a)).status, 200);
    a = await day(tokens.a);
    assert.equal(a.consumedMl, 260);
    assert.equal((await connection.query("SELECT consumed_ml FROM macro_hydration_days WHERE user_id = ? AND log_date = ?", [ids.a, TODAY]))[0][0].consumed_ml, 260, "the cache follows removals");
    // A past day's entry can't be removed
    await connection.query("INSERT INTO macro_water_logs (id, user_id, log_date, amount_ml) VALUES (UUID(), ?, ?, 500)", [ids.a, utcDay(-3)]);
    const [[old]] = await connection.query("SELECT id FROM macro_water_logs WHERE user_id = ? AND log_date = ?", [ids.a, utcDay(-3)]);
    assert.equal((await api("DELETE", `/api/macro/water/${old.id}`, tokens.a)).status, 400);
    assert.equal((await day(tokens.b)).entries.length, 0, "B sees none of A's water");

    // At most 60 entries a day
    for (let i = a.entries.length; i < 60; i++) await connection.query("INSERT INTO macro_water_logs (id, user_id, log_date, amount_ml) VALUES (UUID(), ?, ?, 10)", [ids.a, TODAY]);
    const full = await api("POST", "/api/macro/water", tokens.a, { date: TODAY, amountMl: 250 });
    assert.equal(full.status, 400);
    assert.equal(full.json.error, "Too many entries logged for one day");

    // Reminders: saved per member, clamped, and the window must make sense
    const off = await api("PUT", "/api/macro/water/reminders", tokens.a, { remindersEnabled: false, intervalHours: 99, startHour: 7 });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    assert.deepEqual(off.json.preferences, { remindersEnabled: false, intervalHours: 12, startHour: 7, endHour: 20 });
    assert.deepEqual((await day(tokens.a)).preferences, off.json.preferences);
    assert.equal((await day(tokens.b)).preferences.remindersEnabled, true, "B keeps the defaults");
    for (const body of [{ remindersEnabled: true, startHour: 20, endHour: 8 }, { remindersEnabled: "yes" }, { remindersEnabled: true, userId: ids.b }, { remindersEnabled: true, intervalHours: "2" }]) {
      assert.equal((await api("PUT", "/api/macro/water/reminders", tokens.a, body)).status, 400, JSON.stringify(body));
    }
  }));
});
