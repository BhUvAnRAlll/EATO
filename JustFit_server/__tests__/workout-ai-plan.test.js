// The AI-written workout week (workout/aiPlan.js), the parts with no database or model: the
// library the AI may use, the prompt, and the checks on its answer before anything is stored.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const ai = require("../workout/aiPlan.js");
const workout = require("../../JustFit_client/src/lib/workout/index.ts");

const INPUTS = {
  gender: "female", ageYears: 30, weightKg: 62, heightCm: 162, bodyType: "average", goal: "build_muscle", weekdays: [1, 3, 5],
  pace: "standard", fitnessBase: 3, squatScore: 3, pushScore: 3, pullScore: 3, seriousInjury: false,
};
const library = workout.EXERCISE_LIBRARY;
const engine = workout.generatePlan(INPUTS, library);
const day = (weekday, exercises, extra = {}) => ({ weekday, title: "Day", sessionType: "full_body", exercises, ...extra });
const ex = (name, over = {}) => ({ name, section: "workout", role: "main", sets: 3, reps: 10, repsMin: 8, repsMax: 12, durationSec: null, restSec: 90, note: null, ...over });
const week = (exercises) => ({ name: "Plan", days: INPUTS.weekdays.map((d) => day(d, exercises)) });

describe("AI workout: the answer the engine would give passes unchanged", () => {
  it("normalizes the engine's own week back to the same days", () => {
    const days = ai.normalizeWeek(ai.asAnswer(engine), { weekdays: INPUTS.weekdays, library });
    assert.ok(days);
    assert.deepEqual(JSON.parse(JSON.stringify(days)), JSON.parse(JSON.stringify(engine.days)));
  });
});

describe("AI workout: checking the answer", () => {
  it("keeps library exercises only, matched by name loosely, once per day, in section order", () => {
    const days = ai.normalizeWeek(week([
      ex("Plank", { section: "cooldown", role: "stretch", durationSec: 30, reps: null }),
      ex("bodyweight squats"),
      ex("Bodyweight Squat"),
      ex("Moon Walk Jumps"),
      ex("Push-Up", { section: "warmup" }),
    ]), { weekdays: INPUTS.weekdays, library });
    assert.ok(days);
    const names = days[0].exercises.map((e) => `${e.section}:${e.name}`);
    assert.ok(!names.some((n) => n.includes("Moon")), "invented exercises are left out");
    assert.equal(names.filter((n) => n.includes("Bodyweight Squat")).length, 1, "no repeats in a day");
    assert.deepEqual(days[0].exercises.map((e) => e.section), [...days[0].exercises.map((e) => e.section)].sort((a, b) => ["warmup", "workout", "cooldown"].indexOf(a) - ["warmup", "workout", "cooldown"].indexOf(b)));
    assert.deepEqual(days[0].exercises.map((e) => e.order), days[0].exercises.map((_, i) => i));
  });

  it("bounds every number", () => {
    const days = ai.normalizeWeek(week([ex("Bodyweight Squat", { sets: 40, reps: 500, repsMin: -3, repsMax: 900, restSec: 5000 })]), { weekdays: INPUTS.weekdays, library });
    const e = days[0].exercises[0];
    assert.equal(e.sets.length, ai.limits.setsWorkout);
    assert.ok(e.sets.every((s) => s.reps >= 1 && s.reps <= ai.limits.reps));
    assert.ok(e.repsMin >= 1 && e.repsMin <= e.repsMax && e.repsMax <= ai.limits.reps);
    assert.equal(e.restSec, ai.limits.restWorkout);
  });

  it("times a timed exercise in seconds, within bounds", () => {
    const timed = library.find((e) => e.timedSec !== undefined && e.pattern === "core");
    const days = ai.normalizeWeek(week([ex("Bodyweight Squat"), ex(timed.name, { reps: 12, durationSec: 99999 })]), { weekdays: INPUTS.weekdays, library });
    const e = days[0].exercises.find((x) => x.name === timed.name);
    assert.ok(e.sets.every((s) => s.durationSec === ai.limits.secondsMax && s.reps === undefined));
  });

  it("refuses a week missing a training day, or a day with no workout exercise", () => {
    const missing = { name: "x", days: [day(1, [ex("Bodyweight Squat")]), day(3, [ex("Bodyweight Squat")])] };
    assert.equal(ai.normalizeWeek(missing, { weekdays: INPUTS.weekdays, library }), null);
    const onlyStretch = week([ex("Bodyweight Squat", { section: "cooldown" })]);
    assert.equal(ai.normalizeWeek(onlyStretch, { weekdays: INPUTS.weekdays, library }), null);
    for (const raw of [null, {}, { days: "x" }, { days: [null] }]) assert.equal(ai.normalizeWeek(raw, { weekdays: INPUTS.weekdays, library }), null);
  });

  it("ignores days the member doesn't train, and cleans titles and notes", () => {
    const raw = week([ex("Bodyweight Squat", { note: "<b>Brace</b> your core" })]);
    raw.days.push(day(0, [ex("Bodyweight Squat")]));
    raw.days[0].title = "<script>x</script>Legs";
    const days = ai.normalizeWeek(raw, { weekdays: INPUTS.weekdays, library });
    assert.deepEqual(days.map((d) => d.weekday), INPUTS.weekdays);
    assert.ok(!/[<>]/.test(days[0].title) && !/[<>]/.test(days[0].exercises[0].note));
  });
});

describe("AI workout: the safety rules the server keeps", () => {
  it("a serious injury takes high-risk exercises off the list; a heavier body takes off the ones that aren't low-impact", () => {
    const calm = workout.calibrate({ ...INPUTS, seriousInjury: true });
    assert.ok(ai.allowedLibrary(library, INPUTS, calm).every((e) => !e.highRisk));
    const heavier = { ...INPUTS, bodyType: "obese" };
    assert.ok(ai.allowedLibrary(library, heavier, workout.calibrate(heavier)).every((e) => e.lowImpact));
    assert.equal(ai.allowedLibrary(library, INPUTS, workout.calibrate(INPUTS)).length, library.length);
  });

  it("the prompt carries the days, the ceilings, the coach's line and the library; the schema is strict", () => {
    const text = ai.brief({ inputs: INPUTS, calibration: engine.calibration, library: library.slice(0, 3), extra: "Session length: 30 minutes." });
    assert.match(text, /1 \(Monday\), 3 \(Wednesday\), 5 \(Friday\)/);
    assert.match(text, /Highest difficulty/);
    assert.match(text, /30 minutes/);
    assert.ok(text.includes(library[0].name));
    assert.match(ai.INSTRUCTIONS, /Indian/);
    assert.equal(ai.schema.properties.days.items.properties.exercises.items.additionalProperties, false);
  });

  it("without an AI key there is no call: the engine's week is used", async () => {
    assert.equal(await ai.write(null, "u1", { inputs: INPUTS, enginePlan: engine, library }, { NODE_ENV: "production" }), null);
  });
});
