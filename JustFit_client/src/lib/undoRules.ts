// Undo's rules (pure, unit-tested; 2026-11-09, step 5 of the native interactions plan): how long
// an undo is offered, and when the phone's accelerometer readings count as a shake.

// The Undo bar stays this long; the removal is sent to the server when it ends
export const UNDO_MS = 5000;

// A shake: two strong jolts (the reading's size in g, gravity included, at rest about 1) within
// SHAKE_WINDOW_MS of each other, at least SHAKE_GAP_MS apart so one jolt's readings don't count
// twice. A bump, a step or putting the phone down is one jolt and never undoes anything.
export const SHAKE_G = 2.2;
export const SHAKE_WINDOW_MS = 800;
export const SHAKE_GAP_MS = 120;
// How often the accelerometer is read while an undo is offered (and never otherwise)
export const SHAKE_INTERVAL_MS = 60;

export type ShakeState = { lastJoltAt: number | null };
export type Reading = { x: number; y: number; z: number };

export const restingShake = (): ShakeState => ({ lastJoltAt: null });

// One reading in: the new state, and whether this reading completes a shake
export function shakeStep(state: ShakeState, reading: Reading, now: number): { state: ShakeState; shaken: boolean } {
  const g = Math.sqrt(reading.x * reading.x + reading.y * reading.y + reading.z * reading.z);
  if (!Number.isFinite(g) || g < SHAKE_G) return { state, shaken: false };
  const last = state.lastJoltAt;
  if (last !== null && now - last < SHAKE_GAP_MS) return { state, shaken: false };
  if (last !== null && now - last <= SHAKE_WINDOW_MS) return { state: restingShake(), shaken: true };
  return { state: { lastJoltAt: now }, shaken: false };
}
