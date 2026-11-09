import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DAYS, FACILITIES, TIME_SLOTS, copyToAll, dayText, hoursProblem, nextSession, sameHours, sessionsProblem, startingHours, timeLabel, type OpeningHours } from "../gymProfile.ts";

describe("Gym public profile helpers", () => {
  it("lists every facility and day once", () => {
    assert.equal(new Set(FACILITIES.map((f) => f.id)).size, FACILITIES.length);
    assert.deepEqual(DAYS.map((d) => d.id), ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  });

  it("offers half hours from 4 am to 11:30 pm", () => {
    assert.equal(TIME_SLOTS[0], "04:00");
    assert.equal(TIME_SLOTS[1], "04:30");
    assert.equal(TIME_SLOTS.at(-1), "23:30");
    assert.equal(TIME_SLOTS.length, 40);
  });

  it("writes times and days in words", () => {
    assert.equal(timeLabel("05:30"), "5:30 am");
    assert.equal(timeLabel("12:00"), "12 pm");
    assert.equal(timeLabel("00:00"), "12 am");
    assert.equal(timeLabel("22:00"), "10 pm");
    assert.equal(dayText([]), "Closed");
    assert.equal(dayText([["05:30", "11:00"], ["16:00", "22:00"]]), "5:30 am – 11 am, 4 pm – 10 pm");
  });

  it("checks sessions as the server does", () => {
    assert.equal(sessionsProblem([["05:30", "11:00"], ["16:00", "22:00"]]), null);
    assert.match(sessionsProblem([["11:00", "05:30"]]) ?? "", /open before/);
    assert.match(sessionsProblem([["05:00", "12:00"], ["11:00", "20:00"]]) ?? "", /after the first/);
    assert.match(sessionsProblem([["05:00", "06:00"], ["07:00", "08:00"], ["09:00", "10:00"]]) ?? "", /up to 2/);
    const week = startingHours();
    assert.equal(hoursProblem(week), null);
    assert.equal(hoursProblem({ ...week, wed: [["10:00", "09:00"]] }), "Wednesday: Each session must open before it closes.");
  });

  it("copies one day to the week, and suggests a second session", () => {
    const week: OpeningHours = { ...startingHours(), mon: [["06:00", "09:00"]] };
    const copied = copyToAll(week, "mon");
    assert.ok(DAYS.every((d) => sameHours({ ...copied, [d.id]: copied.mon } as OpeningHours, copied)));
    copied.tue[0][0] = "07:00";
    assert.equal(copied.mon[0][0], "06:00", "each day gets its own copy");
    assert.deepEqual(nextSession([]), ["06:00", "10:00"]);
    assert.deepEqual(nextSession([["05:30", "10:30"]]), ["11:30", "14:30"]);
    assert.deepEqual(nextSession([["05:30", "22:00"]]), ["22:00", "23:30"]);
    assert.equal(sessionsProblem([["05:30", "21:00"], nextSession([["05:30", "21:00"]])]), null);
  });
});
