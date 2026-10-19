// The bell. Nothing is stored for it: every entry is read from the rows the events already
// wrote (a like, a comment, a friendship answered, a trainer accepting, a plan saved, a gym
// approval, an RSVP, a gym's notice), always for the verified caller only. Two kinds of entry:
//   - requests the caller can act on (follow requests, friend requests, and join requests in
//     gyms they manage); their count is the badge on the bell
//   - activity from the last 30 days, newest first
// Members blocked either way, and suspended members, are left out of what involves them.
const { memberSummary } = require("./members");
const { listFollowRequests } = require("./profiles");
const { listRequests: listFriendRequests } = require("./friends");

const WINDOW_DAYS = 30;
const ACTIVITY_LIMIT = 50;

// SQL: member `x` (a column) isn't blocked either way with the viewer and isn't suspended.
// Placeholders: viewer, viewer
const reachable = (x) => `NOT EXISTS (SELECT 1 FROM community_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = ${x}) OR (b.blocker_id = ${x} AND b.blocked_id = ?))
  AND NOT EXISTS (SELECT 1 FROM community_profiles cp WHERE cp.user_id = ${x} AND cp.status = 'suspended')`;

const iso = (value) => new Date(value).toISOString();
const member = (row, idKey = "user_id") => memberSummary({ user_id: row[idKey], full_name: row.full_name });

async function likesAndComments(pool, userId) {
  const [likes] = await pool.query(
    `SELECT l.user_id, l.post_id, l.created_at, u.full_name, p.body FROM community_post_likes l
     JOIN community_posts p ON p.id = l.post_id JOIN users u ON u.id = l.user_id
     WHERE p.user_id = ? AND l.user_id <> ? AND p.deleted_at IS NULL AND ${reachable("l.user_id")}
     ORDER BY l.created_at DESC LIMIT 30`,
    [userId, userId, userId, userId],
  );
  const [comments] = await pool.query(
    `SELECT c.user_id, c.post_id, c.created_at, c.body, u.full_name FROM community_comments c
     JOIN community_posts p ON p.id = c.post_id JOIN users u ON u.id = c.user_id
     WHERE p.user_id = ? AND c.user_id <> ? AND c.deleted_at IS NULL AND p.deleted_at IS NULL AND ${reachable("c.user_id")}
     ORDER BY c.created_at DESC LIMIT 30`,
    [userId, userId, userId, userId],
  );
  return [
    ...likes.map((row) => ({ type: "like", member: member(row), postId: row.post_id, preview: row.body.slice(0, 60), at: iso(row.created_at) })),
    ...comments.map((row) => ({ type: "comment", member: member(row), postId: row.post_id, preview: row.body.slice(0, 60), at: iso(row.created_at) })),
  ];
}

// Friend requests the caller sent that the other member accepted
async function friendsAccepted(pool, userId) {
  const [rows] = await pool.query(
    `SELECT IF(f.user_low = ?, f.user_high, f.user_low) AS other_id, f.responded_at, u.full_name
     FROM community_friendships f JOIN users u ON u.id = IF(f.user_low = ?, f.user_high, f.user_low)
     WHERE (f.user_low = ? OR f.user_high = ?) AND f.requester_id = ? AND f.status = 'accepted'
       AND f.responded_at >= NOW() - INTERVAL ? DAY AND ${reachable("u.id")}
     ORDER BY f.responded_at DESC LIMIT 20`,
    [userId, userId, userId, userId, userId, WINDOW_DAYS, userId, userId],
  );
  return rows.map((row) => ({ type: "friend_accepted", member: member(row, "other_id"), preview: "accepted your friend request", at: iso(row.responded_at) }));
}

// The caller's trainer: accepting them, and what the trainer shared since
async function fromMyTrainer(pool, userId) {
  const [[connection]] = await pool.query(
    `SELECT c.trainer_id, c.responded_at, u.full_name FROM trainer_connections c JOIN users u ON u.id = c.trainer_id
     WHERE c.client_id = ? AND c.status = 'connected'`,
    [userId],
  );
  if (!connection) return [];
  const trainer = member(connection, "trainer_id");
  const out = [];
  const since = Date.now() - WINDOW_DAYS * 86400000;
  if (new Date(connection.responded_at).getTime() >= since) out.push({ type: "trainer_accepted", member: trainer, preview: "accepted you as a client", at: iso(connection.responded_at) });
  const [[plan]] = await pool.query("SELECT name, updated_at FROM diet_plans WHERE client_id = ? AND trainer_id = ? AND status = 'active'", [userId, connection.trainer_id]);
  if (plan && new Date(plan.updated_at).getTime() >= since) out.push({ type: "plan_updated", member: trainer, preview: `shared your diet plan: ${plan.name}`, at: iso(plan.updated_at) });
  const [[workout]] = await pool.query("SELECT name, created_at FROM workout_plans WHERE user_id = ? AND created_by = ? AND source = 'trainer' AND status = 'active'", [userId, connection.trainer_id]);
  if (workout && new Date(workout.created_at).getTime() >= since) out.push({ type: "workout_updated", member: trainer, preview: `updated your workout: ${workout.name}`, at: iso(workout.created_at) });
  const [[rec]] = await pool.query(
    "SELECT calories, created_at FROM trainer_target_recommendations WHERE client_id = ? AND trainer_id = ? AND applied_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1",
    [userId, connection.trainer_id],
  );
  if (rec && new Date(rec.created_at).getTime() >= since) out.push({ type: "recommendation", member: trainer, preview: `recommended ${rec.calories} kcal a day`, at: iso(rec.created_at) });
  return out;
}

