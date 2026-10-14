// Groups: discovery, membership and (for admins) creation. Private groups appear only to
// their members; member counts are kept in step inside the join/leave transaction.
const { mediaUrl, assertOwnMedia } = require("./media");
const { encodeCursor } = require("./validate");
const { NotFoundError, ForbiddenError } = require("./posts");
const { ValidationError } = require("../profile");

function groupToApi(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    topic: row.topic,
    description: row.description,
    coverUrl: mediaUrl(row.cover_media_id),
    isPrivate: Boolean(row.is_private),
    memberCount: row.member_count,
    joined: Boolean(row.joined),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const GROUP_SELECT = `
  SELECT g.*, EXISTS (SELECT 1 FROM community_group_members m WHERE m.group_id = g.id AND m.user_id = ?) AS joined
  FROM community_groups g`;

// Public groups plus the private ones the member belongs to; search matches name or topic
async function listGroups(pool, userId, { search = null, cursor = null, limit }) {
  const params = [userId, userId];
  let where = "WHERE (g.is_private = FALSE OR EXISTS (SELECT 1 FROM community_group_members m WHERE m.group_id = g.id AND m.user_id = ?))";
  if (search) {
    where += " AND (g.name LIKE ? OR g.topic LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  if (cursor) {
    where += " AND (g.created_at > ? OR (g.created_at = ? AND g.id > ?))";
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  params.push(limit + 1);
  const [rows] = await pool.query(`${GROUP_SELECT} ${where} ORDER BY g.created_at ASC, g.id ASC LIMIT ?`, params);
  const page = rows.slice(0, limit);
  return { groups: page.map(groupToApi), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}

async function getGroup(pool, userId, groupId) {
  const [rows] = await pool.query(`${GROUP_SELECT} WHERE g.id = ?`, [userId, groupId]);
  const row = rows[0];
  if (!row) throw new NotFoundError("That group doesn't exist.");
  if (row.is_private && !row.joined) throw new ForbiddenError("This group is private.");
  return groupToApi(row);
}

// Admins only (checked by the route). The creator joins as the group's admin.
async function createGroup(pool, userId, values) {
  const coverMediaId = await assertOwnMedia(pool, values.coverMediaId, userId);
  const [existing] = await pool.query("SELECT 1 FROM community_groups WHERE slug = ?", [values.slug]);
  if (existing.length > 0) throw new ValidationError("A group with that name already exists.");
  const connection = await pool.getConnection();
  let id;
  try {
    await connection.beginTransaction();
    [[{ id }]] = await connection.query("SELECT UUID() AS id");
    await connection.query(
      "INSERT INTO community_groups (id, slug, name, topic, description, cover_media_id, is_private, member_count, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
      [id, values.slug, values.name, values.topic, values.description, coverMediaId, values.isPrivate, userId],
    );
    await connection.query("INSERT INTO community_group_members (group_id, user_id, role) VALUES (?, ?, 'admin')", [id, userId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getGroup(pool, userId, id);
}

// Join a public group (a repeat is a no-op); private groups can't be joined from the app
async function joinGroup(pool, userId, groupId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT is_private FROM community_groups WHERE id = ? FOR UPDATE", [groupId]);
    if (!rows[0]) throw new NotFoundError("That group doesn't exist.");
    if (rows[0].is_private) throw new ForbiddenError("This group is private.");
    const [result] = await connection.query("INSERT IGNORE INTO community_group_members (group_id, user_id) VALUES (?, ?)", [groupId, userId]);
    if (result.affectedRows === 1) await connection.query("UPDATE community_groups SET member_count = member_count + 1 WHERE id = ?", [groupId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return getGroup(pool, userId, groupId);
}

async function leaveGroup(pool, userId, groupId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query("SELECT id FROM community_groups WHERE id = ? FOR UPDATE", [groupId]);
    if (!rows[0]) throw new NotFoundError("That group doesn't exist.");
    const [result] = await connection.query("DELETE FROM community_group_members WHERE group_id = ? AND user_id = ?", [groupId, userId]);
    if (result.affectedRows === 1) await connection.query("UPDATE community_groups SET member_count = GREATEST(member_count, 1) - 1 WHERE id = ?", [groupId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  // A private group the member just left is no longer visible to them
  const [after] = await pool.query(`${GROUP_SELECT} WHERE g.id = ?`, [userId, groupId]);
  return { ...groupToApi(after[0]), joined: false };
}

module.exports = { listGroups, getGroup, createGroup, joinGroup, leaveGroup };
