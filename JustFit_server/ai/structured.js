// One structured OpenAI call, shared by every feature that wants a JSON answer of a known shape
// (the coach's day plan and meal swaps, the AI-written workout, Admin › Exercises). The model and
// its caps come from ai/models.js; in tests (NODE_ENV=test with AI_PROVIDER=fake) `fake` is
// answered instead. Never logs the prompt or the answer, only the status.
const OpenAI = require("openai");

const models = require("./models");
const { CoachPlanError } = require("../coach/planRules");

// `usage` (ai/usage.tracker) records the call for the admin's AI Usage screen; never the text
// One structured call: `feature` picks the model and caps (coach_plan: the whole day; coach_meal:
// one meal; coach_workout: the week of training; exercise_library: Admin › Exercises), `schema` the answer's shape, `fake` the test
// answer, `failure` and `busy` what the caller reads when the model fails or is rate limited.
async function askStructured({ feature, instructions, brief, schema, fake, failure, busy = "Your coach is busy right now. Please try again in a minute." }, env, usage) {
  if (models.isFake(env)) {
    await usage?.record({ provider: "openai", model: "fake", inputTokens: 10, outputTokens: 5, status: "ok" });
    return fake;
  }
  const { request, model: MODEL } = models.settingsFor(feature, env);
  const client = models.openaiClient();
  let response;
  try {
    response = await client.responses.create({
      ...request,
      instructions,
      store: false,
      input: [{ role: "user", content: [{ type: "input_text", text: brief }] }],
      text: { format: { type: "json_schema", name: feature, strict: true, schema } },
    });
  } catch (error) {
    await usage?.record({ provider: "openai", model: MODEL, status: "failed" });
    // Never log the request or the answer, only the status
    if (error instanceof OpenAI.RateLimitError) throw new CoachPlanError(busy, 503);
    if (error instanceof OpenAI.APIError) {
      console.error(`Coach ${feature} failed: OpenAI ${error.status ?? "unknown"} ${error.name}`);
      throw new CoachPlanError(failure, 502);
    }
    throw error;
  }
  const refused = response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
  const usable = !refused && response.status !== "incomplete" && Boolean(response.output_text);
  await usage?.record({
    provider: "openai", model: MODEL, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens,
    cachedInputTokens: models.cachedTokensOf(response), status: usable ? "ok" : "refused",
  });
  if (!usable) throw new CoachPlanError(failure, 502);
  return JSON.parse(response.output_text);
}

module.exports = { askStructured };
