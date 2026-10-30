// Test accounts and sessions for the e2e and UI suites, written straight into justfit_test: no
// external service, nothing sent. An identity is a users row exactly like one phone sign-in
// creates (user_ id, verified phone, role 'user' unless a test asks for another), plus a
// test email so the email-based gym features can be exercised. Sessions are auth_sessions
// rows with a real random token, so the server checks them exactly like a device's.
// Tokens are returned to the caller and never logged.
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const db = require("./test-db");
const { newToken, hashToken } = require("../../auth/sessions");
const { newUserId } = require("../../auth/service");

const TEST_DOMAIN = "example.com";

// Only a status and a code, never a message (a database message can quote a value)
function describeIdentityError(error) {
  return { status: error?.status ?? null, code: error?.code ?? null };
}

// A random Indian mobile number (9xxxxxxxxx); collisions are vanishingly unlikely and the
// unique key on verified_phone would refuse one anyway
const randomPhone = () => "9" + String(crypto.randomInt(0, 1_000_000_000)).padStart(9, "0");

function identitiesFor(env) {
  if (env.DB_NAME !== "justfit_test" || env.DB_USER !== "justfit_test") throw new Error("test identities are only written to justfit_test");
  const tokens = new Map(); // sessionId → token, for tokenFor
  const phones = new Map(); // userId → phone, so the codes sent to it can be cleaned up

  // One short-lived connection per call, so nothing keeps the test process alive
  async function withDb(work) {
    const connection = await db.connect(env);
    try {
      return await work(connection);
    } finally {
      await connection.end();
    }
  }

  // An account as phone sign-in makes it. `role` ("admin") is set the way
  // scripts/set-role.js does, for tests of role-protected routes. `withPassword` is accepted
  // for older callers and ignored: there are no passwords any more.
  async function createIdentity(runId, tag, { role = "user", phone = randomPhone(), email } = {}) {
    const id = newUserId();
    const emailAddress = email === null ? null : email ?? `e2e-${runId}-${tag}@${TEST_DOMAIN}`;
    await withDb((c) => c.query(
      "INSERT INTO users (id, email, full_name, phone, phone_verified_at, role) VALUES (?, ?, NULL, ?, NOW(), ?)",
      [id, emailAddress, phone, role],
    ));
    phones.set(id, phone);
    return { id, emailAddress, phone };
  }

  // A live session (30 days unless expiresInSeconds is given). `jwt` is the same token under
  // the name older tests read.
  async function mintToken(userId, expiresInSeconds = 30 * 24 * 3600) {
    const sessionId = crypto.randomUUID();
    const token = newToken();
    await withDb((c) => c.query(
      "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, NOW() + INTERVAL ? SECOND)",
      [sessionId, userId, hashToken(token), expiresInSeconds],
    ));
    tokens.set(sessionId, token);
    return { sessionId, token, jwt: token };
  }

  // The token of a session that is still live; refuses once it is revoked or expired
  async function tokenFor(sessionId) {
    const [[row]] = await withDb((c) => c.query("SELECT revoked_at IS NULL AND expires_at > NOW() AS live FROM auth_sessions WHERE id = ?", [sessionId]));
    if (!row?.live || !tokens.has(sessionId)) throw new Error("session is not live");
    return tokens.get(sessionId);
  }

  const revokeSession = (sessionId) => withDb((c) => c.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL", [sessionId]));
  // The account, its sessions (they go with it) and the sign-in codes sent to its number
  const deleteUser = (userId) => withDb(async (c) => {
    const [[row]] = await c.query("SELECT phone FROM users WHERE id = ?", [userId]);
    const phone = row?.phone ?? phones.get(userId); // the row may already be gone
    if (phone) await c.query("DELETE FROM otp_challenges WHERE phone = ?", [phone]);
    await db.deleteUsers(c, [userId]);
  });
  const userExists = async (userId) => (await withDb((c) => c.query("SELECT 1 FROM users WHERE id = ?", [userId])))[0].length > 0;
  const setRole = (userId, role) => withDb((c) => c.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]));

  // The setup's finished flag lives in profiles (a profile save sets it). Tests that start a
  // member on home set it here: a bare profiles row is made when the account has none yet.
  const setProfileComplete = (userId, value) => withDb((c) => c.query(
    "INSERT INTO profiles (user_id, profile_complete) VALUES (?, ?) ON DUPLICATE KEY UPDATE profile_complete = VALUES(profile_complete)",
    [userId, Boolean(value)],
  ));
  const getProfileComplete = async (userId) => {
    const [[row]] = await withDb((c) => c.query("SELECT profile_complete FROM profiles WHERE user_id = ?", [userId]));
    return row ? Boolean(row.profile_complete) : false;
  };

  // justfit_test is rebuilt from schema.sql at the start of every file, so nothing is left over
  const sweepOrphans = async () => [];

  return { createIdentity, mintToken, tokenFor, revokeSession, deleteUser, userExists, setRole, setProfileComplete, getProfileComplete, sweepOrphans };
}

module.exports = { identitiesFor, describeIdentityError, randomPhone, TEST_DOMAIN };
