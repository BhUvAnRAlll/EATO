// Stories: one photo each with an optional caption, up for `limits.storyHours`, shown to an
// audience the owner picks (Everyone, Followers, Close Friends). Every read path (the
// stories row, a view, a report, the media route) goes through VISIBLE_STORY_SQL, which
// also drops expired and deleted stories, so an old link stops working the moment a story
// expires, is deleted or the viewer loses access. Expiry is decided by the database clock,
// never by the app; purgeOldStories removes old rows on the server's hourly sweep.
const { ValidationError } = require("../profile");
const { memberSummary, ensureUser } = require("./members");
const { assertOwnMedia, mediaUrl } = require("./media");
const { limits } = require("./validate");
const { NotFoundError, ForbiddenError } = require("./posts");

// A story the viewer may see right now:
//   - not deleted and not expired, and
//   - the viewer is the owner, or the owner is active, neither has blocked the other, and
//       - audience Everyone and the owner's account is public, or
//       - audience Everyone or Followers and the viewer is an accepted follower, or
//       - audience Close Friends and the viewer is on the owner's Close Friends list.
// Placeholders: viewer ×5 (see visibleStoryParams).
const VISIBLE_STORY_SQL = `(
  s.deleted_at IS NULL AND s.expires_at > NOW() AND (
    s.user_id = ?
    OR (
      NOT EXISTS (SELECT 1 FROM community_profiles cp WHERE cp.user_id = s.user_id AND cp.status = 'suspended')
      AND NOT EXISTS (SELECT 1 FROM community_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = s.user_id) OR (b.blocker_id = s.user_id AND b.blocked_id = ?))
      AND (
        (s.audience = 'public' AND NOT EXISTS (SELECT 1 FROM community_profiles cp2 WHERE cp2.user_id = s.user_id AND cp2.is_private = TRUE))
        OR (s.audience IN ('public', 'followers')
            AND EXISTS (SELECT 1 FROM community_follows f WHERE f.follower_id = ? AND f.following_id = s.user_id AND f.status = 'accepted'))
        OR (s.audience = 'close_friends'
            AND EXISTS (SELECT 1 FROM community_close_friends cf WHERE cf.owner_id = s.user_id AND cf.friend_id = ?))
      )
    )
  )
)`;
const visibleStoryParams = (viewerId) => Array(5).fill(viewerId);

// How long an expired or deleted story's row and photo are kept (for reports), in days
const KEEP_DAYS = 30;

const STORY_COLUMNS = `s.id, s.user_id, s.media_id, s.caption, s.audience, s.created_at, s.expires_at, u.full_name,
  EXISTS (SELECT 1 FROM community_story_views v WHERE v.story_id = s.id AND v.user_id = ?) AS viewed,
  (SELECT COUNT(*) FROM community_story_views v WHERE v.story_id = s.id AND v.user_id <> s.user_id) AS view_count`;

