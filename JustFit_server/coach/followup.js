// The AI Coach's daily follow-up: the coach's evening check-in on the member's day, written by the
// model from the same facts the chat uses (their answers, targets, what they logged today, today's
// plan) plus today's workout. Asked for when the member taps the evening notification (the phone
// schedules it itself: no push server), at most one AI call per member per day: the message is
// saved in the conversation under an id made from the member, the day and the coach
// (followupRules.followupId), and a second ask reads it back. Every query is scoped to the
// verified member id passed in by the route; the text is never logged.
const { CoachPlanError } = require("./planRules");
const { memberFacts, askCoach } = require("./chat");
const chatHistory = require("./chatHistory");
const chatRules = require("./chatRules");
const rules = require("./followupRules");
const aiUsage = require("../ai/usage");
const models = require("../ai/models");
const aiLimits = require("../ai/limits");
const dedupe = require("../ai/dedupe");

const FEATURE = "coach_followup";
const FAILED = "Your coach couldn't write today's check-in right now. Please try again.";
const NOT_SET_UP = "Daily check-ins aren't set up on this server yet (run migrations/2027-02-01-coach-followups.sql).";

// Whether ai_usage can record this feature (migration 2027-02-01), read once a minute: without it
// the calls couldn't be counted against the budget, so none are made
let ready = { at: 0, value: false };
async function featureReady(pool) {
  if (Date.now() - ready.at < 60 * 1000) return ready.value;
  const [[row]] = await pool.query(
    "SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_usage' AND COLUMN_NAME = 'feature'",
  );
  ready = { at: Date.now(), value: String(row?.type ?? "").includes(`'${FEATURE}'`) };
  return ready.value;
}

async function workoutStatus(pool, userId, date) {
  const [rows] = await pool.query("SELECT status FROM workout_logs WHERE user_id = ? AND on_date = ?", [userId, date]);
  if (rows.some((r) => r.status === "completed")) return "completed";
  return rows.some((r) => r.status === "skipped") ? "skipped" : null;
}

/** POST /followup { date } → { message }: today's check-in, written the first time it's asked for */
async function followup(pool, userId, { date }, env = process.env) {
  const facts = await memberFacts(pool, userId, date); // 400 before the intake
  const clientId = rules.followupId(userId, date, facts.intake.coach);
  const saved = await chatHistory.savedCoachMessage(pool, userId, clientId);
  if (saved) return { message: chatRules.toMessage(saved) };
  if (!(await featureReady(pool))) throw new CoachPlanError(NOT_SET_UP, 503);

  return dedupe.shared.run(dedupe.requestKey(FEATURE, userId, clientId), async () => {
    await aiLimits.check(pool, { feature: FEATURE, userId }, env);
    const [status, recent] = await Promise.all([workoutStatus(pool, userId, date), chatHistory.recentContext(pool, userId)]);
    const earlier = recent.coach === facts.intake.coach ? recent.messages : [];
    const brief = `${chatRules.memberBrief(facts)}\n${rules.workoutLine(facts.intake, date, status)}`;
    const instructions = `${rules.followupInstructions(facts.intake)}\n\nFacts about the member:\n${brief}`;
    // The model is shown the conversation so far and an ask that is never saved
    const messages = chatRules.modelHistory([...earlier, { role: "member", text: "Write my check-in for today." }]);
    const usage = aiUsage.tracker(pool, { feature: FEATURE, userId });
    const answer = models.isFake(env)
      ? (await usage.record({ provider: "openai", model: "fake", inputTokens: 10, outputTokens: 5, status: "ok" }), { reply: rules.FAKE_FOLLOWUP })
      : await askCoach({ instructions, messages, cacheKey: `coach_chat:${userId}`, feature: FEATURE }, env, usage);
    const text = chatRules.cleanReply(answer?.reply);
    if (!text) throw new CoachPlanError(FAILED, 502);
    const row = await chatHistory.saveCoachMessage(pool, userId, { clientId, coach: facts.intake.coach, text });
    if (!row) throw new CoachPlanError("Your coach changed just now. Open the chat again.", 409);
    return { message: chatRules.toMessage(row) };
  });
}

module.exports = { followup, FEATURE };
