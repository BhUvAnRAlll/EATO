const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../gym/memberHubRules");

describe("Gym Hub membership page rules", () => {
  it("takes this month by default, or a month in the last 24", () => {
    assert.deepEqual(rules.hubQuery({}, "2026-11-09"), { month: "2026-11" });
    assert.deepEqual(rules.hubQuery({ month: "2024-11" }, "2026-11-09"), { month: "2024-11" });
    for (const [month, message] of [["2024-10", /last 24 months/], ["2026-12", /hasn't started/], ["2026-13", /like 2026-11/], ["11-2026", /like 2026-11/], [["2026-11"], /like 2026-11/], ["2026-11' OR 1=1", /like 2026-11/]]) {
      assert.throws(() => rules.hubQuery({ month }, "2026-11-09"), message);
    }
    assert.throws(() => rules.hubQuery({ month: "2026-11", memberId: "2" }, "2026-11-09"), /fields we don't use/);
  });

  it("gives a month's days and the months either side within the range", () => {
    assert.deepEqual(rules.monthBounds("2026-02", "2026-11-09"), { from: "2026-02-01", to: "2026-02-28", days: 28, previous: "2026-01", next: "2026-03" });
    assert.equal(rules.monthBounds("2024-02", "2026-11-09").to, "2024-02-29", "a leap year");
    assert.equal(rules.monthBounds("2026-11", "2026-11-09").next, null);
    assert.equal(rules.monthBounds("2024-11", "2026-11-09").previous, null);
    assert.equal(rules.monthBounds("2025-12", "2026-11-09").next, "2026-01");
  });

  it("puts two visits on one day together, in date order", () => {
    assert.deepEqual(
      rules.calendarDays([
        { date: "2026-11-05", durationMin: 60 },
        { date: "2026-11-02", durationMin: null },
        { date: "2026-11-05", durationMin: 30 },
      ]),
      [{ date: "2026-11-02", visits: 1, minutes: 0 }, { date: "2026-11-05", visits: 2, minutes: 90 }],
    );
  });
});
