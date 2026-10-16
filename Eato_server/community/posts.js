// Feed posts, likes, comments and reports. Every query is scoped to the verified caller
// where it returns or changes something they own, and counts are changed in the same
// transaction as the like or comment they count.
const { ValidationError } = require("../profile");
const { memberSummary } = require("./members");
const { assertOwnMediaList, removeIfUnreferenced, mediaUrl } = require("./media");
const { encodeCursor } = require("./validate");
const { VISIBLE_POST_SQL, visiblePostParams, canSeeAccount } = require("./visibility");

// Safe-to-show errors: the shared handler answers with the status and the message
class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
    this.status = 404;
  }
}
class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = "ForbiddenError";
    this.status = 403;
  }
}

const POST_SELECT = `
  SELECT p.id, p.user_id, p.group_id, p.category, p.audience, p.body, p.media_id, p.like_count, p.comment_count,
         p.created_at, p.updated_at, u.full_name,
         EXISTS (SELECT 1 FROM community_post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
  FROM community_posts p
  JOIN users u ON u.id = p.user_id`;

// The photos of each post in a page, in display order: postId → [{ id, url }]
async function mediaByPost(pool, postIds) {
  const result = new Map(postIds.map((id) => [id, []]));
  if (postIds.length === 0) return result;
  const [rows] = await pool.query("SELECT post_id, media_id FROM community_post_media WHERE post_id IN (?) ORDER BY post_id, position", [postIds]);
  for (const row of rows) result.get(row.post_id).push({ id: row.media_id, url: mediaUrl(row.media_id) });
  return result;
}

