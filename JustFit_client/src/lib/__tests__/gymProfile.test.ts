import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DAYS, FACILITIES, SECTIONS, TIME_SLOTS, closureDateText, copyToAll, customProblem, dayText, hoursProblem, makeCover, movePhoto, nextSession, publishStateText, sameHours, sessionsProblem, stampText, startingHours, timeLabel, type OpeningHours } from "../gymProfile.ts";

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

describe("Gym Profile Management helpers (2026-11-09)", () => {
  it("lists the ten sections the server knows, once each", () => {
    assert.deepEqual(SECTIONS.map((s) => s.id), ["photos", "about", "facilities", "hours", "address", "contact", "links", "plans", "pt", "trainers"]);
  });

  it("names the publishing states", () => {
    assert.equal(publishStateText("draft").label, "Draft");
    assert.equal(publishStateText("published").label, "Published");
    assert.equal(publishStateText("changed").label, "Changes not published");
  });

  it("writes times in India's time: today, yesterday or the date", () => {
    const now = Date.parse("2026-11-09T12:00:00Z"); // 5:30 pm in India
    assert.equal(stampText("2026-11-09T10:35:00Z", now), "Today, 4:05 pm");
    assert.equal(stampText("2026-11-08T03:30:00Z", now), "Yesterday, 9 am");
    assert.equal(stampText("2026-11-03T13:00:00Z", now), "3 Nov 2026, 6:30 pm");
    // 11 pm UTC on the 8th is already the 9th in India
    assert.equal(stampText("2026-11-08T23:00:00Z", now), "Today, 4:30 am");
  });

  it("checks a facility of the gym's own", () => {
    assert.equal(customProblem("  Boxing   ring ", []), null);
    assert.match(customProblem("P", []) ?? "", /2 to 40/);
    assert.match(customProblem("parking", []) ?? "", /already on the list/);
    assert.match(customProblem("boxing ring", [{ name: "Boxing ring", on: true }]) ?? "", /already added/);
    assert.equal(customProblem("Boxing Ring", [{ name: "Boxing ring", on: true }], 0), null);
  });

  it("moves photos and makes the cover", () => {
    assert.deepEqual(movePhoto([1, 2, 3], 2, -1), [2, 1, 3]);
    assert.deepEqual(movePhoto([1, 2, 3], 3, 1), [1, 2, 3]);
    assert.deepEqual(movePhoto([1, 2, 3], 9, 1), [1, 2, 3]);
    assert.deepEqual(makeCover([1, 2, 3], 3), [3, 1, 2]);
    assert.deepEqual(makeCover([1, 2, 3], 9), [1, 2, 3]);
  });

  it("writes a closure's date", () => {
    assert.equal(closureDateText("2026-12-25"), "Fri 25 Dec");
  });
});

