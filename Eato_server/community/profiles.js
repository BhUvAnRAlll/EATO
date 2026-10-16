// Member profiles, following and blocking. A private account's posts and stories show to
// accepted followers only; following one creates a request its owner accepts or declines.
const { ValidationError } = require("../profile");
const { memberSummary, ensureUser } = require("./members");
const { NotFoundError, ForbiddenError } = require("./posts");
const { isBlocked } = require("./visibility");

async function assertMemberExists(pool, userId) {
  const [rows] = await pool.query("SELECT id FROM users WHERE id = ?", [userId]);
  if (rows.length === 0) throw new NotFoundError("That member doesn't exist.");
}

// The profile as the viewer may see it: counts, follow state and whether posts are visible
async function getProfile(pool, viewerId, userId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, cp.is_private, cp.status, cp.bio,
            (SELECT COUNT(*) FROM community_follows f WHERE f.following_id = u.id AND f.status = 'accepted') AS followers,
            (SELECT COUNT(*) FROM community_follows f WHERE f.follower_id = u.id AND f.status = 'accepted') AS following,
            (SELECT COUNT(*) FROM community_posts p WHERE p.user_id = u.id AND p.deleted_at IS NULL AND p.group_id IS NULL) AS posts,
            (SELECT f.status FROM community_follows f WHERE f.follower_id = ? AND f.following_id = u.id) AS my_follow,
            EXISTS (SELECT 1 FROM community_follows f WHERE f.follower_id = u.id AND f.following_id = ? AND f.status = 'accepted') AS follows_me,
            EXISTS (SELECT 1 FROM community_blocks b WHERE b.blocker_id = ? AND b.blocked_id = u.id) AS blocked_by_me,
            EXISTS (SELECT 1 FROM community_blocks b WHERE b.blocker_id = u.id AND b.blocked_id = ?) AS blocked_me
     FROM users u LEFT JOIN community_profiles cp ON cp.user_id = u.id
     WHERE u.id = ?`,
    [viewerId, viewerId, viewerId, viewerId, userId],
  );
  const row = rows[0];
  if (!row || row.blocked_me) throw new NotFoundError("That member doesn't exist.");
  const isOwn = row.id === viewerId;
  const suspended = row.status === "suspended";
  const isPrivate = Boolean(row.is_private);
  const followState = row.my_follow === "accepted" ? "following" : row.my_follow === "pending" ? "requested" : "none";
  return {
    member: memberSummary({ user_id: row.id, full_name: row.full_name }),
    bio: row.bio ?? null,
    isPrivate,
    isOwn,
    suspended,
    followers: Number(row.followers),
    following: Number(row.following),
    postCount: Number(row.posts),
    followState,
    followsMe: Boolean(row.follows_me),
    blocked: Boolean(row.blocked_by_me),
    // Whether the viewer may see this member's posts (the server enforces it; the app uses it for the empty state)
    canViewPosts: isOwn || (!suspended && !row.blocked_by_me && (!isPrivate || followState === "following")),
  };
}

// Own settings: private account and bio
async function updateOwnProfile(pool, userId, changes) {
  await ensureUser(pool, userId);
  await pool.query(
    `INSERT INTO community_profiles (user_id, is_private, bio) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE is_private = COALESCE(?, is_private), bio = COALESCE(?, bio)`,
    [userId, changes.isPrivate ?? false, changes.bio ?? null, changes.isPrivate ?? null, changes.bio === undefined ? null : changes.bio],
  );
  // Turning a private account public accepts every pending request
  if (changes.isPrivate === false) await pool.query("UPDATE community_follows SET status = 'accepted' WHERE following_id = ? AND status = 'pending'", [userId]);
  return getProfile(pool, userId, userId);
}

// Follow: accepted at once for a public account, a request for a private one
async function follow(pool, viewerId, userId) {
  if (viewerId === userId) throw new ValidationError("You can't follow yourself.");
  await assertMemberExists(pool, userId);
  if (await isBlocked(pool, viewerId, userId)) throw new NotFoundError("That member doesn't exist.");
  await ensureUser(pool, viewerId);
  const [rows] = await pool.query("SELECT is_private, status FROM community_profiles WHERE user_id = ?", [userId]);
  if (rows[0]?.status === "suspended") throw new NotFoundError("That member doesn't exist.");
  const status = rows[0]?.is_private ? "pending" : "accepted";
  await pool.query("INSERT IGNORE INTO community_follows (follower_id, following_id, status) VALUES (?, ?, ?)", [viewerId, userId, status]);
  return getProfile(pool, viewerId, userId);
}

async function unfollow(pool, viewerId, userId) {
  await pool.query("DELETE FROM community_follows WHERE follower_id = ? AND following_id = ?", [viewerId, userId]);
  return getProfile(pool, viewerId, userId);
}

// Pending requests to follow the caller
async function listFollowRequests(pool, userId) {
  const [rows] = await pool.query(
    `SELECT f.follower_id, f.created_at, u.full_name FROM community_follows f JOIN users u ON u.id = f.follower_id
     WHERE f.following_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC LIMIT 100`,
    [userId],
  );
  return rows.map((row) => ({ member: memberSummary({ user_id: row.follower_id, full_name: row.full_name }), requestedAt: new Date(row.created_at).toISOString() }));
}

// Only the account being followed decides
async function answerFollowRequest(pool, userId, followerId, accept) {
  const [result] = accept
    ? await pool.query("UPDATE community_follows SET status = 'accepted' WHERE follower_id = ? AND following_id = ? AND status = 'pending'", [followerId, userId])
    : await pool.query("DELETE FROM community_follows WHERE follower_id = ? AND following_id = ? AND status = 'pending'", [followerId, userId]);
  if (result.affectedRows === 0) throw new NotFoundError("That request is no longer open.");
  return { followerId, accepted: accept };
}

// Blocking also ends any follow in either direction
async function block(pool, viewerId, userId) {
  if (viewerId === userId) throw new ValidationError("You can't block yourself.");
  await assertMemberExists(pool, userId);
  await ensureUser(pool, viewerId);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("INSERT IGNORE INTO community_blocks (blocker_id, blocked_id) VALUES (?, ?)", [viewerId, userId]);
    await connection.query("DELETE FROM community_follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)", [viewerId, userId, userId, viewerId]);
    await connection.query("DELETE FROM community_close_friends WHERE (owner_id = ? AND friend_id = ?) OR (owner_id = ? AND friend_id = ?)", [viewerId, userId, userId, viewerId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { blocked: true };
}

async function unblock(pool, viewerId, userId) {
  await pool.query("DELETE FROM community_blocks WHERE blocker_id = ? AND blocked_id = ?", [viewerId, userId]);
  return { blocked: false };
}

async function listBlocked(pool, viewerId) {
  const [rows] = await pool.query(
    "SELECT b.blocked_id, u.full_name FROM community_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC LIMIT 200",
    [viewerId],
  );
  return rows.map((row) => memberSummary({ user_id: row.blocked_id, full_name: row.full_name }));
}

// ---- Close Friends -------------------------------------------------------------------
// A member's list of who sees their close-friends stories. Only the owner reads or changes
// it; nothing returns another member's list.

// The owner's accepted followers and current close friends, each marked in or out
async function listCloseFriends(pool, ownerId) {
  const [rows] = await pool.query(
    `SELECT u.id AS user_id, u.full_name,
            EXISTS (SELECT 1 FROM community_close_friends cf WHERE cf.owner_id = ? AND cf.friend_id = u.id) AS is_close
     FROM users u
     WHERE u.id <> ?
       AND (EXISTS (SELECT 1 FROM community_follows f WHERE f.follower_id = u.id AND f.following_id = ? AND f.status = 'accepted')
            OR EXISTS (SELECT 1 FROM community_close_friends cf WHERE cf.owner_id = ? AND cf.friend_id = u.id))
       AND NOT EXISTS (SELECT 1 FROM community_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
     ORDER BY is_close DESC, u.full_name ASC
     LIMIT 500`,
    [ownerId, ownerId, ownerId, ownerId, ownerId, ownerId],
  );
  return rows.map((row) => ({ member: memberSummary(row), isCloseFriend: Boolean(row.is_close) }));
}

// Adds a follower to the owner's Close Friends (only members who follow the owner)
async function addCloseFriend(pool, ownerId, friendId) {
  if (ownerId === friendId) throw new ValidationError("You can't add yourself to Close Friends.");
  await assertMemberExists(pool, friendId);
  if (await isBlocked(pool, ownerId, friendId)) throw new NotFoundError("That member doesn't exist.");
  const [rows] = await pool.query("SELECT 1 FROM community_follows WHERE follower_id = ? AND following_id = ? AND status = 'accepted'", [friendId, ownerId]);
  if (rows.length === 0) throw new ValidationError("Only members who follow you can be close friends.");
  await ensureUser(pool, ownerId);
  await pool.query("INSERT IGNORE INTO community_close_friends (owner_id, friend_id) VALUES (?, ?)", [ownerId, friendId]);
  return { userId: friendId, isCloseFriend: true };
}

async function removeCloseFriend(pool, ownerId, friendId) {
  await pool.query("DELETE FROM community_close_friends WHERE owner_id = ? AND friend_id = ?", [ownerId, friendId]);
  return { userId: friendId, isCloseFriend: false };
}

// Admins: suspend or reinstate a member's community presence
async function setSuspended(pool, userId, suspended) {
  await assertMemberExists(pool, userId);
  await pool.query(
    "INSERT INTO community_profiles (user_id, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)",
    [userId, suspended ? "suspended" : "active"],
  );
  return { userId, suspended };
}

async function listSuspended(pool) {
  const [rows] = await pool.query(
    "SELECT cp.user_id, cp.updated_at, u.full_name FROM community_profiles cp JOIN users u ON u.id = cp.user_id WHERE cp.status = 'suspended' ORDER BY cp.updated_at DESC LIMIT 200",
  );
  return rows.map((row) => ({ member: memberSummary(row), since: new Date(row.updated_at).toISOString() }));
}

// What the bell shows: follow requests plus recent likes and comments on the caller's posts
async function listNotifications(pool, userId) {
  const requests = await listFollowRequests(pool, userId);
  const [likes] = await pool.query(
    `SELECT l.user_id, l.post_id, l.created_at, u.full_name, p.body FROM community_post_likes l
     JOIN community_posts p ON p.id = l.post_id JOIN users u ON u.id = l.user_id
     WHERE p.user_id = ? AND l.user_id <> ? AND p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM community_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = l.user_id) OR (b.blocker_id = l.user_id AND b.blocked_id = ?))
     ORDER BY l.created_at DESC LIMIT 30`,
    [userId, userId, userId, userId],
  );
  const [comments] = await pool.query(
    `SELECT c.user_id, c.post_id, c.created_at, c.body, u.full_name FROM community_comments c
     JOIN community_posts p ON p.id = c.post_id JOIN users u ON u.id = c.user_id
     WHERE p.user_id = ? AND c.user_id <> ? AND c.deleted_at IS NULL AND p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM community_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = c.user_id) OR (b.blocker_id = c.user_id AND b.blocked_id = ?))
     ORDER BY c.created_at DESC LIMIT 30`,
    [userId, userId, userId, userId],
  );
  const activity = [
    ...likes.map((row) => ({ type: "like", member: memberSummary(row), postId: row.post_id, preview: row.body.slice(0, 60), at: new Date(row.created_at).toISOString() })),
    ...comments.map((row) => ({ type: "comment", member: memberSummary(row), postId: row.post_id, preview: row.body.slice(0, 60), at: new Date(row.created_at).toISOString() })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40);
  return { followRequests: requests, activity };
}

module.exports = {
  getProfile, updateOwnProfile, follow, unfollow, listFollowRequests, answerFollowRequest, block, unblock, listBlocked,
  listCloseFriends, addCloseFriend, removeCloseFriend, setSuspended, listSuspended, listNotifications,
};
