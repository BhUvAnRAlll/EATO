// Undo's rules: the shake detector needs two strong jolts close together, nothing else counts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SHAKE_GAP_MS, SHAKE_WINDOW_MS, UNDO_MS, restingShake, shakeStep, type ShakeState } from "../undoRules.ts";

const still = { x: 0, y: 0, z: 1 };
const jolt = { x: 2.4, y: 0.6, z: 1 };

// Feeds readings in at the given times; returns the times at which a shake was found
function run(samples: [number, { x: number; y: number; z: number }][]) {
  let state: ShakeState = restingShake();
  const shakes: number[] = [];
  for (const [at, reading] of samples) {
    const step = shakeStep(state, reading, at);
    state = step.state;
    if (step.shaken) shakes.push(at);
  }
  return shakes;
}

describe("shakeStep", () => {
  it("finds two strong jolts within the window", () => {
    assert.deepEqual(run([[0, still], [100, jolt], [400, jolt]]), [400]);
  });
  it("ignores the phone at rest, a walk and one bump", () => {
    assert.deepEqual(run([[0, still], [60, { x: 0.4, y: 0.3, z: 1.3 }], [120, jolt], [180, still], [240, still]]), []);
  });
  it("needs the second jolt soon enough", () => {
    assert.deepEqual(run([[0, jolt], [SHAKE_WINDOW_MS + 50, jolt]]), []);
    // the late jolt starts a new count, so a third one in time completes it
    assert.deepEqual(run([[0, jolt], [SHAKE_WINDOW_MS + 50, jolt], [SHAKE_WINDOW_MS + 300, jolt]]), [SHAKE_WINDOW_MS + 300]);
  });
  it("doesn't count one jolt's readings twice", () => {
    assert.deepEqual(run([[0, jolt], [SHAKE_GAP_MS - 60, jolt]]), []);
  });
  it("starts over after a shake, and ignores readings that aren't numbers", () => {
    assert.deepEqual(run([[0, jolt], [300, jolt], [500, jolt]]), [300]);
    assert.deepEqual(run([[0, { x: Number.NaN, y: 0, z: 0 }], [200, { x: Infinity, y: 0, z: 0 }]]), []);
  });
});

describe("UNDO_MS", () => {
  it("offers undo for a few seconds", () => {
    assert.ok(UNDO_MS >= 4000 && UNDO_MS <= 10000);
  });
});
