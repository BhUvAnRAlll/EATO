// Pure rules for AI usage and cost management (no database, no network), so they are unit-tested
// directly: what a call costs, the periods the admin screen filters by, the checks on its queries,
// and when a budget alert fires.
const { ValidationError } = require("../profile");

const FEATURES = ["gym_assistant", "coach_plan", "coach_workout", "coach_meal", "coach_chat", "food_scan", "body_scan", "body_report", "exercise_library"];
const PROVIDERS = ["openai", "forma"];
const STATUSES = ["ok", "failed", "refused"];
const PERIODS = ["day", "week", "month"];
const SORTS = ["newest", "oldest", "cost", "tokens"];
const THRESHOLDS = [50, 75, 90, 100];
const PAGE_SIZE = 25;
const limits = { search: 80, model: 64, maxLimitInr: 10_000_000, minRate: 1, maxRate: 1000, maxPage: 10000 };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- recording ------------------------------------------------------------------------

const DEFAULT_USD_TO_INR = 84;

// What a call costs in rupees: the model's dollar price row (null when it has none → 0) at the
// exchange rate (rupees per dollar). `cachedTokens` is the part of the input OpenAI served from
// its prompt cache, billed at the row's cached price (or the full input price when the row has
// none). The input count includes the cached tokens, as OpenAI reports it.
function costInr(price, inputTokens, outputTokens, usdToInr = DEFAULT_USD_TO_INR, cachedTokens = 0) {
  if (!price) return 0;
  const cached = Math.min(count(Number(cachedTokens)), count(Number(inputTokens)));
  const cachedPrice = price.cached_input_usd_per_million === null || price.cached_input_usd_per_million === undefined
    ? Number(price.input_usd_per_million)
    : Number(price.cached_input_usd_per_million);
  const usd =
    ((Number(inputTokens) - cached) / 1_000_000) * Number(price.input_usd_per_million) +
    (cached / 1_000_000) * cachedPrice +
    (Number(outputTokens) / 1_000_000) * Number(price.output_usd_per_million) +
    Number(price.request_usd);
  return Math.round(usd * Number(usdToInr) * 10_000) / 10_000;
}

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

// One usage row, checked: a programming error here is logged by the recorder, never thrown to a member.
// `fromCache` marks an answer the server reused instead of asking the model (no tokens, no cost).
function usageRow({ feature, provider, model, inputTokens = 0, outputTokens = 0, cachedInputTokens = 0, fromCache = false, status, userId = null, gymId = null, durationMs = null }) {
  if (!FEATURES.includes(feature)) throw new Error(`unknown AI feature: ${feature}`);
  if (!PROVIDERS.includes(provider)) throw new Error(`unknown AI provider: ${provider}`);
  if (!STATUSES.includes(status)) throw new Error(`unknown AI status: ${status}`);
  if (typeof model !== "string" || !model.trim()) throw new Error("an AI usage row needs a model");
  const input = count(inputTokens);
  return {
    feature,
    provider,
    model: model.trim().slice(0, limits.model),
    inputTokens: input,
    outputTokens: count(outputTokens),
    cachedInputTokens: Math.min(count(cachedInputTokens), input),
    fromCache: fromCache === true,
    status,
    userId: typeof userId === "string" && userId ? userId : null,
    gymId: typeof gymId === "string" && gymId ? gymId : null,
    durationMs: durationMs === null ? null : Math.min(count(Math.round(durationMs)), 4_000_000_000),
  };
}

// ---- prompt size and usage limits ---------------------------------------------------------

// A rough token count for budgeting a prompt (English and JSON run about four characters a token)
const estimateTokens = (text) => Math.ceil(String(text ?? "").length / 4);

