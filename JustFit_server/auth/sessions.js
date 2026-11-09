// Signed-in devices. A session token is 32 random bytes (base64url) with a "jfs_" prefix,
// handed to the app once at sign-in. MySQL keeps only its SHA-256 (auth_sessions.token_hash),
// so a copy of the table can't sign anyone in. Every time comes from the database clock
// (NOW()), never from JavaScript dates. Tokens are never logged.
const crypto = require("node:crypto");

const PREFIX = "jfs_";
const TOKEN = /^jfs_[A-Za-z0-9_-]{43}$/;
const SESSION_DAYS = 30; // absolute: a device signs in again after 30 days
const TOUCH_AFTER_SECONDS = 3600; // last_used_at is refreshed at most once an hour

const newToken = () => PREFIX + crypto.randomBytes(32).toString("base64url");
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

// A new session for the user, inside the caller's transaction (conn). Returns the raw token
// (shown once) and when it expires.
async function createSession(conn, userId) {
  const id = crypto.randomUUID();
  const token = newToken();
  await conn.query(
    "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL ? DAY)",
    [id, userId, hashToken(token), SESSION_DAYS],
  );
  const [[row]] = await conn.query("SELECT expires_at FROM auth_sessions WHERE id = ?", [id]);
  return { sessionId: id, token, expiresAt: row.expires_at };
}

// The live session a token belongs to: { sessionId, userId } or null (malformed, unknown,
// expired, revoked, or the account is gone). Refreshes last_used_at when it is stale.
// Whether account suspensions (migration 2027-01-07) exist on this database: asked once, and again
// a minute later while missing, so sign-in works the same before the migration
let suspensionsTable = { has: false, at: 0 };
async function hasSuspensions(db) {
  if (suspensionsTable.has || Date.now() - suspensionsTable.at < 60000) return suspensionsTable.has;
  const [[row]] = await db.query("SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account_suspensions'");
  suspensionsTable = { has: Number(row.n) > 0, at: Date.now() };
  return suspensionsTable.has;
}

/** Whether a justFit admin has suspended the account (never before the migration) */
async function isSuspended(db, userId) {
  if (!(await hasSuspensions(db))) return false;
  const [[row]] = await db.query("SELECT 1 AS yes FROM account_suspensions WHERE user_id = ?", [userId]);
  return Boolean(row);
}

async function findSession(pool, token) {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  // A suspended account's session is never live, even if one slipped through being revoked
  const notSuspended = (await hasSuspensions(pool)) ? " AND NOT EXISTS (SELECT 1 FROM account_suspensions x WHERE x.user_id = s.user_id)" : "";
  const [rows] = await pool.query(
    `SELECT s.id, s.user_id, (s.last_used_at IS NULL OR s.last_used_at < NOW() - INTERVAL ? SECOND) AS stale
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW()${notSuspended}`,
    [TOUCH_AFTER_SECONDS, hashToken(token)],
  );
  const session = rows[0];
  if (!session) return null;
  if (session.stale) {
    // Best effort: a failed refresh never fails the request
    pool.query("UPDATE auth_sessions SET last_used_at = NOW() WHERE id = ?", [session.id]).catch(() => {});
  }
  return { sessionId: session.id, userId: session.user_id };
}

// Logout: ends this one session (only if it belongs to the user)
async function revokeSession(pool, sessionId, userId) {
  const [result] = await pool.query(
    "UPDATE auth_sessions SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    [sessionId, userId],
  );
  return result.affectedRows;
}

// Logout everywhere: ends every live session of the user. Returns how many were ended.
async function revokeAllSessions(pool, userId) {
  const [result] = await pool.query(
    "UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()",
    [userId],
  );
  return result.affectedRows;
}

module.exports = { TOKEN, SESSION_DAYS, newToken, hashToken, createSession, findSession, revokeSession, revokeAllSessions, isSuspended, hasSuspensions };
