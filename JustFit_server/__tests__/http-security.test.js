// Response headers and the cross-origin policy (httpSecurity.js), and the security log lines
// (logging.js): pure functions, no database.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { securityHeaders, corsOptions } = require("../httpSecurity.js");
const { logSecurityEvent, maskPhone } = require("../logging.js");

// A minimal Express-like response: res.set(object) and res.set(name, value)
function fakeResponse() {
  const headers = {};
  return {
    headers,
    set(name, value) {
      if (typeof name === "object") Object.assign(headers, name);
      else headers[name] = value;
      return this;
    },
  };
}

describe("security headers", () => {
  it("every answer says nosniff, no framing, no script, no referrer, no caching", () => {
    const res = fakeResponse();
    let called = false;
    securityHeaders({ secure: false }, res, () => (called = true));
    assert.equal(called, true, "passes the request on");
    assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
    assert.equal(res.headers["X-Frame-Options"], "DENY");
    assert.match(res.headers["Content-Security-Policy"], /default-src 'none'/);
    assert.match(res.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
    assert.equal(res.headers["Referrer-Policy"], "no-referrer");
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.equal(res.headers["Strict-Transport-Security"], undefined, "no HSTS over plain HTTP (a developer's Mac)");
  });

  it("over HTTPS the browser is told to stay on HTTPS for a year", () => {
    const res = fakeResponse();
    securityHeaders({ secure: true }, res, () => {});
    assert.equal(res.headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  });
});

describe("cross-origin policy", () => {
  it("development and tests: any origin, so Expo web on any local port works", () => {
    assert.equal(corsOptions({ NODE_ENV: "development" }).origin, true);
    assert.equal(corsOptions({ NODE_ENV: "test" }).origin, true);
    assert.equal(corsOptions({}).origin, true);
  });

  it("production without a list: no browser origin at all (the native app is unaffected)", () => {
    assert.equal(corsOptions({ NODE_ENV: "production" }).origin, false);
  });

  it("CORS_ORIGINS lists exactly the allowed origins, trimmed, without trailing slashes", () => {
    const options = corsOptions({ NODE_ENV: "production", CORS_ORIGINS: " https://admin.example.com/, http://localhost:8081 ,, " });
    assert.deepEqual(options.origin, ["https://admin.example.com", "http://localhost:8081"]);
  });

  it("never allows credentials, and only the headers and methods the app uses", () => {
    const options = corsOptions({ NODE_ENV: "production" });
    assert.equal(options.credentials, false);
    assert.deepEqual(options.allowedHeaders, ["Authorization", "Content-Type"]);
    assert.ok(options.methods.includes("DELETE") && !options.methods.includes("OPTIONS"));
  });

  it("refuses an entry that is not an origin", () => {
    assert.throws(() => corsOptions({ CORS_ORIGINS: "https://admin.example.com/portal" }), /CORS_ORIGINS must be origins/);
    assert.throws(() => corsOptions({ CORS_ORIGINS: "*" }), /CORS_ORIGINS must be origins/);
    assert.throws(() => corsOptions({ CORS_ORIGINS: "admin.example.com" }), /CORS_ORIGINS must be origins/);
  });
});

describe("security log", () => {
  it("masks a phone number down to its last 4 digits", () => {
    assert.equal(maskPhone("+919113956439"), "+91******6439");
    assert.equal(maskPhone("9113956439"), "911***6439");
    assert.equal(maskPhone(undefined), "unknown");
    assert.equal(maskPhone("12"), "unknown");
  });

  it("writes one JSON line with the event name and the safe details", () => {
    const lines = [];
    const original = console.warn;
    console.warn = (line) => lines.push(line);
    try {
      logSecurityEvent("otp.locked", { phone: "+91******6439", ip: "10.0.0.5" });
    } finally {
      console.warn = original;
    }
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.security, "otp.locked");
    assert.equal(entry.phone, "+91******6439");
    assert.equal(entry.ip, "10.0.0.5");
    assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T/);
  });
});
