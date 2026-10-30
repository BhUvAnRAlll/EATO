// Phone sign-in: sending a code and checking it. The routes (auth/routes.js) validate the
// body and the per-IP budget first; everything here works on a normalised 10-digit phone.
//
// Sending: one request at a time per number (a MySQL named lock), so two taps can't both pass
// the cooldown. The limits are counted from otp_challenges, so a restart doesn't reset them.
// A new code replaces the previous one only once the SMS provider has accepted it: until then
// the new row is 'pending' (never accepted at sign-in) and the previous code keeps working, so
// a failed or timed-out send never leaves the member without a usable code, and there is never
// more than one ('sent' is the only status sign-in accepts).
// Checking: the newest code for the number is locked (SELECT ... FOR UPDATE) for the whole
// transaction, so concurrent attempts queue; a right code is consumed in the same
// transaction that signs in, so it works once. Answers never say whether an account exists.
const crypto = require("node:crypto");
const { ValidationError } = require("../profile");
const otp = require("./otp");
const sessions = require("./sessions");
const { SmsError } = require("./sms");
const { toE164 } = require("./phone");
const { isDevPhone } = require("./devLogin");

const LOCK_WAIT_SECONDS = 5;

// A refusal with its own status (and, for 429, when to try again)
function refusal(status, message, retryAfterSeconds) {
  const error = new ValidationError(message);
  error.status = status;
  if (retryAfterSeconds) error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

// user_ + 24 random base62 characters: the shape the existing validators and passes accept
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const newUserId = () => "user_" + Array.from({ length: 24 }, () => BASE62[crypto.randomInt(0, 62)]).join("");

// Sends a new code to the number. Returns { retryAfterSeconds, expiresInSeconds }.
// devLogin (auth/devLogin.js, development only): for its one number the code is the fixed
// development code and no SMS is sent; everything else (limits, hashing, expiry) is the same.
async function requestOtp(pool, phone, { sms, otpKey, config, devLogin = null }) {
  const dev = isDevPhone(devLogin, phone);
  if (!sms.enabled && !dev) throw refusal(503, "Phone sign-in isn't available yet.");
  const conn = await pool.getConnection();
  const lockName = `justfit-otp:${phone}`;
  let locked = false;
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK(?, ?) AS got", [lockName, LOCK_WAIT_SECONDS]);
    if (lock.got !== 1) throw refusal(429, "Please wait a moment and try again.", 5);
    locked = true;

    const [[history]] = await conn.query(
      `SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW(3)) AS since_last,
              COALESCE(SUM(created_at > NOW(3) - INTERVAL 1 HOUR), 0) AS last_hour,
              COUNT(*) AS last_day,
              TIMESTAMPDIFF(SECOND, NOW(3), MIN(IF(created_at > NOW(3) - INTERVAL 1 HOUR, created_at, NULL)) + INTERVAL 1 HOUR) AS hour_reset,
              TIMESTAMPDIFF(SECOND, NOW(3), MIN(created_at) + INTERVAL 1 DAY) AS day_reset
         FROM otp_challenges WHERE phone = ? AND created_at > NOW(3) - INTERVAL 1 DAY`,
      [phone],
    );
    const allowed = otp.sendAllowed(config, {
      sinceLastSeconds: history.since_last === null ? null : Number(history.since_last),
      lastHour: Number(history.last_hour),
      lastDay: Number(history.last_day),
      hourResetSeconds: history.hour_reset === null ? null : Number(history.hour_reset),
      dayResetSeconds: history.day_reset === null ? null : Number(history.day_reset),
    });
    if (!allowed.ok) {
      throw refusal(429, `Please wait ${allowed.retryAfterSeconds} seconds before asking for another code.`, allowed.retryAfterSeconds);
    }
    const [[everyone]] = await conn.query("SELECT COUNT(*) AS n FROM otp_challenges WHERE created_at > NOW(3) - INTERVAL 1 DAY");
    if (Number(everyone.n) >= config.dailyCap) throw refusal(503, "Phone sign-in is busy right now. Please try again later.");

    const id = crypto.randomUUID();
    const code = dev ? devLogin.code : otp.generateCode();
    await conn.query(
      "INSERT INTO otp_challenges (id, phone, code_hash, status, expires_at) VALUES (?, ?, ?, 'pending', NOW() + INTERVAL ? SECOND)",
      [id, phone, otp.hashCode(otpKey, id, code), config.ttlSeconds],
    );
    try {
      if (!dev) await sms.sendOtp(phone, code); // the development number gets no SMS
    } catch (error) {
      // Not sent (or the provider timed out): the new code is never used, the previous one stays.
      // If even this update fails, the row stays 'pending', which sign-in never accepts either.
      await conn.query("UPDATE otp_challenges SET status = 'failed' WHERE id = ?", [id]).catch(() => {});
      if (error instanceof SmsError) {
        console.warn(`Sign-in SMS not sent: ${error.reason}`); // the provider's code only
        throw refusal(503, "We couldn't send the code. Please try again in a minute.");
      }
      throw error;
    }
    // Sent: in one transaction the earlier codes for this number stop working and the new one
    // starts. A database failure here rolls both back: the previous code still works and the new
    // one stays 'pending' (unusable), so there is never more than one live code.
    await conn.beginTransaction();
    try {
      await conn.query("UPDATE otp_challenges SET status = 'superseded' WHERE phone = ? AND status IN ('pending', 'sent') AND id <> ?", [phone, id]);
      await conn.query("UPDATE otp_challenges SET status = 'sent' WHERE id = ? AND status = 'pending'", [id]);
      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    }
    return { retryAfterSeconds: config.cooldownSeconds, expiresInSeconds: config.ttlSeconds };
  } finally {
    if (locked) await conn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
    conn.release();
  }
}

