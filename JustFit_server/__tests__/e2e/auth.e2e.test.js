// Phone sign-in end to end: the real Express server (index.js) on the test port, the justfit_test
// database, and the fake SMS provider (codes land in a throwaway outbox folder; nothing is
// sent). Time is moved by editing justfit_test rows (created_at, expires_at), never by waiting.
//
//   yarn test:e2e      (needs JustFit_server/.env.test; otherwise every test is skipped)
const assert = require("node:assert/strict");
const { describe, it, before, after } = require("node:test");
const crypto = require("node:crypto");

const db = require("./test-db.js");
const { startTestServer } = require("./server.js");
const { identitiesFor, randomPhone } = require("./test-identities.js");
const nutrition = require("../../../JustFit_client/src/lib/nutrition/index.ts");

// A profile save exactly like the targets screen's (for the profile-complete check)
const inputs = { age: 30, gender: "female", heightCm: 165, weightKg: 60, activityLevel: "lightly_active", fitnessGoal: "maintenance", healthFlags: [] };
const birth = new Date(); birth.setFullYear(birth.getFullYear() - inputs.age);
const pad = (n) => String(n).padStart(2, "0");
const profile = {
  fullName: "Phone Member", dob: `${pad(birth.getDate())}/${pad(birth.getMonth() + 1)}/${birth.getFullYear()}`, gender: "female", phone: "9000000002", email: "", goal: "maintenance",
  heightCm: "165", weightKg: "60", bodyFatPercent: "", age: "30", activity: "lightly_active", healthFlags: [], diet: "vegan",
  cuisines: ["South Indian"], dislikes: "", allergies: "", workoutFrequency: "3-4", workoutType: "home", workoutTime: "evening", mealsPerDay: "3",
};
const record = nutrition.createTargetRecord(inputs, nutrition.calculateTargets(inputs));
// The production defaults (auth/otp.js), set explicitly because the harness relaxes them
const LIMITS = { OTP_COOLDOWN_SECONDS: "60", OTP_PER_HOUR: "5", OTP_PER_DAY: "10", OTP_DAILY_SMS_CAP: "500" };

