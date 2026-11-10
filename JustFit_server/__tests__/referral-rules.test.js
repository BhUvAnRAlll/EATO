const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const rules = require("../referrals/rules");

describe("referral rules", () => {
  it("makes codes without look-alike letters", () => {
    for (let i = 0; i < 50; i++) {
      assert.match(rules.referralCode(), /^JF[A-HJ-NP-Z2-9]{6}$/);
      assert.match(rules.couponCode(), /^R[A-HJ-NP-Z2-9]{7}$/);
    }
  });
  it("reads a claim body strictly", () => {
    assert.deepEqual(rules.claimBody({ code: " jfab23cd " }), { code: "JFAB23CD" });
    for (const bad of [null, [], {}, { code: 5 }, { code: "AB" }, { code: "JF' OR 1=1" }, { code: "JFAB23CD", extra: 1 }]) assert.throws(() => rules.claimBody(bad));
  });
  it("says why a code can't be used", () => {
    const ok = { self: false, referrerRole: "user", ageDays: 3, orders: 0, claimed: false };
    assert.equal(rules.claimProblem(ok), null);
    assert.match(rules.claimProblem({ ...ok, self: true }), /own code/);
    assert.match(rules.claimProblem({ ...ok, referrerRole: "admin" }), /isn't valid/);
    assert.match(rules.claimProblem({ ...ok, claimed: true }), /already/);
    assert.match(rules.claimProblem({ ...ok, orders: 1 }), /first order/);
    assert.match(rules.claimProblem({ ...ok, ageDays: 31 }), /first 30 days/);
  });
  it("writes the share text with the code and the reward", () => {
    assert.match(rules.shareText("JFAB23CD"), /JFAB23CD.*₹50 off.*₹149/);
  });
});
