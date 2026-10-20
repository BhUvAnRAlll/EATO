// The owner portal's Review tab: posts held for approval in the gym, and the gym's posts that
// members reported. The gym's owner and admins (or an EATO admin) approve or reject held posts,
// and keep or remove reported ones. Reports use the same statuses as EATO's admin queue: keeping a
// post dismisses its open reports, removing it marks them reviewed, so handled reports leave both
// queues. Reporters stay anonymous here: the gym sees each reason and how many people reported.
const { ValidationError } = require("../profile");
const { memberSummary } = require("../community/members");
const { NotFoundError } = require("../community/posts");
const { mediaUrl } = require("../community/media");
const { ownerAccess } = require("./owner");

const conflict = (message) => {
  const error = new ValidationError(message);
  error.status = 409;
  return error;
};

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

const postToApi = (row) => ({
  id: row.id,
  author: memberSummary(row),
  body: row.body,
  category: row.category,
  imageUrl: mediaUrl(row.media_id),
  createdAt: new Date(row.created_at).toISOString(),
});

// Held posts (oldest first, so nobody waits longest) and reported posts with their open reports
async function review(pool, staffId, gymId) {
  const { gym, as } = await ownerAccess(pool, gymId, staffId);
  const [[settings]] = await pool.query("SELECT post_moderation FROM gyms WHERE id = ?", [gymId]);
  const [pending] = await pool.query(
    `SELECT p.id, p.user_id, p.body, p.category, p.media_id, p.created_at, u.full_name
     FROM community_posts p JOIN users u ON u.id = p.user_id
     WHERE p.gym_id = ? AND p.deleted_at IS NULL AND p.review_status = 'pending'
     ORDER BY p.created_at, p.id LIMIT 100`,
    [gymId],
  );
  const [reported] = await pool.query(
    `SELECT p.id, p.user_id, p.body, p.category, p.media_id, p.created_at, u.full_name,
            COUNT(r.id) AS reports, MAX(r.created_at) AS last_report, GROUP_CONCAT(r.reason ORDER BY r.created_at SEPARATOR '\\n') AS reasons
     FROM community_reports r JOIN community_posts p ON p.id = r.post_id JOIN users u ON u.id = p.user_id
     WHERE p.gym_id = ? AND p.deleted_at IS NULL AND r.status = 'open'
     GROUP BY p.id, p.user_id, p.body, p.category, p.media_id, p.created_at, u.full_name
     ORDER BY last_report DESC LIMIT 100`,
    [gymId],
  );
  return {
    gym: { id: gym.id, name: gym.name, as },
    postModeration: Boolean(settings.post_moderation),
    pending: pending.map(postToApi),
    reported: reported.map((row) => ({
      post: postToApi(row),
      reports: Number(row.reports),
      // Each distinct reason once (several people often give the same one)
      reasons: [...new Set(String(row.reasons ?? "").split("\n").filter(Boolean))].slice(0, 10),
      lastReportedAt: new Date(row.last_report).toISOString(),
    })),
  };
}

// A post of this gym, or a 404 (another gym's post looks missing, so ids can't be probed)
async function gymPost(db, gymId, postId, { lock = false } = {}) {
  const [[post]] = await db.query(
    `SELECT id, review_status, deleted_at FROM community_posts WHERE id = ? AND gym_id = ?${lock ? " FOR UPDATE" : ""}`,
    [postId, gymId],
  );
  if (!post || post.deleted_at) throw new NotFoundError("That post no longer exists.");
  return post;
}

// Approve: the held post goes live in the gym feed
async function approve(pool, staffId, gymId, postId) {
  await ownerAccess(pool, gymId, staffId);
  const post = await gymPost(pool, gymId, postId);
  if (post.review_status !== "pending") throw conflict("That post is already live.");
  await pool.query("UPDATE community_posts SET review_status = 'published' WHERE id = ? AND review_status = 'pending'", [postId]);
  return { id: postId, reviewStatus: "published" };
}

// Reject: the held post is removed (soft delete; it was never shown)
async function reject(pool, staffId, gymId, postId) {
  await ownerAccess(pool, gymId, staffId);
  const post = await gymPost(pool, gymId, postId);
  if (post.review_status !== "pending") throw conflict("That post is already live. Remove it from Reported instead.");
  await pool.query("UPDATE community_posts SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL", [postId]);
  return { id: postId, rejected: true };
}

// Keep a reported post: its open reports are dismissed
async function keep(pool, staffId, gymId, postId) {
  await ownerAccess(pool, gymId, staffId);
  await gymPost(pool, gymId, postId);
  const [result] = await pool.query("UPDATE community_reports SET status = 'dismissed' WHERE post_id = ? AND status = 'open'", [postId]);
  if (result.affectedRows === 0) throw conflict("That post has no open reports.");
  return { id: postId, dismissed: result.affectedRows };
}

// Remove a reported post: it's taken down and its open reports are marked reviewed, together
async function remove(pool, staffId, gymId, postId) {
  return inTransaction(pool, async (connection) => {
    await ownerAccess(connection, gymId, staffId);
    await gymPost(connection, gymId, postId, { lock: true });
    await connection.query("UPDATE community_posts SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL", [postId]);
    const [result] = await connection.query("UPDATE community_reports SET status = 'reviewed' WHERE post_id = ? AND status = 'open'", [postId]);
    return { id: postId, removed: true, reviewed: result.affectedRows };
  });
}

function validateModeration(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Say whether posts are reviewed first.");
  const extra = Object.keys(body).filter((k) => k !== "postModeration");
  if (extra.length > 0) throw new ValidationError("That request has fields we don't accept.");
  if (typeof body.postModeration !== "boolean") throw new ValidationError("Say whether posts are reviewed first.");
  return { postModeration: body.postModeration };
}

// "Review posts before they go live": the same switch as post moderation in Community settings.
// Turning it off doesn't publish what's waiting; those posts stay in Pending.
async function setModeration(pool, staffId, gymId, { postModeration }) {
  await ownerAccess(pool, gymId, staffId);
  await pool.query("UPDATE gyms SET post_moderation = ? WHERE id = ?", [postModeration, gymId]);
  return { postModeration };
}

module.exports = { review, approve, reject, keep, remove, validateModeration, setModeration };
