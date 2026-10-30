/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { basicsErrors, draftFrom, goalsErrors, parseNumber, performanceErrors, toAnswers, toggleWeekday, withDayCount, type Draft } from "../recreateRules.ts";

const complete: Draft = {
  gender: "female", age: "29", weight: "62.5", height: "165", bodyType: "average",
  goal: "lose_weight", daysPerWeek: 3, weekdays: [5, 1, 3], pace: "standard", fitnessBase: 2,
  squatScore: 3, pushScore: 2, pullScore: 1, seriousInjury: false,
};
const empty = draftFrom({});

describe("rebuild my plan: the draft's checks", () => {
  it("reads typed numbers, a comma as a decimal point, and nothing else", () => {
    assert.equal(parseNumber("62,5"), 62.5);
    assert.equal(parseNumber(" 70 "), 70);
    assert.equal(parseNumber(""), null);
    assert.equal(parseNumber("7e1"), null);
    assert.equal(parseNumber("-5"), null);
  });

  it("asks every basics question with the spec's words", () => {
    assert.deepEqual(basicsErrors(empty), {
      gender: "Pick your gender",
      age: "Enter an age between 13 and 100",
      weight: "Enter a weight between 25 and 300 kg",
      height: "Enter a height between 100 and 250 cm",
      bodyType: "Pick the closest body type",
    });
    assert.deepEqual(basicsErrors(complete), {});
    assert.ok(basicsErrors({ ...complete, age: "12" }).age);
    assert.ok(basicsErrors({ ...complete, age: "29.5" }).age, "age is whole years");
    assert.ok(basicsErrors({ ...complete, weight: "301" }).weight);
    assert.ok(basicsErrors({ ...complete, height: "99" }).height);
  });

  it("wants as many weekdays as training days, and at least three", () => {
    assert.equal(goalsErrors({ ...complete, weekdays: [1, 3] }).weekdays, "Select at least 3 days (2 chosen)");
    assert.equal(goalsErrors({ ...complete, daysPerWeek: 4 }).weekdays, "Select 4 days (3 chosen)");
    assert.deepEqual(goalsErrors(complete), {});
    assert.deepEqual(Object.keys(goalsErrors(empty)).sort(), ["daysPerWeek", "fitnessBase", "goal", "pace", "weekdays"]);
  });

  it("asks the performance questions and the injury question", () => {
    assert.deepEqual(performanceErrors(empty), { squatScore: "Pick a range", pushScore: "Pick a range", pullScore: "Pick a range", seriousInjury: "Answer yes or no" });
    assert.deepEqual(performanceErrors({ ...complete, seriousInjury: true }), {}, "yes is an answer");
  });

  it("lowering the day count keeps the earliest weekdays; a full week takes no more", () => {
    const four = { ...complete, daysPerWeek: 4, weekdays: [5, 1, 3, 2] };
    assert.deepEqual(withDayCount(four, 3).weekdays, [1, 2, 3]);
    assert.deepEqual(toggleWeekday(complete, 4).weekdays, [5, 1, 3], "already three of three");
    assert.deepEqual(toggleWeekday(complete, 3).weekdays, [5, 1]);
  });

  it("turns a complete draft into the server's answers, Monday first", () => {
    assert.deepEqual(toAnswers(complete), {
      gender: "female", ageYears: 29, weightKg: 62.5, heightCm: 165, bodyType: "average", goal: "lose_weight",
      weekdays: [1, 3, 5], pace: "standard", fitnessBase: 2, squatScore: 3, pushScore: 2, pullScore: 1, seriousInjury: false,
    });
    assert.equal(toAnswers({ ...complete, pace: null }), null);
  });

  it("starts from the saved answers, mapping the engine's extra body types to the nearest card", () => {
    const d = draftFrom({ gender: "male", ageYears: 31, weightKg: 70, heightCm: 175, bodyType: "athletic", goal: "stay_healthy", weekdays: [1, 3, 5], seriousInjury: false });
    assert.equal(d.bodyType, "lean");
    assert.equal(d.goal, "get_fitter");
    assert.equal(d.daysPerWeek, 3);
    assert.equal(d.age, "31");
    assert.equal(d.pace, null);
  });
});
