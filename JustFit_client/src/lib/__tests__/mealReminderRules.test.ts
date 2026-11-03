// Meal reminders: one per planned meal still to come today, at its time, never for a logged or
// past meal, with ids that replace instead of duplicating.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { REMINDER_PREFIX, clockLabel, mealReminders } from "../mealReminderRules.ts";

const meal = (id: string, slot: "breakfast" | "lunch" | "evening_snack" | "dinner", time: string, logged = false) => ({ id, slot, name: `${slot} dish`, time, logged, totals: { kcal: 540.4 } });
const day = [meal("b", "breakfast", "08:00", true), meal("l", "lunch", "13:30"), meal("s", "evening_snack", "17:00"), meal("d", "dinner", "20:30")];

describe("mealReminders", () => {
  it("schedules each meal still to come at its time on that day", () => {
    const list = mealReminders(day, "2026-11-02", new Date(2026, 10, 2, 12, 0));
    assert.deepEqual(list.map((r) => r.at.getHours() * 60 + r.at.getMinutes()), [13 * 60 + 30, 17 * 60, 20 * 60 + 30]);
    assert.ok(list.every((r) => r.at.getDate() === 2 && r.at.getMonth() === 10));
  });
  it("skips logged meals and meals already past (or within a minute)", () => {
    const list = mealReminders(day, "2026-11-02", new Date(2026, 10, 2, 13, 29, 30));
    assert.deepEqual(list.map((r) => r.id), [`${REMINDER_PREFIX}2026-11-02-s`, `${REMINDER_PREFIX}2026-11-02-d`]);
  });
  it("words the reminder like the app does", () => {
    const [lunch] = mealReminders(day, "2026-11-02", new Date(2026, 10, 2, 9, 0));
    assert.equal(lunch.title, "Lunch at 1:30 PM");
    assert.equal(lunch.body, "lunch dish · 540 kcal. Tap to log it when you eat.");
  });
  it("ignores a time it can't read", () => {
    assert.deepEqual(mealReminders([meal("x", "lunch", "lunchtime"), meal("y", "dinner", "25:00")], "2026-11-02", new Date(2026, 10, 2, 0, 0)), []);
  });
  it("gives the same id on every run, so rescheduling replaces", () => {
    const now = new Date(2026, 10, 2, 9, 0);
    assert.deepEqual(mealReminders(day, "2026-11-02", now).map((r) => r.id), mealReminders(day, "2026-11-02", now).map((r) => r.id));
  });
});

describe("clockLabel", () => {
  it("writes 12-hour times", () => {
    assert.equal(clockLabel(0, 5), "12:05 AM");
    assert.equal(clockLabel(12, 0), "12:00 PM");
    assert.equal(clockLabel(20, 30), "8:30 PM");
  });
});
