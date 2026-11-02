// The usage limits every paid AI call passes before it is made: the monthly budget (a hard stop
// when it is spent), a per-member burst limit, a per-member daily limit and a daily limit on plan
// generations. Each refusal is a friendly 429 or 503 the app shows as it is; nothing is retried
// silently. The limits come from ai/rules.js limitsConfig (environment variables).
//
// The burst limit is counted in this process (like rateLimit.js); the daily ones count the
// ai_usage rows the recorder writes, so they survive a restart and count every feature together.
const { ValidationError } = require("../profile");
const { createRateLimiter } = require("../rateLimit");
const models = require("./models");
const rules = require("./rules");
const usage = require("./usage");

// A refusal the member can act on; it goes through the central error handler like any ValidationError
class AiLimitError extends ValidationError {
  constructor(message, status, limit) {
    super(message);
    this.name = "AiLimitError";
    this.status = status;
    this.limit = limit; // "budget" | "unchecked" | "unpriced" | "minute" | "day" | "plans"
  }
}

const BUDGET_TTL_MS = 30 * 1000;
// Close to the limit the cache is skipped, so a burst of calls can't all slip past it together
const NEAR_LIMIT_SHARE = 0.9;
let budgetCache = { at: 0, stopped: false, near: false };
let burst = null;
let burstLimit = null;

const burstLimiter = (perMinute) => {
  if (!burst || burstLimit !== perMinute) {
    burst = createRateLimiter({ limit: perMinute, windowMs: 60 * 1000 });
    burstLimit = perMinute;
  }
  return burst;
};

// Has this month's spend reached the budget? Cached for 30 s so the check costs nothing per call,
// except within the last 10% of the budget, where every call reads the spend again. A check that
// fails (a database hiccup, the migration not run) is a refusal and is not cached: AI spending
// fails closed, and the next call checks again.
async function budgetSpent(pool) {
  if (!budgetCache.near && Date.now() - budgetCache.at < BUDGET_TTL_MS) return budgetCache.stopped;
  let settings;
  let month;
  try {
    [settings, month] = await Promise.all([usage.settings(pool), usage.monthSpend(pool)]);
  } catch (error) {
    console.error(`AI budget check failed (${error?.code ?? error?.name ?? "error"}): AI calls refused until it works`);
    throw new AiLimitError(rules.LIMIT_MESSAGES.unchecked, 503, "unchecked");
  }
  const limit = Number(settings?.monthly_limit_inr ?? 0);
  const stopped = limit > 0 && month.spentInr >= limit;
  budgetCache = { at: Date.now(), stopped, near: limit > 0 && month.spentInr >= limit * NEAR_LIMIT_SHARE };
  return stopped;
}

// A feature's model must have a price row, or its calls would count as ₹0 against the budget
// (an AI_MODEL_* override naming a new model, say). Features with no OpenAI model (the self-hosted
// body scan) and the tests' fake provider have nothing to price.
async function unpriced(pool, feature, env) {
  if (models.isFake(env) || !models.FEATURES.includes(feature)) return null;
  const model = models.modelFor(feature, env);
  try {
    return (await usage.hasPrice(pool, model)) ? null : model;
  } catch (error) {
    console.error(`AI price check failed (${error?.code ?? error?.name ?? "error"}): AI calls refused until it works`);
    throw new AiLimitError(rules.LIMIT_MESSAGES.unchecked, 503, "unchecked");
  }
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
  const missing = config.budgetHardStop ? await unpriced(pool, feature, env) : null;
  if (missing) {
    console.error(`AI call refused: model ${missing} has no row in ai_model_prices (add its price on Admin › AI Usage)`);
    throw new AiLimitError(rules.LIMIT_MESSAGES.unchecked, 503, "unpriced");
  }
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
  budgetCache = { at: 0, stopped: false, near: false };
  burst = null;
  burstLimit = null;
};

module.exports = { AiLimitError, check, reset };
