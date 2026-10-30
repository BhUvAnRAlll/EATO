// Phone sign-in, the pure parts: phone numbers, codes and their hashes, the send limits, the
// SMS providers (with a stubbed fetch: nothing is ever sent), the session token shape, and the
// order in which a new code replaces the old one (with a fake database connection).
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { normalizePhone, toE164 } = require("../auth/phone");
const otp = require("../auth/otp");
const { createSmsProvider, SmsError } = require("../auth/sms");
const sessions = require("../auth/sessions");
const { newUserId, requestOtp } = require("../auth/service");
const { devLoginConfig, weakCode } = require("../auth/devLogin");

const SECRET = "a-test-secret-that-is-long-enough-1234567890";

describe("phone numbers", () => {
  it("accepts the ways people type an Indian mobile number and keeps the 10 digits", () => {
    for (const typed of ["9876543210", "98765 43210", "98765-43210", "+919876543210", "+91 98765 43210", "919876543210", "09876543210", " 9876543210 "]) {
      assert.equal(normalizePhone(typed), "9876543210", typed);
    }
    assert.equal(toE164("9876543210"), "+919876543210");
  });

  it("refuses anything else with one friendly line", () => {
    const bad = ["", "12345", "98765432", "98765432101", "5876543210", "0876543210", "+1 9876543210", "+92 9876543210",
      "98765abcde", "9876543210; DROP TABLE users", "' OR '1'='1", "9".repeat(21), null, undefined, 9876543210, ["9876543210"], { phone: "9876543210" }];
    for (const value of bad) assert.throws(() => normalizePhone(value), (e) => e.status === 400 && /10-digit mobile number/.test(e.message), String(value));
    assert.equal(toE164("123"), null);
  });
});

describe("sign-in codes", () => {
  it("are 6 digits from the secure random source, spread over the whole range", () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const code = otp.generateCode();
      assert.match(code, /^[0-9]{6}$/);
      seen.add(code);
    }
    assert.ok(seen.size > 1990, "codes should almost never repeat");
  });

  it("are stored only as an HMAC bound to their challenge and checked in constant time", () => {
    const key = otp.deriveOtpKey(SECRET);
    const hash = otp.hashCode(key, "challenge-a", "123456");
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(!hash.includes("123456"));
    assert.equal(otp.codeMatches(key, "challenge-a", "123456", hash), true);
    assert.equal(otp.codeMatches(key, "challenge-a", "123457", hash), false, "a wrong code");
    assert.equal(otp.codeMatches(key, "challenge-b", "123456", hash), false, "the right code for another challenge");
    assert.equal(otp.codeMatches(otp.deriveOtpKey(SECRET + "x"), "challenge-a", "123456", hash), false, "another secret");
    for (const odd of ["12345", "1234567", "abcdef", "", null, 123456]) assert.equal(otp.codeMatches(key, "challenge-a", odd, hash), false, String(odd));
    assert.equal(otp.codeMatches(key, "challenge-a", "123456", "not-a-hash"), false);
  });

  it("need an AUTH_SECRET of at least 32 characters", () => {
    for (const secret of [undefined, "", "short", "x".repeat(31)]) assert.throws(() => otp.deriveOtpKey(secret), /AUTH_SECRET/);
    assert.equal(otp.deriveOtpKey(SECRET).length, 32);
  });
});

