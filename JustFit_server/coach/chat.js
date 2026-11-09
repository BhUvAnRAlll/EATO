// The AI Coach chat: the member's conversation so far plus what justFit knows about them today
// (their answers, targets, today's diary, the plan) → the coach's next reply from the model.
//
// The conversation is saved on the server for 7 days (coach/chatHistory.js): the app sends only
// the new message, the coach reads the saved conversation, and the message and reply are saved
// together once answered (a send that fails saves nothing). Neither is ever logged. When the reply recommends a change to the plan
// (a different dish for one of today's meals, other training days or session length) the answer
// also carries it as a proposal: a meal is cleaned and stored as a Swap Meal option (so Apply
// is the same replace, with Undo), a workout change is only checked and handed back. Every query is scoped to the verified member id
// passed in by the route. In tests (NODE_ENV=test with AI_PROVIDER=fake) a fixed reply is used.
//
// Cost: the model comes from ai/models.js (a small one), the model sees only the newest turns
// (chatRules.modelHistory), the reply is capped, the member's limits are checked first
// (ai/limits.js), a send already answered gets its saved answer, and one still being answered is
// not asked twice (ai/dedupe.js).
const OpenAI = require("openai");

const { ValidationError } = require("../profile");
const diary = require("../macro/diary");
const { toIntake, getPlan, storeOption } = require("./plan");
const planRules = require("./planRules");
const { CoachPlanError } = require("./planRules");
const rules = require("./chatRules");
const aiUsage = require("../ai/usage");
const models = require("../ai/models");
const aiLimits = require("../ai/limits");
const dedupe = require("../ai/dedupe");
const chatHistory = require("./chatHistory");

const FEATURE = "coach_chat";
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BUSY = "Your coach couldn't answer right now. Please try again.";

async function memberFacts(pool, userId, date) {
  // All read together; without the intake the rest isn't used
  const [[[intakeRow]], [[profile]], [[targets]], day, plan] = await Promise.all([
    pool.query("SELECT * FROM coach_profiles WHERE user_id = ?", [userId]),
    pool.query("SELECT diet, cuisines, dislikes, allergies FROM profiles WHERE user_id = ?", [userId]),
    pool.query("SELECT calories, protein_g AS proteinG, carbs_g AS carbsG, fat_g AS fatG FROM nutrition_targets WHERE user_id = ?", [userId]),
    diary.day(pool, userId, date),
    getPlan(pool, userId, { date }),
  ]);
  if (!intakeRow) throw new ValidationError("Answer your coach's questions first.");
  const intake = toIntake(intakeRow);
  const meals = plan.plan ? plan.plan.meals : [];
  const plannedMeals = meals.map((m, i) => `[${rules.mealKey(i)}] ${m.time} ${m.name} (${m.totals.kcal} kcal${m.logged ? ", logged" : ""})`);
  const workout = plan.workout
    ? plan.workout.sessions.map((s) => `${WEEKDAY[s.weekday]} ${s.title} ${s.minutes} min`).join(", ")
    : null;
  const food = profile ? { ...profile, cuisines: (typeof profile.cuisines === "string" ? JSON.parse(profile.cuisines) : profile.cuisines) ?? [] } : null;
  return { intake, profile: food, targets, today: day.totals, plannedMeals, workout, planId: plan.plan?.id ?? null, meals };
}

