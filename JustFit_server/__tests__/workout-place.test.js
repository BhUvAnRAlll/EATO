// Workout › At home / At center, the parts with no database or model (workout/place.js): the
// library each place allows, and the same-movement swap used when the AI can't adapt the day.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const place = require("../workout/place.js");
const workout = require("../../JustFit_client/src/lib/workout/index.ts");

const library = workout.EXERCISE_LIBRARY;
const byName = (name) => library.find((e) => e.name === name);
const entry = (name, over = {}) => {
  const e = byName(name);
  const timed = e.timedSec !== undefined;
  return { name, pattern: e.pattern, difficulty: e.difficulty, section: "workout", role: "main", restSec: 90, ...(timed ? { sets: [{ durationSec: 30 }, { durationSec: 30 }] } : { sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }], repsMin: 8, repsMax: 10 }), ...over };
};
const gymOnly = library.find((e) => e.machine && e.pattern === "vertical_pull") ?? library.find((e) => e.equipment === "Barbell");

describe("At home / At center: what each place allows", () => {
  it("home with no equipment is bodyweight only; the center is the whole library", () => {
    const home = place.libraryFor(library, { equipmentKey: "none", careful: false });
    assert.ok(home.length > 0 && home.every((e) => e.equipment === "Bodyweight"));
    assert.equal(place.libraryFor(library, { equipmentKey: "full_gym", careful: false }).length, library.length);
  });

  it("sore joints or a condition take high-risk moves out, and the plan's safety rules still apply", () => {
    assert.ok(place.libraryFor(library, { equipmentKey: "full_gym", careful: true }).every((e) => !e.highRisk));
    const inputs = { bodyType: "obese" };
    const calibration = { safetyMode: true };
    assert.ok(place.libraryFor(library, { equipmentKey: "full_gym", careful: false, inputs, calibration }).every((e) => !e.highRisk && e.lowImpact));
  });

  it("an unknown equipment answer reads as none", () => {
    assert.ok(place.libraryFor(library, { equipmentKey: "jetpack", careful: false }).every((e) => e.equipment === "Bodyweight"));
  });
});

describe("At home / At center: the same-movement swap", () => {
  const home = place.libraryFor(library, { equipmentKey: "none", careful: false });

  it("keeps what the place allows and swaps the rest for the same movement, keeping sets and rest", () => {
    const day = [entry("Bodyweight Squat"), entry(gymOnly.name)];
    const out = place.swapForPlace(day, home);
    assert.ok(out);
    assert.equal(out[0].name, "Bodyweight Squat");
    assert.ok(out.every((e) => home.some((h) => h.name === e.name)), "only home exercises");
    const swapped = out.find((e) => e.name !== "Bodyweight Squat");
    if (swapped) {
      assert.equal(byName(swapped.name).pattern, gymOnly.pattern);
      assert.equal(swapped.restSec, 90);
    }
    assert.deepEqual(out.map((e) => e.order), out.map((_, i) => i));
  });

  it("never uses one exercise twice, and moves between timed and counted sets sensibly", () => {
    const squats = library.filter((e) => e.pattern === "squat");
    const out = place.swapForPlace(squats.map((e) => entry(e.name)), home);
    assert.equal(new Set(out.map((e) => e.name)).size, out.length);
    const timedHome = home.find((e) => e.timedSec !== undefined && e.pattern === "core");
    const countedGym = library.find((e) => e.timedSec === undefined && e.pattern === "core" && !home.includes(e));
    if (timedHome && countedGym) {
      const [moved] = place.swapForPlace([entry(countedGym.name)], home.filter((e) => e.pattern !== "core" || e.timedSec !== undefined));
      assert.ok(moved.sets.every((s) => s.durationSec > 0 && s.reps === undefined));
    }
  });

  it("answers null when no workout exercise can be done at the place", () => {
    assert.equal(place.swapForPlace([entry(gymOnly.name)], []), null);
    assert.equal(place.swapForPlace([], home), null);
  });
});