describe("send limits", () => {
  const config = otp.otpConfig({});

  it("have the approved defaults: 5 minutes, 5 tries, 60 s cooldown, 5 an hour, 10 a day", () => {
    assert.equal(config.ttlSeconds, 300);
    assert.equal(config.maxAttempts, 5);
    assert.equal(config.cooldownSeconds, 60);
    assert.equal(config.perHour, 5);
    assert.equal(config.perDay, 10);
  });

  it("can be tuned from the environment within bounds, but not expiry or attempts", () => {
    const tuned = otp.otpConfig({ OTP_COOLDOWN_SECONDS: "0", OTP_PER_HOUR: "50", OTP_IP_REQUEST_LIMIT: "3" });
    assert.equal(tuned.cooldownSeconds, 0);
    assert.equal(tuned.perHour, 50);
    assert.equal(tuned.ipRequestLimit, 3);
    assert.equal(otp.otpConfig({ OTP_TTL_SECONDS: "99999", OTP_MAX_ATTEMPTS: "1000" }).ttlSeconds, 300, "expiry is fixed");
    for (const bad of [{ OTP_PER_HOUR: "0" }, { OTP_PER_DAY: "-1" }, { OTP_COOLDOWN_SECONDS: "1.5" }, { OTP_DAILY_SMS_CAP: "lots" }]) assert.throws(() => otp.otpConfig(bad));
  });

  it("enforce the cooldown, then the daily and hourly counts", () => {
    const fresh = { sinceLastSeconds: null, lastHour: 0, lastDay: 0, hourResetSeconds: null, dayResetSeconds: null };
    assert.deepEqual(otp.sendAllowed(config, fresh), { ok: true });
    assert.deepEqual(otp.sendAllowed(config, { ...fresh, sinceLastSeconds: 20, lastHour: 1, lastDay: 1 }), { ok: false, retryAfterSeconds: 40 });
    assert.deepEqual(otp.sendAllowed(config, { ...fresh, sinceLastSeconds: 61, lastHour: 1, lastDay: 1 }), { ok: true });
    assert.deepEqual(otp.sendAllowed(config, { ...fresh, sinceLastSeconds: 600, lastHour: 5, lastDay: 5, hourResetSeconds: 1200 }), { ok: false, retryAfterSeconds: 1200 });
    assert.deepEqual(otp.sendAllowed(config, { ...fresh, sinceLastSeconds: 600, lastHour: 0, lastDay: 10, dayResetSeconds: 5000 }), { ok: false, retryAfterSeconds: 5000 });
  });
});

