// Member passes and check-out codes: a pass reads back only when it is well formed, signed with
// the same key and not yet expired; tampering, other keys and junk are all "invalid".
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const passes = require("../owner/passes");

const key = passes.deriveKey("sk_test_this_is_a_long_enough_secret");
const otherKey = passes.deriveKey("sk_test_a_completely_different_secret");
const USER = "user_2abcDEF345ghiJKL";
const NOW = Date.UTC(2026, 9, 19, 9, 0, 0);

describe("member passes", () => {
  it("reads back a fresh pass as its member", () => {
    const { pass, expiresAt } = passes.issuePass(key, USER, NOW);
    assert.match(pass, /^EATO1\.user_[A-Za-z0-9]+\.\d+\.[A-Za-z0-9_-]+$/);
    assert.equal(new Date(expiresAt).getTime(), NOW + passes.LIFETIME_SECONDS * 1000);
    assert.deepEqual(passes.readPass(key, pass, NOW + 1000), { ok: true, userId: USER });
    assert.deepEqual(passes.readPass(key, `  ${pass}\n`, NOW), { ok: true, userId: USER }, "surrounding spaces are ignored");
  });

  it("expires after two minutes", () => {
    const { pass } = passes.issuePass(key, USER, NOW);
    assert.equal(passes.readPass(key, pass, NOW + 119_000).ok, true);
    assert.deepEqual(passes.readPass(key, pass, NOW + 121_000), { ok: false, reason: "expired" });
  });

  it("refuses a pass signed with another key, or with any part changed", () => {
    const { pass } = passes.issuePass(key, USER, NOW);
    assert.deepEqual(passes.readPass(otherKey, pass, NOW), { ok: false, reason: "invalid" });
    const [prefix, user, expires, signature] = pass.split(".");
    const tampered = [
      [prefix, "user_2abcDEF345ghiJKX", expires, signature].join("."), // someone else's id
      [prefix, user, String(Number(expires) + 3600), signature].join("."), // a later expiry
      [prefix, user, expires, signature.slice(0, -2) + (signature.endsWith("AA") ? "BB" : "AA")].join("."),
      ["EATO2", user, expires, signature].join("."),
    ];
    for (const code of tampered) assert.deepEqual(passes.readPass(key, code, NOW), { ok: false, reason: "invalid" }, code);
  });

  it("refuses junk, injection attempts and the wrong types", () => {
    for (const code of ["", "hello", "EATO1", "EATO1.a.b.c", "EATO1.user_x.1.sig", "' OR 1=1 --", "EATO-OUT-ABCDEFGHJKLM", "x".repeat(500), null, 42, {}]) {
      assert.deepEqual(passes.readPass(key, code, NOW), { ok: false, reason: "invalid" }, String(code));
    }
  });

  it("only issues passes for real member ids, and needs a real secret", () => {
    assert.throws(() => passes.issuePass(key, "not-a-user", NOW));
    assert.throws(() => passes.deriveKey("short"));
    assert.throws(() => passes.deriveKey(undefined));
  });
});

describe("check-out codes", () => {
  it("makes readable 12-character codes and reads them back from a scanned QR", () => {
    const code = passes.newCheckoutCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);
    assert.notEqual(passes.newCheckoutCode(), code);
    assert.equal(passes.readCheckoutQr(passes.checkoutQrText(code)), code);
    assert.equal(passes.readCheckoutQr(` eato-out-${code.toLowerCase()} `), code, "case and spaces don't matter");
  });

  it("refuses anything else", () => {
    for (const text of ["", "EATO-OUT-", "EATO-OUT-ABC", "EATO-OUT-ABCDEFGHJKL0", "EATO1.user_x.1.s", "https://example.com", null, 7]) {
      assert.equal(passes.readCheckoutQr(text), null, String(text));
    }
  });
});
