// A small in-memory cache for AI answers that are safe to reuse: the same question with the same
// facts gets the same answer. Keys are hashes of everything the answer depends on, so an edit to
// the facts simply misses. Nothing personal to
// one member goes in here (the coach's replies and plans are never cached), and entries expire.
//
// Per process, like the rate limits: enough for the single server in use today.
const crypto = require("node:crypto");

const MAX_ENTRIES = 500;

function createResponseCache({ ttlMs, maxEntries = MAX_ENTRIES } = {}) {
  const entries = new Map(); // key → { value, expires }
  const get = (key, now = Date.now()) => {
    const hit = entries.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now) {
      entries.delete(key);
      return undefined;
    }
    entries.delete(key); // re-insert so the most recently used entry is last
    entries.set(key, hit);
    return hit.value;
  };
  const set = (key, value, now = Date.now()) => {
    if (!(ttlMs > 0)) return;
    entries.delete(key);
    entries.set(key, { value, expires: now + ttlMs });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value); // the oldest
  };
  return { get, set, size: () => entries.size, clear: () => entries.clear() };
}

/** A stable key from the parts an answer depends on (strings, objects, numbers) */
const keyOf = (...parts) => crypto.createHash("sha256").update(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p) ?? "")).join("\u0000")).digest("hex");

// "  What ARE your Timings?? " → "what are your timings": the same question in different clothes
const normalizeQuestion = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

// The server's one cache, sized from the environment (AI_CACHE, AI_CACHE_TTL_MINUTES) the first
// time it is used; a disabled cache is one whose entries expire at once
let sharedInstance = null;
function shared(env = process.env) {
  if (!sharedInstance) {
    const { cacheEnabled, cacheTtlMs } = require("./rules").limitsConfig(env);
    sharedInstance = createResponseCache({ ttlMs: cacheEnabled ? cacheTtlMs : 0 });
  }
  return sharedInstance;
}

module.exports = { createResponseCache, keyOf, normalizeQuestion, shared };
