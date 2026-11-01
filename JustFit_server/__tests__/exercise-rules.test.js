// Admin › Exercises, the rules with no database (admin/exerciseRules.js): the duplicate key,
// reading the admin's requests, and cleaning what the AI answers before anything is stored.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../admin/exerciseRules.js");
const { ValidationError } = require("../profile.js");

const good = (over = {}) => ({
  name: "dumbbell goblet squat", muscleGroup: "legs", pattern: "squat", equipment: "Dumbbell", difficulty: 2, region: "lower",
  highRisk: false, lowImpact: true, machine: false, timedSec: null, instructions: ["Hold the dumbbell at your chest.", "Squat down and stand up."], ...over,
});

describe("exercise names: one key for the same exercise", () => {
  it("matches spelling, spacing, hyphens and plurals", () => {
    const key = rules.exerciseKey("Push-up");
    for (const name of ["Push Ups", "push-ups", "PUSHUP", " push up "]) assert.equal(rules.exerciseKey(name), key, name);
    assert.equal(rules.exerciseKey("Bench Presses"), rules.exerciseKey("Bench Press"));
    assert.equal(rules.exerciseKey("Walking Lunges"), rules.exerciseKey("Walking Lunge"));
    assert.notEqual(rules.exerciseKey("Front Squat"), rules.exerciseKey("Back Squat"));
  });
});

describe("the admin's requests", () => {
  it("reads the list filters, defaulting anything unknown", () => {
    assert.deepEqual(rules.listQuery({}), { search: "", group: null, video: "all", show: "active" });
    assert.deepEqual(rules.listQuery({ search: "  squat ", group: "legs", video: "missing", show: "archived" }), { search: "squat", group: "legs", video: "missing", show: "archived" });
    assert.deepEqual(rules.listQuery({ group: "'; DROP TABLE x;--", video: "1 OR 1=1", show: ["a"] }), { search: "", group: null, video: "all", show: "active" });
    assert.equal(rules.listQuery({ search: "x".repeat(500) }).search.length, rules.limits.search);
  });

  it("accepts only a UUID as an exercise id", () => {
    assert.equal(rules.exerciseId("0B2F7C2A-1111-4222-8333-444455556666"), "0b2f7c2a-1111-4222-8333-444455556666");
    for (const bad of ["1", "' OR 1=1 --", "../x", "", undefined]) assert.throws(() => rules.exerciseId(bad), { name: "NotFoundError" });
  });

  it("checks the AI request: text, count and nothing else", () => {
    assert.deepEqual(rules.draftBody({ request: "Home yoga stretches" }), { request: "Home yoga stretches", count: 10 });
    assert.deepEqual(rules.draftBody({ request: "Kettlebell moves", count: 20 }), { request: "Kettlebell moves", count: 20 });
    for (const body of [{ request: "x" }, { request: "y".repeat(201) }, { request: "abc", count: 0 }, { request: "abc", count: 21 }, { request: "abc", count: 2.5 }, { request: "abc", role: "admin" }, null, []]) {
      assert.throws(() => rules.draftBody(body), ValidationError, JSON.stringify(body));
    }
  });
});

describe("cleaning the AI's exercises", () => {
  it("keeps a good one, in Title Case, with its details", () => {
    const { added, skipped } = rules.normalizeDrafts({ exercises: [good()] }, { count: 5, taken: new Set() });
    assert.equal(skipped.length, 0);
    assert.equal(added[0].name, "Dumbbell Goblet Squat");
    assert.equal(added[0].difficulty, 2);
    assert.equal(added[0].instructions.length, 2);
  });

  it("leaves out duplicates of the library and of each other", () => {
    const taken = new Set([rules.exerciseKey("Bodyweight Squat")]);
    const { added, skipped } = rules.normalizeDrafts({ exercises: [good({ name: "Bodyweight Squats" }), good(), good({ name: "Dumbbell Goblet Squats" })] }, { count: 5, taken });
    assert.deepEqual(added.map((e) => e.name), ["Dumbbell Goblet Squat"]);
    assert.deepEqual(skipped.map((s) => s.reason), ["It's already in the library.", "It's already in the library."]);
  });

  it("leaves out rows with a bad field, no name or no steps", () => {
    const rows = [good({ name: "" }), good({ name: "A" }), good({ name: "X1", pattern: "teleport" }), good({ name: "Y Move", difficulty: 9 }), good({ name: "Z Move", instructions: ["Do it."] })];
    const { added, skipped } = rules.normalizeDrafts({ exercises: rows }, { count: 5, taken: new Set() });
    assert.equal(added.length, 0);
    assert.equal(skipped.length, rows.length);
  });

  it("cleans the text: markup, long lines, timings out of range", () => {
    const { added } = rules.normalizeDrafts({
      exercises: [good({ name: "<script>alert(1)</script> Plank Hold", equipment: "", timedSec: 99999, instructions: ["<b>Brace</b> your core.", "z".repeat(400), "ok"] })],
    }, { count: 5, taken: new Set() });
    assert.equal(added.length, 1);
    assert.ok(!/[<>]/.test(added[0].name));
    assert.equal(added[0].equipment, "Bodyweight");
    assert.equal(added[0].timedSec, null);
    assert.ok(added[0].instructions.every((line) => line.length <= rules.limits.instructionLine && !/[<>]/.test(line)));
  });

  it("adds no more than were asked for, and survives a broken answer", () => {
    const many = Array.from({ length: 6 }, (_, i) => good({ name: `Move Number ${"abcdef"[i]}` }));
    assert.equal(rules.normalizeDrafts({ exercises: many }, { count: 3, taken: new Set() }).added.length, 3);
    for (const raw of [null, {}, { exercises: "x" }, { exercises: [null, 3] }]) {
      assert.equal(rules.normalizeDrafts(raw, { count: 3, taken: new Set() }).added.length, 0);
    }
  });

  it("the prompt names the library and the request, and the schema is strict", () => {
    const brief = rules.draftBrief({ request: "Yoga", count: 4 }, ["Plank", "Push-up"]);
    assert.match(brief, /up to 4/);
    assert.match(brief, /Plank; Push-up/);
    assert.equal(rules.draftSchema.properties.exercises.items.additionalProperties, false);
    assert.match(rules.INSTRUCTIONS, /Indian/);
  });
});
