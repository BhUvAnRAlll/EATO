// Sending a text to a customer through the gym's own number. The conversation must belong to
// the gym, the gym's connection must be live, and the customer must have written within the
// last 24 hours (WhatsApp's customer-service window): outside it only an approved template may
// be sent (campaigns, phase G). The message is stored as "queued" first, so a crash after Meta
// accepts it still leaves a record; Meta's id and the status follow.
const { ValidationError } = require("../profile");
const { sendingConnection } = require("./connections");
const { recordUsage } = require("./usage");

class SendRefused extends ValidationError {
  constructor(message, code) {
    super(message);
    this.status = 409;
    this.code = code;
    this.publicMessage = code;
  }
}

const MAX_TEXT = 4096;

async function sendText(pool, meta, { gymId, conversationId, body, sender, staffUserId = null }) {
  const text = typeof body === "string" ? body.trim().slice(0, MAX_TEXT) : "";
  if (!text) throw new SendRefused("There's nothing to send.", "empty");
  const [rows] = await pool.query(
    `SELECT c.id, c.last_inbound_at > NOW() - INTERVAL 24 HOUR AS in_window, k.wa_id, k.opted_out_at
     FROM whatsapp_conversations c JOIN whatsapp_contacts k ON k.id = c.contact_id AND k.gym_id = c.gym_id
     WHERE c.id = ? AND c.gym_id = ?`,
    [conversationId, gymId],
  );
  const conversation = rows[0];
  if (!conversation) throw new SendRefused("That conversation doesn't exist.", "not_found");
  if (!conversation.in_window) throw new SendRefused("The customer hasn't written in the last 24 hours, so only an approved template can be sent.", "window_closed");
  const connection = await sendingConnection(pool, gymId);
  if (!connection) throw new SendRefused("The gym's WhatsApp isn't connected.", "not_connected");

  const [[{ id }]] = await pool.query("SELECT UUID() AS id");
  await pool.query(
    "INSERT INTO whatsapp_messages (id, gym_id, conversation_id, direction, sender, staff_user_id, type, body, status) VALUES (?, ?, ?, 'out', ?, ?, 'text', ?, 'queued')",
    [id, gymId, conversationId, sender, staffUserId, text],
  );
  try {
    const sent = await meta.sendText({ phoneNumberId: connection.phoneNumberId, token: connection.token, to: conversation.wa_id, body: text });
    await pool.query("UPDATE whatsapp_messages SET provider_message_id = ?, status = 'sent', status_at = NOW() WHERE id = ? AND gym_id = ?", [sent.id, id, gymId]);
    await pool.query("UPDATE whatsapp_conversations SET last_message_at = NOW() WHERE id = ? AND gym_id = ?", [conversationId, gymId]);
    await recordUsage(pool, gymId, "service", 1);
    return { id, providerMessageId: sent.id, status: "sent" };
  } catch (error) {
    await pool.query("UPDATE whatsapp_messages SET status = 'failed', error_code = ?, status_at = NOW() WHERE id = ? AND gym_id = ?", [String(error?.code ?? error?.name ?? "error").slice(0, 40), id, gymId]);
    throw error;
  }
}

module.exports = { sendText, SendRefused };
