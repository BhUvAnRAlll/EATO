// The pure rules behind friendships (no database, no Clerk), so they are unit-tested on
// their own (__tests__/friend-rules.test.js). friends.js uses them and re-exports them.

// The pair in its stored order. Compared lowercased because the columns use the database's
// case-insensitive collation (utf8mb4_0900_ai_ci): a plain `<` puts every capital letter
// before every small one, disagrees with MySQL for about one pair in five, and the row then
// fails chk_friendships_order. Clerk ids are "user_" plus letters and digits, so this order
// matches MySQL's exactly.
const pairOf = (a, b) => (a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]);

// "none" | "outgoing" (the viewer asked) | "incoming" (they asked) | "friends"
function stateOf(row, viewerId) {
  if (!row) return "none";
  if (row.status === "accepted") return "friends";
  if (row.status === "pending") return row.requester_id === viewerId ? "outgoing" : "incoming";
  return "none";
}

// Why the viewer can't message someone, for the chat screen (null = they can)
function messageLockReason(friendState, name) {
  const first = (name || "").trim().split(/\s+/)[0] || "them";
  if (friendState === "friends") return null;
  if (friendState === "outgoing") return `Messaging unlocks when ${first} accepts your friend request.`;
  if (friendState === "incoming") return `Accept ${first}'s friend request to message them.`;
  return `Add ${first} as a friend to message them.`;
}

module.exports = { pairOf, stateOf, messageLockReason };