describe("SMS providers", () => {
  it("default to off, which sends nothing", async () => {
    const sms = createSmsProvider({});
    assert.equal(sms.enabled, false);
    await assert.rejects(sms.sendOtp("9876543210", "123456"), (e) => e instanceof SmsError && e.reason === "off");
    assert.throws(() => createSmsProvider({ SMS_PROVIDER: "twilio" }), /SMS_PROVIDER/);
  });

  it("refuse the fake provider outside the test database", () => {
    const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "justfit-sms-unit-"));
    try {
      assert.throws(() => createSmsProvider({ SMS_PROVIDER: "fake", SMS_FAKE_OUTBOX: outbox, NODE_ENV: "development", DB_NAME: "eato_test" }), /only allowed in tests/);
      assert.throws(() => createSmsProvider({ SMS_PROVIDER: "fake", SMS_FAKE_OUTBOX: outbox, NODE_ENV: "test", DB_NAME: "eato" }), /only allowed in tests/);
      assert.throws(() => createSmsProvider({ SMS_PROVIDER: "fake", SMS_FAKE_OUTBOX: "relative/dir", NODE_ENV: "test", DB_NAME: "eato_test" }), /SMS_FAKE_OUTBOX/);
      assert.equal(createSmsProvider({ SMS_PROVIDER: "fake", SMS_FAKE_OUTBOX: outbox, NODE_ENV: "test", DB_NAME: "eato_test" }).enabled, true);
    } finally {
      fs.rmSync(outbox, { recursive: true, force: true });
    }
  });

  const FAST2SMS = { SMS_PROVIDER: "fast2sms", FAST2SMS_API_KEY: "test-key-not-real", FAST2SMS_ROUTE: "dlt", FAST2SMS_SENDER_ID: "JSTFIT", FAST2SMS_TEMPLATE_ID: "123456" };
  const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  it("Fast2SMS: refuses incomplete settings at startup", () => {
    assert.throws(() => createSmsProvider({ ...FAST2SMS, FAST2SMS_API_KEY: "" }), /FAST2SMS_API_KEY/);
    assert.throws(() => createSmsProvider({ ...FAST2SMS, FAST2SMS_SENDER_ID: "ab" }), /FAST2SMS_SENDER_ID/);
    assert.throws(() => createSmsProvider({ ...FAST2SMS, FAST2SMS_TEMPLATE_ID: "x1" }), /FAST2SMS_TEMPLATE_ID/);
    assert.throws(() => createSmsProvider({ ...FAST2SMS, FAST2SMS_ROUTE: "q" }), /FAST2SMS_ROUTE/);
    assert.throws(() => createSmsProvider({ ...FAST2SMS, FAST2SMS_ROUTE: "otp" }), /FAST2SMS_OTP_ID/);
  });

  it("Fast2SMS DLT route: sends the documented request with the key in the header", async () => {
    let sent;
    const sms = createSmsProvider(FAST2SMS, { fetchImpl: async (url, init) => { sent = { url, init }; return reply(200, { return: true, request_id: "r1" })(); } });
    await sms.sendOtp("9876543210", "042917");
    assert.equal(sent.url, "https://www.fast2sms.com/dev/bulkV2");
    assert.equal(sent.init.method, "POST");
    assert.equal(sent.init.headers.authorization, "test-key-not-real");
    assert.deepEqual(JSON.parse(sent.init.body), { route: "dlt", sender_id: "JSTFIT", message: "123456", variables_values: "042917", numbers: "9876543210" });
    assert.ok(sent.init.signal, "every call has a timeout");
  });

  it("Fast2SMS OTP route: sends our own code (Fast2SMS never generates or checks it)", async () => {
    let body;
    const sms = createSmsProvider({ ...FAST2SMS, FAST2SMS_ROUTE: "otp", FAST2SMS_OTP_ID: "tpl_1" }, { fetchImpl: async (url, init) => { body = JSON.parse(init.body); return reply(200, { return: true })(); } });
    await sms.sendOtp("9876543210", "042917");
    assert.deepEqual(body, { mobile: "9876543210", otp_id: "tpl_1", otp: "042917", otp_length: 6, otp_expiry: 5 });
  });

  it("Fast2SMS errors and timeouts become an SmsError with only the provider's code: no phone, code or key", async () => {
    const cases = [
      [reply(400, { return: false, status_code: 416, message: "You don't have sufficient wallet balance" }), "416"],
      [reply(401, { return: false, status_code: 412, message: "Invalid Authentication" }), "412"],
      [reply(400, { return: false, status_code: 995, message: "Spamming detected" }), "995"],
      [reply(200, { return: false }), "200"],
      [async () => { throw Object.assign(new Error("boom"), { name: "TimeoutError" }); }, "timeout"],
      [async () => { throw new TypeError("fetch failed: getaddrinfo ENOTFOUND"); }, "network"],
    ];
    for (const [fetchImpl, reason] of cases) {
      const sms = createSmsProvider(FAST2SMS, { fetchImpl });
      const error = await sms.sendOtp("9876543210", "042917").catch((e) => e);
      assert.ok(error instanceof SmsError);
      assert.equal(error.reason, reason);
      for (const secret of ["9876543210", "042917", "test-key-not-real"]) assert.ok(!`${error.message} ${error.reason}`.includes(secret), `${reason}: ${secret} must not appear`);
    }
  });

  it("Fast2SMS: a provider that never answers is cut off by the timeout", async () => {
    const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    const sms = createSmsProvider(FAST2SMS, { fetchImpl: hang, timeoutMs: 50 });
    const error = await sms.sendOtp("9876543210", "042917").catch((e) => e);
    assert.equal(error.reason, "timeout");
  });
});

describe("session tokens and ids", () => {
  it("tokens are 256 random bits with a prefix; only a SHA-256 is stored", () => {
    const a = sessions.newToken();
    const b = sessions.newToken();
    assert.match(a, sessions.TOKEN);
    assert.notEqual(a, b);
    assert.match(sessions.hashToken(a), /^[0-9a-f]{64}$/);
    assert.notEqual(sessions.hashToken(a), sessions.hashToken(b));
  });

  it("malformed tokens are rejected before any database lookup", async () => {
    const pool = { query: async () => { throw new Error("must not be called"); } };
    for (const token of ["", "Bearer x", "jfs_short", "x".repeat(47), sessions.newToken() + "x", null, 42]) {
      assert.equal(await sessions.findSession(pool, token), null);
    }
  });

  it("new user ids keep the user_ shape the validators and passes accept", () => {
    const ids = new Set(Array.from({ length: 500 }, newUserId));
    assert.equal(ids.size, 500);
    for (const id of ids) assert.match(id, /^user_[A-Za-z0-9]{24}$/);
  });
});

