/// <reference types="node" />
// JustFit's side of the workout engine: how a setup profile and the saved workout answers
// become engine inputs, plus spec guarantees the ported engine tests don't state.
// Run with: npm test
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENGINE_VERSION, PATTERN_GROUP, generatePlan, inputHashOf } from "../engine.ts";
import { EXERCISE_LIBRARY } from "../library.ts";
import { engineProfileFor, inputsForMember } from "../profile.ts";

const TODAY = "2026-10-15";

describe("JustFit profile → engine inputs", () => {
  it("maps setup goals onto the engine's goals", () => {
    const goalOf = (goal: string) => inputsForMember({ goal }, {}, TODAY).goal;
    assert.equal(goalOf("fat_loss"), "lose_weight");
    assert.equal(goalOf("muscle_gain"), "build_muscle");
    assert.equal(goalOf("maintenance"), "stay_healthy");
    assert.equal(goalOf("healthy_eating"), "get_fitter");
  });

  it("keeps male and female, and reads any other answer as other", () => {
    assert.equal(inputsForMember({ gender: "male" }, {}, TODAY).gender, "male");
    assert.equal(inputsForMember({ gender: "female" }, {}, TODAY).gender, "female");
    assert.equal(inputsForMember({ gender: "unspecified" }, {}, TODAY).gender, "other");
    assert.equal(inputsForMember({}, {}, TODAY).gender, "other");
  });

  it("takes training days from the low end of the setup frequency, spread by the engine", () => {
    const days = (workoutFrequency: string) => inputsForMember({ workoutFrequency }, {}, TODAY).weekdays;
    assert.deepEqual(days("1-2"), [3]); // Wed
    assert.deepEqual(days("3-4"), [1, 3, 5]); // Mon, Wed, Fri
    assert.deepEqual(days("5-6"), [1, 2, 3, 4, 5]);
    assert.deepEqual(days("7"), [1, 2, 3, 4, 5, 6]); // the automatic spread stops at six
    assert.deepEqual(inputsForMember({}, {}, TODAY).weekdays, [1, 3, 5], "unknown frequency: three days");
  });

  it("derives age from the date of birth, and an age given in the rebuild flow wins", () => {
    assert.equal(inputsForMember({ dob: "1996-10-16" }, {}, TODAY).ageYears, 29, "birthday is tomorrow");
    assert.equal(inputsForMember({ dob: "1996-10-15" }, {}, TODAY).ageYears, 30);
    assert.equal(inputsForMember({ dob: "1996-10-15" }, { ageYears: 41 }, TODAY).ageYears, 41);
  });

  it("uses workout answers before the setup profile, field by field", () => {
    const inputs = inputsForMember(
      { gender: "female", goal: "fat_loss", weightKg: 82, heightCm: 165, workoutFrequency: "3-4" },
      { gender: "other", goal: "build_muscle", weightKg: 79.5, weekdays: [0, 2, 4, 6], pace: "brisk", bodyType: "athletic", fitnessBase: 3, squatScore: 4, pushScore: 3, pullScore: 2, seriousInjury: false, split: "upper_lower" },
      TODAY,
    );
    assert.equal(inputs.gender, "other");
    assert.equal(inputs.goal, "build_muscle");
    assert.equal(inputs.weightKg, 79.5);
    assert.equal(inputs.heightCm, 165, "not answered in the workout flow: the setup height");
    assert.deepEqual(inputs.weekdays, [2, 4, 6, 0], "Monday-first order");
    assert.equal(inputs.pace, "brisk");
    assert.equal(inputs.bodyType, "athletic");
    assert.equal(inputs.split, "upper_lower");
  });

  it("falls back to the engine's cautious defaults for a thin profile", () => {
    const inputs = inputsForMember({}, {}, TODAY);
    assert.deepEqual(
      { ...inputs, weekdays: inputs.weekdays.join(",") },
      { gender: "other", ageYears: 30, weightKg: 70, heightCm: 170, bodyType: "average", goal: "get_fitter", weekdays: "1,3,5", pace: "standard", fitnessBase: 2, squatScore: 3, pushScore: 3, pullScore: 3, seriousInjury: false, split: "auto" },
    );
  });

  it("treats a setup health flag as 'train around something' until the member answers", () => {
    assert.equal(inputsForMember({ healthFlags: ["pregnant"] }, {}, TODAY).seriousInjury, true);
    assert.equal(inputsForMember({ healthFlags: ["pregnant"] }, { seriousInjury: false }, TODAY).seriousInjury, false, "the member's own answer wins");
    assert.equal(inputsForMember({ healthFlags: [] }, {}, TODAY).seriousInjury, false);
    const plan = generatePlan(inputsForMember({ healthFlags: ["pregnant"] }, {}, TODAY), EXERCISE_LIBRARY);
    assert.equal(plan.level, "beginner");
    assert.equal(plan.requiresProfessionalReview, true);
  });

  it("an experience level from Preferences sets the fitness base", () => {
    assert.equal(engineProfileFor({}, { experience: "advanced" }).experience, "advanced");
    assert.equal(inputsForMember({}, { experience: "advanced" }, TODAY).fitnessBase, 4);
    assert.equal(inputsForMember({}, { experience: "beginner" }, TODAY).fitnessBase, 1);
  });
});

describe("spec guarantees", () => {
  it("is engine version 2 with a stable eight-character input hash", () => {
    assert.equal(ENGINE_VERSION, 2);
    const inputs = inputsForMember({}, {}, TODAY);
    assert.match(inputHashOf(inputs, ENGINE_VERSION), /^[0-9a-f]{8}$/);
    assert.equal(inputHashOf(inputs, ENGINE_VERSION), inputHashOf({ ...inputs }, ENGINE_VERSION));
  });

  it("ships the 77-exercise library across all 18 movement patterns, each programmable", () => {
    assert.equal(EXERCISE_LIBRARY.length, 77);
    assert.equal(Object.keys(PATTERN_GROUP).length, 18);
    for (const pattern of Object.keys(PATTERN_GROUP)) {
      assert.ok(EXERCISE_LIBRARY.some((e) => e.pattern === pattern), `an exercise for ${pattern}`);
    }
    for (const e of EXERCISE_LIBRARY) assert.ok([1, 2, 3].includes(e.difficulty), `${e.name} has a difficulty`);
  });

  it("never prescribes a weight", () => {
    for (const workoutFrequency of ["1-2", "3-4", "5-6", "7"]) {
      const plan = generatePlan(inputsForMember({ workoutFrequency, goal: "muscle_gain" }, { experience: "advanced", fitnessBase: 4, squatScore: 4, pushScore: 4, pullScore: 4 }, TODAY), EXERCISE_LIBRARY);
      for (const day of plan.days) for (const exercise of day.exercises) for (const set of exercise.sets) assert.equal(set.weightKg, undefined, `${exercise.name}`);
    }
  });
});
