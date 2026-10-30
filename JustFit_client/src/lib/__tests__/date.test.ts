/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatLongDate, greetingFor, dobLimits } from "../date.ts";

describe("date of birth limits", () => {
  it("clamps a February 29 boundary to the last day of February", () => {
    const { maximumDate } = dobLimits(new Date(2024, 1, 29));
    assert.deepEqual(
      [maximumDate.getFullYear(), maximumDate.getMonth(), maximumDate.getDate()],
      [2011, 1, 28],
    );
  });
});
describe("Home greeting", () => {
  it("says morning until noon, afternoon until 5 pm, evening after", () => {
    const at = (hour: number) => new Date(2026, 9, 26, hour, 30);
    assert.deepEqual([0, 11, 12, 16, 17, 23].map((hour) => greetingFor(at(hour))), [
      "Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening",
    ]);
  });

  it("writes the date with the weekday and year", () => {
    assert.equal(formatLongDate(new Date(2026, 9, 26)), "Mon, 26 Oct 2026");
  });
});
