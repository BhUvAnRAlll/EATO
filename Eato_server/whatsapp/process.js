// Turns a saved webhook event into records, inside the gym the event was routed to. A message
// becomes a contact, a conversation and a message (once: Meta's message id is unique); a status
// updates only an outgoing message of that same gym, and never moves backwards (read stays read).
// Status events never trigger a reply. `afterInbound` is the hook the AI engine uses (phase D).
const { recordUsage } = require("./usage");

const STATUS_RANK = { queued: 0, sent: 1, delivered: 2, read: 3 };
const USAGE_CATEGORIES = ["service", "utility", "marketing", "authentication"];

async function inTransaction(pool, fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function storeInbound(pool, gymId, event) {
  return inTransaction(pool, async (db) => {
    await db.query(
      `INSERT INTO whatsapp_contacts (gym_id, wa_id, profile_name) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE profile_name = COALESCE(VALUES(profile_name), profile_name)`,
      [gymId, event.from, event.profileName],
    );
    const [[contact]] = await db.query("SELECT id FROM whatsapp_contacts WHERE gym_id = ? AND wa_id = ?", [gymId, event.from]);
    await db.query("INSERT IGNORE INTO whatsapp_conversations (gym_id, contact_id) VALUES (?, ?)", [gymId, contact.id]);
    const [[conversation]] = await db.query("SELECT id FROM whatsapp_conversations WHERE gym_id = ? AND contact_id = ? FOR UPDATE", [gymId, contact.id]);
    let mediaId = null;
    if (event.type === "image" && event.media) {
      const [[{ id }]] = await db.query("SELECT UUID() AS id");
      await db.query("INSERT INTO whatsapp_media (id, gym_id, provider_media_id, mime_type, status) VALUES (?, ?, ?, ?, 'pending')", [id, gymId, event.media.id, event.media.mimeType]);
      mediaId = id;
    }
    const [inserted] = await db.query(
      `INSERT IGNORE INTO whatsapp_messages (gym_id, conversation_id, direction, sender, type, body, media_id, provider_message_id, status)
       VALUES (?, ?, 'in', 'customer', ?, ?, ?, ?, 'received')`,
      [gymId, conversation.id, event.type, event.body, mediaId, event.providerMessageId],
    );
    if (inserted.affectedRows !== 1) {
      if (mediaId) await db.query("DELETE FROM whatsapp_media WHERE id = ? AND gym_id = ?", [mediaId, gymId]);
      return null; // the same message arrived twice
    }
    await db.query(
      "UPDATE whatsapp_conversations SET last_message_at = NOW(), last_inbound_at = NOW(), unread_count = unread_count + 1, status = 'open' WHERE id = ? AND gym_id = ?",
      [conversation.id, gymId],
    );
    await recordUsage(db, gymId, "inbound", 1);
    return { conversationId: conversation.id, contactId: contact.id, type: event.type, body: event.body };
  });
}

async function applyStatus(pool, gymId, event) {
  const [rows] = await pool.query(
    "SELECT id, status FROM whatsapp_messages WHERE provider_message_id = ? AND gym_id = ? AND direction = 'out'",
    [event.providerMessageId, gymId],
  );
  const message = rows[0];
  if (!message) return "ignored"; // not one of this gym's messages
  const forward = event.status === "failed" || (STATUS_RANK[event.status] ?? -1) > (STATUS_RANK[message.status] ?? 99);
  if (!forward) return "processed";
  await pool.query(
    "UPDATE whatsapp_messages SET status = ?, error_code = ?, status_at = NOW() WHERE id = ? AND gym_id = ?",
    [event.status, event.status === "failed" ? event.errorCode : null, message.id, gymId],
  );
  return "processed";
}

// The job handler for "whatsapp.event"
function eventHandler({ afterInbound = null } = {}) {
  return async (pool, job) => {
    const [rows] = await pool.query("SELECT id, gym_id, kind, payload, status FROM whatsapp_webhook_events WHERE id = ?", [job.payload.eventId]);
    const row = rows[0];
    if (!row || row.status !== "pending" || !row.gym_id) return; // already handled, or never routable
    const event = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    let outcome = "processed";
    if (row.kind === "message") {
      const stored = await storeInbound(pool, row.gym_id, event);
      if (stored && afterInbound) await afterInbound(pool, row.gym_id, stored);
    } else if (row.kind === "status") {
      outcome = await applyStatus(pool, row.gym_id, event);
    } else {
      outcome = "ignored";
    }
    await pool.query("UPDATE whatsapp_webhook_events SET status = ?, processed_at = NOW(), attempts = attempts + 1 WHERE id = ?", [outcome, row.id]);
  };
}

module.exports = { eventHandler, storeInbound, applyStatus, USAGE_CATEGORIES };
