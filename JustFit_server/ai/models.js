// Where every OpenAI call picks its model and its limits (the "model router"). One place, so a
// cheap model is the default for every feature and an expensive one has to be chosen on purpose.
//
// Each feature has a default model, a cap on the answer (max_output_tokens) and a cap on the
// prompt. Environment variables override them per feature:
//   AI_MODEL_COACH_CHAT, AI_MODEL_COACH_PLAN, AI_MODEL_COACH_MEAL, AI_MODEL_FOOD_SCAN,
//   AI_MODEL_BODY_REPORT, AI_MODEL_GYM_ASSISTANT       the model id, as OpenAI names it
//   AI_MAX_OUTPUT_<FEATURE>                             the answer cap in tokens
// The older OPENAI_MODEL (every app feature) and AI_MODEL (the gym assistant) still work as a
// fallback for a server that already sets them, below the per-feature variables.
//
// Prices live in the ai_model_prices table (ai/usage.js reads them), so a model named here must
// have a price row or its calls are recorded at ₹0. Official list prices (developers.openai.com,
// read 2026-10-31), per million tokens, input / cached input / output:
//   gpt-4.1-mini  $0.40 / $0.10  / $1.60      gpt-4.1-nano $0.10 / $0.025 / $0.40
//   gpt-4o-mini   $0.15 / $0.075 / $0.60      gpt-4o       $2.50 / $1.25  / $10.00
//   gpt-5-mini    $0.25 / $0.025 / $2.00      gpt-5-nano   $0.05 / $0.005 / $0.40
const OpenAI = require("openai");

// The defaults. gpt-4.1-mini reads photos, follows a JSON schema strictly and writes good short
// text at a sixth of gpt-4o's price; the gym assistant keeps gpt-4o-mini, the cheapest model that
// handles many languages well. Output caps are generous enough that a plan or a scan is never
// cut short (planRules.js refuses an incomplete answer), and tight enough that a runaway answer
// can't cost more than a few paise.
const DEFAULTS = {
  coach_chat: { model: "gpt-4.1-mini", maxOutputTokens: 450, maxInputTokens: 6000 },
  coach_plan: { model: "gpt-4.1-mini", maxOutputTokens: 2200, maxInputTokens: 4000 },
  coach_meal: { model: "gpt-4.1-mini", maxOutputTokens: 500, maxInputTokens: 3000 },
  food_scan: { model: "gpt-4.1-mini", maxOutputTokens: 900, maxInputTokens: 8000 },
  body_report: { model: "gpt-4.1-mini", maxOutputTokens: 1200, maxInputTokens: 12000 },
  gym_assistant: { model: "gpt-4o-mini", maxOutputTokens: 320, maxInputTokens: 8000 },
};

const FEATURES = Object.keys(DEFAULTS);
const envKey = (feature) => feature.toUpperCase();

const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** The model a feature uses: its own variable, then the old global one, then the default */
function modelFor(feature, env = process.env) {
  if (!DEFAULTS[feature]) throw new Error(`unknown AI feature: ${feature}`);
  const own = env[`AI_MODEL_${envKey(feature)}`];
  if (typeof own === "string" && own.trim()) return own.trim();
  const legacy = feature === "gym_assistant" ? env.AI_MODEL : env.OPENAI_MODEL;
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  return DEFAULTS[feature].model;
}

// Reasoning models (gpt-5 family, o-series) think before they answer and bill the thinking as
// output tokens. For these short, well-specified tasks the least thinking is right.
const isReasoningModel = (model) => /^(gpt-5|o\d)/.test(model);

/**
 * Everything a feature's call needs from here: `{ model, maxOutputTokens, maxInputTokens,
 * request }`, where `request` is the part of the Responses API body that comes from this file
 * (model, max_output_tokens and, for a reasoning model, the lowest reasoning effort).
 */
function settingsFor(feature, env = process.env) {
  const defaults = DEFAULTS[feature];
  if (!defaults) throw new Error(`unknown AI feature: ${feature}`);
  const model = modelFor(feature, env);
  const maxOutputTokens = positiveInt(env[`AI_MAX_OUTPUT_${envKey(feature)}`], defaults.maxOutputTokens);
  const request = { model, max_output_tokens: maxOutputTokens };
  if (isReasoningModel(model)) request.reasoning = { effort: env.AI_REASONING_EFFORT || "minimal" };
  return { model, maxOutputTokens, maxInputTokens: defaults.maxInputTokens, request };
}

/** One line for the startup log: which model each feature will use */
const routingSummary = (env = process.env) => FEATURES.map((f) => `${f}=${modelFor(f, env)}`).join(", ");

// Tests run with a stand-in instead of the real model
const isFake = (env = process.env) => env.NODE_ENV === "test" && env.AI_PROVIDER === "fake";

// ---- the client ---------------------------------------------------------------------------

// One OpenAI client per distinct set of options (most features share the default one), made the
// first time it's needed so the server starts without the key and tests never create one
const clients = new Map();
function openaiClient(options = {}) {
  const key = JSON.stringify(options);
  if (!clients.has(key)) clients.set(key, new OpenAI(options)); // reads OPENAI_API_KEY
  return clients.get(key);
}

/** The cached-prompt token count OpenAI reports on a response (0 when it reports none) */
const cachedTokensOf = (response) => Number(response?.usage?.input_tokens_details?.cached_tokens ?? 0) || 0;

module.exports = { DEFAULTS, FEATURES, modelFor, settingsFor, routingSummary, isFake, isReasoningModel, openaiClient, cachedTokensOf };
