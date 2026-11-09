// What the ongoing notification (and the Live Activity) say about a running workout.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { restLength, workoutStatus } from "../workoutStatus.ts";
import type { Step } from "../workoutSteps.ts";

const set: Step = { kind: "set", exerciseIndex: 0, exerciseId: "e1", name: "Bench Press", setIndex: 1, setCount: 4, durationSec: null, reps: 10, weightKg: null, restSec: 90 } as Step;
const rest: Step = { kind: "rest", exerciseIndex: 0, durationSec: 90 };
const base = { dayTitle: "Push Day", exerciseName: "Bench Press", nextName: "Squat", done: 5, total: 18, paused: false };

describe("workoutStatus", () => {
  it("names the set in progress and the sets done", () => {
    assert.deepEqual(workoutStatus({ ...base, step: set }), { title: "Bench Press · set 2 of 4", body: "Push Day · 5 of 18 sets done", progress: 5 / 18 });
  });
  it("names a rest's length and what follows", () => {
    assert.equal(workoutStatus({ ...base, step: rest }).title, "Rest 1 min 30 s");
    assert.equal(workoutStatus({ ...base, step: rest }).body, "5 of 18 sets done, then Squat");
    assert.equal(workoutStatus({ ...base, step: rest, nextName: null }).body, "5 of 18 sets done");
  });
  it("says when it is paused", () => {
    assert.equal(workoutStatus({ ...base, step: set, paused: true }).title, "Bench Press · set 2 of 4 · paused");
  });
  it("after the last set, asks to finish in the app", () => {
    assert.equal(workoutStatus({ ...base, step: null, done: 18 }).title, "Push Day · last set done");
  });
  it("keeps the progress between 0 and 1", () => {
    assert.equal(workoutStatus({ ...base, step: set, total: 0 }).progress, 0);
    assert.equal(workoutStatus({ ...base, step: set, done: 30 }).progress, 1);
  });
});

describe("restLength", () => {
  it("reads seconds and minutes", () => {
    assert.equal(restLength(45), "45 s");
    assert.equal(restLength(60), "1 min");
    assert.equal(restLength(150), "2 min 30 s");
  });
});
