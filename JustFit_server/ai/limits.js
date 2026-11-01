// The usage limits every paid AI call passes before it is made: the monthly budget (a hard stop
// when it is spent), a per-member burst limit, a per-member daily limit and a daily limit on plan
// generations. Each refusal is a friendly 429 or 503 the app shows as it is; nothing is retried
// silently. The limits come from ai/rules.js limitsConfig (environment variables).
//
// The burst limit is counted in this process (like rateLimit.js); the daily ones count the
// ai_usage rows the recorder writes, so they survive a restart and count every feature together.
const { ValidationError } = require("../profile");
const { createRateLimiter } = require("../rateLimit");
const rules = require("./rules");
const usage = require("./usage");

// A refusal the member can act on; it goes through the central error handler like any ValidationError
class AiLimitError extends ValidationError {
  constructor(message, status, limit) {
    super(message);
    this.name = "AiLimitError";
    this.status = status;
    this.limit = limit; // "budget" | "minute" | "day" | "plans"
  }
}

const BUDGET_TTL_MS = 30 * 1000;
let budgetCache = { at: 0, stopped: false };
let burst = null;
let burstLimit = null;

const burstLimiter = (perMinute) => {
  if (!burst || burstLimit !== perMinute) {
    burst = createRateLimiter({ limit: perMinute, windowMs: 60 * 1000 });
    burstLimit = perMinute;
  }
  return burst;
};

// Has this month's spend reached the budget? Cached for 30 s so the check costs nothing per call.
async function budgetSpent(pool) {
  if (Date.now() - budgetCache.at < BUDGET_TTL_MS) return budgetCache.stopped;
  let stopped = false;
  try {
    const [settings, month] = await Promise.all([usage.settings(pool), usage.monthSpend(pool)]);
    const limit = Number(settings?.monthly_limit_inr ?? 0);
    stopped = limit > 0 && month.spentInr >= limit;
  } catch {
    stopped = false; // before the migration, or a database hiccup: never block on the budget check itself
  }
  budgetCache = { at: Date.now(), stopped };
  return stopped;
}

const todayCount = async (pool, userId, feature = null) => {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM ai_usage WHERE user_id = ? AND created_at >= CURDATE() AND from_cache = FALSE${feature ? " AND feature = ? AND status = 'ok'" : ""}`,
    feature ? [userId, feature] : [userId],
  );
  return Number(row.n);
};

/**
 * Throws an AiLimitError when `userId` (null for a WhatsApp customer) may not make a `feature`
 * call right now. Call it after the request has been validated and just before the model.
 */
async function check(pool, { feature, userId = null }, env = process.env) {
  const config = rules.limitsConfig(env);
  if (config.budgetHardStop && (await budgetSpent(pool))) throw new AiLimitError(rules.LIMIT_MESSAGES.budget, 503, "budget");
  if (!userId) return;
  if (config.perMinute > 0 && !burstLimiter(config.perMinute).check(userId).ok) throw new AiLimitError(rules.LIMIT_MESSAGES.minute, 429, "minute");
  try {
    if (config.perDay > 0 && (await todayCount(pool, userId)) >= config.perDay) throw new AiLimitError(rules.LIMIT_MESSAGES.day(config.perDay), 429, "day");
    // A plan (meals) and a workout plan each count on their own against the daily plan limit
    if ((feature === "coach_plan" || feature === "coach_workout") && config.plansPerDay > 0 && (await todayCount(pool, userId, feature)) >= config.plansPerDay) {
      throw new AiLimitError(rules.LIMIT_MESSAGES.plans(config.plansPerDay), 429, "plans");
    }
  } catch (error) {
    if (error instanceof AiLimitError) throw error;
    if (error?.code === "ER_NO_SUCH_TABLE" || error?.code === "ER_BAD_FIELD_ERROR") return; // usage isn't recorded yet: nothing to count
    throw error;
  }
}

// Tests only: forget the cached budget state and the burst counters
const reset = () => {
  budgetCache = { at: 0, stopped: false };
  burst = null;
  burstLimit = null;
};

module.exports = { AiLimitError, check, reset };
