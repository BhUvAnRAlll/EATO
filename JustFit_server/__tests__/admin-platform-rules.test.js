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

describe("gym report exports", () => {
  it("defaults to the gyms report as Excel and refuses anything else", () => {
    assert.deepEqual(rules.reportQuery({}), { kind: "gyms", format: "xlsx" });
    assert.deepEqual(rules.reportQuery({ kind: "staff", format: "csv" }), { kind: "staff", format: "csv" });
    assert.throws(() => rules.reportQuery({ kind: "members" }), /gyms or the staff/);
    assert.throws(() => rules.reportQuery({ format: "pdf" }), /Excel or CSV/);
    assert.throws(() => rules.reportQuery({ kind: "gyms", table: "users" }), /fields we don't use/);
    assert.throws(() => rules.reportQuery({ kind: ["gyms"] }), /gyms or the staff/);
  });

  it("neutralises formulas and quotes commas and quotes in CSV", () => {
    assert.equal(rules.csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(rules.csvCell("+91"), "'+91");
    assert.equal(rules.csvCell('Forma, "Gold"'), '"Forma, ""Gold"""');
    assert.equal(rules.csvCell(null), "");
    assert.equal(rules.csvCell(12), "12");
    const csv = rules.toCsv(["A", "B"], [["x", 1]]);
    assert.ok(csv.startsWith("﻿A,B\nx,1"));
  });

  it("turns a branch into a row: live only when approved and published", () => {
    const base = { brand: "Forma", branch: "Tumkur", area: "BH Road", city: "Tumakuru", state: "Karnataka", added_on: "2026-11-01", memberships: "4", active: "3", visits: "20", team: "2" };
    assert.deepEqual(rules.gymRow({ ...base, status: "approved", published: 1, featured: 1 }), ["Forma", "Tumkur", "BH Road", "Tumakuru", "Karnataka", "Approved", "Yes", "Yes", "2026-11-01", 4, 3, 20, 2]);
    assert.equal(rules.gymRow({ ...base, status: "approved", published: 0, featured: 0 })[6], "No");
    assert.equal(rules.gymRow({ ...base, status: "suspended", published: 1 })[6], "No");
    assert.equal(rules.gymRow({ ...base, status: "pending_review", published: 1 })[5], "In review");
    assert.equal(rules.gymRow(base).length, rules.GYM_HEADER.length);
  });

  it("turns a team member into a row", () => {
    const row = rules.staffRow({ name: null, phone: "******3210", roleLabel: "Trainer", gym: { name: "Forma", branch: "Tumkur", city: "Tumakuru" }, addedOn: "2026-11-02", suspended: true });
    assert.deepEqual(row, ["No name yet", "******3210", "Trainer", "Forma", "Tumkur", "Tumakuru", "2026-11-02", "Yes"]);
    assert.equal(row.length, rules.STAFF_HEADER.length);
  });
});
