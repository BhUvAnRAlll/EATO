// Encrypts each gym's Meta access token at rest with AES-256-GCM. The key is WHATSAPP_TOKEN_KEY
// (32 bytes as 64 hex characters, or base64), kept in JustFit_server/.env and never logged. A
// fresh random IV per token; the auth tag makes any tampering fail to decrypt.
const crypto = require("node:crypto");

function keyFrom(value) {
  if (typeof value !== "string" || value === "") throw new Error("WHATSAPP_TOKEN_KEY is missing");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("WHATSAPP_TOKEN_KEY must be 32 bytes");
  return key;
}

function encryptToken(plain, keyValue = process.env.WHATSAPP_TOKEN_KEY) {
  if (typeof plain !== "string" || plain === "") throw new Error("Nothing to encrypt");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFrom(keyValue), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptToken({ ciphertext, iv, tag }, keyValue = process.env.WHATSAPP_TOKEN_KEY) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyFrom(keyValue), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

module.exports = { encryptToken, decryptToken };
