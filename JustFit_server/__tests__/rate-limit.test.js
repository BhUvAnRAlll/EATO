// rateLimit.js: the sliding-window limiter and the Express middleware around it.
// No server, no database, no network.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { createRateLimiter, limitPerUser, rateLimits, tooManyRequestsMessage } = require("../rateLimit.js");

describe("rate limiter (sliding window, per key)", () => {
  it("allows up to the limit inside the window, then refuses with a retry delay", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 10_000 });
    assert.deepEqual(limiter.check("user_a", 1_000), { ok: true, remaining: 2 });
    assert.deepEqual(limiter.check("user_a", 2_000), { ok: true, remaining: 1 });
    assert.deepEqual(limiter.check("user_a", 3_000), { ok: true, remaining: 0 });
    // The oldest hit was at 1 000 ms, so the window frees up at 11 000 ms: 8 s from now
    assert.deepEqual(limiter.check("user_a", 3_000), { ok: false, retryAfterSeconds: 8 });
    assert.deepEqual(limiter.check("user_a", 10_999), { ok: false, retryAfterSeconds: 1 });
  });

  it("refused requests do not extend the window (no lock-out by retrying)", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1_000 });
    limiter.check("k", 0);
    limiter.check("k", 100);
    for (let t = 200; t < 1_000; t += 100) assert.equal(limiter.check("k", t).ok, false);
    assert.equal(limiter.check("k", 1_001).ok, true, "the first hit has left the window");
  });

  it("keys are independent", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    assert.equal(limiter.check("user_a", 0).ok, true);
    assert.equal(limiter.check("user_a", 1).ok, false);
    assert.equal(limiter.check("user_b", 1).ok, true, "another user keeps their own budget");
    assert.equal(limiter.check("user_a", 1_001).ok, true);
  });

  it("retryAfterSeconds is at least 1 and rounds up", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_500 });
    limiter.check("k", 0);
    assert.deepEqual(limiter.check("k", 1_400), { ok: false, retryAfterSeconds: 1 });
    assert.deepEqual(limiter.check("k", 100), { ok: false, retryAfterSeconds: 2 });
  });

  it("forgets idle keys once their window has passed (memory does not grow forever)", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 1_000 });
    for (let i = 0; i < 100; i++) limiter.check(`user_${i}`, 0);
    assert.equal(limiter.size(), 100);
    limiter.check("user_new", 2_500); // a later request triggers the sweep
    assert.equal(limiter.size(), 1);
  });

  it("rejects a nonsensical rule", () => {
    assert.throws(() => createRateLimiter({ limit: 0, windowMs: 1_000 }));
    assert.throws(() => createRateLimiter({ limit: 1, windowMs: 0 }));
  });

  it("the shipped budgets are sane: uploads are much scarcer than ordinary calls", () => {
    assert.ok(rateLimits.upload.limit < rateLimits.standard.limit);
    assert.ok(rateLimits.upload.windowMs > rateLimits.standard.windowMs);
    assert.equal(tooManyRequestsMessage(1), "Too many requests. Please try again in 1 second.");
    assert.equal(tooManyRequestsMessage(30), "Too many requests. Please try again in 30 seconds.");
  });
});

// A minimal Express-style response that records what was sent
function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.set = (name, value) => { res.headers[name.toLowerCase()] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}
const runMiddleware = (middleware, req) => {
  const res = fakeRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
};

describe("limitPerUser", () => {
  it("fails closed when there is no verified user id: 401 in the usual format, no bucket touched", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const middleware = limitPerUser(limiter);
    for (const req of [{}, { userId: undefined }, { userId: null }, { userId: "" }, { userId: "   " }, { userId: 42 }]) {
      const { res, nextCalled } = runMiddleware(middleware, req);
      assert.equal(nextCalled, false, `request ${JSON.stringify(req)} must not reach the route`);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.body, { error: "Please sign in again." });
      assert.equal(res.headers["retry-after"], undefined);
    }
    assert.equal(limiter.size(), 0, "no key may be created for a missing user id");
  });

  it("lets a verified user through until the budget is spent, then answers 429 with Retry-After", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const middleware = limitPerUser(limiter);
    assert.equal(runMiddleware(middleware, { userId: "user_a" }).nextCalled, true);
    assert.equal(runMiddleware(middleware, { userId: "user_a" }).nextCalled, true);
    const { res, nextCalled } = runMiddleware(middleware, { userId: "user_a" });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 429);
    assert.match(res.body.error, /^Too many requests\. Please try again in \d+ seconds?\.$/);
    assert.ok(Number(res.headers["retry-after"]) >= 1);
    // Another verified user has their own budget
    assert.equal(runMiddleware(middleware, { userId: "user_b" }).nextCalled, true);
    assert.equal(limiter.size(), 2);
  });
});
