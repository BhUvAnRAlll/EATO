// Member passes: the short-lived code a member's "My QR code" shows and the front desk scans.
// A pass is "JF1.<user id>.<expiry, unix seconds>.<signature>"; the signature is an HMAC-SHA256
// over "<user id>.<expiry>" with a key derived from the server's Clerk secret (HKDF, its own
// label), so no extra secret is needed and the app can't forge one. Passes last two minutes and
// the app refreshes them, so a screenshot stops working soon after.
//
// No database. Pure apart from the key, so the tests pass their own key.
const crypto = require("node:crypto");

const PREFIX = "JF1";
// Passes issued before the JustFit rename ("EATO1.…") are still read: same signature, same expiry
const LEGACY_PREFIXES = new Set([PREFIX, "EATO1"]);
const LIFETIME_SECONDS = 120;
const USER_ID = /^user_[A-Za-z0-9]{10,64}$/;

// The signing key: HKDF from a server secret, labelled for this one use
function deriveKey(secret) {
  if (typeof secret !== "string" || secret.length < 16) throw new Error("A server secret is needed to sign member passes");
  return Buffer.from(crypto.hkdfSync("sha256", secret, "eato-member-pass", "member pass v1", 32));
}

const sign = (key, body) => crypto.createHmac("sha256", key).update(body).digest("base64url");

// A fresh pass for this member
function issuePass(key, userId, now = Date.now()) {
  if (!USER_ID.test(userId)) throw new Error("Not a member id");
  const expires = Math.floor(now / 1000) + LIFETIME_SECONDS;
  const body = `${userId}.${expires}`;
  return { pass: `${PREFIX}.${body}.${sign(key, body)}`, expiresAt: new Date(expires * 1000).toISOString() };
}

// What a scanned code says: { ok: true, userId } or { ok: false, reason: "invalid" | "expired" }.
// Anything that isn't a well-formed, correctly signed JustFit pass is "invalid".
function readPass(key, code, now = Date.now()) {
  if (typeof code !== "string" || code.length > 200) return { ok: false, reason: "invalid" };
  const parts = code.trim().split(".");
  if (parts.length !== 4 || !LEGACY_PREFIXES.has(parts[0])) return { ok: false, reason: "invalid" };
  const [, userId, expiresText, signature] = parts;
  if (!USER_ID.test(userId) || !/^\d{9,11}$/.test(expiresText)) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(key, `${userId}.${expiresText}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  if (Number(expiresText) * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, userId };
}

// The gym's check-out code (printed in its QR as "JUSTFIT-OUT-<code>"; QR codes printed before the
// rename say "EATO-OUT-<code>" and still work): 12 characters people can
// read back (no 0/O or 1/I)
const CHECKOUT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCheckoutCode() {
  return Array.from(crypto.randomBytes(12), (b) => CHECKOUT_ALPHABET[b % CHECKOUT_ALPHABET.length]).join("");
}
const checkoutQrText = (code) => `JUSTFIT-OUT-${code}`;
// The code inside a scanned check-out QR, or null
function readCheckoutQr(text) {
  if (typeof text !== "string") return null;
  const match = /^(?:JUSTFIT|EATO)-OUT-([A-HJ-NP-Z2-9]{12})$/.exec(text.trim().toUpperCase());
  return match ? match[1] : null;
}

module.exports = { LIFETIME_SECONDS, deriveKey, issuePass, readPass, newCheckoutCode, checkoutQrText, readCheckoutQr };