// The configurable limits (environment variables, with these defaults). 0 switches a limit off.
//   AI_LIMIT_PER_MINUTE      AI calls one member may make in a minute, across every feature
//   AI_LIMIT_PER_DAY         AI calls one member may make in a day
//   AI_PLAN_LIMIT_PER_DAY    plans (meals + workout) one member may make in a day
//   AI_BUDGET_HARD_STOP      "off" to keep answering after the monthly budget is spent (alerts only)
//   AI_CACHE_TTL_MINUTES     how long a reusable answer is kept; AI_CACHE=off disables the cache
const nonNegativeInt = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};
function limitsConfig(env = process.env) {
  return {
    perMinute: nonNegativeInt(env.AI_LIMIT_PER_MINUTE, 12),
    perDay: nonNegativeInt(env.AI_LIMIT_PER_DAY, 150),
    plansPerDay: nonNegativeInt(env.AI_PLAN_LIMIT_PER_DAY, 3),
    budgetHardStop: !/^(off|false|0|no)$/i.test(String(env.AI_BUDGET_HARD_STOP ?? "")),
    cacheTtlMs: nonNegativeInt(env.AI_CACHE_TTL_MINUTES, 24 * 60) * 60 * 1000,
    cacheEnabled: !/^(off|false|0|no)$/i.test(String(env.AI_CACHE ?? "")),
  };
}

// The messages members see when a limit stops a call (friendly, and never silent)
const LIMIT_MESSAGES = {
  budget: "AI features are paused for the rest of this month because the monthly AI budget has been used. Everything else in justFit keeps working.",
  minute: "You're sending requests very quickly. Please wait a moment and try again.",
  day: (n) => `You've reached today's limit of ${n} AI requests. It resets at midnight.`,
  plans: (n) => `You've made ${n} plans today, which is the daily limit. Ask your coach to adjust a meal, or make a new plan tomorrow.`,
};

// ---- periods ----------------------------------------------------------------------------

// day: today (vs yesterday); week: the last 7 days (vs the 7 before); month: the last 30 (vs the 30 before)
const periodDays = (period) => ({ day: 1, week: 7, month: 30 })[period];

const addDays = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};

// The x-axis of the charts: 24 hours for a day, else one entry per date from `from` for `days` days
function seriesKeys(period, from) {
  if (period === "day") return Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
  return Array.from({ length: periodDays(period) }, (_, i) => addDays(from, i));
}

// Every key gets a point, zero where nothing happened
function fillSeries(keys, rows) {
  const byKey = new Map(rows.map((r) => [String(r.k), r]));
  return keys.map((key) => {
    const row = byKey.get(key);
    return { key, requests: Number(row?.requests ?? 0), tokens: Number(row?.tokens ?? 0), costInr: Number(row?.costInr ?? 0) };
  });
}

// ---- the admin screen's queries ---------------------------------------------------------

function summaryQuery(query) {
  const period = query.period === undefined || query.period === "" ? "week" : query.period;
  if (!PERIODS.includes(period)) throw new ValidationError("Pick a period: day, week or month.");
  return { period };
}

const isoDate = (value, what) => {
  if (typeof value !== "string" || !ISO_DATE.test(value)) throw new ValidationError(`${what} must look like YYYY-MM-DD.`);
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new ValidationError(`${what} isn't a real day.`);
  return value;
};
const optional = (value) => (value === undefined || value === null || value === "" ? null : value);

// GET /ai-usage/history?search&feature&model&status&from&to&sort&page
function historyQuery(query) {
  const search = typeof query.search === "string" ? query.search.trim().slice(0, limits.search) : "";
  const feature = optional(query.feature);
  if (feature !== null && !FEATURES.includes(feature)) throw new ValidationError("That AI feature doesn't exist.");
  const status = optional(query.status);
  if (status !== null && !STATUSES.includes(status)) throw new ValidationError("Pick a status: ok, failed or refused.");
  const model = optional(query.model);
  if (model !== null && (typeof model !== "string" || model.length > limits.model)) throw new ValidationError("That model name is too long.");
  const from = optional(query.from) === null ? null : isoDate(query.from, "From");
  const to = optional(query.to) === null ? null : isoDate(query.to, "To");
  if (from && to && from > to) throw new ValidationError("From must be on or before To.");
  const sort = optional(query.sort) ?? "newest";
  if (!SORTS.includes(sort)) throw new ValidationError("Sort by newest, oldest, cost or tokens.");
  const page = optional(query.page) === null ? 1 : Number(query.page);
  if (!Number.isInteger(page) || page < 1 || page > limits.maxPage) throw new ValidationError("That page doesn't exist.");
  return { search, feature, status, model, from, to, sort, page };
}

