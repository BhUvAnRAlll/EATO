// The AI Coach chat: the member's conversation so far plus what justFit knows about them today
// (their answers, targets, today's diary, the plan) → the coach's next reply from the model.
//
// Nothing is stored: the app keeps the conversation and sends the last few turns each time, and
// neither the messages nor the reply are logged. Every query is scoped to the verified member id
// passed in by the route. In tests (NODE_ENV=test with AI_PROVIDER=fake) a fixed reply is used.
//
// Cost: the model comes from ai/models.js (a small one), the model sees only the newest turns
// (chatRules.modelHistory), the reply is capped, the member's limits are checked first
// (ai/limits.js) and an identical message already being answered is not asked twice (ai/dedupe.js).
const OpenAI = require("openai");

const { ValidationError } = require("../profile");
const diary = require("../macro/diary");
const { toIntake, getPlan } = require("./plan");
const { CoachPlanError } = require("./planRules");
const rules = require("./chatRules");
const aiUsage = require("../ai/usage");
const models = require("../ai/models");
const aiLimits = require("../ai/limits");
const dedupe = require("../ai/dedupe");

const FEATURE = "coach_chat";
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BUSY = "Your coach couldn't answer right now. Please try again.";

async function memberFacts(pool, userId, date) {
  const [[intakeRow]] = await pool.query("SELECT * FROM coach_profiles WHERE user_id = ?", [userId]);
  if (!intakeRow) throw new ValidationError("Answer your coach's questions first.");
  const [[[profile]], [[targets]], day, plan] = await Promise.all([
    pool.query("SELECT diet, dislikes, allergies FROM profiles WHERE user_id = ?", [userId]),
    pool.query("SELECT calories, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG FROM nutrition_targets WHERE user_id = ?", [userId]),
    diary.day(pool, userId, date),
    getPlan(pool, userId, { date }),
  ]);
  const intake = toIntake(intakeRow);
  const plannedMeals = plan.plan
    ? plan.plan.meals.map((m) => `${m.time} ${m.name} (${m.totals.kcal} kcal${m.logged ? ", logged" : ""})`)
    : [];
  const workout = plan.workout
    ? plan.workout.sessions.map((s) => `${WEEKDAY[s.weekday]} ${s.title} ${s.minutes} min`).join(", ")
    : null;
  return { intake, profile, targets, today: day.totals, plannedMeals, workout };
}

// `usage` (ai/usage.tracker) records the call for the admin's AI Usage screen; never the text
async function askCoach({ instructions, messages, cacheKey }, env, usage) {
  if (models.isFake(env)) {
    await usage?.record({ provider: "openai", model: "fake", inputTokens: 10, outputTokens: 5, status: "ok" });
    return rules.FAKE_REPLY;
  }
  const { request, model: MODEL } = models.settingsFor(FEATURE, env);
  const client = models.openaiClient();
  let response;
  try {
    response = await client.responses.create({
      ...request,
      instructions,
      store: false,
      prompt_cache_key: cacheKey, // the same member's prompts share one cache slot on OpenAI's side
      input: messages.map((m) =>
        m.role === "member"
          ? { role: "user", content: [{ type: "input_text", text: m.text }] }
          : { role: "assistant", content: [{ type: "output_text", text: m.text }] },
      ),
    });
  } catch (error) {
    await usage?.record({ provider: "openai", model: MODEL, status: "failed" });
    // Never log the conversation or the answer, only the status
    if (error instanceof OpenAI.RateLimitError) throw new CoachPlanError("Your coach is busy right now. Please try again in a minute.", 503);
    if (error instanceof OpenAI.APIError) {
      console.error(`Coach chat failed: OpenAI ${error.status ?? "unknown"} ${error.name}`);
      throw new CoachPlanError(BUSY, 502);
    }
    throw error;
  }
  const refused = response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
  const usable = !refused && Boolean(response.output_text);
  await usage?.record({
    provider: "openai", model: MODEL, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens,
    cachedInputTokens: models.cachedTokensOf(response), status: usable ? "ok" : "refused",
  });
  if (!usable) throw new CoachPlanError(BUSY, 502);
  return response.output_text;
}

/** The coach's reply to the member's latest message: { reply } */
async function chat(pool, userId, { date, messages }, env = process.env) {
  const facts = await memberFacts(pool, userId, date);
  await aiLimits.check(pool, { feature: FEATURE, userId }, env);
  const history = rules.modelHistory(messages);
  // The same message sent twice at once (a double tap, a retried connection) is answered once
  return dedupe.shared.run(dedupe.requestKey(FEATURE, userId, history), async () => {
    const instructions = `${rules.chatInstructions(facts.intake)}\n\nFacts about the member:\n${rules.memberBrief(facts)}`;
    const reply = rules.cleanReply(
      await askCoach({ instructions, messages: history, cacheKey: `${FEATURE}:${userId}` }, env, aiUsage.tracker(pool, { feature: FEATURE, userId })),
    );
    if (!reply) throw new CoachPlanError(BUSY, 502);
    return { reply };
  });
}

module.exports = { chat };
