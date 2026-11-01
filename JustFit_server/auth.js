// Who is calling? Checks the session token the app sends as "Authorization: Bearer <token>"
// against auth_sessions (see auth/sessions.js) and puts the verified user id on req.userId
// and the session on req.sessionId. Identity and role come from the database only, never
// from the request body. Tokens are never logged.
const sessions = require("./auth/sessions");
const { logSecurityEvent } = require("./logging");

const ROLES = ["user", "admin"];

const signInAgain = (res) => res.status(401).json({ error: "Please sign in again." });

// Express middleware: 401 unless the token belongs to a live session (not expired, not
// revoked, account still there). The pool is the app's (app.locals.pool).
async function requireUser(req, res, next) {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return signInAgain(res);
  try {
    const session = await sessions.findSession(req.app.locals.pool, token);
    if (!session) return signInAgain(res);
    req.userId = session.userId;
    req.sessionId = session.sessionId;
    next();
  } catch (error) {
    next(error);
  }
}

// The account as the database knows it: email (may be empty for phone accounts), the
// verified phone and the role. Throws if the account is missing, so callers fail closed.
async function getAccount(userId, pool = require("./database").pool) {
  const [[row]] = await pool.query("SELECT email, verified_phone, role FROM users WHERE id = ?", [userId]);
  if (!row) throw new Error("Account not found");
  return { email: row.email ?? null, phone: row.verified_phone ?? null, role: ROLES.includes(row.role) ? row.role : "user" };
}

// Express middleware for admin-only routes, placed after requireUser (and the rate limit):
// 403 unless the verified caller's role is "admin". Read from the database on every call,
// so a demoted admin loses access at once. No verified user → 401; lookup failure → 503.
async function requireAdmin(req, res, next) {
  if (typeof req.userId !== "string" || req.userId === "") return signInAgain(res);
  let account;
  try {
    account = await getAccount(req.userId, req.app.locals.pool);
  } catch {
    console.error("Account lookup failed");
    return res.status(503).json({ error: "We couldn't verify your account right now. Please try again." });
  }
  if (account.role !== "admin") {
    logSecurityEvent("admin.denied", { userId: req.userId, method: req.method, path: req.originalUrl?.split("?")[0] ?? req.path });
    return res.status(403).json({ error: "Only admins can do that." });
  }
  req.account = account;
  next();
}

// Makes sure the verified caller still has a users row (deleting the account ends its
// sessions, but a request can be in flight). Missing → 401, so the app asks to sign in again.
async function ensureUser(pool, userId) {
  const [rows] = await pool.query("SELECT id FROM users WHERE id = ?", [userId]);
  if (rows.length > 0) return;
  const error = new Error("Please sign in again.");
  error.name = "AccountUnavailableError";
  error.status = 401;
  throw error;
}

module.exports = { requireUser, requireAdmin, getAccount, ensureUser, ROLES };
