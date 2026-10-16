// Friendships: a mutual relationship, separate from following. One row per pair of members
// (stored in a fixed order, so a pair can never have two rows, whichever side asks first),
// with who sent the current request and where it stands. Nothing here creates, changes or
// reads follows, and a friendship never opens a private account's posts or stories.
//
// Lifecycle (every change is an UPDATE, never a DELETE, so the history stays):
//   pending   → accepted (the other member accepts) | declined (they decline) | cancelled (the sender cancels)
//   accepted  → removed (either member removes the friendship)
//   any ended state → pending again when someone sends a new request (a sender whose request
//   was declined waits DECLINE_COOLDOWN_DAYS before asking the same member again)
// Blocking ends a pending request or a friendship between the two members at once.
const { ValidationError } = require("../profile");
const { memberSummary, ensureUser } = require("./members");
const { NotFoundError } = require("./posts");
const { isBlocked } = require("./visibility");

const DECLINE_COOLDOWN_DAYS = 7;

// The pair in its stored order
const pairOf = (a, b) => (a < b ? [a, b] : [b, a]);

const conflict = (message) => {
  const error = new ValidationError(message);
  error.status = 409;
  return error;
};

// The member must exist, be active and not blocked either way; anything else looks missing
async function assertCanReach(pool, viewerId, otherId) {
  if (viewerId === otherId) throw new ValidationError("You can't send a friend request to yourself.");
  const [rows] = await pool.query(
    "SELECT u.id, (SELECT cp.status FROM community_profiles cp WHERE cp.user_id = u.id) AS status FROM users u WHERE u.id = ?",
    [otherId],
  );
  if (!rows[0] || rows[0].status === "suspended") throw new NotFoundError("That member doesn't exist.");
  if (await isBlocked(pool, viewerId, otherId)) throw new NotFoundError("That member doesn't exist.");
}

// "none" | "outgoing" (the viewer asked) | "incoming" (they asked) | "friends"
function stateOf(row, viewerId) {
  if (!row) return "none";
  if (row.status === "accepted") return "friends";
  if (row.status === "pending") return row.requester_id === viewerId ? "outgoing" : "incoming";
  return "none";
}

async function friendState(pool, viewerId, otherId) {
  if (viewerId === otherId) return "none";
  const [low, high] = pairOf(viewerId, otherId);
  const [rows] = await pool.query("SELECT requester_id, status FROM community_friendships WHERE user_low = ? AND user_high = ?", [low, high]);
  return stateOf(rows[0], viewerId);
}

