// The in-app gym assistant (the gym page's Ask): the same agent and facts as WhatsApp, for a
// signed-in member who may see the gym. One question at a time (no stored history). It answers
// while the gym's agent is "testing" (so owners can try it) or "active"; "disabled" turns it off.
const { ValidationError } = require("../profile");
const { gymKnowledge, answer } = require("./agent");
const { recordUsage } = require("./usage");
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

async function ask(pool, userId, gym, question) {
  const budget = limiter.check(userId);
  if (!budget.ok) throw new AssistantUnavailable(tooManyRequestsMessage(budget.retryAfterSeconds), 429);
  const knowledge = await gymKnowledge(pool, gym.id);
  if (!knowledge || knowledge.agentStatus === "disabled") throw new AssistantUnavailable("This gym's assistant isn't switched on yet.", 409);
  const result = await answer(getProvider(), knowledge, [{ role: "user", content: question }], { channel: "app" });
  await recordUsage(pool, gym.id, "ai", 1, { inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  // Questions it couldn't answer go to the gym's team (owner portal › Gym assistant)
  if (result.escalate) await require("../owner/questions").recordQuestion(pool, gym.id, userId, question, result.reply);
  return { reply: result.reply, escalated: result.escalate, contact: result.escalate ? knowledge.escalationContact : null };
}

module.exports = { ask };
