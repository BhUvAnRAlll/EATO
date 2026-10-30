// Who a member is, as the community shows them: display name and initials from the users
// table. Every signed-in account has a users row (phone sign-in creates it), so nothing is
// copied from anywhere else.
const { getAccount } = require("../auth");

// The public shape of a member (no email, no phone)
function memberSummary(row) {
  const name = (row.full_name && row.full_name.trim()) || "justFit member";
  return { id: row.user_id ?? row.id, name, initial: name.trim().charAt(0).toUpperCase() };
}

// Makes sure the verified caller still has a users row (a session can outlive nothing else:
// deleting the account ends its sessions). Missing → 401, so the app asks to sign in again.
async function ensureUser(pool, userId) {
  const [rows] = await pool.query("SELECT id FROM users WHERE id = ?", [userId]);
  if (rows.length > 0) return;
  const error = new Error("Please sign in again.");
  error.name = "AccountUnavailableError";
  error.status = 401;
  throw error;
}

// The caller's role right now (users.role, which only admins change), for moderation and
// role checks. Read on every call, so a demoted admin loses moderation at once. Lookup
// failure → 503.
async function currentRole(userId, pool) {
  try {
    return (await getAccount(userId, pool)).role;
  } catch {
    console.error("Account lookup failed");
    const error = new Error("We couldn't verify your account right now. Please try again.");
    error.name = "AccountUnavailableError";
    error.status = 503;
    throw error;
  }
}

module.exports = { memberSummary, ensureUser, currentRole };
