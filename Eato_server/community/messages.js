// Direct messages between two members. Every read and write first checks that the caller
// is a member of the conversation, so nobody can read or post into someone else's chat.
//
// Blocking: a direct conversation between two members is hidden from both of them while
// either has blocked the other (it leaves the inbox and the unread count, and reading it
// is a 404). The history is kept, so unblocking brings it back exactly as it was. Sending
// into it is refused. The rule applies to direct (two-member) conversations only; a
// conversation with more members is never hidden by a block between two of them.
const { memberSummary, ensureUser } = require("./members");
const { encodeCursor } = require("./validate");
const { NotFoundError, ForbiddenError } = require("./posts");
const { ValidationError } = require("../profile");
const { isBlocked, isSuspended } = require("./visibility");

async function assertMember(pool, conversationId, userId) {
  const [rows] = await pool.query("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?", [conversationId, userId]);
  if (rows.length === 0) throw new ForbiddenError("You're not part of this conversation.");
}

// SQL: conversation `c` is not a direct conversation hidden by a block involving viewer `?`.
// Placeholders, in order: viewer, viewer, viewer, viewer
const NOT_BLOCKED_SQL = `NOT (
  (SELECT COUNT(*) FROM conversation_members cm WHERE cm.conversation_id = c.id) = 2
  AND EXISTS (
    SELECT 1 FROM conversation_members o
    JOIN community_blocks b ON (b.blocker_id = ? AND b.blocked_id = o.user_id) OR (b.blocker_id = o.user_id AND b.blocked_id = ?)
    WHERE o.conversation_id = c.id AND o.user_id <> ?
  )
)`;
const notBlockedParams = (viewerId) => [viewerId, viewerId, viewerId];

// Whether this conversation is hidden from the viewer by a block (direct conversations only)
async function isHiddenByBlock(pool, conversationId, viewerId) {
  const [rows] = await pool.query(`SELECT 1 FROM conversations c WHERE c.id = ? AND ${NOT_BLOCKED_SQL}`, [conversationId, ...notBlockedParams(viewerId)]);
  return rows.length === 0;
}

// Membership plus the block rule: a hidden conversation answers like a missing one
async function assertVisibleMember(pool, conversationId, userId) {
  await assertMember(pool, conversationId, userId);
  if (await isHiddenByBlock(pool, conversationId, userId)) throw new NotFoundError("That conversation isn't available.");
}

// The caller's conversations, most recent message first, with the other member and the unread count
async function listConversations(pool, userId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.last_message_at,
            o.user_id AS other_id, u.full_name,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> ? AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)) AS unread,
            (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body
     FROM conversation_members me
     JOIN conversations c ON c.id = me.conversation_id
     JOIN conversation_members o ON o.conversation_id = c.id AND o.user_id <> me.user_id
     JOIN users u ON u.id = o.user_id
     WHERE me.user_id = ? AND ${NOT_BLOCKED_SQL}
     ORDER BY c.last_message_at DESC, c.created_at DESC
     LIMIT 100`,
    [userId, userId, ...notBlockedParams(userId)],
  );
  return rows.map((row) => ({
    id: row.id,
    other: memberSummary({ user_id: row.other_id, full_name: row.full_name }),
    lastMessage: row.last_body,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
    unreadCount: Number(row.unread),
  }));
}

// Messages in other members' conversations the caller hasn't read yet (the header badge)
async function unreadCount(pool, userId) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM messages m
     JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = ?
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.sender_id <> ? AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at) AND ${NOT_BLOCKED_SQL}`,
    [userId, userId, ...notBlockedParams(userId)],
  );
  return Number(row.n);
}

// Opens (or returns the existing) direct conversation with another member
async function openConversation(pool, userId, otherId) {
  if (otherId === userId) throw new ValidationError("You can't message yourself.");
  const [others] = await pool.query("SELECT id FROM users WHERE id = ?", [otherId]);
  if (others.length === 0 || (await isBlocked(pool, userId, otherId)) || (await isSuspended(pool, otherId))) throw new NotFoundError("That member doesn't exist.");
  await ensureUser(pool, userId);
  const [existing] = await pool.query(
    `SELECT a.conversation_id AS id FROM conversation_members a
     JOIN conversation_members b ON b.conversation_id = a.conversation_id AND b.user_id = ?
     WHERE a.user_id = ? LIMIT 1`,
    [otherId, userId],
  );
  if (existing[0]) return { id: existing[0].id };
  const connection = await pool.getConnection();
  let id;
  try {
    await connection.beginTransaction();
    [[{ id }]] = await connection.query("SELECT UUID() AS id");
    await connection.query("INSERT INTO conversations (id) VALUES (?)", [id]);
    await connection.query("INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)", [id, userId, id, otherId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { id };
}

function messageToApi(row, viewerId) {
  return { id: row.id, conversationId: row.conversation_id, senderId: row.sender_id, body: row.body, isOwn: row.sender_id === viewerId, createdAt: new Date(row.created_at).toISOString() };
}

// Newest messages first (the screen reverses them); reading marks the conversation read
async function listMessages(pool, userId, conversationId, { cursor = null, limit }) {
  await assertVisibleMember(pool, conversationId, userId);
  const params = [conversationId];
  let where = "WHERE conversation_id = ?";
  if (cursor) {
    where += " AND (created_at < ? OR (created_at = ? AND id < ?))";
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  params.push(limit + 1);
  const [rows] = await pool.query(`SELECT id, conversation_id, sender_id, body, created_at FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ?`, params);
  if (!cursor) await pool.query("UPDATE conversation_members SET last_read_at = NOW(6) WHERE conversation_id = ? AND user_id = ?", [conversationId, userId]);
  const page = rows.slice(0, limit);
  const [members] = await pool.query(
    "SELECT m.user_id, u.full_name FROM conversation_members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ? AND m.user_id <> ?",
    [conversationId, userId],
  );
  return {
    other: members[0] ? memberSummary(members[0]) : null,
    messages: page.map((row) => messageToApi(row, userId)),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

async function sendMessage(pool, userId, conversationId, values) {
  await assertMember(pool, conversationId, userId);
  // A direct conversation hidden by a block can't be written to from either side
  if (await isHiddenByBlock(pool, conversationId, userId)) throw new ForbiddenError("You can't message this member.");
  // In a conversation with more members, a blocked pair still can't message each other through it
  const [others] = await pool.query("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?", [conversationId, userId]);
  for (const other of others) {
    if (await isBlocked(pool, userId, other.user_id)) throw new ForbiddenError("You can't message this member.");
  }
  const connection = await pool.getConnection();
  let id;
  try {
    await connection.beginTransaction();
    [[{ id }]] = await connection.query("SELECT UUID() AS id");
    await connection.query("INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?, ?, ?, ?)", [id, conversationId, userId, values.body]);
    await connection.query("UPDATE conversations SET last_message_at = NOW(6) WHERE id = ?", [conversationId]);
    await connection.query("UPDATE conversation_members SET last_read_at = NOW(6) WHERE conversation_id = ? AND user_id = ?", [conversationId, userId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const [rows] = await pool.query("SELECT id, conversation_id, sender_id, body, created_at FROM messages WHERE id = ?", [id]);
  return messageToApi(rows[0], userId);
}

module.exports = { listConversations, unreadCount, openConversation, listMessages, sendMessage, isHiddenByBlock };