const flag = (value, what) => {
  if (typeof value !== "boolean") throw new ValidationError(`${what} must be on or off.`);
  return value;
};

// PUT /ai-usage/budget { monthlyLimitInr, usdToInr, alert50, alert75, alert90, alert100, spikeAlerts }
function budgetBody(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Send the budget as a JSON object.");
  const fields = ["monthlyLimitInr", "usdToInr", "alert50", "alert75", "alert90", "alert100", "spikeAlerts"];
  for (const key of Object.keys(body)) if (!fields.includes(key)) throw new ValidationError(`The request has an unexpected field: ${key}.`);
  const limit = body.monthlyLimitInr;
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0 || limit > limits.maxLimitInr) {
    throw new ValidationError(`The monthly limit must be a number between 0 and ${limits.maxLimitInr.toLocaleString("en-IN")} rupees.`);
  }
  const rate = body.usdToInr;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < limits.minRate || rate > limits.maxRate) {
    throw new ValidationError(`The exchange rate must be between ${limits.minRate} and ${limits.maxRate} rupees per US dollar.`);
  }
  return {
    monthlyLimitInr: Math.round(limit * 100) / 100,
    usdToInr: Math.round(rate * 100) / 100,
    alert50: flag(body.alert50, "The 50% alert"),
    alert75: flag(body.alert75, "The 75% alert"),
    alert90: flag(body.alert90, "The 90% alert"),
    alert100: flag(body.alert100, "The 100% alert"),
    spikeAlerts: flag(body.spikeAlerts, "The spike alert"),
  };
}

function alertId(value) {
  if (typeof value !== "string" || !/^\d{1,18}$/.test(value)) throw new ValidationError("That alert doesn't exist.");
  return Number(value);
}

// ---- alerts -----------------------------------------------------------------------------

// How much of the monthly limit is spent, as a whole percentage (0 with no limit)
const percentOf = (spentInr, limitInr) => (Number(limitInr) > 0 ? Math.round((Number(spentInr) / Number(limitInr)) * 100) : 0);

// The enabled thresholds the month's spend has reached (nothing with no limit)
function crossedThresholds(spentInr, limitInr, settings) {
  if (!(Number(limitInr) > 0)) return [];
  const percent = (Number(spentInr) / Number(limitInr)) * 100;
  return THRESHOLDS.filter((t) => settings[`alert_${t}`] && percent >= t);
}

// An unexpected increase: today's spend is at least `minInr` (₹100) and more than double the
// daily average of the last 7 days (so a quiet week followed by a busy day counts too)
const isSpike = (todayInr, averageDailyInr, minInr = 100) => Number(todayInr) >= minInr && Number(todayInr) > 2 * Number(averageDailyInr);

// "₹1,234.50": rupees with Indian grouping
const money = (inr) => `₹${Number(inr).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

module.exports = {
  FEATURES, PROVIDERS, STATUSES, PERIODS, SORTS, THRESHOLDS, PAGE_SIZE, limits,
  DEFAULT_USD_TO_INR, costInr, usageRow, estimateTokens, limitsConfig, LIMIT_MESSAGES,
  periodDays, addDays, seriesKeys, fillSeries,
  summaryQuery, historyQuery, budgetBody, alertId,
  percentOf, crossedThresholds, isSpike, money,
};
