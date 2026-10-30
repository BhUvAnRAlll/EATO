/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSteps, exerciseProgress, prescribedReps, setKey, setTotals, startIndex, type StepExercise } from "../workoutSteps.ts";

const squat: StepExercise = { id: "a", name: "Squat", sets: [{ reps: 8 }, { reps: 8 }, { reps: 6 }], restSec: 90, repsMin: 6, repsMax: 10 };
const plank: StepExercise = { id: "b", name: "Plank", sets: [{ durationSec: 30 }, { durationSec: 30 }], restSec: 30, repsMin: null, repsMax: null };
const stretch: StepExercise = { id: "c", name: "Hamstring stretch", sets: [{ durationSec: 40 }], restSec: 0, repsMin: null, repsMax: null };

describe("the session player's steps", () => {
  it("lists every set in order with a rest after each, but none after the very last set", () => {
    const steps = buildSteps([squat, plank]);
    assert.deepEqual(
      steps.map((s) => (s.kind === "set" ? `${s.name}#${s.setIndex}` : `rest${s.durationSec}`)),
      ["Squat#0", "rest90", "Squat#1", "rest90", "Squat#2", "rest90", "Plank#0", "rest30", "Plank#1"],
    );
  });

  it("adds no rest where the exercise's rest is zero", () => {
    const steps = buildSteps([stretch, squat]);
    assert.equal(steps[0].kind, "set");
    assert.equal(steps[1].kind, "set", "the stretch has no rest after it");
  });

  it("times a timed set and counts reps on a rep set", () => {
    const [first] = buildSteps([plank]);
    assert.equal(first.kind === "set" && first.durationSec, 30);
    const [rep] = buildSteps([squat]);
    assert.equal(rep.kind === "set" && rep.durationSec, null);
    assert.equal(rep.kind === "set" && rep.reps, 8);
  });

  it("asks for the set's reps, else the top of the range", () => {
    assert.equal(prescribedReps(squat, 2), 6);
    assert.equal(prescribedReps({ ...squat, sets: [{}] }, 0), 10);
    assert.equal(prescribedReps({ ...squat, sets: [{}], repsMax: null }, 0), 6);
    assert.equal(prescribedReps({ ...squat, sets: [{}], repsMax: null, repsMin: null }, 0), 0);
  });

  it("opens at the first set not yet logged, or at a chosen exercise", () => {
    const steps = buildSteps([squat, plank]);
    assert.equal(startIndex(steps, new Set()), 0);
    assert.equal(startIndex(steps, new Set([setKey("a", 0), setKey("a", 1)])), 4, "the third squat set");
    assert.equal(startIndex(steps, new Set(), "b"), 6, "the plank's first set");
    assert.equal(startIndex(steps, new Set(), "missing"), 0, "an unknown exercise falls back to the first open set");
    const all = new Set([...[0, 1, 2].map((i) => setKey("a", i)), setKey("b", 0), setKey("b", 1)]);
    assert.equal(startIndex(steps, all), steps.length, "everything done: the end");
  });

  it("measures progress per exercise and in sets", () => {
    const logged = new Set([setKey("a", 0), setKey("b", 0), setKey("b", 1)]);
    assert.deepEqual(exerciseProgress([squat, plank], logged), [1 / 3, 1]);
    assert.deepEqual(setTotals(buildSteps([squat, plank]), logged), { total: 5, done: 3 });
  });

  it("handles an empty day", () => {
    assert.deepEqual(buildSteps([]), []);
    assert.equal(startIndex([], new Set()), 0);
  });
});
