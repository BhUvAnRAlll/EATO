// Stops the same paid AI request from running twice at once. When a second identical request
// arrives while the first is still waiting on the model (a double tap, two screens loading, a
// retried connection), it is given the first one's promise instead of a second call. Nothing is
// kept once the call ends: this is not a cache.
const crypto = require("node:crypto");

function createDeduplicator() {
  const inFlight = new Map(); // key → promise
  return {
    // Runs `work` for `key`, or joins the run already in progress for the same key
    run(key, work) {
      const running = inFlight.get(key);
      if (running) return running;
      const promise = Promise.resolve()
        .then(work)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
    size: () => inFlight.size,
  };
}

/** A key from a feature, the member and what they asked (the content is hashed, never kept) */
const requestKey = (feature, userId, ...content) =>
  `${feature}:${userId ?? "-"}:${crypto.createHash("sha256").update(content.map((c) => (typeof c === "string" ? c : JSON.stringify(c) ?? "")).join("\u0000")).digest("hex").slice(0, 32)}`;

const shared = createDeduplicator();

module.exports = { createDeduplicator, requestKey, shared };
