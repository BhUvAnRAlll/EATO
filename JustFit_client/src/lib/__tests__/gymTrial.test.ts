import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ageOn, clockText, quickTimes, trialCardText, trialDays, trialDetailsText, trialPrefill, trialStateText, openTrial, type TrialInfo } from "../gymTrial.ts";

const trial = (extra: Partial<TrialInfo> = {}): TrialInfo => ({
  status: "requested",
  details: { age: 27, gender: "male", goal: "build_muscle", experience: "some", day: "2026-11-15", time: "evening" },
  preferred: "Sun 15 Nov, evening",
  at: null,
  ...extra,
});

describe("gym trial words and autofill", () => {
  it("fills the sheet in from the profile", () => {
    assert.deepEqual(trialPrefill({ fullName: " Asha Rao ", dob: "1999-11-11", gender: "female", goal: "fat_loss" }, "x", "2026-11-10"), { name: "Asha Rao", age: 26, gender: "female", goal: "lose_weight" });
    assert.deepEqual(trialPrefill(null, "Ravi", "2026-11-10"), { name: "Ravi", age: null, gender: null, goal: null });
    assert.equal(trialPrefill({ gender: "unspecified", goal: "maintenance" }, null, "2026-11-10").gender, null);
    assert.equal(trialPrefill({ goal: "maintenance" }, null, "2026-11-10").goal, "get_fit");
  });

  it("works out the age, only from 13 to 90", () => {
    assert.equal(ageOn("2000-11-10", "2026-11-10"), 26);
    assert.equal(ageOn("2000-11-11", "2026-11-10"), 25);
    assert.equal(ageOn("2020-01-01", "2026-11-10"), null);
    assert.equal(ageOn("bad", "2026-11-10"), null);
  });

  it("lists today and the next two weeks", () => {
    const days = trialDays("2026-11-10");
    assert.equal(days.length, 15);
    assert.deepEqual(days[0], { day: "2026-11-10", top: "Today", bottom: "10 Nov" });
    assert.equal(days[1].top, "Tomorrow");
    assert.equal(days[5].top, "Sun");
  });

  it("says where a trial stands, for the member and the gym", () => {
    assert.match(trialStateText(trial(), "Forma").line, /call you to fix the time \(you asked for Sun 15 Nov, evening\)/);
    assert.equal(trialStateText(trial({ status: "scheduled", at: { day: "2026-11-15", time: "18:30", text: "Sun 15 Nov, 6:30 PM" } }), "Forma").line, "Your trial at Forma is on Sun 15 Nov, 6:30 PM.");
    assert.equal(trialCardText(trial()), "Free trial requested · prefers Sun 15 Nov, evening");
    assert.equal(trialDetailsText(trial()), "27 yrs · Male · Build muscle · Trained before");
    assert.equal(trialDetailsText(trial({ details: null })), null);
    assert.equal(openTrial(trial({ status: "done" })), false);
    assert.equal(openTrial(trial({ status: "scheduled" })), true);
  });

  it("offers quick times near what was asked for", () => {
    assert.deepEqual(quickTimes("evening"), ["17:00", "18:00", "18:30", "19:30"]);
    assert.equal(quickTimes(null).length, 4);
    assert.equal(clockText("00:30"), "12:30 AM");
    assert.equal(clockText("12:00"), "12:00 PM");
  });
});
