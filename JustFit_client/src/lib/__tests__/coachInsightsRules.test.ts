// AI Coach › Insights: how the week's dates and weight changes read on the tab.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changeIsGood, daysBetween, kgChange, shortDay, weekdayLetter, weekRange } from "../coachInsightsRules.ts";

describe("coach insights formatting", () => {
  it("shows a week inside one month and across two", () => {
    assert.equal(weekRange("2026-11-02", "2026-11-08"), "2 – 8 Nov");
    assert.equal(weekRange("2026-10-26", "2026-11-01"), "26 Oct – 1 Nov");
  });

  it("names days the same in every time zone", () => {
    assert.equal(weekdayLetter("2026-11-02"), "M");
    assert.equal(weekdayLetter("2026-11-08"), "S");
    assert.equal(shortDay("2026-11-02"), "2 Nov");
    assert.equal(daysBetween("2026-10-20", "2026-11-02"), 13);
  });

  it("writes a weight change with its sign, and no change plainly", () => {
    assert.equal(kgChange(-1.25), "−1.3 kg");
    assert.equal(kgChange(0.4), "+0.4 kg");
    assert.equal(kgChange(0), "No change");
  });

  it("judges a change only against the member's own goal", () => {
    assert.equal(changeIsGood(-1, "lose"), true);
    assert.equal(changeIsGood(1, "lose"), false);
    assert.equal(changeIsGood(0.5, "gain"), true);
    assert.equal(changeIsGood(0.3, "maintain"), true);
    assert.equal(changeIsGood(2, "maintain"), false);
    assert.equal(changeIsGood(-1, null), null);
    assert.equal(changeIsGood(0, "lose"), null);
  });
});
