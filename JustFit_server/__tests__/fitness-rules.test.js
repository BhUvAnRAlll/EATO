// The Fitness tab's programs, the rules with no database or model (fitness/rules.js): the starter
// catalog, building sessions from the exercise library, reading requests, and checking the AI.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../fitness/rules.js");
const { ValidationError } = require("../profile.js");
const { EQUIPMENT } = require("../coach/planRules.js");
const workout = require("../../JustFit_client/src/lib/workout/index.ts");

const library = workout.EXERCISE_LIBRARY;
const { PROGRAMS, SECTION_ORDER } = rules.catalog;

describe("the starter catalog", () => {
  it("fills all six sections, for home and for the center, with unique slugs and no paywall words", () => {
    assert.deepEqual(SECTION_ORDER, ["popular", "categories", "build_muscle", "stay_fit", "dance", "workplace"]);
    for (const place of ["home", "center"]) {
      for (const section of SECTION_ORDER) {
        assert.ok(PROGRAMS.some((p) => p.section === section && (p.place === place || p.place === "both")), `${section} at ${place}`);
      }
    }
    assert.equal(new Set(PROGRAMS.map((p) => p.slug)).size, PROGRAMS.length);
    assert.ok(PROGRAMS.every((p) => !/premium|subscri|price|₹|\$|locked|pro only/i.test(`${p.title} ${p.subtitle} ${p.description}`)));
  });

  it("every program's every session can be built from the library, within its kit", () => {
    for (const p of PROGRAMS) {
      const sessions = rules.buildSessions(p, library);
      assert.equal(sessions.length, p.sessions.length, p.slug);
      const kit = EQUIPMENT[p.kit];
      for (const s of sessions) {
        assert.ok(s.exercises.some((e) => e.section === "workout"), `${p.slug}: ${s.title}`);
        assert.equal(new Set(s.exercises.map((e) => e.name)).size, s.exercises.length, "no repeats");
        for (const e of s.exercises) {
          const lib = library.find((x) => x.name === e.name);
          assert.ok(kit === null || kit.includes(lib.equipment), `${p.slug}: ${e.name} needs ${lib.equipment}`);
          if (p.level === "beginner") assert.equal(lib.highRisk, false, `${p.slug}: ${e.name} is high-risk`);
        }
      }
    }
  });

  it("sessions of one program differ, and order runs warm-up, workout, cool-down", () => {
    const [a, b] = rules.buildSessions(PROGRAMS.find((p) => p.slug === "workout-for-beginners"), library);
    assert.notDeepEqual(a.exercises.map((e) => e.name), b.exercises.map((e) => e.name));
    const order = ["warmup", "workout", "cooldown"];
    for (const s of [a, b]) assert.deepEqual(s.exercises.map((e) => order.indexOf(e.section)), [...s.exercises.map((e) => order.indexOf(e.section))].sort());
  });
});

describe("requests", () => {
  it("reads the list: home unless it says center, and a trimmed search", () => {
    assert.deepEqual(rules.listQuery({}), { place: "home", search: "" });
    assert.deepEqual(rules.listQuery({ place: "center", search: "  yoga " }), { place: "center", search: "yoga" });
    assert.equal(rules.listQuery({ place: "' OR 1=1" }).place, "home");
  });

  it("ids are UUIDs or missing", () => {
    assert.equal(rules.id("0B2F7C2A-1111-4222-8333-444455556666"), "0b2f7c2a-1111-4222-8333-444455556666");
    for (const bad of ["1", "' OR 1=1", "", undefined]) assert.throws(() => rules.id(bad), { name: "NotFoundError" });
  });

  it("the location sheet takes known equipment only", () => {
    assert.deepEqual(rules.equipmentBody({ home: "some", center: "full_gym" }), { home: "some", center: "full_gym" });
    for (const body of [{ home: "full_gym", center: "full_gym" }, { home: "none", center: "none" }, { home: "none", center: "full_gym", userId: "x" }, null]) {
      assert.throws(() => rules.equipmentBody(body), ValidationError, JSON.stringify(body));
    }
  });

  it("an admin's program: required fields when creating, partial edits, sessions only through the AI", () => {
    const made = rules.programBody({ title: "Morning <b>Mobility</b>", section: "stay_fit", place: "home", level: "beginner", kit: "none" }, { creating: true });
    assert.equal(made.title, "Morning b Mobility /b");
    assert.equal(made.sessions, 3);
    assert.equal(made.icon, "strength");
    assert.deepEqual(rules.programBody({ published: false }, { creating: false }), { published: false });
    for (const body of [{ title: "x" }, { title: "Ok title", section: "vip" }, { published: "yes" }, { sessions: 4 }, { price: 99 }]) {
      assert.throws(() => rules.programBody(body, { creating: false }), ValidationError, JSON.stringify(body));
    }
    assert.throws(() => rules.programBody({ title: "Morning", section: "stay_fit", place: "home", level: "beginner", kit: "none", sessions: 50 }, { creating: true }), ValidationError);
  });
});

describe("the AI rewriting a program", () => {
  const program = PROGRAMS.find((p) => p.slug === "total-tone");
  const allowed = rules.kitLibrary(library, program);
  const built = rules.buildSessions(program, library);

  it("the library-built sessions pass the checks as an AI answer", () => {
    const sessions = rules.normalizeSessions(rules.fakeAnswer(built), { library: allowed, count: 3 });
    assert.equal(sessions.length, built.length);
    assert.deepEqual(sessions.map((s) => s.exercises.map((e) => e.name)), built.map((s) => s.exercises.map((e) => e.name)));
  });

  it("drops exercises outside the kit, sessions with nothing usable, and extra sessions", () => {
    const barbell = library.find((e) => e.equipment === "Barbell");
    const raw = rules.fakeAnswer(built);
    raw.sessions[0].exercises.push({ ...raw.sessions[0].exercises[0], name: barbell.name });
    raw.sessions.push({ title: "Junk", minutes: 999, exercises: [{ ...raw.sessions[0].exercises[0], name: "Moon Jumps" }] });
    const sessions = rules.normalizeSessions(raw, { library: allowed, count: 3 });
    assert.equal(sessions.length, 3);
    assert.ok(!sessions[0].exercises.some((e) => e.name === barbell.name));
    assert.equal(rules.normalizeSessions({ sessions: [{ title: "x", minutes: 10, exercises: [] }] }, { library: allowed, count: 3 }), null);
  });

  it("the prompt names the program, its kit and the library, and treats the admin's note as a preference", () => {
    const text = rules.brief(program, { count: 3, minutes: 30, request: "more arms", library: allowed.slice(0, 2) });
    assert.match(text, /Total Tone/);
    assert.match(text, /dumbbells/);
    assert.match(text, /not instructions/);
    assert.ok(text.includes(allowed[0].name));
    assert.equal(rules.schema.properties.sessions.items.additionalProperties, false);
  });
});
