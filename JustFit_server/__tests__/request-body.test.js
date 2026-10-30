// requestBody.js: the capped JSON body middleware, driven with an in-memory request
// stream so Content-Length and the actual bytes can disagree on purpose. No server.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { Readable } = require("node:stream");

const { jsonBodyWithLimit } = require("../requestBody.js");

// A request-like stream that delivers `chunks` one at a time and counts how many were read
function fakeReq(chunks, headers = {}) {
  const queue = [...chunks];
  let pulled = 0;
  // highWaterMark 0: chunks are produced only as they are consumed, so `pulled` counts delivery
  const req = new Readable({
    highWaterMark: 0,
    read() {
      const next = queue.shift();
      if (next === undefined) return this.push(null);
      pulled += 1;
      this.push(Buffer.from(next));
    },
  });
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  req.get = (name) => lower[name.toLowerCase()];
  req.pulled = () => pulled;
  return req;
}
function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.set = (name, value) => { res.headers[name.toLowerCase()] = value; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.done?.(); return res; };
  return res;
}
// Runs the middleware and resolves with what happened
function run(req, maxBytes) {
  return new Promise((resolve) => {
    const res = fakeRes();
    res.done = () => resolve({ res, nextCalled: false, body: req.body });
    jsonBodyWithLimit(maxBytes)(req, res, () => resolve({ res, nextCalled: true, body: req.body }));
  });
}

describe("jsonBodyWithLimit: a hard byte cap on the request body", () => {
  it("parses a body under the cap and passes it on", async () => {
    const { nextCalled, body } = await run(fakeReq(["{\"data\":", "\"abc\"}"]), 100);
    assert.equal(nextCalled, true);
    assert.deepEqual(body, { data: "abc" });
  });

  it("refuses a declared Content-Length above the cap without reading a single chunk, and closes the connection", async () => {
    const req = fakeReq(["x".repeat(50)], { "Content-Length": "1000" });
    const { res, nextCalled } = await run(req, 100);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 413);
    assert.equal(res.headers.connection, "close");
    assert.equal(req.pulled(), 0, "no body chunk may be read once the declared size is over the cap");
  });

  it("a missing Content-Length cannot bypass the cap: the stream is stopped soon after twice the cap", async () => {
    const req = fakeReq(Array.from({ length: 10 }, () => "y".repeat(40))); // 400 bytes in 10 chunks
    const { res, nextCalled } = await run(req, 100);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 413);
    assert.ok(req.pulled() >= 3 && req.pulled() <= 7, `reading must stop soon after twice the cap (read ${req.pulled()} of 10 chunks)`);
  });

  it("an understated Content-Length cannot bypass the cap either: actual bytes are what count", async () => {
    const req = fakeReq(Array.from({ length: 10 }, () => "z".repeat(40)), { "content-length": "10" });
    const { res } = await run(req, 100);
    assert.equal(res.statusCode, 413);
  });

  it("a body only a little over the cap is drained to the end, so the client gets the 413 cleanly", async () => {
    const req = fakeReq(["w".repeat(60), "w".repeat(60)]); // 120 bytes, cap 100, within the drain allowance
    const { res } = await run(req, 100);
    assert.equal(res.statusCode, 413);
    assert.equal(req.pulled(), 2, "the whole (slightly oversized) body is read and discarded");
  });

  it("a nonsensical Content-Length is a 400", async () => {
    assert.equal((await run(fakeReq(["{}"], { "content-length": "-5" }), 100)).res.statusCode, 400);
    assert.equal((await run(fakeReq(["{}"], { "content-length": "abc" }), 100)).res.statusCode, 400);
  });

  it("invalid JSON is a 400 that keeps the connection reusable; an empty body is invalid JSON too", async () => {
    const bad = await run(fakeReq(["{not json"]), 100);
    assert.equal(bad.res.statusCode, 400);
    assert.deepEqual(bad.res.body, { error: "The request body isn't valid JSON." });
    assert.equal(bad.res.headers.connection, undefined);
    assert.equal((await run(fakeReq([]), 100)).res.statusCode, 400);
  });

  it("exactly the cap is still accepted; one byte more is not", async () => {
    const exactly100 = '"' + "a".repeat(98) + '"'; // a 100-byte JSON string
    assert.equal((await run(fakeReq([exactly100]), 100)).nextCalled, true);
    assert.equal((await run(fakeReq(["a".repeat(101)]), 100)).res.statusCode, 413);
  });
});
