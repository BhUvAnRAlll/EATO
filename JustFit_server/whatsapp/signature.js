// Meta signs each webhook POST: X-Hub-Signature-256 is "sha256=" + the HMAC-SHA256 of the raw
// request body with the app secret. Checked over the exact bytes received, in constant time.
const crypto = require("node:crypto");

function validSignature(rawBody, header, appSecret) {
  if (!Buffer.isBuffer(rawBody) || typeof header !== "string" || typeof appSecret !== "string" || appSecret === "") return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(match[1], "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// The GET handshake when the webhook is registered: echo the challenge only for our token
function verifyHandshake(query, verifyToken) {
  if (typeof verifyToken !== "string" || verifyToken === "") return null;
  if (query["hub.mode"] !== "subscribe" || typeof query["hub.verify_token"] !== "string") return null;
  const a = Buffer.from(query["hub.verify_token"]);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const challenge = query["hub.challenge"];
  return typeof challenge === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(challenge) ? challenge : null;
}

module.exports = { validSignature, verifyHandshake };
