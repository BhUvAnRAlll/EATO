// The in-app gym assistant (the gym page's Ask): the same agent and facts as WhatsApp, for a
// signed-in member who may see the gym. One question at a time (no stored history). It answers
// while the gym's agent is "testing" (so owners can try it) or "active"; "disabled" turns it off.
const { ValidationError } = require("../profile");
const { gymKnowledge, answer } = require("./agent");
const { recordUsage } = require("./usage");
const aiUsage = require("../ai/usage");
const aiLimits = require("../ai/limits");
const aiCache = require("../ai/cache");
const dedupe = require("../ai/dedupe");
const { createRateLimiter, tooManyRequestsMessage } = require("../rateLimit");

const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 }); // each question is a paid AI call
let provider = null;
const getProvider = () => (provider ??= require("./aiProvider").createAiProvider());

class AssistantUnavailable extends ValidationError {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// The same question about the same gym (same facts, same owner guidance) gets the same answer
// without a second paid call. The key hashes the facts, so editing them starts fresh. Answers
// the agent escalated are not reused: each of those should reach the team.
const cacheKeyFor = (knowledge, channel, question) => aiCache.keyOf("gym_assistant", knowledge.gymId, channel, knowledge.facts, knowledge.ownerInstructions, aiCache.normalizeQuestion(question));

async function ask(pool, userId, gym, question) {
  const budget = limiter.check(userId);
  if (!budget.ok) throw new AssistantUnavailable(tooManyRequestsMessage(budget.retryAfterSeconds), 429);
  const knowledge = await gymKnowledge(pool, gym.id);
  if (!knowledge || knowledge.agentStatus === "disabled") throw new AssistantUnavailable("This gym's assistant isn't switched on yet.", 409);
  const cache = aiCache.shared();
  const cacheKey = cacheKeyFor(knowledge, "app", question);
  const cached = cache.get(cacheKey);
  if (cached) {
    await aiUsage.tracker(pool, { feature: "gym_assistant", userId, gymId: gym.id }).record({ provider: "openai", model: cached.model, fromCache: true, status: "ok" });
    return { reply: cached.reply, escalated: false, contact: null };
  }
  await aiLimits.check(pool, { feature: "gym_assistant", userId });
  const result = await dedupe.shared.run(dedupe.requestKey("gym_assistant", userId, gym.id, question), async () => {
    const usage = aiUsage.tracker(pool, { feature: "gym_assistant", userId, gymId: gym.id });
    let answered;
    try {
      answered = await answer(getProvider(), knowledge, [{ role: "user", content: question }], { channel: "app" });
    } catch (error) {
      await usage.record({ provider: "openai", model: getProvider().model ?? "unknown", status: "failed" });
      throw error;
    }
    await recordUsage(pool, gym.id, "ai", 1, { inputTokens: answered.inputTokens, outputTokens: answered.outputTokens });
    await usage.record({ provider: "openai", model: answered.model, inputTokens: answered.inputTokens, outputTokens: answered.outputTokens, cachedInputTokens: answered.cachedInputTokens, status: "ok" });
    if (!answered.escalate) cache.set(cacheKey, { reply: answered.reply, model: answered.model });
    return answered;
  });
  // Questions it couldn't answer go to the gym's team (owner portal › Gym assistant)
  if (result.escalate) await require("../owner/questions").recordQuestion(pool, gym.id, userId, question, result.reply);
  return { reply: result.reply, escalated: result.escalate, contact: result.escalate ? knowledge.escalationContact : null };
}

module.exports = { ask };
