// The AI Coach chat's saved conversation (tables coach_chats and coach_chat_messages).
//
// The member's current conversation is their newest coach_chats row while it is with the coach
// they have now; after a change of coach the next message starts a new one, and the old one is
// kept (never shown) until it expires. Each message lives KEEP_DAYS days from when it was written:
// older ones are left out of every read here (what the app shows, the coach's context, a retried
// send) and deleted by cleanupExpired, which the server runs at startup and every hour. Every
// query is scoped to the verified member id passed in by the route; the text is never logged.
const crypto = require("node:crypto");

const { ValidationError } = require("../profile");
const { KEEP_DAYS, limits, toMessage } = require("./chatRules");

// TIMESTAMP columns compare as instants, so the cutoff is the same whatever the server's or the
// connection's time zone is
const FRESH = "created_at >= NOW(3) - INTERVAL ? DAY";
const COLUMNS = "id, role, text, proposals, created_at";

async function newestChat(db, userId, { lock = false } = {}) {
  const [[chat]] = await db.query(
    `SELECT id, coach FROM coach_chats WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
  return chat ?? null;
}

// The newest `limit` messages of the member's newest conversation, oldest first, and that
// conversation's coach (null when it has no messages left): one query, the chat and its messages joined
async function newestMessages(db, userId, limit) {
  const [rows] = await db.query(
    `SELECT m.id, m.role, m.text, m.proposals, m.created_at, c.coach
     FROM (SELECT id, coach FROM coach_chats WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1) c
     JOIN coach_chat_messages m ON m.chat_id = c.id AND m.user_id = ?
     WHERE m.created_at >= NOW(3) - INTERVAL ? DAY
     ORDER BY m.id DESC LIMIT ?`,
    [userId, userId, KEEP_DAYS, limit],
  );
  return { coach: rows[0]?.coach ?? null, rows: rows.reverse() };
}

// The newest `limit` messages of the conversation with this coach, oldest first ([] when there is none)
async function currentMessages(db, userId, coach, limit) {
  const newest = await newestMessages(db, userId, limit);
  return newest.coach === coach ? newest.rows : [];
}

/** GET /chat: the member's coach and their current conversation as the app shows it, oldest first */
async function history(pool, userId) {
  // This member's expired messages go now, without waiting for the hourly cleanup
  await pool.query(`DELETE FROM coach_chat_messages WHERE user_id = ? AND NOT (${FRESH})`, [userId, KEEP_DAYS]);
  const [[profile]] = await pool.query("SELECT coach FROM coach_profiles WHERE user_id = ?", [userId]);
  if (!profile) return { coach: null, messages: [] };
  return { coach: profile.coach, messages: (await currentMessages(pool, userId, profile.coach, limits.shown)).map(toMessage) };
}

const forCoach = (rows) => rows.map(({ role, text }) => ({ role, text }));

/** The conversation so far as the coach reads it: [{ role, text }], oldest first */
async function context(pool, userId, coach) {
  return forCoach(await currentMessages(pool, userId, coach, limits.turns));
}

/** The newest conversation as the coach would read it, with its coach, for a caller that doesn't
 * know the member's coach yet (the chat reads it alongside the member's facts): { coach, messages } */
async function recentContext(pool, userId) {
  const newest = await newestMessages(pool, userId, limits.turns);
  return { coach: newest.coach, messages: forCoach(newest.rows) };
}

const answerOf = (rows) => {
  const reply = rows.find((r) => r.role === "coach");
  if (!reply) return null;
  const messages = rows.map(toMessage);
  const coach = messages.find((m) => m.role === "coach");
  return { reply: coach.text, proposals: coach.proposals ?? { meals: [], workout: null }, messages };
};

/** The saved answer to this send, when it was answered already (a retry): { reply, proposals, messages } or null */
async function savedAnswer(db, userId, clientId) {
  const [rows] = await db.query(
    `SELECT ${COLUMNS} FROM coach_chat_messages WHERE user_id = ? AND client_id = ? AND ${FRESH} ORDER BY id`,
    [userId, clientId, KEEP_DAYS],
  );
  return answerOf(rows);
}

/**
 * Saves the member's message and the coach's reply together, in the current conversation (a new
 * one when there is none or the coach changed). The member's coach_profiles row is locked while
 * it does, so two sends at once never start two conversations. The same send saved twice keeps the first.
 */
async function saveAnswer(pool, userId, { clientId, text, reply, proposals }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[profile]] = await conn.query("SELECT coach FROM coach_profiles WHERE user_id = ? FOR UPDATE", [userId]);
    if (!profile) throw new ValidationError("Answer your coach's questions first.");
    let chat = await newestChat(conn, userId, { lock: true });
    if (!chat || chat.coach !== profile.coach) {
      chat = { id: crypto.randomUUID(), coach: profile.coach };
      await conn.query("INSERT INTO coach_chats (id, user_id, coach) VALUES (?, ?, ?)", [chat.id, userId, chat.coach]);
    }
    await conn.query(
      "INSERT INTO coach_chat_messages (user_id, chat_id, role, text, proposals, client_id) VALUES (?, ?, 'member', ?, NULL, ?), (?, ?, 'coach', ?, ?, ?)",
      [userId, chat.id, text, clientId, userId, chat.id, reply, JSON.stringify(proposals), clientId],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    // The same send was saved a moment ago: answer with that one
    if (error?.code !== "ER_DUP_ENTRY") throw error;
  } finally {
    conn.release();
  }
  return savedAnswer(pool, userId, clientId);
}

const BATCH = 1000;

/**
 * Deletes every chat message older than KEEP_DAYS, in batches so no long lock is held, then the
 * conversations left empty that are older than that and no longer anyone's current one (a send
 * only ever writes to the current one, so this never races a new message). Only the two chat
 * tables are touched. Safe to run at the same time as itself or as sends. → { messages, chats } deleted
 */
async function cleanupExpired(db) {
  let messages = 0;
  for (;;) {
    const [result] = await db.query(`DELETE FROM coach_chat_messages WHERE NOT (${FRESH}) ORDER BY id LIMIT ${BATCH}`, [KEEP_DAYS]);
    messages += result.affectedRows;
    if (result.affectedRows < BATCH) break;
  }
  let chats = 0;
  for (;;) {
    const [rows] = await db.query(
      `SELECT c.id FROM coach_chats c
        WHERE NOT (c.${FRESH})
          AND NOT EXISTS (SELECT 1 FROM coach_chat_messages m WHERE m.user_id = c.user_id AND m.chat_id = c.id)
          AND EXISTS (SELECT 1 FROM coach_chats n WHERE n.user_id = c.user_id AND (n.created_at > c.created_at OR (n.created_at = c.created_at AND n.id > c.id)))
        LIMIT ${BATCH}`,
      [KEEP_DAYS],
    );
    if (rows.length === 0) break;
    const [result] = await db.query(
      "DELETE FROM coach_chats WHERE id IN (?) AND NOT EXISTS (SELECT 1 FROM coach_chat_messages m WHERE m.chat_id = coach_chats.id)",
      [rows.map((r) => r.id)],
    );
    chats += result.affectedRows;
    if (rows.length < BATCH) break;
  }
  return { messages, chats };
}

/** Runs cleanupExpired now and every `everyMs` (an hour) without keeping the process alive. → stop() */
function startCleanup(pool, { everyMs = 60 * 60 * 1000, log = console } = {}) {
  let warned = false;
  const run = () =>
    cleanupExpired(pool)
      .then(({ messages, chats }) => {
        if (messages + chats > 0 && process.env.NODE_ENV !== "test") log.log(`Coach chat cleanup: ${messages} expired messages, ${chats} conversations deleted`);
      })
      .catch((error) => {
        // Before the migration has run there is nothing to clean: say so once
        if (error?.code === "ER_NO_SUCH_TABLE") {
          if (!warned) log.warn("Coach chat cleanup skipped: run migrations/2026-11-10-coach-chat-history.sql");
          warned = true;
          return;
        }
        log.error(`Coach chat cleanup failed: ${error?.code ?? error?.name ?? "unknown"}`);
      });
  const first = setTimeout(run, 0);
  const timer = setInterval(run, everyMs);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}

module.exports = { history, context, recentContext, savedAnswer, saveAnswer, cleanupExpired, startCleanup };