// Checks a code. A right one signs in: the account for this verified number, or a new
// member account (role 'user', no email). Returns { token, expiresAt, user }.
async function verifyOtp(pool, phone, code, { otpKey, config }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[challenge]] = await conn.query(
      `SELECT id, code_hash, attempts, status, expires_at > NOW() AS live
         FROM otp_challenges WHERE phone = ? AND status IN ('sent', 'locked')
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [phone],
    );
    if (!challenge || !challenge.live) {
      await conn.rollback();
      throw refusal(400, "That code has expired. Please ask for a new one.");
    }
    if (challenge.status === "locked") {
      await conn.rollback();
      throw refusal(429, "Too many wrong codes. Please ask for a new one.");
    }
    if (!otp.codeMatches(otpKey, challenge.id, code, challenge.code_hash)) {
      const attempts = challenge.attempts + 1;
      const lockedNow = attempts >= config.maxAttempts;
      await conn.query("UPDATE otp_challenges SET attempts = ?, status = IF(?, 'locked', status) WHERE id = ?", [attempts, lockedNow, challenge.id]);
      await conn.commit(); // the wrong try counts even though sign-in failed
      if (lockedNow) throw refusal(429, "Too many wrong codes. Please ask for a new one.");
      const left = config.maxAttempts - attempts;
      throw refusal(400, `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`);
    }

    const [consumed] = await conn.query(
      "UPDATE otp_challenges SET status = 'consumed', consumed_at = NOW(), attempts = attempts + 1 WHERE id = ? AND status = 'sent'",
      [challenge.id],
    );
    if (consumed.affectedRows !== 1) {
      await conn.rollback();
      throw refusal(400, "That code has expired. Please ask for a new one.");
    }

    let isNew = false;
    let [[user]] = await conn.query("SELECT id FROM users WHERE verified_phone = ? FOR UPDATE", [phone]);
    if (!user) {
      const id = newUserId();
      try {
        await conn.query(
          "INSERT INTO users (id, email, full_name, phone, phone_verified_at, role) VALUES (?, NULL, NULL, ?, NOW(), 'user')",
          [id, phone],
        );
        user = { id };
        isNew = true;
      } catch (error) {
        if (error?.code !== "ER_DUP_ENTRY") throw error;
        [[user]] = await conn.query("SELECT id FROM users WHERE verified_phone = ?", [phone]); // created a moment ago
        if (!user) throw error;
      }
    }
    const session = await sessions.createSession(conn, user.id);
    await conn.commit();
    return { token: session.token, expiresAt: session.expiresAt, user: { ...(await accountFor(pool, user.id)), isNew } };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
}

// What the app needs about the signed-in account: never another user's, never a session
async function accountFor(pool, userId) {
  const [[row]] = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.phone, u.phone_verified_at IS NOT NULL AS phone_verified, u.role, p.profile_complete
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`,
    [userId],
  );
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone_verified ? toE164(row.phone) : null,
    email: row.email ?? null,
    fullName: row.full_name ?? null,
    role: row.role,
    profileComplete: row.profile_complete === 1 || row.profile_complete === true,
  };
}

module.exports = { requestOtp, verifyOtp, accountFor, newUserId };
