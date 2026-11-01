// Super Admin › AI Usage: what the AI features cost. Reads ai_usage (written by ai/usage.js on
// every AI call), the budget and its alerts. Every route is admin-only (admin/routes.js), and
// every value from the request goes through ai/rules.js and a parameterised query.
const rules = require("../ai/rules");
const usage = require("../ai/usage");
const { NotFoundError } = require("../errors");

const num = (value) => Number(value ?? 0);

const round6 = (value) => Math.round(value * 1_000_000) / 1_000_000;

// The totals of a group of calls, with what one call costs on average (cache hits included: they
// are free answers the members got) and how many were answered from the server's cache
const totalsOf = (row) => ({
  requests: num(row.requests),
  inputTokens: num(row.inputTokens),
  cachedInputTokens: num(row.cachedInputTokens),
  outputTokens: num(row.outputTokens),
  tokens: num(row.tokens),
  costInr: num(row.costInr),
  fromCache: num(row.fromCache),
  avgCostInr: num(row.requests) > 0 ? round6(num(row.costInr) / num(row.requests)) : 0,
});

const TOTALS = "COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(total_tokens), 0) AS tokens, COALESCE(SUM(cost_inr), 0) AS costInr, COALESCE(SUM(from_cache), 0) AS fromCache";

// The members who cost the most in the period (the admin sees who, to spot a runaway account)
const TOP_MEMBERS = 10;

/**
 * Everything the AI Usage screen shows for one period: all-time and period totals (with the
 * previous period to compare), each feature with its models, outcomes and average cost per call,
 * the charts' series, the cost by model, the members who cost the most, and the budget.
 */
async function summary(pool, { period }) {
  const days = rules.periodDays(period);
  // The period's window, as SQL on the database clock (the admin sees the server's day)
  const current = "created_at >= CURDATE() - INTERVAL ? DAY";
  const currentParams = [days - 1];
  const previous = "created_at >= CURDATE() - INTERVAL ? DAY AND created_at < CURDATE() - INTERVAL ? DAY";
  const previousParams = [2 * days - 1, days - 1];

  const [[dates]] = await pool.query(
    "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today, DATE_FORMAT(CURDATE() - INTERVAL ? DAY, '%Y-%m-%d') AS fromDate",
    [days - 1],
  );
  const [[allTime]] = await pool.query(`SELECT ${TOTALS} FROM ai_usage`);
  const [[cur]] = await pool.query(`SELECT ${TOTALS} FROM ai_usage WHERE ${current}`, currentParams);
  const [[prev]] = await pool.query(`SELECT ${TOTALS} FROM ai_usage WHERE ${previous}`, previousParams);
  const [[today]] = await pool.query("SELECT COALESCE(SUM(cost_inr), 0) AS costInr, COUNT(*) AS requests FROM ai_usage WHERE DATE(created_at) = CURDATE()");
  const [[month]] = await pool.query("SELECT COALESCE(SUM(cost_inr), 0) AS costInr, COUNT(*) AS requests FROM ai_usage WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')");

  const [features] = await pool.query(
    `SELECT feature, ${TOTALS}, SUM(status = 'ok') AS ok, SUM(status = 'failed') AS failed, SUM(status = 'refused') AS refused
     FROM ai_usage WHERE ${current} GROUP BY feature`,
    currentParams,
  );
  const [models] = await pool.query(
    `SELECT feature, model, provider, ${TOTALS} FROM ai_usage WHERE ${current} GROUP BY feature, model, provider ORDER BY costInr DESC, requests DESC`,
    currentParams,
  );
  const [byModel] = await pool.query(
    `SELECT model, provider, ${TOTALS} FROM ai_usage WHERE ${current} GROUP BY model, provider ORDER BY costInr DESC, requests DESC`,
    currentParams,
  );
  const [series] = period === "day"
    ? await pool.query(`SELECT DATE_FORMAT(created_at, '%H') AS k, ${TOTALS} FROM ai_usage WHERE DATE(created_at) = CURDATE() GROUP BY k`)
    : await pool.query(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS k, ${TOTALS} FROM ai_usage WHERE ${current} GROUP BY k`, currentParams);
  const [members] = await pool.query(
    `SELECT u.user_id, us.full_name, ${TOTALS} FROM ai_usage u LEFT JOIN users us ON us.id = u.user_id
     WHERE ${current.replace("created_at", "u.created_at")} AND u.user_id IS NOT NULL GROUP BY u.user_id, us.full_name ORDER BY costInr DESC, requests DESC LIMIT ${TOP_MEMBERS}`,
    currentParams,
  );

  return {
    period,
    range: { from: dates.fromDate, to: dates.today },
    allTime: totalsOf(allTime),
    today: { costInr: num(today.costInr), requests: num(today.requests) },
    month: { costInr: num(month.costInr), requests: num(month.requests) },
    current: totalsOf(cur),
    previous: totalsOf(prev),
    features: features.map((f) => ({
      feature: f.feature,
      ...totalsOf(f),
      ok: num(f.ok),
      failed: num(f.failed),
      refused: num(f.refused),
      models: models.filter((m) => m.feature === f.feature).map((m) => ({ model: m.model, provider: m.provider, ...totalsOf(m) })),
    })),
    byModel: byModel.map((m) => ({ model: m.model, provider: m.provider, ...totalsOf(m) })),
    topMembers: members.map((m) => ({ userId: m.user_id, userName: m.full_name, ...totalsOf(m) })),
    series: rules.fillSeries(rules.seriesKeys(period, dates.fromDate), series),
    budget: await usage.budgetStatus(pool),
  };
}

// The usage history: one page of calls, newest first unless sorted otherwise. The sort fragment
// comes from this list, never from the request.
const ORDER = {
  newest: "u.created_at DESC, u.id DESC",
  oldest: "u.created_at ASC, u.id ASC",
  cost: "u.cost_inr DESC, u.id DESC",
  tokens: "u.total_tokens DESC, u.id DESC",
};

async function history(pool, q) {
  const where = [];
  const params = [];
  if (q.feature) { where.push("u.feature = ?"); params.push(q.feature); }
  if (q.status) { where.push("u.status = ?"); params.push(q.status); }
  if (q.model) { where.push("u.model = ?"); params.push(q.model); }
  if (q.from) { where.push("u.created_at >= ?"); params.push(q.from); }
  if (q.to) { where.push("u.created_at < DATE_ADD(?, INTERVAL 1 DAY)"); params.push(q.to); }
  if (q.search) {
    // Matches an account id, a name or a model; LIKE wildcards in the text are matched literally
    const like = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(u.user_id LIKE ? OR us.full_name LIKE ? OR u.model LIKE ?)");
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM ai_usage u LEFT JOIN users us ON us.id = u.user_id ${whereSql}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from}`, params);
  const [rows] = await pool.query(
    `SELECT u.id, u.created_at, u.user_id, us.full_name, u.gym_id, u.feature, u.provider, u.model, u.input_tokens, u.cached_input_tokens, u.output_tokens,
            u.total_tokens, u.cost_inr, u.status, u.from_cache, u.duration_ms
     ${from} ORDER BY ${ORDER[q.sort]} LIMIT ? OFFSET ?`,
    [...params, rules.PAGE_SIZE, (q.page - 1) * rules.PAGE_SIZE],
  );
  return {
    page: q.page,
    pageSize: rules.PAGE_SIZE,
    total: num(total),
    rows: rows.map((r) => ({
      id: String(r.id),
      at: new Date(r.created_at).toISOString(),
      userId: r.user_id,
      userName: r.full_name,
      gymId: r.gym_id,
      feature: r.feature,
      provider: r.provider,
      model: r.model,
      inputTokens: num(r.input_tokens),
      cachedInputTokens: num(r.cached_input_tokens),
      outputTokens: num(r.output_tokens),
      totalTokens: num(r.total_tokens),
      costInr: num(r.cost_inr),
      status: r.status,
      fromCache: Boolean(r.from_cache),
      durationMs: r.duration_ms === null ? null : num(r.duration_ms),
    })),
  };
}

