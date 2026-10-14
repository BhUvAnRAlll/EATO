// Per-user rate limiting for the authenticated routes.
//
// Keyed by the Clerk user id that the token verifier produced, never by anything the
// client sends. The counters live in this process's memory: they are per process, are not
// shared between instances, and reset whenever the process restarts. That is enough to
// stop one account from hammering the AI upload route on the single server in use today;
// a multi-instance deployment would need a shared store instead.

// The budgets. Uploads are expensive (an OpenAI vision call each), everything else is cheap.
const rateLimits = {
  upload: { limit: 10, windowMs: 10 * 60 * 1000 },
  standard: { limit: 60, windowMs: 60 * 1000 },
};

// Sliding window: the timestamps of the last `limit` requests per key. A request is
// allowed when fewer than `limit` requests happened in the last `windowMs`.
function createRateLimiter({ limit, windowMs }) {
  if (!Number.isInteger(limit) || limit < 1 || !(windowMs > 0)) throw new Error("rate limit rule must have limit >= 1 and windowMs > 0");
  const hits = new Map();
  let lastSweep = 0;

  // Forget keys whose window has fully passed, so idle accounts don't accumulate
  const sweep = (now) => {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const [key, times] of hits) if (times.length === 0 || times[times.length - 1] <= now - windowMs) hits.delete(key);
  };

  return {
    // Records one request for `key` and says whether it is within the budget
    check(key, now = Date.now()) {
      sweep(now);
      const since = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((time) => time > since);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
      }
      recent.push(now);
      hits.set(key, recent);
      return { ok: true, remaining: limit - recent.length };
    },
    // Keys currently tracked (for tests and diagnostics)
    size: () => hits.size,
  };
}

// The one message every route sends with a 429
const tooManyRequestsMessage = (retryAfterSeconds) =>
  `Too many requests. Please try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`;

// Middleware for a route that already ran requireUser. Keys the budget by the verified
// Clerk user id on req.userId. If that id is missing (the middleware was put in front of a
// route without requireUser), it fails closed with the same 401 requireUser sends, and no
// bucket is created or consumed: nothing is ever keyed by "undefined".
function limitPerUser(limiter) {
  return (req, res, next) => {
    const userId = req.userId;
    if (typeof userId !== "string" || userId.trim() === "") {
      return res.status(401).json({ error: "Please sign in again." });
    }
    const budget = limiter.check(userId);
    if (budget.ok) return next();
    res.set("Retry-After", String(budget.retryAfterSeconds));
    res.status(429).json({ error: tooManyRequestsMessage(budget.retryAfterSeconds) });
  };
}

module.exports = { rateLimits, createRateLimiter, tooManyRequestsMessage, limitPerUser };
