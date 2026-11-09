// Membership states and the gym's pause policy (Gym Hub ecosystem, 2026-11-09): what the gym may send,
// which moves are allowed, what an inactive membership is told, and the policy's limits
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/standingRules");

describe("Membership standing rules", () => {
  it("needs a reason to suspend or cancel, none to reactivate", () => {
    assert.deepEqual(rules.standingBody({ standing: "suspended", note: "Fees unpaid for two months." }), { standing: "suspended", note: "Fees unpaid for two months." });
    assert.deepEqual(rules.standingBody({ standing: "active" }), { standing: "active", note: null });
    assert.throws(() => rules.standingBody({ standing: "cancelled" }), /Say why/);
    assert.throws(() => rules.standingBody({ standing: "suspended", note: "no" }), /Say why/);
    assert.throws(() => rules.standingBody({ standing: "banned", note: "Something" }), /Pick/);
    assert.throws(() => rules.standingBody({ standing: "active", memberId: 3 }), /fields/);
    assert.throws(() => rules.standingBody({ standing: "suspended", note: "x".repeat(450) }), /200/);
  });

  it("allows only sensible moves", () => {
    assert.equal(rules.moveProblem("active", "suspended"), null);
    assert.equal(rules.moveProblem("suspended", "cancelled"), null);
    assert.equal(rules.moveProblem("cancelled", "active"), null);
    assert.match(rules.moveProblem("cancelled", "suspended"), /can't/);
    assert.match(rules.moveProblem("active", "active"), /already/);
  });

  it("tells an inactive member why, and an active one nothing", () => {
    assert.equal(rules.inactiveProblem("active", "Forma"), null);
    assert.match(rules.inactiveProblem("suspended", "Forma"), /suspended by Forma/);
    assert.match(rules.inactiveProblem("cancelled", "Forma"), /cancelled by Forma/);
  });

  it("reads and checks the pause policy", () => {
    assert.deepEqual(rules.readPolicy(null), { maxPerYear: null, maxDaysPerYear: null, maxDaysEach: 90 });
    assert.deepEqual(rules.readPolicy('{"maxPerYear":2,"maxDaysPerYear":30,"maxDaysEach":15}'), { maxPerYear: 2, maxDaysPerYear: 30, maxDaysEach: 15 });
    assert.deepEqual(rules.readPolicy({ maxPerYear: 99 }).maxPerYear, null, "out of range reads as no limit");
    assert.deepEqual(rules.policyBody({ maxPerYear: 2, maxDaysPerYear: null }), { maxPerYear: 2, maxDaysPerYear: null });
    assert.throws(() => rules.policyBody({ maxPerYear: 0 }), /1 to 12/);
    assert.throws(() => rules.policyBody({ maxDaysEach: 120 }), /1 to 90/);
    assert.throws(() => rules.policyBody({ maxDaysPerYear: 10, maxDaysEach: 20 }), /longest pause/);
    assert.throws(() => rules.policyBody({}), /at least one/);
    assert.throws(() => rules.policyBody({ gymId: 1 }), /fields/);
  });

  it("works out what is left and refuses a request that breaks the policy", () => {
    const policy = { maxPerYear: 2, maxDaysPerYear: 30, maxDaysEach: 15 };
    assert.deepEqual(rules.eligibility(policy, { count: 1, days: 20 }), { policy, used: { count: 1, days: 20 }, pausesLeft: 1, daysLeft: 10, maxDaysNow: 10 });
    assert.equal(rules.policyProblem(policy, { count: 1, days: 20 }, 10), null);
    assert.match(rules.policyProblem(policy, { count: 1, days: 20 }, 11), /10 pause days left/);
    assert.match(rules.policyProblem(policy, { count: 2, days: 20 }, 1), /allows 2 pauses/);
    assert.match(rules.policyProblem(policy, { count: 0, days: 0 }, 16), /up to 15 days/);
    assert.match(rules.policyProblem(policy, { count: 1, days: 30 }, 1), /30 pause days/);
    const open = rules.readPolicy(null);
    assert.equal(rules.policyProblem(open, { count: 9, days: 300 }, 90), null, "no limits by default");
    assert.equal(rules.eligibility(open, { count: 0, days: 0 }).pausesLeft, null);
  });
});
