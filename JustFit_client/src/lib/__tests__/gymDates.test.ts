/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDaysIso, addMonthsIso, latestEndIso, lengthBetween, planEndIso } from "../gymDates.ts";

describe("gym dates", () => {
  it("adds days and whole months like the server", () => {
    assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
    assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28", "kept on a real day");
    assert.equal(addMonthsIso("2024-01-31", 1), "2024-02-29");
  });

  it("ends a period the day before the same date for months, inclusive for days", () => {
    assert.equal(planEndIso("2026-11-07", 1, "months"), "2026-12-06");
    assert.equal(planEndIso("2026-11-07", 10, "days"), "2026-11-16");
    assert.equal(planEndIso("2026-11-07", 1, "days"), "2026-11-07", "one day is the start day");
    assert.equal(latestEndIso("2026-11-07"), "2028-11-06");
  });

  it("reads the length back from a start and an end date", () => {
    assert.deepEqual(lengthBetween("2026-11-07", "2026-12-06"), { unit: "months", duration: 1 });
    assert.deepEqual(lengthBetween("2026-11-07", "2027-11-06"), { unit: "months", duration: 12 });
    assert.deepEqual(lengthBetween("2026-11-07", "2026-11-16"), { unit: "days", duration: 10 });
    assert.deepEqual(lengthBetween("2026-11-07", "2026-11-07"), { unit: "days", duration: 1 });
    assert.deepEqual(lengthBetween("2026-11-07", "2027-11-07"), null, "366 days that aren't whole months");
    assert.deepEqual(lengthBetween("2026-11-07", "2026-11-06"), null, "an end before the start");
    assert.deepEqual(lengthBetween("2026-11-07", "2028-11-06"), { unit: "months", duration: 24 });
    assert.deepEqual(lengthBetween("2026-11-07", "2028-11-07"), null, "past 24 months");
  });
});
