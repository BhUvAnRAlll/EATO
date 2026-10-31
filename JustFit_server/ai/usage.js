// Records every AI call the server makes (ai_usage) and fires the budget alerts. Called from the
// AI modules through a tracker; it never throws, so a bookkeeping problem can't fail a member's
// request. Until migrations/2026-11-03-ai-usage.sql has run, nothing is recorded (one log line).
const rules = require("./rules");

const PRICE_TTL_MS = 5 * 60 * 1000;
let priceCache = { at: 0, byModel: new Map() };
let warnedMissing = false;
let warnedColumns = false;
// Before migrations/2026-11-04-ai-cost-optimization.sql has run, the cached-token columns don't
// exist yet: rows are then written the old way (and cached tokens are billed at the full price)
let legacyColumns = false;

const missingTable = (error) => error?.code === "ER_NO_SUCH_TABLE";
const missingColumn = (error) => error?.code === "ER_BAD_FIELD_ERROR";

const warnOnce = () => {
  if (warnedMissing) return;
  warnedMissing = true;
  console.log("AI usage isn't recorded until migrations/2026-11-03-ai-usage.sql has run");
};
const warnColumnsOnce = () => {
  if (warnedColumns) return;
  warnedColumns = true;
  console.log("AI usage: cached tokens aren't recorded until migrations/2026-11-04-ai-cost-optimization.sql has run");
};

// The price rows and the exchange rate, refreshed every five minutes
async function pricing(pool) {
  if (Date.now() - priceCache.at > PRICE_TTL_MS) {
    let rows;
    if (legacyColumns) {
      [rows] = await pool.query("SELECT model, input_usd_per_million, output_usd_per_million, request_usd FROM ai_model_prices");
    } else {
      try {
        [rows] = await pool.query("SELECT model, input_usd_per_million, cached_input_usd_per_million, output_usd_per_million, request_usd FROM ai_model_prices");
      } catch (error) {
        if (!missingColumn(error)) throw error;
        legacyColumns = true;
        warnColumnsOnce();
        [rows] = await pool.query("SELECT model, input_usd_per_million, output_usd_per_million, request_usd FROM ai_model_prices");
      }
    }
    const [[budget]] = await pool.query("SELECT usd_to_inr FROM ai_budget WHERE id = 1");
    priceCache = { at: Date.now(), byModel: new Map(rows.map((r) => [r.model, r])), usdToInr: Number(budget?.usd_to_inr ?? rules.DEFAULT_USD_TO_INR) };
  }
  return priceCache;
}

/** What a call with these tokens costs right now, in rupees (the admin's price table and rate) */
async function priceCall(pool, { model, inputTokens = 0, outputTokens = 0, cachedInputTokens = 0 }) {
  const { byModel, usdToInr } = await pricing(pool);
  return rules.costInr(byModel.get(model) ?? null, inputTokens, outputTokens, usdToInr, cachedInputTokens);
}

const insertRow = (pool, row, cost) =>
  legacyColumns
    ? pool.query(
        `INSERT INTO ai_usage (user_id, gym_id, feature, provider, model, input_tokens, output_tokens, cost_inr, status, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.userId, row.gymId, row.feature, row.provider, row.model, row.inputTokens, row.outputTokens, cost, row.status, row.durationMs],
      )
    : pool.query(
        `INSERT INTO ai_usage (user_id, gym_id, feature, provider, model, input_tokens, cached_input_tokens, output_tokens, cost_inr, status, from_cache, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.userId, row.gymId, row.feature, row.provider, row.model, row.inputTokens, row.cachedInputTokens, row.outputTokens, cost, row.status, row.fromCache, row.durationMs],
      );

/**
 * Writes one usage row and checks the budget alerts. Returns the row id, or null when nothing
 * was recorded. Never throws.
 */
async function recordAiUsage(pool, input) {
  try {
    const row = rules.usageRow(input);
    const cost = row.fromCache ? 0 : await priceCall(pool, row);
    let result;
    try {
      [result] = await insertRow(pool, row, cost);
    } catch (error) {
      if (!missingColumn(error) || legacyColumns) throw error;
      legacyColumns = true;
      warnColumnsOnce();
      [result] = await insertRow(pool, row, cost);
    }
    if (cost > 0) await checkAlerts(pool);
    return result.insertId;
  } catch (error) {
    if (missingTable(error)) warnOnce();
    else console.error(`AI usage not recorded: ${error?.code ?? error?.name ?? "error"}`);
    return null;
  }
}

