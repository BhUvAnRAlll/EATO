import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hoursFrom, hoursLine, hoursProblem, hoursToForm, loadText, parsePincodes } from "../kitchenRules.ts";

describe("kitchen rules", () => {
  it("turns one time and closed days into a week, and back", () => {
    const hours = hoursFrom("06:00", "22:00", ["sun"]);
    assert.deepEqual(hours.mon, [["06:00", "22:00"]]);
    assert.deepEqual(hours.sun, []);
    assert.deepEqual(hoursToForm(hours), { opens: "06:00", closes: "22:00", closed: ["sun"] });
    assert.deepEqual(hoursToForm(null), { opens: "06:00", closes: "22:00", closed: [] });
  });

  it("says why hours can't be saved", () => {
    assert.equal(hoursProblem("06:00", "22:00", []), null);
    assert.match(hoursProblem("6", "22:00", []) ?? "", /like 06:00/);
    assert.match(hoursProblem("22:00", "06:00", []) ?? "", /open before/);
    assert.match(hoursProblem("06:00", "22:00", ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) ?? "", /at least one day/);
  });

  it("reads pincodes typed with commas or spaces", () => {
    assert.deepEqual(parsePincodes("560095, 560034 560095"), ["560034", "560095"]);
    assert.equal(parsePincodes(""), null);
    assert.equal(parsePincodes("560095, 5600"), null);
    assert.equal(parsePincodes("060095"), null);
  });

  it("writes the hours and the load", () => {
    assert.equal(hoursLine(hoursFrom("06:00", "22:30", [])), "Every day 6:00 am – 10:30 pm");
    assert.equal(hoursLine(hoursFrom("12:00", "23:00", ["sat", "sun"])), "12:00 pm – 11:00 pm · closed Sat, Sun");
    assert.equal(loadText(62), "62% of today's capacity");
    assert.equal(loadText(null), null);
  });
});
