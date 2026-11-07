/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDaysIso, addMonthsIso, latestEndIso, monthsBetween, planEndIso } from "../gymDates.ts";

describe("gym dates", () => {
  it("adds days and whole months like the server", () => {
    assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
    assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28", "kept on a real day");
    assert.equal(addMonthsIso("2024-01-31", 1), "2024-02-29");
  });

  it("ends a period the day before the same date for months, inclusive for days", () => {
    assert.equal(planEndIso("2026-11-07", 1), "2026-12-06");
    assert.equal(planEndIso("2026-01-31", 1), "2026-02-27", "31 Jan + 1 month is 28 Feb, so it ends on the 27th");
    assert.equal(latestEndIso("2026-11-07"), "2028-11-06");
  });

  it("reads the length back from a start and an end date", () => {
    assert.equal(monthsBetween("2026-11-07", "2026-12-06"), 1);
    assert.equal(monthsBetween("2026-11-07", "2027-11-06"), 12);
    assert.equal(monthsBetween("2026-11-07", "2026-11-16"), null, "10 days isn't a whole month");
    assert.equal(monthsBetween("2026-11-07", "2026-11-07"), null, "one day isn't a whole month");
    assert.equal(monthsBetween("2026-11-07", "2027-11-07"), null, "a day past 12 months");
    assert.equal(monthsBetween("2026-11-07", "2026-11-06"), null, "an end before the start");
    assert.equal(monthsBetween("2026-11-07", "2028-11-06"), 24);
    assert.equal(monthsBetween("2026-11-07", "2028-11-07"), null, "past 24 months");
  });
});
