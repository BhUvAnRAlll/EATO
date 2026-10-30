// Automatic replies on WhatsApp. After a customer's message is stored (process.js), a reply is
// queued only when the gym's agent is active, the number is connected and the conversation is
// with the AI (not paused, not handed to a person). The reply job checks all of that again when
// it runs, answers the newest message only (a burst gets one reply), keeps to the daily and
// per-conversation limits, and hands the conversation to a person when the agent escalates.
const { enqueue } = require("./jobs");
const { gymKnowledge, conversationHistory, answer } = require("./agent");
const { sendText, SendRefused } = require("./send");
const { recordUsage } = require("./usage");
const aiUsage = require("../ai/usage");

const PER_CONVERSATION_HOURLY = 15; // AI replies in one conversation per hour before a person takes over

const HANDOFF = {
  image: "Thanks for the photo. A team member will take a look and reply here.",
  other: "Thanks for your message. A team member will reply here soon.",
  limit: "Thanks for your message. A team member will reply here soon.",
};

async function eligible(db, gymId, conversationId) {
  const [[row]] = await db.query(
    `SELECT s.agent_status, c.status AS connection, c.disabled_by_admin, v.handler, v.ai_paused
     FROM whatsapp_agent_settings s
     JOIN whatsapp_connections c ON c.gym_id = s.gym_id
     JOIN whatsapp_conversations v ON v.gym_id = s.gym_id AND v.id = ?
     WHERE s.gym_id = ?`,
    [conversationId, gymId],
  );
  return Boolean(row && row.agent_status === "active" && row.connection === "connected" && !row.disabled_by_admin && row.handler === "ai" && !row.ai_paused);
}

// The process.js hook: queue one reply per stored customer message
async function afterInbound(pool, gymId, stored) {
  if (!(await eligible(pool, gymId, stored.conversationId))) return;
  await enqueue(pool, "whatsapp.reply", { conversationId: stored.conversationId, messageId: stored.messageId }, { gymId, idempotencyKey: `reply:${stored.messageId}`, maxAttempts: 4 });
}

async function handOff(pool, meta, gymId, conversationId, text) {
  await pool.query("UPDATE whatsapp_conversations SET handler = 'human' WHERE id = ? AND gym_id = ?", [conversationId, gymId]);
  await sendText(pool, meta, { gymId, conversationId, body: text, sender: "ai" });
}

function replyHandler({ provider, meta }) {
  return async (pool, job) => {
    const gymId = job.gym_id;
    const { conversationId, messageId } = job.payload;
    if (!gymId || !(await eligible(pool, gymId, conversationId))) return; // switched off or handed over since
    const [[message]] = await pool.query("SELECT id, type, created_at FROM whatsapp_messages WHERE id = ? AND gym_id = ? AND conversation_id = ?", [messageId, gymId, conversationId]);
    if (!message) return;
    // A newer customer message has its own reply job, which sees this one in the history
    const [[newer]] = await pool.query(
      "SELECT COUNT(*) AS n FROM whatsapp_messages WHERE gym_id = ? AND conversation_id = ? AND direction = 'in' AND created_at > ?",
      [gymId, conversationId, message.created_at],
    );
    if (Number(newer.n) > 0) return;
    // Already answered (a retry after the send went through)
    const [[answered]] = await pool.query(
      "SELECT COUNT(*) AS n FROM whatsapp_messages WHERE gym_id = ? AND conversation_id = ? AND direction = 'out' AND created_at > ?",
      [gymId, conversationId, message.created_at],
    );
    if (Number(answered.n) > 0) return;

    if (message.type !== "text") return handOff(pool, meta, gymId, conversationId, message.type === "image" ? HANDOFF.image : HANDOFF.other);

    const knowledge = await gymKnowledge(pool, gymId);
    const [[today]] = await pool.query("SELECT COALESCE(SUM(count), 0) AS n FROM whatsapp_usage WHERE gym_id = ? AND day = CURDATE() AND kind = 'ai'", [gymId]);
    const [[recent]] = await pool.query(
      "SELECT COUNT(*) AS n FROM whatsapp_messages WHERE gym_id = ? AND conversation_id = ? AND sender = 'ai' AND created_at > NOW() - INTERVAL 1 HOUR",
      [gymId, conversationId],
    );
    if (Number(today.n) >= knowledge.dailyReplyLimit || Number(recent.n) >= PER_CONVERSATION_HOURLY) {
      return handOff(pool, meta, gymId, conversationId, HANDOFF.limit);
    }

    const usage = aiUsage.tracker(pool, { feature: "gym_assistant", gymId });
    let result;
    try {
      result = await answer(provider, knowledge, await conversationHistory(pool, gymId, conversationId), { channel: "whatsapp" });
    } catch (error) {
      await usage.record({ provider: "openai", model: provider.model ?? "unknown", status: "failed" });
      throw error;
    }
    await recordUsage(pool, gymId, "ai", 1, { inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    await usage.record({ provider: "openai", model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, status: "ok" });
    if (result.escalate) await pool.query("UPDATE whatsapp_conversations SET handler = 'human' WHERE id = ? AND gym_id = ?", [conversationId, gymId]);
    try {
      await sendText(pool, meta, { gymId, conversationId, body: result.reply, sender: "ai" });
    } catch (error) {
      if (error instanceof SendRefused) error.retryable = false; // window closed or disconnected: retrying won't help
      throw error;
    }
  };
}

module.exports = { afterInbound, replyHandler, PER_CONVERSATION_HOURLY };
