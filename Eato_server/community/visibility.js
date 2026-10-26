// Who may see what. One SQL fragment decides whether a post is visible to a viewer, and
// every route that returns posts (feed, single post, profile, media) uses it, so nothing
// can leak through a different path.
//
// A post is visible when:
//   - the author is the viewer, or
//   - the author's account is active, neither side has blocked the other, and
//       - for a gym post: published and the gym is public or the viewer is an active member,
//         or (published or held for review) the viewer is active gym staff, or
//       - audience = public and the author's account is public, or
//       - audience = public or followers and the viewer is an accepted follower.
//   only_me posts are never visible to anyone else. Gym posts never match the main-feed rules.

// Placeholders: the viewer, every time (VISIBLE_POST_PARAMS of them)
const VISIBLE_POST_SQL = `(
  p.user_id = ?
  OR (
    NOT EXISTS (SELECT 1 FROM community_profiles cp WHERE cp.user_id = p.user_id AND cp.status = 'suspended')
    AND NOT EXISTS (SELECT 1 FROM community_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = ?))
    AND (
      (p.gym_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM gyms gy WHERE gy.id = p.gym_id AND gy.status <> 'suspended' AND (
          (p.review_status = 'published' AND (gy.visibility = 'public'
            OR EXISTS (SELECT 1 FROM gym_members gmv WHERE gmv.gym_id = gy.id AND gmv.user_id = ? AND gmv.status = 'active')))
          OR EXISTS (SELECT 1 FROM gym_members gms WHERE gms.gym_id = gy.id AND gms.user_id = ? AND gms.status = 'active' AND gms.role IN ('owner', 'admin', 'trainer'))
        )
      ))
      OR (p.gym_id IS NULL AND p.audience = 'public'
          AND NOT EXISTS (SELECT 1 FROM community_profiles cp2 WHERE cp2.user_id = p.user_id AND cp2.is_private = TRUE))
      OR (p.gym_id IS NULL AND p.audience IN ('public', 'followers')
          AND EXISTS (SELECT 1 FROM community_follows f WHERE f.follower_id = ? AND f.following_id = p.user_id AND f.status = 'accepted'))
    )
  )
)`;
const VISIBLE_POST_PARAMS = 6;
const visiblePostParams = (viewerId) => Array(VISIBLE_POST_PARAMS).fill(viewerId);

// Whether `viewerId` may see `authorId`'s public-audience content (profile posts list, stories):
// not blocked either way, author active, and either the account is public or the viewer is
// an accepted follower. The author always sees their own.
async function canSeeAccount(pool, viewerId, authorId) {
  if (viewerId === authorId) return true;
  const [rows] = await pool.query(
    `SELECT
       EXISTS (SELECT 1 FROM community_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = ?) OR (b.blocker_id = ? AND b.blocked_id = ?)) AS blocked,
       (SELECT cp.status FROM community_profiles cp WHERE cp.user_id = ?) AS status,
       (SELECT cp.is_private FROM community_profiles cp WHERE cp.user_id = ?) AS is_private,
       EXISTS (SELECT 1 FROM community_follows f WHERE f.follower_id = ? AND f.following_id = ? AND f.status = 'accepted') AS follows`,
    [viewerId, authorId, authorId, viewerId, authorId, authorId, viewerId, authorId],
  );
  const row = rows[0];
  if (row.blocked || row.status === "suspended") return false;
  return !row.is_private || Boolean(row.follows);
}

// Whether either side has blocked the other
async function isBlocked(pool, a, b) {
  const [rows] = await pool.query(
    "SELECT 1 FROM community_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1",
    [a, b, b, a],
  );
  return rows.length > 0;
}

async function isSuspended(pool, userId) {
  const [rows] = await pool.query("SELECT 1 FROM community_profiles WHERE user_id = ? AND status = 'suspended'", [userId]);
  return rows.length > 0;
}

module.exports = { VISIBLE_POST_SQL, visiblePostParams, canSeeAccount, isBlocked, isSuspended };
