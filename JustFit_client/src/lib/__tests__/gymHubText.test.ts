import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { durationText, monthGrid, monthLabel, pausedTimes, planProgress, timeText } from "../gymHubText.ts";

describe("Gym Hub text", () => {
  it("lays a month out Monday first", () => {
    // November 2026 starts on a Sunday
    const weeks = monthGrid("2026-11");
    assert.deepEqual(weeks[0], [null, null, null, null, null, null, "2026-11-01"]);
    assert.equal(weeks[weeks.length - 1][0], "2026-11-30");
    assert.ok(weeks.every((w) => w.length === 7));
    assert.equal(weeks.flat().filter(Boolean).length, 30);
    assert.equal(monthGrid("2024-02").flat().filter(Boolean).length, 29);
  });

  it("writes months, India's times and durations", () => {
    assert.equal(monthLabel("2026-11"), "November 2026");
    assert.equal(timeText("2026-11-09T00:35:00.000Z"), "6:05 am");
    assert.equal(timeText("2026-11-09T12:30:00.000Z"), "6:00 pm");
    assert.equal(timeText("2026-11-09T18:30:00.000Z"), "12:00 am");
    assert.equal(durationText(40), "40 min");
    assert.equal(durationText(60), "1 h");
    assert.equal(durationText(75), "1 h 15 min");
  });

  it("measures how much of the plan has gone, and counts pauses", () => {
    assert.equal(planProgress("2026-11-01", "2026-12-01", "2026-11-16"), 0.5);
    assert.equal(planProgress("2026-11-01", "2026-12-01", "2027-01-01"), 1);
    assert.equal(planProgress("2026-11-10", "2026-12-01", "2026-11-01"), 0);
    assert.deepEqual([0, 1, 3].map(pausedTimes), ["Never paused", "Paused once", "Paused 3 times"]);
  });
});