// The budget screen: the settings, this month, and the alerts (open first)
async function budget(pool) {
  const [row, status] = await Promise.all([usage.settings(pool), usage.budgetStatus(pool)]);
  const [alerts] = await pool.query(
    `SELECT a.id, a.kind, a.period, a.threshold, a.spent_inr, a.detail, a.created_at, a.acknowledged_at
     FROM ai_budget_alerts a ORDER BY (a.acknowledged_at IS NULL) DESC, a.created_at DESC LIMIT 30`,
  );
  const [[by]] = row?.updated_by ? await pool.query("SELECT full_name FROM users WHERE id = ?", [row.updated_by]) : [[null]];
  return {
    settings: {
      monthlyLimitInr: row ? Number(row.monthly_limit_inr) : 0,
      usdToInr: row ? Number(row.usd_to_inr) : rules.DEFAULT_USD_TO_INR,
      alert50: Boolean(row?.alert_50),
      alert75: Boolean(row?.alert_75),
      alert90: Boolean(row?.alert_90),
      alert100: Boolean(row?.alert_100),
      spikeAlerts: Boolean(row?.spike_alerts),
      updatedBy: by?.full_name ?? null,
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    },
    month: status,
    alerts: alerts.map((a) => ({
      id: String(a.id),
      kind: a.kind,
      period: a.period,
      threshold: num(a.threshold),
      spentInr: num(a.spent_inr),
      detail: a.detail,
      at: new Date(a.created_at).toISOString(),
      acknowledgedAt: a.acknowledged_at ? new Date(a.acknowledged_at).toISOString() : null,
    })),
  };
}

// Saves the settings (who changed them is kept on the row): new calls use the new rate at once,
// and the alerts are checked straight away so a lower limit shows its effect immediately
async function saveBudget(pool, adminId, values) {
  await pool.query(
    `INSERT INTO ai_budget (id, monthly_limit_inr, usd_to_inr, alert_50, alert_75, alert_90, alert_100, spike_alerts, updated_by)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE monthly_limit_inr = VALUES(monthly_limit_inr), usd_to_inr = VALUES(usd_to_inr), alert_50 = VALUES(alert_50),
       alert_75 = VALUES(alert_75), alert_90 = VALUES(alert_90), alert_100 = VALUES(alert_100), spike_alerts = VALUES(spike_alerts),
       updated_by = VALUES(updated_by)`,
    [values.monthlyLimitInr, values.usdToInr, values.alert50, values.alert75, values.alert90, values.alert100, values.spikeAlerts, adminId],
  );
  usage.refreshPricing();
  await usage.checkAlerts(pool);
  return budget(pool);
}

async function acknowledgeAlert(pool, id) {
  const [result] = await pool.query("UPDATE ai_budget_alerts SET acknowledged_at = NOW() WHERE id = ? AND acknowledged_at IS NULL", [id]);
  if (result.affectedRows === 0) {
    const [[exists]] = await pool.query("SELECT id FROM ai_budget_alerts WHERE id = ?", [id]);
    if (!exists) throw new NotFoundError("That alert doesn't exist.");
  }
  return budget(pool);
}

module.exports = { summary, history, budget, saveBudget, acknowledgeAlert };