describe("replacing a code (fake database connection, nothing sent)", () => {
  const config = otp.otpConfig({});
  const otpKey = otp.deriveOtpKey(SECRET);

  // Records every statement in order; `failOn` makes the matching statement throw
  function fakePool({ failOn = null } = {}) {
    const log = [];
    const conn = {
      async query(sql) {
        const step = /GET_LOCK/.test(sql) ? "lock"
          : /RELEASE_LOCK/.test(sql) ? "unlock"
          : /^SELECT TIMESTAMPDIFF/.test(sql.trim()) ? "history"
          : /SELECT COUNT\(\*\) AS n FROM otp_challenges/.test(sql) ? "daily cap"
          : /^INSERT INTO otp_challenges/.test(sql) ? "insert pending"
          : /'superseded'/.test(sql) ? "supersede others"
          : /SET status = 'sent'/.test(sql) ? "mark sent"
          : /SET status = 'failed'/.test(sql) ? "mark failed"
          : sql;
        log.push(step);
        if (failOn === step) throw Object.assign(new Error("database went away"), { code: "PROTOCOL_CONNECTION_LOST" });
        if (step === "lock") return [[{ got: 1 }]];
        if (step === "history") return [[{ since_last: null, last_hour: 0, last_day: 0, hour_reset: null, day_reset: null }]];
        if (step === "daily cap") return [[{ n: 0 }]];
        return [{ affectedRows: 1 }];
      },
      async beginTransaction() { log.push("begin"); },
      async commit() { log.push("commit"); },
      async rollback() { log.push("rollback"); },
      release() { log.push("release"); },
    };
    return { log, pool: { getConnection: async () => conn } };
  }
  const sender = (log, { fail = false } = {}) => ({
    enabled: true,
    async sendOtp() {
      log.push("send");
      if (fail === "timeout") throw new SmsError("timeout");
      if (fail) throw new SmsError("fake-failure");
    },
  });

  it("the earlier codes stop working only after the provider accepted the new one, in one transaction", async () => {
    const { log, pool } = fakePool();
    await requestOtp(pool, "9876543210", { sms: sender(log), otpKey, config });
    assert.deepEqual(log, ["lock", "history", "daily cap", "insert pending", "send", "begin", "supersede others", "mark sent", "commit", "unlock", "release"]);
  });

  for (const fail of [true, "timeout"]) {
    it(`a ${fail === "timeout" ? "timed-out" : "failed"} send leaves the previous code alone: only the new one is marked failed`, async () => {
      const { log, pool } = fakePool();
      await assert.rejects(requestOtp(pool, "9876543210", { sms: sender(log, { fail }), otpKey, config }), (error) => error.status === 503);
      assert.deepEqual(log, ["lock", "history", "daily cap", "insert pending", "send", "mark failed", "unlock", "release"]);
      assert.ok(!log.includes("supersede others"), "the previous code still works");
    });
  }

  it("a failed send whose 'failed' mark can't be written still answers 503 (the row stays pending, which sign-in never accepts)", async () => {
    const { log, pool } = fakePool({ failOn: "mark failed" });
    await assert.rejects(requestOtp(pool, "9876543210", { sms: sender(log, { fail: true }), otpKey, config }), (error) => error.status === 503);
    assert.ok(!log.includes("supersede others"));
    assert.deepEqual(log.slice(-2), ["unlock", "release"], "the lock and the connection are given back");
  });

  it("the development number: the fixed code is stored (as its hash) and no SMS is sent, even with SMS off; other numbers still need SMS", async () => {
    const devLogin = { phone: "9876500001", code: "480317" };
    const { log, pool } = fakePool();
    const off = { enabled: false, async sendOtp() { log.push("send"); } };
    await requestOtp(pool, devLogin.phone, { sms: off, otpKey, config, devLogin });
    assert.deepEqual(log, ["lock", "history", "daily cap", "insert pending", "begin", "supersede others", "mark sent", "commit", "unlock", "release"], "same steps, minus the SMS");
    const other = fakePool();
    await assert.rejects(requestOtp(other.pool, "9876500002", { sms: off, otpKey, config, devLogin }), (error) => error.status === 503);
    assert.deepEqual(other.log, [], "another number is refused before anything is written");
  });

  for (const failOn of ["supersede others", "mark sent"]) {
    it(`a database failure at "${failOn}" after the send rolls both changes back (the previous code still works, the new one stays pending)`, async () => {
      const { log, pool } = fakePool({ failOn });
      await assert.rejects(requestOtp(pool, "9876543210", { sms: sender(log), otpKey, config }), /database went away/);
      assert.ok(log.includes("rollback") && !log.includes("commit"), log.join(", "));
      assert.deepEqual(log.slice(-2), ["unlock", "release"]);
    });
  }
});