function postToApi(row, viewerId, media = []) {
  return {
    id: row.id,
    author: memberSummary(row),
    groupId: row.group_id,
    category: row.category,
    audience: row.audience,
    body: row.body,
    imageUrl: media[0]?.url ?? mediaUrl(row.media_id), // the cover, for anything that shows one image
    media,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    liked: Boolean(row.liked),
    isOwn: row.user_id === viewerId,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

// Posts a member may see: the main feed (no group), or a group they can view
async function canViewGroup(pool, groupId, userId) {
  const [rows] = await pool.query(
    "SELECT g.is_private, EXISTS (SELECT 1 FROM community_group_members m WHERE m.group_id = g.id AND m.user_id = ?) AS member FROM community_groups g WHERE g.id = ?",
    [userId, groupId],
  );
  const group = rows[0];
  if (!group) throw new NotFoundError("That group doesn't exist.");
  return !group.is_private || Boolean(group.member);
}

// A page of the main feed (groupId null), of a group, or of one member's profile, newest
// first. Only posts the viewer may see are returned (see visibility.js).
async function listPosts(pool, userId, { groupId = null, authorId = null, cursor = null, limit }) {
  if (groupId && !(await canViewGroup(pool, groupId, userId))) throw new ForbiddenError("Join this group to see its posts.");
  if (authorId && !(await canSeeAccount(pool, userId, authorId))) throw new ForbiddenError("This account is private.");
  const params = [userId, ...visiblePostParams(userId)];
  let where = `WHERE p.deleted_at IS NULL AND ${VISIBLE_POST_SQL} AND ` + (groupId ? "p.group_id = ?" : authorId ? "p.group_id IS NULL AND p.user_id = ?" : "p.group_id IS NULL");
  if (groupId) params.push(groupId);
  if (authorId) params.push(authorId);
  if (cursor) {
    where += " AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))";
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  params.push(limit + 1);
  const [rows] = await pool.query(`${POST_SELECT} ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`, params);
  const page = rows.slice(0, limit);
  const media = await mediaByPost(pool, page.map((row) => row.id));
  return { posts: page.map((row) => postToApi(row, userId, media.get(row.id))), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}

// A post the viewer may see; anything else is a 404 (never confirms a hidden post exists)
async function getPost(pool, userId, postId) {
  const [rows] = await pool.query(`${POST_SELECT} WHERE p.id = ? AND p.deleted_at IS NULL AND ${VISIBLE_POST_SQL}`, [userId, postId, ...visiblePostParams(userId)]);
  const row = rows[0];
  if (!row) throw new NotFoundError("That post no longer exists.");
  const media = await mediaByPost(pool, [row.id]);
  return postToApi(row, userId, media.get(row.id));
}

// Whether the viewer may see a live post the image belongs to (for the media route). A
// deleted post's photos answer like missing ones to everyone but their uploader.
async function canSeePostMedia(pool, userId, mediaId) {
  const [rows] = await pool.query(
    `SELECT 1 FROM community_posts p
     WHERE (p.media_id = ? OR EXISTS (SELECT 1 FROM community_post_media pm WHERE pm.post_id = p.id AND pm.media_id = ?))
       AND p.deleted_at IS NULL AND ${VISIBLE_POST_SQL} LIMIT 1`,
    [mediaId, mediaId, ...visiblePostParams(userId)],
  );
  return rows.length > 0;
}

// The photo a report is about (a post's cover or a story's photo), deleted content included,
// for the admin-only evidence route. null when the report has no photo or doesn't exist.
async function reportEvidenceMediaId(pool, reportId) {
  const [rows] = await pool.query(
    `SELECT COALESCE(p.media_id, s.media_id) AS media_id FROM community_reports r
     LEFT JOIN community_posts p ON p.id = r.post_id
     LEFT JOIN community_stories s ON s.id = r.story_id
     WHERE r.id = ?`,
    [reportId],
  );
  return rows[0]?.media_id ?? null;
}

// Who a post may address is decided here, from the account's saved privacy, never from the
// app: a private account can't publish to Everyone. Checked inside the saving transaction so
// a privacy change during composition is caught at publish time.
async function assertAudienceAllowed(connection, userId, audience, groupId) {
  if (groupId || audience !== "public") return;
  const [rows] = await connection.query("SELECT is_private FROM community_profiles WHERE user_id = ?", [userId]);
  if (rows[0]?.is_private) {
    const error = new ValidationError("Your account is private, so choose Followers or Only me.");
    error.status = 409; // the app reloads the account and asks for a valid audience
    throw error;
  }
}

// The post saved earlier for this draft, if the app already published it (same client key)
async function findByClientKey(pool, userId, clientKey) {
  if (!clientKey) return null;
  const [rows] = await pool.query("SELECT id FROM community_posts WHERE user_id = ? AND client_key = ?", [userId, clientKey]);
  return rows[0]?.id ?? null;
}

// Writes the ordered photo list for a post (inside the caller's transaction)
async function writePostMedia(connection, postId, mediaIds) {
  await connection.query("DELETE FROM community_post_media WHERE post_id = ?", [postId]);
  for (const [position, mediaId] of mediaIds.entries()) {
    await connection.query("INSERT INTO community_post_media (post_id, media_id, position) VALUES (?, ?, ?)", [postId, mediaId, position]);
  }
}

// Saves a post with its photos in one transaction. The photos must be the author's own,
// finished uploads; the audience is checked against the account's privacy at this moment;
// and a repeated publish with the same client key returns the post saved the first time.
async function createPost(pool, userId, values) {
  const existing = await findByClientKey(pool, userId, values.clientKey);
  if (existing) return getPost(pool, userId, existing);
  const media = await assertOwnMediaList(pool, values.mediaIds, userId);
  if (values.groupId) {
    const [rows] = await pool.query("SELECT 1 FROM community_group_members WHERE group_id = ? AND user_id = ?", [values.groupId, userId]);
    if (rows.length === 0) throw new ForbiddenError("Join the group before posting in it.");
  }
  const connection = await pool.getConnection();
  let postId;
  try {
    await connection.beginTransaction();
    await assertAudienceAllowed(connection, userId, values.audience, values.groupId);
    const [[{ id }]] = await connection.query("SELECT UUID() AS id");
    postId = id;
    await connection.query(
      "INSERT INTO community_posts (id, user_id, group_id, category, audience, body, media_id, client_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [postId, userId, values.groupId, values.category, values.audience, values.body, media[0]?.id ?? null, values.clientKey],
    );
    await writePostMedia(connection, postId, media.map((row) => row.id));
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    // Two publishes of the same draft raced: the first one won, so answer with its post
    if (error?.code === "ER_DUP_ENTRY" && values.clientKey) {
      const winner = await findByClientKey(pool, userId, values.clientKey);
      if (winner) return getPost(pool, userId, winner);
    }
    throw error;
  } finally {
    connection.release();
  }
  return getPost(pool, userId, postId);
}

// Only the author may edit (a post the caller can't see is a 404, not a hint that it exists).
// The audience the post ends up with is checked against the account's privacy, and photos
// taken off the post are deleted when nothing else uses them.
async function updatePost(pool, userId, postId, changes) {
  const visible = await getPost(pool, userId, postId);
  if (!visible.isOwn) throw new ForbiddenError("Only the author can edit this post.");
  const media = changes.mediaIds === undefined ? null : await assertOwnMediaList(pool, changes.mediaIds, userId);
  const sets = [];
  const params = [];
  if (changes.body !== undefined) { sets.push("body = ?"); params.push(changes.body); }
  if (changes.category !== undefined) { sets.push("category = ?"); params.push(changes.category); }
  if (changes.audience !== undefined) { sets.push("audience = ?"); params.push(changes.audience); }
  if (media !== null) { sets.push("media_id = ?"); params.push(media[0]?.id ?? null); }
  params.push(postId);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertAudienceAllowed(connection, userId, changes.audience ?? visible.audience, visible.groupId);
    await connection.query(`UPDATE community_posts SET ${sets.join(", ")} WHERE id = ?`, params);
    if (media !== null) await writePostMedia(connection, postId, media.map((row) => row.id));
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (media !== null) {
    const kept = new Set(media.map((row) => row.id));
    for (const item of visible.media) if (!kept.has(item.id)) await removeIfUnreferenced(pool, item.id);
  }
  return getPost(pool, userId, postId);
}

// The author or an admin may delete (soft delete keeps reports meaningful). Admins may
// delete posts they can't otherwise see (moderation); members get a 404 for those.
async function deletePost(pool, userId, role, postId) {
  if (role === "admin") {
    const [rows] = await pool.query("SELECT user_id FROM community_posts WHERE id = ? AND deleted_at IS NULL", [postId]);
    if (!rows[0]) throw new NotFoundError("That post no longer exists.");
  } else {
    const visible = await getPost(pool, userId, postId);
    if (!visible.isOwn) throw new ForbiddenError("Only the author can delete this post.");
  }
  await pool.query("UPDATE community_posts SET deleted_at = NOW() WHERE id = ?", [postId]);
}

// Like / unlike: the primary key on (post, user) makes a repeat a no-op, and the count only
// changes when a row was really inserted or deleted
async function setLike(pool, userId, postId, liked) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [posts] = await connection.query(`SELECT p.id FROM community_posts p WHERE p.id = ? AND p.deleted_at IS NULL AND ${VISIBLE_POST_SQL} FOR UPDATE`, [postId, ...visiblePostParams(userId)]);
    if (!posts[0]) throw new NotFoundError("That post no longer exists.");
    const [result] = liked
      ? await connection.query("INSERT IGNORE INTO community_post_likes (post_id, user_id) VALUES (?, ?)", [postId, userId])
      : await connection.query("DELETE FROM community_post_likes WHERE post_id = ? AND user_id = ?", [postId, userId]);
    if (result.affectedRows === 1) {
      await connection.query(
        liked ? "UPDATE community_posts SET like_count = like_count + 1 WHERE id = ?" : "UPDATE community_posts SET like_count = GREATEST(like_count, 1) - 1 WHERE id = ?",
        [postId],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const [rows] = await pool.query("SELECT like_count FROM community_posts WHERE id = ?", [postId]);
  return { liked, likeCount: rows[0].like_count };
}

function commentToApi(row, viewerId) {
  return { id: row.id, postId: row.post_id, author: memberSummary(row), body: row.body, isOwn: row.user_id === viewerId, createdAt: new Date(row.created_at).toISOString() };
}

// Comments on a post, oldest first
async function listComments(pool, userId, postId, { cursor = null, limit }) {
  await getPost(pool, userId, postId); // existence and group visibility
  const params = [postId];
  let where = "WHERE c.post_id = ? AND c.deleted_at IS NULL";
  if (cursor) {
    where += " AND (c.created_at > ? OR (c.created_at = ? AND c.id > ?))";
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  params.push(limit + 1);
  const [rows] = await pool.query(
    `SELECT c.id, c.post_id, c.user_id, c.body, c.created_at, u.full_name FROM community_comments c JOIN users u ON u.id = c.user_id ${where} ORDER BY c.created_at ASC, c.id ASC LIMIT ?`,
    params,
  );
  const page = rows.slice(0, limit);
  return { comments: page.map((row) => commentToApi(row, userId)), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}

async function createComment(pool, userId, postId, values) {
  await getPost(pool, userId, postId);
  const connection = await pool.getConnection();
  let commentId;
  try {
    await connection.beginTransaction();
    const [[{ id }]] = await connection.query("SELECT UUID() AS id");
    commentId = id;
    await connection.query("INSERT INTO community_comments (id, post_id, user_id, body) VALUES (?, ?, ?, ?)", [commentId, postId, userId, values.body]);
    await connection.query("UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = ?", [postId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const [rows] = await pool.query(
    "SELECT c.id, c.post_id, c.user_id, c.body, c.created_at, u.full_name FROM community_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?",
    [commentId],
  );
  const [[post]] = await pool.query("SELECT comment_count FROM community_posts WHERE id = ?", [postId]);
  return { comment: commentToApi(rows[0], userId), commentCount: post.comment_count };
}

// The comment's author, the post's author, or an admin may delete a comment
async function deleteComment(pool, userId, role, commentId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT c.user_id, c.post_id, p.user_id AS post_user_id FROM community_comments c JOIN community_posts p ON p.id = c.post_id WHERE c.id = ? AND c.deleted_at IS NULL FOR UPDATE",
      [commentId],
    );
    const comment = rows[0];
    if (!comment) throw new NotFoundError("That comment no longer exists.");
    if (comment.user_id !== userId && comment.post_user_id !== userId && role !== "admin") throw new ForbiddenError("You can't delete this comment.");
    await connection.query("UPDATE community_comments SET deleted_at = NOW() WHERE id = ?", [commentId]);
    await connection.query("UPDATE community_posts SET comment_count = GREATEST(comment_count, 1) - 1 WHERE id = ?", [comment.post_id]);
    await connection.commit();
    const [[post]] = await pool.query("SELECT comment_count FROM community_posts WHERE id = ?", [comment.post_id]);
    return { postId: comment.post_id, commentCount: post.comment_count };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// A member reports a post or a comment (one row each time; admins review them)
async function reportContent(pool, userId, { postId = null, commentId = null }, values) {
  if (postId) await getPost(pool, userId, postId);
  if (commentId) {
    const [rows] = await pool.query(
      `SELECT 1 FROM community_comments c JOIN community_posts p ON p.id = c.post_id
       WHERE c.id = ? AND c.deleted_at IS NULL AND p.deleted_at IS NULL AND ${VISIBLE_POST_SQL}`,
      [commentId, ...visiblePostParams(userId)],
    );
    if (rows.length === 0) throw new NotFoundError("That comment no longer exists.");
  }
  await pool.query("INSERT INTO community_reports (id, reporter_id, post_id, comment_id, reason) VALUES (UUID(), ?, ?, ?, ?)", [userId, postId, commentId, values.reason]);
  return { reported: true };
}

// Open reports, for admins
async function listReports(pool) {
  const [rows] = await pool.query(
    `SELECT r.id, r.reporter_id, r.post_id, r.comment_id, r.story_id, r.reason, r.status, r.created_at, u.full_name
     FROM community_reports r JOIN users u ON u.id = r.reporter_id
     WHERE r.status = 'open' ORDER BY r.created_at ASC LIMIT 100`,
  );
  return rows.map((row) => ({
    id: row.id, reporter: memberSummary({ user_id: row.reporter_id, full_name: row.full_name }), postId: row.post_id, commentId: row.comment_id, storyId: row.story_id,
    reason: row.reason, status: row.status, createdAt: new Date(row.created_at).toISOString(),
  }));
}

// The report with the content it points at, for an admin to judge
async function getReport(pool, reportId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.reporter_id, r.post_id, r.comment_id, r.story_id, r.reason, r.status, r.created_at, ru.full_name AS reporter_name,
            p.body AS post_body, p.user_id AS post_user_id, p.deleted_at AS post_deleted_at, p.media_id, pu.full_name AS post_author_name,
            c.body AS comment_body, c.user_id AS comment_user_id, c.deleted_at AS comment_deleted_at, cu.full_name AS comment_author_name,
            s.caption AS story_caption, s.user_id AS story_user_id, s.deleted_at AS story_deleted_at, s.media_id AS story_media_id,
            s.expires_at <= NOW() AS story_expired, su.full_name AS story_author_name
     FROM community_reports r
     JOIN users ru ON ru.id = r.reporter_id
     LEFT JOIN community_posts p ON p.id = r.post_id LEFT JOIN users pu ON pu.id = p.user_id
     LEFT JOIN community_comments c ON c.id = r.comment_id LEFT JOIN users cu ON cu.id = c.user_id
     LEFT JOIN community_stories s ON s.id = r.story_id LEFT JOIN users su ON su.id = s.user_id
     WHERE r.id = ?`,
    [reportId],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("That report doesn't exist.");
  // What was reported: a post, a comment or a story. A photo is linked through the admin-only
  // evidence route, which serves it even after the content was deleted.
  const evidenceUrl = `/api/community/reports/${row.id}/media`;
  const target = row.post_id !== null
    ? { type: "post", id: row.post_id, body: row.post_body, imageUrl: row.media_id ? evidenceUrl : null, deleted: Boolean(row.post_deleted_at), expired: false, authorId: row.post_user_id, authorName: row.post_author_name }
    : row.comment_id !== null
      ? { type: "comment", id: row.comment_id, body: row.comment_body, imageUrl: null, deleted: Boolean(row.comment_deleted_at), expired: false, authorId: row.comment_user_id, authorName: row.comment_author_name }
      : { type: "story", id: row.story_id, body: row.story_caption, imageUrl: row.story_media_id ? evidenceUrl : null, deleted: Boolean(row.story_deleted_at), expired: Boolean(row.story_expired), authorId: row.story_user_id, authorName: row.story_author_name };
  const [[suspended]] = await pool.query("SELECT COUNT(*) AS n FROM community_profiles WHERE user_id = ? AND status = 'suspended'", [target.authorId]);
  return {
    id: row.id, reason: row.reason, status: row.status, createdAt: new Date(row.created_at).toISOString(),
    reporter: memberSummary({ user_id: row.reporter_id, full_name: row.reporter_name }),
    target: {
      type: target.type,
      id: target.id,
      body: target.body,
      imageUrl: target.imageUrl,
      deleted: target.deleted,
      expired: target.expired,
      author: memberSummary({ user_id: target.authorId, full_name: target.authorName }),
      authorSuspended: suspended.n > 0,
    },
  };
}

async function resolveReport(pool, reportId, status) {
  if (!["reviewed", "dismissed"].includes(status)) throw new ValidationError("Status must be reviewed or dismissed.");
  const [result] = await pool.query("UPDATE community_reports SET status = ? WHERE id = ? AND status = 'open'", [status, reportId]);
  if (result.affectedRows === 0) throw new NotFoundError("That report isn't open.");
  return { id: reportId, status };
}

module.exports = {
  NotFoundError, ForbiddenError, canViewGroup, canSeePostMedia, reportEvidenceMediaId,
  listPosts, getPost, createPost, updatePost, deletePost, setLike,
  listComments, createComment, deleteComment, reportContent, listReports, getReport, resolveReport,
};