// Sends a request. Repeating it changes nothing; if the other member already asked, this
// accepts their request instead (two members asking each other at once end up friends).
async function sendRequest(pool, viewerId, otherId, attempt = 0) {
  await assertCanReach(pool, viewerId, otherId);
  await ensureUser(pool, viewerId);
  const [low, high] = pairOf(viewerId, otherId);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT requester_id, status, responded_at > DATE_SUB(NOW(), INTERVAL ? DAY) AS recently_answered
       FROM community_friendships WHERE user_low = ? AND user_high = ? FOR UPDATE`,
      [DECLINE_COOLDOWN_DAYS, low, high],
    );
    const row = rows[0];
    if (!row) {
      await connection.query("INSERT INTO community_friendships (user_low, user_high, requester_id) VALUES (?, ?, ?)", [low, high, viewerId]);
    } else if (row.status === "pending" && row.requester_id !== viewerId) {
      await connection.query("UPDATE community_friendships SET status = 'accepted', responded_at = NOW() WHERE user_low = ? AND user_high = ?", [low, high]);
    } else if (row.status === "declined" && row.requester_id === viewerId && row.recently_answered) {
      throw conflict("You can send another friend request to this member later.");
    } else if (!["pending", "accepted"].includes(row.status)) {
      await connection.query(
        "UPDATE community_friendships SET status = 'pending', requester_id = ?, requested_at = NOW(), responded_at = NULL WHERE user_low = ? AND user_high = ?",
        [viewerId, low, high],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    // Both members asked at the same moment: the other insert won (duplicate key), or the two
    // transactions' locks on the empty pair collided (deadlock, rolled back by MySQL). Either
    // way nothing was written here, so read the pair again and act on what is there now.
    if ((error?.code === "ER_DUP_ENTRY" || error?.code === "ER_LOCK_DEADLOCK") && attempt < 2) {
      connection.release();
      return sendRequest(pool, viewerId, otherId, attempt + 1);
    }
    connection.release();
    throw error;
  }
  connection.release();
  return { userId: otherId, friendState: await friendState(pool, viewerId, otherId) };
}

// The sender withdraws their own pending request
async function cancelRequest(pool, viewerId, otherId) {
  const [low, high] = pairOf(viewerId, otherId);
  const [result] = await pool.query(
    "UPDATE community_friendships SET status = 'cancelled', responded_at = NOW() WHERE user_low = ? AND user_high = ? AND status = 'pending' AND requester_id = ?",
    [low, high, viewerId],
  );
  if (result.affectedRows === 0) throw new NotFoundError("There's no friend request to cancel.");
  return { userId: otherId, friendState: "none" };
}

// Only the member who received the request can accept or decline it
async function answerRequest(pool, viewerId, otherId, accept) {
  const [low, high] = pairOf(viewerId, otherId);
  if (accept) await assertCanReach(pool, viewerId, otherId);
  const [result] = await pool.query(
    `UPDATE community_friendships SET status = ?, responded_at = NOW()
     WHERE user_low = ? AND user_high = ? AND status = 'pending' AND requester_id = ?`,
    [accept ? "accepted" : "declined", low, high, otherId],
  );
  if (result.affectedRows === 0) throw new NotFoundError("That friend request is no longer open.");
  return { userId: otherId, friendState: accept ? "friends" : "none" };
}

// Either friend ends the friendship
async function removeFriend(pool, viewerId, otherId) {
  const [low, high] = pairOf(viewerId, otherId);
  const [result] = await pool.query(
    "UPDATE community_friendships SET status = 'removed', responded_at = NOW() WHERE user_low = ? AND user_high = ? AND status = 'accepted'",
    [low, high],
  );
  if (result.affectedRows === 0) throw new NotFoundError("You aren't friends with this member.");
  return { userId: otherId, friendState: "none" };
}

// Called inside the block transaction: whatever stood between the two ends at once
async function endForBlock(connection, a, b) {
  const [low, high] = pairOf(a, b);
  await connection.query(
    `UPDATE community_friendships SET status = IF(status = 'accepted', 'removed', 'cancelled'), responded_at = NOW()
     WHERE user_low = ? AND user_high = ? AND status IN ('pending', 'accepted')`,
    [low, high],
  );
}

// Rows involving the viewer with the other member's details, hiding blocked and suspended members
const OTHER_SQL = `
  SELECT f.requester_id, f.status, f.requested_at, f.responded_at,
         IF(f.user_low = ?, f.user_high, f.user_low) AS other_id
  FROM community_friendships f
  WHERE (f.user_low = ? OR f.user_high = ?)`;

async function listFor(pool, viewerId, statusSql) {
  const [rows] = await pool.query(
    `SELECT x.*, u.full_name FROM (${OTHER_SQL} AND ${statusSql}) x
     JOIN users u ON u.id = x.other_id
     WHERE NOT EXISTS (SELECT 1 FROM community_profiles cp WHERE cp.user_id = x.other_id AND cp.status = 'suspended')
       AND NOT EXISTS (SELECT 1 FROM community_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = x.other_id) OR (b.blocker_id = x.other_id AND b.blocked_id = ?))
     ORDER BY COALESCE(x.responded_at, x.requested_at) DESC
     LIMIT 500`,
    [viewerId, viewerId, viewerId, viewerId, viewerId],
  );
  return rows;
}

// The viewer's own friends (never another member's list)
async function listFriends(pool, viewerId) {
  const rows = await listFor(pool, viewerId, "f.status = 'accepted'");
  return rows.map((row) => ({ member: memberSummary({ user_id: row.other_id, full_name: row.full_name }), since: new Date(row.responded_at ?? row.requested_at).toISOString() }));
}

// The viewer's pending requests, split into received and sent
async function listRequests(pool, viewerId) {
  const rows = await listFor(pool, viewerId, "f.status = 'pending'");
  const toApi = (row) => ({ member: memberSummary({ user_id: row.other_id, full_name: row.full_name }), requestedAt: new Date(row.requested_at).toISOString() });
  return {
    incoming: rows.filter((row) => row.requester_id !== viewerId).map(toApi),
    outgoing: rows.filter((row) => row.requester_id === viewerId).map(toApi),
  };
}

module.exports = { DECLINE_COOLDOWN_DAYS, pairOf, stateOf, friendState, sendRequest, cancelRequest, answerRequest, removeFriend, endForBlock, listFriends, listRequests };