describe("the development sign-in code (auth/devLogin.js)", () => {
  const good = { DEV_LOGIN_PHONE: "9876500001", DEV_LOGIN_CODE: "480317" };

  it("is off unless both settings are given", () => {
    assert.equal(devLoginConfig({ NODE_ENV: "production", DB_NAME: "eato" }), null);
    assert.equal(devLoginConfig({}), null);
  });

  it("works only with NODE_ENV=development on eato, or in tests on eato_test", () => {
    assert.deepEqual(devLoginConfig({ ...good, NODE_ENV: "development", DB_NAME: "eato" }), { phone: "9876500001", code: "480317" });
    assert.deepEqual(devLoginConfig({ ...good, NODE_ENV: "test", DB_NAME: "eato_test" }), { phone: "9876500001", code: "480317" });
    for (const where of [
      { NODE_ENV: "production", DB_NAME: "eato" },
      { DB_NAME: "eato" }, // NODE_ENV forgotten: refused, not assumed to be development
      { NODE_ENV: "development", DB_NAME: "eato_test" },
      { NODE_ENV: "test", DB_NAME: "eato" },
      { NODE_ENV: "development", DB_NAME: "justfit_prod" },
      { NODE_ENV: "Development", DB_NAME: "eato" },
    ]) {
      assert.throws(() => devLoginConfig({ ...good, ...where }), /only allowed with NODE_ENV=development/, JSON.stringify(where));
    }
    assert.throws(() => devLoginConfig({ DEV_LOGIN_PHONE: "9876500001", NODE_ENV: "production", DB_NAME: "eato" }), /only allowed/, "half a setting is refused too");
  });

  it("refuses a bad number, a code that isn't 6 digits, or one anyone would guess, and never echoes them", () => {
    const dev = { NODE_ENV: "development", DB_NAME: "eato" };
    for (const [setting, message] of [
      [{ DEV_LOGIN_PHONE: "12345" }, /10-digit/], [{ DEV_LOGIN_PHONE: "5876500001" }, /10-digit/], [{ DEV_LOGIN_PHONE: "' OR 1=1 --" }, /10-digit/],
      [{ DEV_LOGIN_CODE: "48031" }, /6 digits/], [{ DEV_LOGIN_CODE: "48031a" }, /6 digits/], [{ DEV_LOGIN_CODE: "" }, /6 digits/],
      [{ DEV_LOGIN_CODE: "123456" }, /too easy/], [{ DEV_LOGIN_CODE: "000000" }, /too easy/], [{ DEV_LOGIN_CODE: "987654" }, /too easy/],
    ]) {
      assert.throws(() => devLoginConfig({ ...good, ...dev, ...setting }), message, JSON.stringify(setting));
    }
    try { devLoginConfig({ ...good, NODE_ENV: "production", DB_NAME: "eato" }); } catch (error) {
      assert.ok(!error.message.includes(good.DEV_LOGIN_PHONE) && !error.message.includes(good.DEV_LOGIN_CODE));
    }
    assert.equal(weakCode("480317"), false);
    assert.equal(weakCode("111111"), true);
  });
});