// The view count is only for the owner
function storyToApi(row, viewerId) {
  const isOwn = row.user_id === viewerId;
  return {
    id: row.id,
    author: memberSummary(row),
    imageUrl: mediaUrl(row.media_id),
    caption: row.caption,
    audience: row.audience,
    viewed: Boolean(row.viewed),
    isOwn,
    viewCount: isOwn ? Number(row.view_count) : null,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

// Active stories the viewer may see, grouped by member: the viewer's own first, then members
// with unseen stories, oldest story first within a member
async function listStories(pool, userId) {
  const [rows] = await pool.query(
    `SELECT ${STORY_COLUMNS}
     FROM community_stories s JOIN users u ON u.id = s.user_id
     WHERE ${VISIBLE_STORY_SQL}
     ORDER BY (s.user_id = ?) DESC, s.created_at ASC
     LIMIT 300`,
    [userId, ...visibleStoryParams(userId), userId],
  );
  const byMember = new Map();
  for (const row of rows) {
    const story = storyToApi(row, userId);
    const entry = byMember.get(row.user_id) ?? { member: story.author, isOwn: story.isOwn, stories: [], allViewed: true };
    entry.stories.push(story);
    if (!story.viewed && !story.isOwn) entry.allViewed = false;
    byMember.set(row.user_id, entry);
  }
  const groups = [...byMember.values()];
  // Own first, then unseen before seen (stable within each)
  return [...groups.filter((g) => g.isOwn), ...groups.filter((g) => !g.isOwn && !g.allViewed), ...groups.filter((g) => !g.isOwn && g.allViewed)];
}

// A visible story's row, or a 404 that never confirms a hidden story exists
async function getVisibleStory(pool, userId, storyId) {
  const [rows] = await pool.query(
    `SELECT ${STORY_COLUMNS} FROM community_stories s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND ${VISIBLE_STORY_SQL}`,
    [userId, storyId, ...visibleStoryParams(userId)],
  );
  if (!rows[0]) throw new NotFoundError("That story has ended.");
  return rows[0];
}

// Publishes a story. The photo must be the member's own finished upload; the audience is
// checked against the account's saved privacy inside the transaction (a private account
// can't address Everyone), so a privacy change during composition is caught here.
// Publishing is idempotent per photo: if this member already has a live story with this
// photo (a Retry after a lost response, a double tap), that story comes back with
// created: false instead of a second one. The photo's row is locked first, so concurrent
// repeats wait for each other and only one of them inserts.
async function createStory(pool, userId, values) {
  const mediaId = await assertOwnMedia(pool, values.mediaId, userId);
  await ensureUser(pool, userId);
  const connection = await pool.getConnection();
  let storyId;
  let created = false;
  try {
    await connection.beginTransaction();
    await connection.query("SELECT id FROM community_media WHERE id = ? FOR UPDATE", [mediaId]);
    const [existing] = await connection.query(
      "SELECT id FROM community_stories WHERE user_id = ? AND media_id = ? AND deleted_at IS NULL AND expires_at > NOW() LIMIT 1",
      [userId, mediaId],
    );
    if (existing[0]) {
      storyId = existing[0].id;
      await connection.commit();
      return { story: storyToApi(await getVisibleStory(pool, userId, storyId), userId), created };
    }
    if (values.audience === "public") {
      const [profiles] = await connection.query("SELECT is_private FROM community_profiles WHERE user_id = ? FOR UPDATE", [userId]);
      if (profiles[0]?.is_private) {
        const error = new ValidationError("Your account is private, so choose Followers or Close Friends.");
        error.status = 409;
        throw error;
      }
    }
    const [[active]] = await connection.query(
      "SELECT COUNT(*) AS n FROM community_stories WHERE user_id = ? AND deleted_at IS NULL AND expires_at > NOW()",
      [userId],
    );
    if (active.n >= limits.activeStories) throw new ValidationError(`You can have up to ${limits.activeStories} stories up at once.`);
    const [[{ id }]] = await connection.query("SELECT UUID() AS id");
    storyId = id;
    await connection.query(
      "INSERT INTO community_stories (id, user_id, media_id, caption, audience, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))",
      [storyId, userId, mediaId, values.caption, values.audience, limits.storyHours],
    );
    await connection.commit();
    created = true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { story: storyToApi(await getVisibleStory(pool, userId, storyId), userId), created };
}

// Records a view once per member (the primary key ignores repeats, so concurrent views of
// the same story by the same member still count once). The owner's own views aren't counted.
async function viewStory(pool, userId, storyId) {
  const story = await getVisibleStory(pool, userId, storyId);
  if (story.user_id !== userId) {
    await pool.query("INSERT IGNORE INTO community_story_views (story_id, user_id) VALUES (?, ?)", [storyId, userId]);
  }
  return { viewed: true };
}

// The owner (or an admin) deletes. The row is kept, hidden, so a report still shows what was
// reported; the photo stops loading for everyone else at once. A story the caller can't
// see is a 404 for members.
async function deleteStory(pool, userId, role, storyId) {
  if (role === "admin") {
    const [rows] = await pool.query("SELECT id FROM community_stories WHERE id = ? AND deleted_at IS NULL", [storyId]);
    if (!rows[0]) throw new NotFoundError("That story has ended.");
  } else {
    const story = await getVisibleStory(pool, userId, storyId);
    if (story.user_id !== userId) throw new ForbiddenError("Only the owner can delete this story.");
  }
  await pool.query("UPDATE community_stories SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL", [storyId]);
}

// A member reports a story they can see (not their own)
async function reportStory(pool, userId, storyId, values) {
  const story = await getVisibleStory(pool, userId, storyId);
  if (story.user_id === userId) throw new ValidationError("You can't report your own story.");
  await ensureUser(pool, userId);
  await pool.query("INSERT INTO community_reports (id, reporter_id, story_id, reason) VALUES (UUID(), ?, ?, ?)", [userId, storyId, values.reason]);
  return { reported: true };
}

// Whether the viewer may see the story an image belongs to (for the media route)
async function canSeeStoryMedia(pool, userId, mediaId) {
  const [rows] = await pool.query(`SELECT 1 FROM community_stories s WHERE s.media_id = ? AND ${VISIBLE_STORY_SQL} LIMIT 1`, [mediaId, ...visibleStoryParams(userId)]);
  return rows.length > 0;
}

// Removes stories that ended (expired or deleted) more than KEEP_DAYS ago and were never
// reported; their photos are then unreferenced and the orphan sweep deletes the files.
// Reported stories are kept for moderation. Returns how many rows were removed.
async function purgeOldStories(pool, keepDays = KEEP_DAYS) {
  const [result] = await pool.query(
    `DELETE s FROM community_stories s
     WHERE (s.expires_at < DATE_SUB(NOW(), INTERVAL ? DAY) OR s.deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY))
       AND NOT EXISTS (SELECT 1 FROM community_reports r WHERE r.story_id = s.id)`,
    [keepDays, keepDays],
  );
  return result.affectedRows;
}

module.exports = { VISIBLE_STORY_SQL, listStories, createStory, viewStory, deleteStory, reportStory, canSeeStoryMedia, purgeOldStories };
