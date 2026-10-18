// The gym owner portal's pure rules: renewal flags, the renewals order, the six-month window,
// and renewal end dates (month lengths and leap years included).
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { renewalFlag, byDaysLeft, lastMonths, renewedEnd } = require("../owner/rules");

describe("owner rules", () => {
  it("flags a package by the days left on it", () => {
    assert.equal(renewalFlag(null), "none");
    assert.equal(renewalFlag(undefined), "none");
    assert.equal(renewalFlag(-1), "expired");
    assert.equal(renewalFlag(0), "this_week");
    assert.equal(renewalFlag(7), "this_week");
    assert.equal(renewalFlag(8), "this_month");
    assert.equal(renewalFlag(30), "this_month");
    assert.equal(renewalFlag(31), "active");
  });

  it("orders renewals: expired first, then soonest to end, members without a package last", () => {
    const row = (name, daysLeft) => ({ member: { name }, daysLeft });
    const sorted = [row("Cara", null), row("Ben", 12), row("Ana", -3), row("Dev", 12), row("Eli", null), row("Fay", 2)].sort(byDaysLeft);
    assert.deepEqual(sorted.map((r) => r.member.name), ["Ana", "Fay", "Ben", "Dev", "Cara", "Eli"]);
  });

  it("lists the last six months oldest first, across a year boundary", () => {
    assert.deepEqual(lastMonths(new Date("2026-02-15T10:00:00Z")), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    assert.deepEqual(lastMonths(new Date("2026-10-18T10:00:00Z"), 3), ["2026-08", "2026-09", "2026-10"]);
  });

  it("extends an active package from its end date and restarts an expired one from today", () => {
    assert.equal(renewedEnd("2026-11-20", "2026-10-18", 1), "2026-12-20");
    assert.equal(renewedEnd("2026-11-20", "2026-10-18", 3), "2027-02-20");
    assert.equal(renewedEnd("2026-09-01", "2026-10-18", 1), "2026-11-18");
    assert.equal(renewedEnd(null, "2026-10-18", 3), "2027-01-18");
    assert.equal(renewedEnd("2026-10-18", "2026-10-18", 1), "2026-11-18", "a package ending today extends from today");
  });

  it("clamps the day to the target month's length", () => {
    assert.equal(renewedEnd("2027-01-31", "2026-10-18", 1), "2027-02-28");
    assert.equal(renewedEnd("2028-01-31", "2026-10-18", 1), "2028-02-29", "leap year");
    assert.equal(renewedEnd("2026-11-30", "2026-10-18", 3), "2027-02-28");
  });
});
