// Who a member is, as the community shows them: display name and initials from the users
// table. A member who signed up but hasn't saved a profile has no users row yet; the first
// community action creates one from Clerk (email and role), the same way a profile save does.
const { getAccount } = require("../auth");

// The public shape of a member (no email, no phone)
function memberSummary(row) {
  const name = (row.full_name && row.full_name.trim()) || "EATO member";
  return { id: row.user_id ?? row.id, name, initial: name.trim().charAt(0).toUpperCase() };
}

// Makes sure the verified caller has a users row. Fails closed if Clerk can't be reached.
async function ensureUser(pool, userId) {
  const [rows] = await pool.query("SELECT id FROM users WHERE id = ?", [userId]);
  if (rows.length > 0) return;
  const account = await getAccount(userId);
  await pool.query("INSERT IGNORE INTO users (id, email, role) VALUES (?, ?, ?)", [userId, account.email, account.role]);
}

// The caller's role, read from the users row (set by the server from Clerk on every profile save)
async function roleOf(pool, userId) {
  const [rows] = await pool.query("SELECT role FROM users WHERE id = ?", [userId]);
  return rows[0]?.role ?? "user";
}

module.exports = { memberSummary, ensureUser, roleOf };