// Gyms: the caller's join requests that staff approved (active, and joined well after asking)
async function gymApprovals(pool, userId) {
  const [rows] = await pool.query(
    `SELECT m.gym_id, m.joined_at, g.name FROM gym_members m JOIN gyms g ON g.id = m.gym_id
     WHERE m.user_id = ? AND m.status = 'active' AND m.role <> 'owner' AND m.joined_at >= NOW() - INTERVAL ? DAY
       AND TIMESTAMPDIFF(SECOND, m.requested_at, m.joined_at) > 5
     ORDER BY m.joined_at DESC LIMIT 20`,
    [userId, WINDOW_DAYS],
  );
  return rows.map((row) => ({ type: "gym_approved", gymId: row.gym_id, preview: `Your request to join ${row.name} was approved`, at: iso(row.joined_at) }));
}

// Gyms: members going to events the caller hosts
async function rsvps(pool, userId) {
  const [rows] = await pool.query(
    `SELECT r.user_id, r.created_at, u.full_name, e.title, e.gym_id FROM gym_event_rsvps r
     JOIN gym_events e ON e.id = r.event_id JOIN users u ON u.id = r.user_id
     WHERE e.host_id = ? AND r.user_id <> ? AND r.created_at >= NOW() - INTERVAL ? DAY AND ${reachable("r.user_id")}
     ORDER BY r.created_at DESC LIMIT 20`,
    [userId, userId, WINDOW_DAYS, userId, userId],
  );
  return rows.map((row) => ({ type: "rsvp", member: member(row), gymId: row.gym_id, preview: `is going to ${row.title}`, at: iso(row.created_at) }));
}

// Notices the caller's gyms sent them (Notify members, reminders, check-in and renewal notes)
async function gymNotices(pool, userId) {
  const [rows] = await pool.query(
    `SELECT n.id, n.gym_id, n.title, n.body, n.target, n.created_at, g.name AS gym_name
     FROM gym_notice_recipients r JOIN gym_notices n ON n.id = r.notice_id JOIN gyms g ON g.id = n.gym_id
     WHERE r.user_id = ? AND n.created_at >= NOW() - INTERVAL ? DAY
     ORDER BY n.created_at DESC, n.id LIMIT 30`,
    [userId, WINDOW_DAYS],
  );
  return rows.map((row) => ({
    type: "gym_notice", noticeId: row.id, gymId: row.gym_id, gymName: row.gym_name, title: row.title, preview: row.body, target: row.target, at: iso(row.created_at),
  }));
}

// Join requests waiting in gyms the caller owns or administers (actionable on the gym's Manage screen)
async function gymJoinRequests(pool, userId) {
  const [rows] = await pool.query(
    `SELECT p.gym_id, g.name, COUNT(*) AS waiting, MAX(p.requested_at) AS latest
     FROM gym_members p
     JOIN gym_members me ON me.gym_id = p.gym_id AND me.user_id = ? AND me.status = 'active' AND me.role IN ('owner', 'admin')
     JOIN gyms g ON g.id = p.gym_id
     WHERE p.status = 'pending'
     GROUP BY p.gym_id, g.name ORDER BY latest DESC LIMIT 20`,
    [userId],
  );
  return rows.map((row) => ({ gymId: row.gym_id, gymName: row.name, waiting: Number(row.waiting), latestAt: iso(row.latest) }));
}

async function listNotifications(pool, userId) {
  const [followRequests, friends, gymRequests, ...groups] = await Promise.all([
    listFollowRequests(pool, userId),
    listFriendRequests(pool, userId),
    gymJoinRequests(pool, userId),
    likesAndComments(pool, userId),
    friendsAccepted(pool, userId),
    fromMyTrainer(pool, userId),
    gymApprovals(pool, userId),
    rsvps(pool, userId),
    gymNotices(pool, userId),
  ]);
  const activity = groups.flat().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, ACTIVITY_LIMIT);
  const friendRequests = friends.incoming;
  return {
    followRequests,
    friendRequests,
    gymRequests,
    // The bell's badge: what the caller can act on
    requestCount: followRequests.length + friendRequests.length + gymRequests.reduce((sum, g) => sum + g.waiting, 0),
    activity,
  };
}

module.exports = { WINDOW_DAYS, listNotifications };