/**
 * What an AI module calls when its request ends: `usage.record({ provider, model, inputTokens,
 * outputTokens, status })`. The feature, member and gym are fixed when the tracker is made, and
 * the duration is measured from then.
 */
function tracker(pool, { feature, userId = null, gymId = null }) {
  const started = Date.now();
  return {
    record: (outcome) => recordAiUsage(pool, { ...outcome, feature, userId, gymId, durationMs: Date.now() - started }),
  };
}

// ---- budget -------------------------------------------------------------------------------

async function settings(pool) {
  const [[row]] = await pool.query(
    "SELECT monthly_limit_inr, usd_to_inr, alert_50, alert_75, alert_90, alert_100, spike_alerts, updated_by, updated_at FROM ai_budget WHERE id = 1",
  );
  return row ?? null;
}

// This calendar month's spend so far, and the month key the alerts are filed under
async function monthSpend(pool) {
  const [[row]] = await pool.query(
    "SELECT COALESCE(SUM(cost_inr), 0) AS spent, DATE_FORMAT(CURDATE(), '%Y-%m') AS month FROM ai_usage WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')",
  );
  return { spentInr: Number(row.spent), month: row.month };
}

/** Files the alerts the current numbers call for (each one once). Never throws. */
async function checkAlerts(pool) {
  try {
    const budget = await settings(pool);
    if (!budget) return;
    const { spentInr, month } = await monthSpend(pool);
    const limit = Number(budget.monthly_limit_inr);
    for (const threshold of rules.crossedThresholds(spentInr, limit, budget)) {
      const [result] = await pool.query(
        "INSERT IGNORE INTO ai_budget_alerts (kind, period, threshold, spent_inr, detail) VALUES ('threshold', ?, ?, ?, ?)",
        [month, threshold, spentInr, `AI spending reached ${threshold}% of the ${rules.money(limit)} monthly budget (${rules.money(spentInr)} so far)`],
      );
      if (result.affectedRows > 0) console.log(`AI budget alert: ${threshold}% of the monthly limit reached`);
    }
    if (budget.spike_alerts) {
      const [[day]] = await pool.query(
        `SELECT COALESCE(SUM(IF(DATE(created_at) = CURDATE(), cost_inr, 0)), 0) AS today,
                COALESCE(SUM(IF(DATE(created_at) < CURDATE(), cost_inr, 0)), 0) / 7 AS average,
                DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS day
         FROM ai_usage WHERE created_at >= CURDATE() - INTERVAL 7 DAY`,
      );
      if (rules.isSpike(day.today, day.average)) {
        const [result] = await pool.query(
          "INSERT IGNORE INTO ai_budget_alerts (kind, period, threshold, spent_inr, detail) VALUES ('spike', ?, 0, ?, ?)",
          [day.day, Number(day.today), `Today's AI spend (${rules.money(day.today)}) is more than double the daily average of the last 7 days (${rules.money(day.average)})`],
        );
        if (result.affectedRows > 0) console.log("AI budget alert: today's spend is well above the recent average");
      }
    }
  } catch (error) {
    if (missingTable(error)) warnOnce();
    else console.error(`AI budget alerts not checked: ${error?.code ?? error?.name ?? "error"}`);
  }
}

/** The budget card: the limit, this month's spend and the open alerts */
async function budgetStatus(pool) {
  const budget = await settings(pool);
  const { spentInr } = await monthSpend(pool);
  const limit = budget ? Number(budget.monthly_limit_inr) : 0;
  const [[open]] = await pool.query("SELECT COUNT(*) AS n FROM ai_budget_alerts WHERE acknowledged_at IS NULL");
  return {
    monthlyLimitInr: limit,
    spentInr,
    remainingInr: Math.max(0, Math.round((limit - spentInr) * 100) / 100),
    percent: rules.percentOf(spentInr, limit),
    openAlerts: Number(open.n),
  };
}

// Tests only: forget the cached prices and rate
const resetPriceCache = () => {
  priceCache = { at: 0, byModel: new Map() };
  legacyColumns = false;
};
// The budget screen saved a new rate: new rows use it at once
const refreshPricing = resetPriceCache;

module.exports = { recordAiUsage, priceCall, tracker, checkAlerts, budgetStatus, settings, monthSpend, resetPriceCache, refreshPricing };
