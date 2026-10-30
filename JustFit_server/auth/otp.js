// One-time sign-in codes: generating, hashing and checking them, and the limits around them.
// Pure: no database and no network, so the rules are unit-tested on their own.
//
// The code itself is never stored or logged. otp_challenges.code_hash is an HMAC-SHA256 of
// "<challenge id>:<code>" with a key derived from AUTH_SECRET (HKDF, its own label), so a
// copy of the table can't be turned back into codes, and a hash only fits its own challenge.
const crypto = require("node:crypto");

const CODE = /^[0-9]{6}$/;

// A uniformly random 6-digit code from the OS's secure random source
function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

// The key for code hashes: HKDF from AUTH_SECRET, labelled for this one use
function deriveOtpKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return Buffer.from(crypto.hkdfSync("sha256", secret, "justfit-otp-code", "otp v1", 32));
}

const hashCode = (key, challengeId, code) => crypto.createHmac("sha256", key).update(`${challengeId}:${code}`).digest("hex");

// Constant-time comparison against the stored hash (hex)
function codeMatches(key, challengeId, code, storedHash) {
  if (typeof code !== "string" || !CODE.test(code) || typeof storedHash !== "string" || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return crypto.timingSafeEqual(Buffer.from(hashCode(key, challengeId, code), "hex"), Buffer.from(storedHash, "hex"));
}

// The limits. Expiry and attempts are fixed by the approved design; the send limits can be
// tightened (or, in tests, loosened) from the environment, within sane bounds.
const DEFAULTS = {
  ttlSeconds: 300, // a code lasts 5 minutes
  maxAttempts: 5, // wrong tries per code, then it is locked
  cooldownSeconds: 60, // between two codes for one number
  perHour: 5, // codes per number per hour
  perDay: 10, // codes per number per day
  dailyCap: 500, // codes for everyone per day: protects the SMS wallet
  ipRequestLimit: 10, // code requests per IP address per window
  ipVerifyLimit: 30, // verify attempts per IP address per window
  ipWindowSeconds: 600,
};
const BOUNDS = {
  cooldownSeconds: [0, 3600],
  perHour: [1, 1000],
  perDay: [1, 10000],
  dailyCap: [1, 1_000_000],
  ipRequestLimit: [1, 100000],
  ipVerifyLimit: [1, 100000],
  ipWindowSeconds: [1, 86400],
};
const ENV_NAMES = {
  cooldownSeconds: "OTP_COOLDOWN_SECONDS",
  perHour: "OTP_PER_HOUR",
  perDay: "OTP_PER_DAY",
  dailyCap: "OTP_DAILY_SMS_CAP",
  ipRequestLimit: "OTP_IP_REQUEST_LIMIT",
  ipVerifyLimit: "OTP_IP_VERIFY_LIMIT",
  ipWindowSeconds: "OTP_IP_WINDOW_SECONDS",
};

// The limits from the environment; a value that isn't a whole number in range is refused at startup
function otpConfig(env = process.env) {
  const config = { ...DEFAULTS };
  for (const [key, name] of Object.entries(ENV_NAMES)) {
    if (env[name] === undefined || env[name] === "") continue;
    const value = Number(env[name]);
    const [min, max] = BOUNDS[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
    config[key] = value;
  }
  return config;
}

// Whether one more code may be sent to a number, from its recent history (counted by the
// database). Returns { ok: true } or { ok: false, retryAfterSeconds }.
//   sinceLastSeconds: seconds since the newest code for the number (null if none today)
//   lastHour / lastDay: codes for the number in the last hour / day
//   hourResetSeconds / dayResetSeconds: seconds until the oldest of those leaves its window
function sendAllowed(config, { sinceLastSeconds, lastHour, lastDay, hourResetSeconds, dayResetSeconds }) {
  if (sinceLastSeconds !== null && sinceLastSeconds < config.cooldownSeconds) {
    return { ok: false, retryAfterSeconds: Math.max(1, config.cooldownSeconds - sinceLastSeconds) };
  }
  if (lastDay >= config.perDay) return { ok: false, retryAfterSeconds: Math.max(1, dayResetSeconds ?? 86400) };
  if (lastHour >= config.perHour) return { ok: false, retryAfterSeconds: Math.max(1, hourResetSeconds ?? 3600) };
  return { ok: true };
}

module.exports = { CODE, generateCode, deriveOtpKey, hashCode, codeMatches, otpConfig, sendAllowed, DEFAULTS };