// `usage` (ai/usage.tracker) records the call for the admin's AI Usage screen; never the text
async function askCoach({ instructions, messages, cacheKey }, env, usage) {
  if (models.isFake(env)) {
    await usage?.record({ provider: "openai", model: "fake", inputTokens: 10, outputTokens: 5, status: "ok" });
    // The fake reply says how many lines of conversation it was given, so tests can see the context
    return { reply: `${rules.FAKE_REPLY} (${messages.length} lines read)`, mealChanges: [], workoutChanges: [] };
  }
  const { request, model: MODEL } = models.settingsFor(FEATURE, env);
  // Past the input cap nothing is sent or paid for (the history is already kept short, chatRules.modelHistory)
  if (!models.withinInputCap(FEATURE, [instructions, ...messages.map((m) => m.text)])) throw new CoachPlanError(BUSY, 502);
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
      text: { format: { type: "json_schema", name: FEATURE, strict: true, schema: rules.chatSchema } },
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
  const usable = !refused && response.status !== "incomplete" && Boolean(response.output_text);
  await usage?.record({
    provider: "openai", model: MODEL, inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens,
    cachedInputTokens: models.cachedTokensOf(response), status: usable ? "ok" : "refused",
  });
  if (!usable) throw new CoachPlanError(BUSY, 502);
  try {
    return JSON.parse(response.output_text);
  } catch {
    throw new CoachPlanError(BUSY, 502);
  }
}

const SUGGESTED = "Suggested in your chat";

// The checked changes → what the app shows under the reply. Each meal is cleaned like a swap
// (allergens dropped, numbers capped; its calories kept as the coach chose them) and stored as an
// option of that meal, so applying it is the plan's replace. A meal that can't be used is left out.
async function proposalsFor(pool, userId, facts, raw) {
  const { mealChanges, workoutChange } = rules.planChanges(raw, { meals: facts.meals, weekdays: facts.intake.weekdays, sessionMinutes: facts.intake.sessionMinutes });
  const meals = [];
  for (const { meal, raw: change } of facts.planId ? mealChanges : []) {
    let next;
    try {
      next = planRules.normalizeMeal(change, meal, facts.profile ?? "", 0);
    } catch {
      continue;
    }
    const option = await storeOption(pool, { userId, planId: facts.planId, meal, kind: "suggestion", option: { ...next, description: SUGGESTED } });
    meals.push({ mealId: meal.id, slot: meal.slot, time: meal.time, current: { name: meal.name, totals: meal.totals }, option });
  }
  const workout = workoutChange
    ? { ...workoutChange, current: { weekdays: [...facts.intake.weekdays].sort(), sessionMinutes: facts.intake.sessionMinutes } }
    : null;
  return { meals, workout };
}

/**
 * The coach's reply to the member's new message, saved with it in their conversation:
 * { reply, proposals: { meals, workout }, messages: [the member's message, the reply] }
 */
async function chat(pool, userId, { date, text, clientId }, env = process.env) {
  // A retry of a send that was answered (the answer was lost on the way): the saved answer, no new
  // AI call and nothing else read
  const saved = await chatHistory.savedAnswer(pool, userId, clientId);
  if (saved) return saved;
  // What the coach knows and the conversation so far, read together
  const [facts, recent] = await Promise.all([memberFacts(pool, userId, date), chatHistory.recentContext(pool, userId)]);
  // Only a conversation with the member's current coach counts (a new coach starts afresh)
  const earlier = recent.coach === facts.intake.coach ? recent.messages : [];
  // The same send arriving twice at once (a double tap, a retried connection) is answered once,
  // and its limits are checked once (inside the shared run), so it uses one turn of the member's
  // per-minute allowance. They come after the facts: a member who can't chat yet isn't charged.
  return dedupe.shared.run(dedupe.requestKey(FEATURE, userId, clientId), async () => {
    await aiLimits.check(pool, { feature: FEATURE, userId }, env);
    const history = rules.modelHistory([...earlier, { role: "member", text }]);
    const instructions = `${rules.chatInstructions(facts.intake)}\n\nFacts about the member:\n${rules.memberBrief(facts)}`;
    const answer = await askCoach({ instructions, messages: history, cacheKey: `${FEATURE}:${userId}` }, env, aiUsage.tracker(pool, { feature: FEATURE, userId }));
    const reply = rules.cleanReply(answer?.reply);
    if (!reply) throw new CoachPlanError(BUSY, 502);
    const proposals = await proposalsFor(pool, userId, facts, answer);
    return chatHistory.saveAnswer(pool, userId, { clientId, text, reply, proposals });
  });
}

module.exports = { chat, history: chatHistory.history };