describe("phone sign-in e2e: request and verify codes, sessions, roles", () => {
  const runId = crypto.randomBytes(4).toString("hex");
  let skipReason = null;
  let env, connection, server, testAccounts;

  const call = async (base, method, path, { token, body, raw } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || raw !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${base}${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    let json = null;
    try { json = await response.json(); } catch { /* non-JSON body */ }
    return { status: response.status, json, retryAfter: response.headers.get("retry-after") };
  };
  const api = (method, path, options) => call(server.baseUrl, method, path, options);
  const requestCode = (phone, base = server.baseUrl) => call(base, "POST", "/api/auth/request-otp", { body: { phone } });
  const verify = (phone, code) => api("POST", "/api/auth/verify-otp", { body: { phone, code } });
  const challenges = async (phone) => (await connection.query("SELECT id, status, attempts, code_hash FROM otp_challenges WHERE phone = ? ORDER BY created_at", [phone]))[0];
  // "Time passes" for a number: its codes become older than the cooldown (and the hour if asked)
  const age = (phone, seconds) => connection.query("UPDATE otp_challenges SET created_at = created_at - INTERVAL ? SECOND WHERE phone = ?", [seconds, phone]);
  // Every code the fake provider "sent", so test 16 can check none of them reached a log
  const seenCodes = new Set();
  const codeFor = (phone) => { const code = server.readCode(phone); if (code) seenCodes.add(code); return code; };
  const wrongCode = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");
  // Signs a fresh number in; returns { phone, token, user }
  const signIn = async (phone = randomPhone()) => {
    assert.equal((await requestCode(phone)).status, 200);
    const verified = await verify(phone, codeFor(phone));
    assert.equal(verified.status, 200, JSON.stringify(verified.json));
    return { phone, token: verified.json.token, user: verified.json.user };
  };

  before(async () => {
    const loaded = db.loadTestEnv();
    if (!loaded.ok) { skipReason = loaded.reason; return; }
    env = loaded.env;
    try { connection = await db.connect(env); } catch (error) { skipReason = `test database unreachable (${error?.code ?? "refused"})`; return; }
    assert.equal(await db.resetSchema(connection), db.SCHEMA_TABLE_COUNT, "schema.sql should create every table in justfit_test");
    testAccounts = identitiesFor(env);
    // The production limits per number (the harness relaxes them for other tests), with
    // generous per-IP budgets (every request comes from 127.0.0.1); test 17 checks those
    server = await startTestServer({ ...env, ...LIMITS, OTP_IP_REQUEST_LIMIT: "500", OTP_IP_VERIFY_LIMIT: "500" });
  });

  after(async () => {
    if (server) await server.stop();
    if (connection) {
      await connection.query("DELETE FROM auth_sessions");
      await connection.query("DELETE FROM otp_challenges");
      await connection.end();
    }
  });

  const run = (fn) => async (t) => { if (skipReason) return t.skip(skipReason); await fn(); };

  it("1. request-otp refuses bad bodies and bad numbers with one friendly line (400/413), and writes nothing", run(async () => {
    const bad = [
      { body: {} }, { body: { phone: "12345" } }, { body: { phone: "5876543210" } }, { body: { phone: 9876543210 } },
      { body: { phone: "9876543210", role: "admin" } }, { body: { phone: "9876543210'; DROP TABLE users; --" } },
      { body: { phone: "' OR '1'='1" } }, { body: ["9876543210"] }, { raw: "{not json" },
    ];
    for (const options of bad) {
      const response = await api("POST", "/api/auth/request-otp", options);
      assert.equal(response.status, 400, JSON.stringify(options));
      assert.equal(typeof response.json.error, "string");
    }
    assert.equal((await api("POST", "/api/auth/request-otp", { raw: JSON.stringify({ phone: "9876543210", pad: "x".repeat(2000) }) })).status, 413);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM otp_challenges");
    assert.equal(n, 0);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM users"))[0][0].n, 0);
  }));

  it("2. a new number: the code arrives, verifies once, and makes one member account with no email", run(async () => {
    const phone = randomPhone();
    const sent = await requestCode(`+91 ${phone.slice(0, 5)} ${phone.slice(5)}`);
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.json, { sent: true, retryAfterSeconds: 60, expiresInSeconds: 300 });
    const code = codeFor(phone);
    assert.match(code, /^[0-9]{6}$/);
    const [challenge] = await challenges(phone);
    assert.equal(challenge.status, "sent");
    assert.match(challenge.code_hash, /^[0-9a-f]{64}$/);
    assert.ok(!challenge.code_hash.includes(code), "only a keyed hash is stored");

    const verified = await verify(phone, code);
    assert.equal(verified.status, 200);
    assert.match(verified.json.token, /^jfs_[A-Za-z0-9_-]{43}$/);
    const { user } = verified.json;
    assert.match(user.id, /^user_[A-Za-z0-9]{24}$/);
    assert.deepEqual({ ...user, id: undefined }, { id: undefined, phone: `+91${phone}`, email: null, fullName: null, role: "user", profileComplete: false, isNew: true });
    const [[row]] = await connection.query("SELECT email, phone, role, phone_verified_at IS NOT NULL AS verified FROM users WHERE id = ?", [user.id]);
    assert.deepEqual({ ...row, verified: Boolean(row.verified) }, { email: null, phone, role: "user", verified: true });
    assert.equal((await challenges(phone))[0].status, "consumed");
    // The session works on existing routes, and only the hash of the token is stored
    assert.equal((await api("GET", "/api/profile", { token: verified.json.token })).status, 200);
    const [[stored]] = await connection.query("SELECT token_hash FROM auth_sessions WHERE user_id = ?", [user.id]);
    assert.equal(stored.token_hash, crypto.createHash("sha256").update(verified.json.token).digest("hex"));
    // The same code can't be used again
    const replay = await verify(phone, code);
    assert.equal(replay.status, 400);
    assert.match(replay.json.error, /expired/);
  }));

  it("3. the same number later signs in to the same account (no duplicate)", run(async () => {
    const first = await signIn();
    await age(first.phone, 120);
    const again = await signIn(first.phone);
    assert.equal(again.user.id, first.user.id);
    assert.equal(again.user.isNew, false);
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM users WHERE phone = ?", [first.phone]);
    assert.equal(n, 1);
    assert.equal((await api("GET", "/api/auth/me", { token: first.token })).status, 200, "the first device stays signed in");
  }));

  it("4. the answer to request-otp is the same for a new number and an existing account (no enumeration)", run(async () => {
    const existing = await signIn();
    await age(existing.phone, 120);
    const forExisting = await requestCode(existing.phone);
    const forNew = await requestCode(randomPhone());
    assert.equal(forExisting.status, forNew.status);
    assert.deepEqual(forExisting.json, forNew.json);
  }));

  it("5. wrong codes count; the 5th locks the code, after which even the right one is refused", run(async () => {
    const phone = randomPhone();
    await requestCode(phone);
    const code = codeFor(phone);
    for (let i = 1; i <= 4; i++) {
      const wrong = await verify(phone, wrongCode(code));
      assert.equal(wrong.status, 400);
      assert.match(wrong.json.error, new RegExp(`${5 - i} tr(y|ies) left`));
    }
    const fifth = await verify(phone, wrongCode(code));
    assert.equal(fifth.status, 429);
    assert.equal((await challenges(phone))[0].status, "locked");
    assert.equal((await verify(phone, code)).status, 429, "a locked code never signs in");
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM users WHERE phone = ?", [phone]))[0][0].n, 0);
    // A new code (after the cooldown) works
    await age(phone, 120);
    assert.equal((await requestCode(phone)).status, 200);
    assert.equal((await verify(phone, codeFor(phone))).status, 200);
  }));

  it("6. a code expires after 5 minutes", run(async () => {
    const phone = randomPhone();
    await requestCode(phone);
    await connection.query("UPDATE otp_challenges SET expires_at = NOW() - INTERVAL 1 SECOND WHERE phone = ?", [phone]);
    const late = await verify(phone, codeFor(phone));
    assert.equal(late.status, 400);
    assert.match(late.json.error, /expired/);
    const [[{ ttl }]] = await connection.query("SELECT TIMESTAMPDIFF(SECOND, created_at, expires_at + INTERVAL 1 SECOND) AS ttl FROM otp_challenges WHERE phone = ?", [phone]);
    assert.ok(ttl <= 300, "codes are created with a 5-minute life");
  }));

  it("7. a new code replaces the old one: the earlier code stops working", run(async () => {
    const phone = randomPhone();
    await requestCode(phone);
    const oldCode = codeFor(phone);
    await age(phone, 120);
    await requestCode(phone);
    const newCode = codeFor(phone);
    assert.deepEqual((await challenges(phone)).map((c) => c.status), ["superseded", "sent"]);
    if (oldCode !== newCode) assert.equal((await verify(phone, oldCode)).status, 400, "the superseded code is refused");
    assert.equal((await verify(phone, newCode)).status, 200);
  }));

  it("8. ten simultaneous verifies of one right code: exactly one signs in", run(async () => {
    const phone = randomPhone();
    await requestCode(phone);
    const code = codeFor(phone);
    const results = await Promise.all(Array.from({ length: 10 }, () => verify(phone, code)));
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 400));
    const [[{ n }]] = await connection.query("SELECT COUNT(*) AS n FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE u.phone = ?", [phone]);
    assert.equal(n, 1, "one code, one session");
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM users WHERE phone = ?", [phone]))[0][0].n, 1);
  }));

  it("9. five simultaneous code requests for one number: exactly one is sent", run(async () => {
    const phone = randomPhone();
    const results = await Promise.all(Array.from({ length: 5 }, () => requestCode(phone)));
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 429));
    assert.equal((await challenges(phone)).length, 1);
  }));

  it("10. limits per number: a 60 s cooldown, 5 an hour, 10 a day (429 with Retry-After)", run(async () => {
    const phone = randomPhone();
    assert.equal((await requestCode(phone)).status, 200);
    const soon = await requestCode(phone);
    assert.equal(soon.status, 429);
    assert.ok(Number(soon.retryAfter) >= 1 && Number(soon.retryAfter) <= 60, `Retry-After ${soon.retryAfter}`);
    for (let i = 2; i <= 5; i++) { await age(phone, 61); assert.equal((await requestCode(phone)).status, 200, `code ${i} this hour`); }
    await age(phone, 61);
    const sixth = await requestCode(phone);
    assert.equal(sixth.status, 429, "the 6th code in an hour is refused");
    assert.ok(Number(sixth.retryAfter) > 60);
    // An hour later the hourly budget is back, but the day still counts
    for (let i = 6; i <= 10; i++) { await age(phone, 3601); assert.equal((await requestCode(phone)).status, 200, `code ${i} today`); }
    await age(phone, 3601);
    assert.equal((await requestCode(phone)).status, 429, "the 11th code in a day is refused");
  }));

  it("11. an SMS provider failure: 503, the code is marked failed and never works; a later request works", run(async () => {
    const phone = randomPhone();
    server.failSmsTo(phone);
    const failed = await requestCode(phone);
    assert.equal(failed.status, 503);
    assert.match(failed.json.error, /couldn't send/);
    assert.equal(codeFor(phone), null);
    assert.equal((await challenges(phone))[0].status, "failed");
    assert.equal((await verify(phone, "000000")).status, 400);
    server.failSmsTo(phone, false);
    await age(phone, 61);
    assert.equal((await requestCode(phone)).status, 200);
    assert.equal((await verify(phone, codeFor(phone))).status, 200);
  }));

  it("11b. a replacement that can't be sent leaves the previous code working, and only one code is ever live", run(async () => {
    const phone = randomPhone();
    assert.equal((await requestCode(phone)).status, 200);
    const firstCode = codeFor(phone);
    await age(phone, 61);
    server.failSmsTo(phone);
    assert.equal((await requestCode(phone)).status, 503);
    server.failSmsTo(phone, false);
    assert.deepEqual((await challenges(phone)).map((c) => c.status), ["sent", "failed"], "the earlier code was not superseded");
    assert.equal((await verify(phone, firstCode)).status, 200, "the code the member already has still signs in");
  }));

  it("11c. a code whose SMS never completed (left 'pending', as a crash mid-send would) is never accepted", run(async () => {
    const phone = randomPhone();
    assert.equal((await requestCode(phone)).status, 200);
    const code = codeFor(phone);
    await connection.query("UPDATE otp_challenges SET status = 'pending' WHERE phone = ?", [phone]);
    assert.equal((await verify(phone, code)).status, 400);
    assert.equal((await challenges(phone))[0].attempts, 0, "nothing was even counted against it");
  }));

  it("12. sessions: missing, malformed, unknown, revoked and expired tokens are refused; logout and logout-all", run(async () => {
    for (const token of [undefined, "nonsense", `jfs_${"A".repeat(43)}`, "x".repeat(300)]) {
      assert.equal((await api("GET", "/api/auth/me", { token })).status, 401, String(token).slice(0, 20));
    }
    const a = await signIn();
    await age(a.phone, 120);
    const a2 = await signIn(a.phone); // a second device
    const b = await signIn();
    const me = await api("GET", "/api/auth/me", { token: a.token });
    assert.equal(me.status, 200);
    assert.deepEqual(Object.keys(me.json.user).sort(), ["email", "fullName", "id", "phone", "profileComplete", "role"]);

    assert.deepEqual((await api("POST", "/api/auth/logout", { token: a.token })).json, { signedOut: true });
    assert.equal((await api("GET", "/api/auth/me", { token: a.token })).status, 401, "logged out at once");
    assert.equal((await api("GET", "/api/auth/me", { token: a2.token })).status, 200, "the other device stays in");

    const a3 = await (async () => { await age(a.phone, 120); return signIn(a.phone); })();
    const all = await api("POST", "/api/auth/logout-all", { token: a3.token });
    assert.deepEqual(all.json, { signedOut: true, sessions: 2 });
    for (const token of [a2.token, a3.token]) assert.equal((await api("GET", "/api/auth/me", { token })).status, 401);
    assert.equal((await api("GET", "/api/auth/me", { token: b.token })).status, 200, "another account is untouched");

    await connection.query("UPDATE auth_sessions SET expires_at = NOW() - INTERVAL 1 SECOND WHERE user_id = ?", [b.user.id]);
    assert.equal((await api("GET", "/api/auth/me", { token: b.token })).status, 401, "an expired session is refused");
    // A deleted account's sessions end with it
    const c = await signIn();
    await testAccounts.deleteUser(c.user.id);
    assert.equal((await api("GET", "/api/auth/me", { token: c.token })).status, 401);
    assert.equal((await connection.query("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?", [c.user.id]))[0][0].n, 0);
  }));

  it("13. roles: new accounts are members; only the database role (set by an admin) opens admin routes; trainers are gone", run(async () => {
    const m = await signIn();
    assert.equal(m.user.role, "user");
    assert.equal((await api("GET", "/api/admin/promotions", { token: m.token })).status, 403);
    assert.equal((await api("GET", "/api/trainers/me/profile", { token: m.token })).status, 404, "the trainer routes are gone");
    assert.equal((await api("POST", "/api/account-type", { token: m.token })).status, 404, "the self-service role route is gone");
    assert.equal((await api("POST", "/api/auth/verify-otp", { body: { phone: m.phone, code: "123456", role: "admin" } })).status, 400, "a role in the body is refused");
    await testAccounts.setRole(m.user.id, "admin");
    assert.equal((await api("GET", "/api/admin/promotions", { token: m.token })).status, 200, "promoted: works on the next request");
    assert.equal((await api("GET", "/api/auth/me", { token: m.token })).json.user.role, "admin");
    await testAccounts.setRole(m.user.id, "user");
    assert.equal((await api("GET", "/api/admin/promotions", { token: m.token })).status, 403, "demoted: refused at once");
    await assert.rejects(testAccounts.setRole(m.user.id, "trainer"), "the database no longer has a trainer role");
  }));

  it("14. profile-complete: false after sign-in, true after the setup is saved; the verified phone is kept", run(async () => {
    const s = await signIn();
    assert.equal((await api("GET", "/api/auth/me", { token: s.token })).json.user.profileComplete, false);
    const saved = await api("POST", "/api/profile", { token: s.token, body: { profile, nutrition: record } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const me = (await api("GET", "/api/auth/me", { token: s.token })).json.user;
    assert.equal(me.profileComplete, true);
    assert.equal(me.fullName, "Phone Member");
    assert.equal(me.phone, `+91${s.phone}`, "the setup form's phone can't replace the verified one");
    assert.equal(me.email, null, "no email is invented");
  }));

  it("16. the server's logs never hold a phone number, a code or a token", run(async () => {
    const s = await signIn();
    server.failSmsTo(s.phone);
    await age(s.phone, 120);
    await requestCode(s.phone); // a provider failure is logged (its reason only)
    const text = server.logs.join("\n");
    assert.match(text, /Sign-in SMS not sent: fake-failure/);
    assert.ok(!text.includes(s.phone), "no phone number");
    assert.ok(!/jfs_/.test(text), "no session token");
    assert.ok(seenCodes.size > 10, "the file has produced plenty of codes to look for");
    for (const code of seenCodes) assert.ok(!text.includes(code), "no sign-in code");
  }));

  it("17. per-IP budgets and the daily SMS cap, on a server started with small limits", run(async () => {
    await server.stop();
    server = null;
    const [[{ today }]] = await connection.query("SELECT COUNT(*) AS today FROM otp_challenges WHERE created_at > NOW(3) - INTERVAL 1 DAY");
    const small = await startTestServer({ ...env, ...LIMITS, OTP_IP_REQUEST_LIMIT: "3", OTP_IP_VERIFY_LIMIT: "2", OTP_DAILY_SMS_CAP: String(Number(today) + 1) });
    try {
      assert.equal((await requestCode(randomPhone(), small.baseUrl)).status, 200, "one more code fits under the daily cap");
      const capped = await requestCode(randomPhone(), small.baseUrl);
      assert.equal(capped.status, 503, "the daily cap protects the SMS wallet");
      assert.match(capped.json.error, /busy/);
      const third = await requestCode(randomPhone(), small.baseUrl);
      assert.equal(third.status, 503);
      const limited = await requestCode(randomPhone(), small.baseUrl);
      assert.equal(limited.status, 429, "the 4th request from one IP in the window");
      assert.ok(Number(limited.retryAfter) >= 1);
      const forged = await fetch(`${small.baseUrl}/api/auth/request-otp`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9" }, body: JSON.stringify({ phone: randomPhone() }) });
      assert.equal(forged.status, 429, "X-Forwarded-For is ignored unless TRUST_PROXY is set");
      for (let i = 0; i < 2; i++) await call(small.baseUrl, "POST", "/api/auth/verify-otp", { body: { phone: randomPhone(), code: "123456" } });
      assert.equal((await call(small.baseUrl, "POST", "/api/auth/verify-otp", { body: { phone: randomPhone(), code: "123456" } })).status, 429, "verify attempts are budgeted per IP");
    } finally {
      await small.stop();
    }
  }));

  it("18. with SMS_PROVIDER off nothing is sent: phone sign-in answers 503 and writes nothing", run(async () => {
    const off = await startTestServer(env, { sms: "off" });
    try {
      const [[before]] = await connection.query("SELECT COUNT(*) AS n FROM otp_challenges");
      const refused = await requestCode(randomPhone(), off.baseUrl);
      assert.equal(refused.status, 503);
      assert.match(refused.json.error, /isn't available yet/);
      const [[after]] = await connection.query("SELECT COUNT(*) AS n FROM otp_challenges");
      assert.equal(after.n, before.n);
    } finally {
      await off.stop();
    }
  }));

  // The development sign-in code (auth/devLogin.js): a short list of numbers, one fixed code, no SMS
  const DEV_PHONES = [randomPhone(), randomPhone()];
  const DEV = { DEV_LOGIN_PHONE: DEV_PHONES.join(","), DEV_LOGIN_CODE: "480317" };

  it("19. development code: its one number signs in with the fixed code and no SMS, inside the normal limits; other numbers are unaffected", run(async () => {
    const dev = await startTestServer({ ...env, ...LIMITS, ...DEV }, { sms: "off" });
    try {
      const sent = await requestCode(DEV_PHONES[0], dev.baseUrl);
      assert.equal(sent.status, 200, "the development number gets a code although SMS is off");
      assert.equal(dev.readCode(DEV_PHONES[0]), null, "no SMS was sent");
      const [stored] = await challenges(DEV_PHONES[0]);
      assert.equal(stored.status, "sent");
      assert.match(stored.code_hash, /^[0-9a-f]{64}$/, "stored as a hash, like any code");

      assert.equal((await requestCode(DEV_PHONES[0], dev.baseUrl)).status, 429, "the cooldown still applies");
      assert.equal((await requestCode(randomPhone(), dev.baseUrl)).status, 503, "any other number still needs the SMS provider (off here)");

      const wrong = await call(dev.baseUrl, "POST", "/api/auth/verify-otp", { body: { phone: DEV_PHONES[0], code: "480318" } });
      assert.equal(wrong.status, 400, "a wrong code is refused and counted");
      const signedIn = await call(dev.baseUrl, "POST", "/api/auth/verify-otp", { body: { phone: DEV_PHONES[0], code: DEV.DEV_LOGIN_CODE } });
      assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
      assert.equal(signedIn.json.user.role, "user", "a new account from it is a member, like any other");
      const me = await call(dev.baseUrl, "GET", "/api/auth/me", { token: signedIn.json.token });
      assert.equal(me.status, 200);
      assert.equal(me.json.user.phone, `+91${DEV_PHONES[0]}`);
      const again = await call(dev.baseUrl, "POST", "/api/auth/verify-otp", { body: { phone: DEV_PHONES[0], code: DEV.DEV_LOGIN_CODE } });
      assert.equal(again.status, 400, "a code works once, the fixed one too");

      // Five wrong tries still lock it; after that even the fixed code is refused
      await age(DEV_PHONES[0], 61);
      assert.equal((await requestCode(DEV_PHONES[0], dev.baseUrl)).status, 200);
      for (let i = 0; i < 5; i++) await call(dev.baseUrl, "POST", "/api/auth/verify-otp", { body: { phone: DEV_PHONES[0], code: "111112" } });
      assert.equal((await call(dev.baseUrl, "POST", "/api/auth/verify-otp", { body: { phone: DEV_PHONES[0], code: DEV.DEV_LOGIN_CODE } })).status, 429, "locked after 5 wrong tries");

      // The second listed number works the same way, with the same code
      assert.equal((await requestCode(DEV_PHONES[1], dev.baseUrl)).status, 200, "every listed number gets a code without SMS");
      assert.equal(dev.readCode(DEV_PHONES[1]), null);
      const second = await call(dev.baseUrl, "POST", "/api/auth/verify-otp", { body: { phone: DEV_PHONES[1], code: DEV.DEV_LOGIN_CODE } });
      assert.equal(second.status, 200, JSON.stringify(second.json));
      assert.equal(second.json.user.role, "user");

      const logText = dev.logs.join("\n");
      assert.ok(logText.includes("Development sign-in code is ON for 2 numbers"), "the server says the development code is on");
      assert.ok(DEV_PHONES.every((p) => !logText.includes(p)) && !logText.includes(DEV.DEV_LOGIN_CODE), "but never logs the numbers or the code");
    } finally {
      await dev.stop();
    }
  }));

  it("20. development code: the server refuses to start with it in production, without NODE_ENV=development, on the wrong database, or with a weak code", run(async () => {
    const { spawnSync } = require("node:child_process");
    const path = require("node:path");
    const SERVER_DIR = path.join(__dirname, "..", "..");
    const start = (overrides) => spawnSync(process.execPath, [path.join(SERVER_DIR, "index.js")], {
      cwd: SERVER_DIR,
      timeout: 20000,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, PORT: env.PORT,
        DB_HOST: env.DB_HOST, DB_PORT: env.DB_PORT, DB_USER: env.DB_USER, DB_PASSWORD: env.DB_PASSWORD, DB_NAME: env.DB_NAME,
        AUTH_SECRET: crypto.randomBytes(32).toString("base64url"), SMS_PROVIDER: "off",
        ...DEV, ...overrides,
      },
    });
    const cases = [
      [{ NODE_ENV: "production" }, /only allowed with NODE_ENV=development/],
      [{ NODE_ENV: "development" }, /only allowed with NODE_ENV=development/], // development, but on justfit_test
      [{ NODE_ENV: "test", DB_NAME: "justfit" }, /only allowed with NODE_ENV=development/],
      [{ NODE_ENV: "test", DEV_LOGIN_CODE: "123456" }, /too easy to guess/],
      [{ NODE_ENV: "test", DEV_LOGIN_PHONE: "12345" }, /10-digit/],
    ];
    for (const [overrides, expected] of cases) {
      const result = start(overrides);
      assert.notEqual(result.status, 0, `refused to start: ${JSON.stringify(overrides)}`);
      assert.match(result.stderr, expected, JSON.stringify(overrides));
      assert.ok(!result.stderr.includes(DEV.DEV_LOGIN_CODE) && DEV_PHONES.every((p) => !result.stderr.includes(p)), "the error never shows the number or the code");
    }
  }));
});
