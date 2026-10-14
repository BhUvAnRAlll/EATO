// Stories: one image each, visible for `limits.storyHours`, grouped by member in the
// stories row. Expired stories are never returned; views are recorded once per member.
const { memberSummary } = require("./members");
const { assertOwnMedia, mediaUrl, getMedia, removeMedia } = require("./media");
const { limits } = require("./validate");
const { NotFoundError, ForbiddenError } = require("./posts");
const { canSeeAccount } = require("./visibility");

// Stories a viewer may see: their own, plus active members who haven't blocked them (or been
// blocked), and whose account is public or followed by the viewer
const VISIBLE_STORY_SQL = `(
  s.user_id = ?
  OR (
    NOT EXISTS (SELECT 1 FROM community_profiles cp WHERE cp.user_id = s.user_id AND cp.status = 'suspended')
    AND NOT EXISTS (SELECT 1 FROM community_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = s.user_id) OR (b.blocker_id = s.user_id AND b.blocked_id = ?))
    AND (NOT EXISTS (SELECT 1 FROM community_profiles cp2 WHERE cp2.user_id = s.user_id AND cp2.is_private = TRUE)
         OR EXISTS (SELECT 1 FROM community_follows f WHERE f.follower_id = ? AND f.following_id = s.user_id AND f.status = 'accepted'))
  )
)`;

function storyToApi(row, viewerId) {
  return {
    id: row.id,
    author: memberSummary(row),
    imageUrl: mediaUrl(row.media_id),
    caption: row.caption,
    viewed: Boolean(row.viewed),
    isOwn: row.user_id === viewerId,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

// Active stories, newest member activity first; the caller's own stories come first
async function listStories(pool, userId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.user_id, s.media_id, s.caption, s.created_at, s.expires_at, u.full_name,
            EXISTS (SELECT 1 FROM community_story_views v WHERE v.story_id = s.id AND v.user_id = ?) AS viewed
     FROM community_stories s JOIN users u ON u.id = s.user_id
     WHERE s.expires_at > NOW() AND ${VISIBLE_STORY_SQL}
     ORDER BY (s.user_id = ?) DESC, s.created_at ASC
     LIMIT 200`,
    [userId, userId, userId, userId, userId, userId],
  );
  // Group by member: each member's stories in the order they were posted
  const byMember = new Map();
  for (const row of rows) {
    const story = storyToApi(row, userId);
    const entry = byMember.get(row.user_id) ?? { member: story.author, isOwn: story.isOwn, stories: [], allViewed: true };
    entry.stories.push(story);
    if (!story.viewed) entry.allViewed = false;
    byMember.set(row.user_id, entry);
  }
  return [...byMember.values()];
}

async function createStory(pool, userId, values) {
  const mediaId = await assertOwnMedia(pool, values.mediaId, userId);
  const [[{ id }]] = await pool.query("SELECT UUID() AS id");
  await pool.query(
    "INSERT INTO community_stories (id, user_id, media_id, caption, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))",
    [id, userId, mediaId, values.caption, limits.storyHours],
  );
  const [rows] = await pool.query(
    "SELECT s.id, s.user_id, s.media_id, s.caption, s.created_at, s.expires_at, u.full_name, FALSE AS viewed FROM community_stories s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
    [id],
  );
  return storyToApi(rows[0], userId);
}

// Recording a view is idempotent: the primary key ignores a repeat
async function viewStory(pool, userId, storyId) {
  const [rows] = await pool.query("SELECT id, user_id FROM community_stories WHERE id = ? AND expires_at > NOW()", [storyId]);
  if (!rows[0]) throw new NotFoundError("That story has expired.");
  if (!(await canSeeAccount(pool, userId, rows[0].user_id))) throw new NotFoundError("That story has expired.");
  await pool.query("INSERT IGNORE INTO community_story_views (story_id, user_id) VALUES (?, ?)", [storyId, userId]);
  return { viewed: true };
}

// Only the owner (or an admin) may delete; the image goes with it
async function deleteStory(pool, userId, role, storyId) {
  const [rows] = await pool.query("SELECT user_id, media_id FROM community_stories WHERE id = ?", [storyId]);
  const story = rows[0];
  if (!story) throw new NotFoundError("That story no longer exists.");
  if (story.user_id !== userId && role !== "admin") throw new ForbiddenError("Only the owner can delete this story.");
  await pool.query("DELETE FROM community_stories WHERE id = ?", [storyId]);
  const media = await getMedia(pool, story.media_id);
  if (media) await removeMedia(pool, media);
}

// Whether the viewer may see the story an image belongs to (for the media route)
async function canSeeStoryMedia(pool, userId, mediaId) {
  const [rows] = await pool.query(`SELECT 1 FROM community_stories s WHERE s.media_id = ? AND s.expires_at > NOW() AND ${VISIBLE_STORY_SQL} LIMIT 1`, [mediaId, userId, userId, userId, userId]);
  return rows.length > 0;
}

module.exports = { listStories, createStory, viewStory, deleteStory, canSeeStoryMedia };
