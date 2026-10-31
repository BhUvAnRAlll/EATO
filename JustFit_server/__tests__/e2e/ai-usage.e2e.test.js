// Super Admin › AI Usage end to end: the real Express server (fake AI) against justfit_test.
// Covers recording (a food scan leaves one ai_usage row and nothing else), the summary for a
// period (all-time, today, the period and the one before, features, models, series, budget),
// the history (filters, search, sort, pages), the budget (settings, thresholds and spike
// alerts, acknowledging), and the attack paths: no or forged session, a member, bad filters,
// SQL in a search, unexpected fields.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, describeIdentityError } = require("./test-identities.js");

describe("ai usage e2e: recording, the admin summary, history and budget", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;
  const identities = {};
  const ids = {};
  const tokens = {};
  const MODEL = `test-model-${runId}`;

  const api = async (method, route, token, body) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${server.baseUrl}${route}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    let json = null;
    try { json = await response.json(); } catch { /* empty */ }
    return { status: response.status, json };
  };
  const count = async (sql, params = []) => Number((await connection.query(sql, params))[0][0].n);
  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.000001, `${what}: ${a} vs ${b}`);

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, `schema.sql should create ${db.SCHEMA_TABLE_COUNT} tables in justfit_test`);
    testAccounts = identitiesFor(env);
    server = await startTestServer({ ...env, AI_PROVIDER: "fake" });
    try {
      for (const [tag, role] of [["admin", "admin"], ["member", "user"]]) {
        const identity = await testAccounts.createIdentity(runId, tag, { role });
        const { sessionId, jwt } = await testAccounts.mintToken(identity.id);
        identities[tag] = { ...identity, sessionId };
        ids[tag] = identity.id;
        tokens[tag] = jwt;
      }
    } catch (error) {
      throw new Error(`could not create a test identity or session: ${JSON.stringify(describeIdentityError(error))}`);
    }
    await connection.query("UPDATE users SET full_name = 'Maya Ortiz' WHERE id = ?", [ids.admin]);
    await connection.query("UPDATE users SET full_name = 'Priya Patel' WHERE id = ?", [ids.member]);
  });

  after(async () => {
    const problems = [];
    if (connection) {
      try {
        await connection.query("DELETE FROM ai_usage");
        await connection.query("DELETE FROM ai_budget_alerts");
        await connection.query("DELETE FROM ai_model_prices WHERE model = ?", [MODEL]);
        await connection.query("UPDATE ai_budget SET monthly_limit_inr = 4000, usd_to_inr = 84, alert_50 = 1, alert_75 = 1, alert_90 = 1, alert_100 = 1, spike_alerts = 1, updated_by = NULL WHERE id = 1");
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

  const ROUTES = [
    ["GET", "/api/admin/portal/ai-usage/summary"],
    ["GET", "/api/admin/portal/ai-usage/history"],
    ["GET", "/api/admin/portal/ai-usage/budget"],
    ["PUT", "/api/admin/portal/ai-usage/budget", { monthlyLimitInr: 1, usdToInr: 84, alert50: true, alert75: true, alert90: true, alert100: true, spikeAlerts: true }],
    ["POST", "/api/admin/portal/ai-usage/alerts/1/acknowledge"],
  ];

  it("1. every route needs a valid session and the admin role", run(async () => {
    for (const [method, route, body] of ROUTES) {
      assert.equal((await api(method, route, null, body)).status, 401, `${method} ${route} without a token`);
      assert.equal((await api(method, route, "jfs_forged-token-that-was-never-issued", body)).status, 401, `${method} ${route} forged`);
      assert.equal((await api(method, route, tokens.member, body)).status, 403, `${method} ${route} as a member`);
    }
  }));

  it("2. an AI call leaves one usage row (who, feature, model, outcome) and nothing about its content", run(async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]).toString("base64");
    const scan = await api("POST", "/api/macro/scan", tokens.member, { data: jpeg, mediaType: "image/jpeg", hint: "'; DROP TABLE ai_usage; --" });
    assert.equal(scan.status, 200, JSON.stringify(scan.json));
    const [rows] = await connection.query("SELECT user_id, gym_id, feature, provider, model, input_tokens, cached_input_tokens, output_tokens, total_tokens, cost_inr, status, from_cache, duration_ms FROM ai_usage");
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.deepEqual(
      { user: row.user_id, gym: row.gym_id, feature: row.feature, provider: row.provider, model: row.model, tokens: [row.input_tokens, row.cached_input_tokens, row.output_tokens, row.total_tokens], cost: Number(row.cost_inr), status: row.status, fromCache: row.from_cache },
      { user: ids.member, gym: null, feature: "food_scan", provider: "openai", model: "fake", tokens: [10, 0, 5, 15], cost: 0, status: "ok", fromCache: 0 },
    );
    assert.ok(row.duration_ms !== null && row.duration_ms >= 0);
    // The table has no column that could hold the photo or the note
    const [columns] = await connection.query("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_usage'");
    assert.ok(!columns.some(({ c }) => /text|prompt|photo|body|content/i.test(c)));
  }));

  it("3. the summary: all-time, today, the period against the one before, features with models, series, budget", run(async () => {
    await connection.query("INSERT INTO ai_model_prices (model, provider, input_usd_per_million, output_usd_per_million) VALUES (?, 'openai', 1, 2)", [MODEL]);
    const insert = (daysAgo, feature, status, input, output, cost, user = ids.member, provider = "openai", model = MODEL) =>
      connection.query(
        "INSERT INTO ai_usage (created_at, user_id, feature, provider, model, input_tokens, output_tokens, cost_inr, status) VALUES (NOW() - INTERVAL ? DAY, ?, ?, ?, ?, ?, ?, ?, ?)",
        [daysAgo, user, feature, provider, model, input, output, cost, status],
      );
    await insert(0, "coach_chat", "ok", 1000, 500, 50);
    await insert(0, "coach_chat", "ok", 1000, 500, 50, ids.admin);
    await insert(0, "coach_plan", "ok", 2000, 1000, 100);
    await insert(0, "food_scan", "failed", 0, 0, 0);
    await insert(0, "gym_assistant", "ok", 500, 100, 25, null);
    await insert(3, "coach_chat", "ok", 4000, 2000, 200);
    await insert(10, "body_scan", "ok", 0, 0, 0, ids.member, "forma", "forma");
    await insert(40, "coach_chat", "ok", 10000, 5000, 500);

    const week = await api("GET", "/api/admin/portal/ai-usage/summary?period=week", tokens.admin);
    assert.equal(week.status, 200, JSON.stringify(week.json));
    const s = week.json;
    assert.equal(s.period, "week");
    assert.deepEqual({ requests: s.allTime.requests, tokens: s.allTime.tokens }, { requests: 9, tokens: 15 + 1500 + 1500 + 3000 + 0 + 600 + 6000 + 0 + 15000 });
    near(s.allTime.costInr, 925, "all-time cost");
    near(s.allTime.avgCostInr, 925 / 9, "average cost");
    near(s.today.costInr, 225, "today's cost");
    assert.equal(s.today.requests, 6);
    assert.ok(s.month.costInr >= 225 - 0.000001 && s.month.costInr <= 925, "this month is between today and all time");
    assert.deepEqual({ requests: s.current.requests, previous: s.previous.requests }, { requests: 7, previous: 1 });
    near(s.current.costInr, 425, "the week's cost");
    near(s.previous.costInr, 0, "the week before");
    const chat = s.features.find((f) => f.feature === "coach_chat");
    assert.deepEqual({ requests: chat.requests, ok: chat.ok, failed: chat.failed, models: chat.models.map((m) => m.model) }, { requests: 3, ok: 3, failed: 0, models: [MODEL] });
    near(chat.costInr, 300, "coach chat cost");
    const food = s.features.find((f) => f.feature === "food_scan");
    assert.deepEqual({ requests: food.requests, ok: food.ok, failed: food.failed, models: food.models.map((m) => m.model).sort() }, { requests: 2, ok: 1, failed: 1, models: ["fake", MODEL].sort() });
    assert.ok(!s.features.some((f) => f.feature === "body_scan"), "last week's scan is not in this week");
    assert.equal(s.series.length, 7);
    assert.equal(s.series.at(-1).key, s.range.to);
    near(s.series.reduce((sum, p) => sum + p.costInr, 0), s.current.costInr, "the series adds up to the period");
    assert.equal(s.byModel[0].model, MODEL, "the dearest model first");
    near(chat.avgCostInr, 100, "the average cost of a coaching message");
    assert.deepEqual({ cached: s.allTime.cachedInputTokens, fromCache: s.allTime.fromCache }, { cached: 0, fromCache: 0 });
    assert.deepEqual(s.topMembers.map((m) => [m.userName, m.requests]), [["Priya Patel", 5], ["Maya Ortiz", 1]], "the dearest members first; the gym's own calls have no member");
    near(s.topMembers[0].costInr, 350, "the member's week: today's chat, plan and scan, and the chat three days ago");
    assert.deepEqual({ limit: s.budget.monthlyLimitInr, open: s.budget.openAlerts }, { limit: 4000, open: 0 });
    near(s.budget.spentInr, s.month.costInr, "budget spend is this month's cost");

    const day = (await api("GET", "/api/admin/portal/ai-usage/summary?period=day", tokens.admin)).json;
    assert.deepEqual({ requests: day.current.requests, previous: day.previous.requests, points: day.series.length, first: day.series[0].key }, { requests: 6, previous: 0, points: 24, first: "00" });
    const month = (await api("GET", "/api/admin/portal/ai-usage/summary?period=month", tokens.admin)).json;
    assert.deepEqual({ requests: month.current.requests, previous: month.previous.requests, points: month.series.length }, { requests: 8, previous: 1, points: 30 });
    assert.equal((await api("GET", "/api/admin/portal/ai-usage/summary", tokens.admin)).json.period, "week", "a week by default");
    assert.equal((await api("GET", "/api/admin/portal/ai-usage/summary?period=year", tokens.admin)).status, 400);
  }));

  it("4. the history: newest first, filters, a literal search, sorting and pages; bad filters are 400s", run(async () => {
    const all = await api("GET", "/api/admin/portal/ai-usage/history", tokens.admin);
    assert.equal(all.status, 200, JSON.stringify(all.json));
    assert.deepEqual({ page: all.json.page, pageSize: all.json.pageSize, total: all.json.total, rows: all.json.rows.length }, { page: 1, pageSize: 25, total: 9, rows: 9 });
    assert.ok(all.json.rows.every((r, i, rows) => i === 0 || rows[i - 1].at >= r.at), "newest first");
    assert.deepEqual(Object.keys(all.json.rows[0]).sort(), ["at", "cachedInputTokens", "costInr", "durationMs", "feature", "fromCache", "gymId", "id", "inputTokens", "model", "outputTokens", "provider", "status", "totalTokens", "userId", "userName"]);
    const q = async (query) => (await api("GET", `/api/admin/portal/ai-usage/history?${query}`, tokens.admin)).json;
    assert.equal((await q("feature=coach_chat")).total, 4);
    assert.equal((await q("status=failed")).total, 1);
    assert.equal((await q(`model=${MODEL}`)).total, 7);
    assert.equal((await q("search=Priya")).rows.every((r) => r.userName === "Priya Patel"), true);
    assert.equal((await q("search=Priya")).total, 7);
    assert.equal((await q("search=Maya")).total, 1);
    assert.equal((await q(`search=${encodeURIComponent("' OR 1=1 --")}`)).total, 0, "SQL in a search matches nothing");
    assert.equal((await q(`search=${encodeURIComponent("%")}`)).total, 0, "a wildcard is matched literally");
    assert.equal((await q("sort=cost")).rows[0].costInr, 500);
    assert.equal((await q("sort=tokens")).rows[0].totalTokens, 15000);
    assert.equal((await q("sort=oldest")).rows[0].costInr, 500);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await q(`from=${today}&to=${today}`)).total, 6);
    assert.equal((await q("page=2")).rows.length, 0);
    for (const bad of ["feature=trainer", "status=deleted", "sort=u.cost_inr", "page=0", "page=abc", "from=yesterday", "from=2026-10-30&to=2026-10-01", `model=${"m".repeat(65)}`]) {
      assert.equal((await api("GET", `/api/admin/portal/ai-usage/history?${bad}`, tokens.admin)).status, 400, bad);
    }
  }));

  it("5. the budget: defaults, saving (who and when), the threshold and spike alerts once each, acknowledging", run(async () => {
    const start = await api("GET", "/api/admin/portal/ai-usage/budget", tokens.admin);
    assert.equal(start.status, 200, JSON.stringify(start.json));
    assert.deepEqual(start.json.settings, { monthlyLimitInr: 4000, usdToInr: 84, alert50: true, alert75: true, alert90: true, alert100: true, spikeAlerts: true, updatedBy: null, updatedAt: start.json.settings.updatedAt });
    assert.deepEqual(start.json.alerts, []);

    // A ₹200 limit with ₹225+ spent this month crosses every threshold, and today's ₹225 is a spike
    const saved = await api("PUT", "/api/admin/portal/ai-usage/budget", tokens.admin, { monthlyLimitInr: 200, usdToInr: 90, alert50: true, alert75: true, alert90: false, alert100: true, spikeAlerts: true });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual({ limit: saved.json.settings.monthlyLimitInr, rate: saved.json.settings.usdToInr, by: saved.json.settings.updatedBy, alert90: saved.json.settings.alert90 }, { limit: 200, rate: 90, by: "Maya Ortiz", alert90: false });
    assert.match(saved.json.alerts.find((a) => a.threshold === 50).detail, /₹200\.00 monthly budget/);
    assert.ok(saved.json.month.percent >= 112, `percent ${saved.json.month.percent}`);
    assert.equal(saved.json.month.remainingInr, 0);
    const kinds = saved.json.alerts.map((a) => `${a.kind}:${a.threshold}`).sort();
    assert.deepEqual(kinds, ["spike:0", "threshold:100", "threshold:50", "threshold:75"], "the 90% alert is off");
    assert.ok(saved.json.alerts.every((a) => a.acknowledgedAt === null && typeof a.detail === "string" && a.detail.length > 0));
    assert.equal(saved.json.month.openAlerts, 4);

    // Saving again files nothing twice
    const again = await api("PUT", "/api/admin/portal/ai-usage/budget", tokens.admin, { monthlyLimitInr: 200, usdToInr: 90, alert50: true, alert75: true, alert90: false, alert100: true, spikeAlerts: true });
    assert.equal(again.json.alerts.length, 4);
    assert.equal(await count("SELECT COUNT(*) AS n FROM ai_budget_alerts"), 4);

    // Acknowledge one; a second time changes nothing; an unknown one is a 404
    const first = saved.json.alerts[0].id;
    const acked = await api("POST", `/api/admin/portal/ai-usage/alerts/${first}/acknowledge`, tokens.admin);
    assert.equal(acked.status, 200, JSON.stringify(acked.json));
    assert.equal(acked.json.month.openAlerts, 3);
    assert.ok(acked.json.alerts.find((a) => a.id === first).acknowledgedAt !== null);
    assert.equal((await api("POST", `/api/admin/portal/ai-usage/alerts/${first}/acknowledge`, tokens.admin)).json.month.openAlerts, 3);
    assert.equal((await api("POST", "/api/admin/portal/ai-usage/alerts/999999/acknowledge", tokens.admin)).status, 404);
    assert.equal((await api("POST", "/api/admin/portal/ai-usage/alerts/1%20OR%201/acknowledge", tokens.admin)).status, 400);

    // Bad settings change nothing
    for (const body of [
      { monthlyLimitInr: -1, usdToInr: 84, alert50: true, alert75: true, alert90: true, alert100: true, spikeAlerts: true },
      { monthlyLimitInr: "200", usdToInr: 84, alert50: true, alert75: true, alert90: true, alert100: true, spikeAlerts: true },
      { monthlyLimitInr: 200, usdToInr: 0, alert50: true, alert75: true, alert90: true, alert100: true, spikeAlerts: true },
      { monthlyLimitInr: 200, usdToInr: 84, alert50: "yes", alert75: true, alert90: true, alert100: true, spikeAlerts: true },
      { monthlyLimitInr: 200, usdToInr: 84, alert50: true, alert75: true, alert90: true, alert100: true, spikeAlerts: true, adminId: ids.member },
      { monthlyLimitInr: 200 },
      [],
      "{not json",
    ]) {
      const r = await api("PUT", "/api/admin/portal/ai-usage/budget", tokens.admin, body);
      assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 60)} → ${JSON.stringify(r.json)}`);
    }
    const [[row]] = await connection.query("SELECT monthly_limit_inr, usd_to_inr, alert_90, updated_by FROM ai_budget WHERE id = 1");
    assert.deepEqual({ limit: Number(row.monthly_limit_inr), rate: Number(row.usd_to_inr), alert90: Boolean(row.alert_90), by: row.updated_by }, { limit: 200, rate: 90, alert90: false, by: ids.admin });
  }));
});
