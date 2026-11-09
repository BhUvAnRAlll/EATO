// Super Admin › the gym platform (Gym Hub ecosystem, section 7): analytics periods, the staff
// directory's filters, suspension and ownership-transfer bodies and refusals, and the chart series
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../admin/platformRules");
const { addDays } = require("../gym/rules");

describe("Admin platform rules", () => {
  it("takes 7, 30 or 90 days and the directory's filters", () => {
    assert.deepEqual(rules.analyticsQuery({}), { days: 30 });
    assert.deepEqual(rules.analyticsQuery({ days: "7" }), { days: 7 });
    assert.throws(() => rules.analyticsQuery({ days: "365" }), /7, 30 or 90/);
    assert.deepEqual(rules.staffQuery({ role: "trainer", search: "  Forma  " }), { role: "trainer", search: "Forma", page: 1 });
    assert.throws(() => rules.staffQuery({ role: "boss" }), /Pick/);
    assert.throws(() => rules.staffQuery({ page: "0" }), /page/);
  });

  it("needs a reason to suspend, and never an admin or yourself", () => {
    assert.deepEqual(rules.suspendBody({ reason: "Shared their login." }), { reason: "Shared their login." });
    assert.throws(() => rules.suspendBody({ reason: "x" }), /Say why/);
    assert.throws(() => rules.suspendBody({ reason: "Shared their login.", role: "admin" }), /fields/);
    assert.equal(rules.suspendProblem({ id: "u1", role: "user" }, "a1"), null);
    assert.match(rules.suspendProblem({ id: "a1", role: "admin" }, "a1"), /own account/);
    assert.match(rules.suspendProblem({ id: "a2", role: "admin" }, "a1"), /admin/);
    assert.match(rules.suspendProblem(null, "a1"), /doesn't exist/);
  });

  it("moves a gym only to a member or gym admin of the same gym, with a reason", () => {
    assert.deepEqual(rules.transferBody({ phone: "98450 12345", reason: "The gym was sold." }), { phone: "9845012345", reason: "The gym was sold." });
    assert.throws(() => rules.transferBody({ phone: "98450 12345" }), /Say why/);
    assert.equal(rules.transferProblem({ role: "user" }, [], 5), null);
    assert.equal(rules.transferProblem({ role: "gym_admin" }, [{ brandId: 5 }], 5), null, "Staff of the same gym can take it over");
    assert.match(rules.transferProblem({ role: "gym_admin" }, [{ brandId: 6 }], 5), /another gym/);
    assert.match(rules.transferProblem({ role: "trainer" }, [], 5), /trainer/);
    assert.match(rules.transferProblem({ role: "admin" }, [], 5), /admin/);
    assert.match(rules.transferProblem(null, [], 5), /signed in/);
  });

  it("fills every day of the period, empty days as zero", () => {
    const s = rules.series([{ day: "2026-11-09", n: "3" }], "2026-11-10", 3, addDays);
    assert.deepEqual(s, [{ date: "2026-11-08", value: 0 }, { date: "2026-11-09", value: 3 }, { date: "2026-11-10", value: 0 }]);
  });
});
