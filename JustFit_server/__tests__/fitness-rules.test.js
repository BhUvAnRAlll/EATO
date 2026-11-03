// The Fitness tab's programs, the rules with no database or model (fitness/rules.js): the starter
// catalog, building sessions from the exercise library, reading requests, and checking the AI.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../fitness/rules.js");
const { ValidationError } = require("../profile.js");
const { NotFoundError } = require("../errors.js");
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

  it("an admin's program: required fields when creating, partial edits, no sessions or video in it (they're added one by one)", () => {
    const made = rules.programBody({ title: "Morning <b>Mobility</b>", section: "stay_fit", place: "home", level: "beginner", kit: "none" }, { creating: true });
    assert.equal(made.title, "Morning b Mobility /b");
    assert.equal(made.sessions, undefined);
    assert.equal(made.icon, "strength");
    assert.deepEqual(rules.programBody({ published: false }, { creating: false }), { published: false });
    for (const body of [{ title: "x" }, { title: "Ok title", section: "VIP Members!" }, { title: "Ok title", section: "../x" }, { title: "Ok title", section: 7 }, { published: "yes" }, { sessions: 4 }, { price: 99 }]) {
      assert.throws(() => rules.programBody(body, { creating: false }), ValidationError, JSON.stringify(body));
    }
    for (const extra of [{ sessions: 3 }, { minutes: 20 }, { youtube: "dQw4w9WgXcQ" }]) {
      assert.throws(() => rules.programBody({ title: "Morning", section: "stay_fit", place: "home", level: "beginner", kit: "none", ...extra }, { creating: true }), ValidationError, JSON.stringify(extra));
    }
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

describe("categories (the admin's fitness_sections)", () => {
  it("a category: a name of 2 to 40 characters, a short line, posters, tiles or wide cards, shown or hidden", () => {
    assert.deepEqual(rules.sectionBody({ title: "  Yoga & Mobility " }, { creating: true }), { title: "Yoga & Mobility", note: "", layout: "tile" });
    assert.doesNotMatch(rules.sectionBody({ title: "<script>Yoga</script>" }, { creating: true }).title, /[<>]/, "no markup reaches the app");
    assert.deepEqual(rules.sectionBody({ layout: "wide", published: false }, { creating: false }), { layout: "wide", published: false });
    for (const body of [{ title: "x" }, { title: "y".repeat(41) }, { title: "Ok", layout: "carousel" }, { title: "Ok", published: "no" }, { title: "Ok", slug: "admin" }, { title: "Ok", builtIn: true }, null, []]) {
      assert.throws(() => rules.sectionBody(body, { creating: true }), ValidationError, JSON.stringify(body));
    }
  });

  it("a new category's key comes from its name, safe for a URL and a SQL value", () => {
    assert.equal(rules.slugFor("Yoga & Mobility"), "yoga_mobility");
    assert.equal(rules.slugFor("  HIIT 2.0!! "), "hiit_2_0");
    assert.equal(rules.slugFor("योग"), "category");
    assert.equal(rules.slugFor("'; DROP TABLE users; --"), "drop_table_users");
    assert.ok(rules.slugFor("x".repeat(80)).length <= 32);
    for (const title of ["Yoga & Mobility", "योग", "a".repeat(80)]) assert.match(rules.slugFor(title), rules.SECTION_SLUG);
  });

  it("a category key from the path, and a move, are checked", () => {
    assert.equal(rules.sectionSlug("stay_fit"), "stay_fit");
    for (const bad of ["../programs", "Stay Fit", "", "x".repeat(41), undefined]) assert.throws(() => rules.sectionSlug(bad), NotFoundError);
    assert.equal(rules.moveBody({ direction: "up" }), "up");
    for (const body of [{ direction: "left" }, { direction: "up", by: 3 }, {}]) assert.throws(() => rules.moveBody(body), ValidationError);
  });
});

describe("a program's YouTube link: one video, never a playlist (2026-11-03)", () => {
  it("a video link in any of YouTube's shapes, or a bare ID, is that video", () => {
    const id = "dQw4w9WgXcQ";
    for (const link of [id, `https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://m.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`, ` https://youtube.com/live/${id} `]) {
      assert.deepEqual(rules.youtubeLink(link), { kind: "video", id }, link);
    }
    // A video opened from a playlist is just the video
    assert.deepEqual(rules.youtubeLink(`https://www.youtube.com/watch?v=${id}&list=PLpa0d6IJAhbjxlK1l2-WcD5F64jNg58t0`), { kind: "video", id });
  });

  it("empty takes it off", () => {
    assert.equal(rules.youtubeLink(""), null);
    assert.equal(rules.youtubeLink(null), null);
  });

  it("a playlist is refused with a line that says so", () => {
    for (const link of ["PLpa0d6IJAhbjxlK1l2-WcD5F64jNg58t0", "https://www.youtube.com/playlist?list=PLpa0d6IJAhbjxlK1l2-WcD5F64jNg58t0"]) {
      assert.throws(() => rules.youtubeLink(link), (error) => error instanceof ValidationError && /Playlists can't be added/.test(error.message), link);
    }
  });

  it("anything else is refused: other sites, plain http, bad IDs, scripts", () => {
    for (const bad of ["https://vimeo.com/123", "http://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=short", "javascript:alert(1)", "https://www.youtube.com/playlist?list=x", "x".repeat(301), 42, {}]) {
      assert.throws(() => rules.youtubeLink(bad), ValidationError, String(bad).slice(0, 40));
    }
  });
});

describe("a session the admin adds or edits: a title, its minutes and one YouTube video (embedded, never uploaded)", () => {
  it("adding needs all three; the link is kept as the video's ID", () => {
    assert.deepEqual(rules.sessionBody({ title: "  Day 1: core  ", minutes: 15, youtube: "https://youtu.be/dQw4w9WgXcQ" }, { creating: true }), { title: "Day 1: core", minutes: 15, youtubeId: "dQw4w9WgXcQ" });
    for (const body of [{ minutes: 15, youtube: "dQw4w9WgXcQ" }, { title: "Day 1", youtube: "dQw4w9WgXcQ" }, { title: "Day 1", minutes: 15 }, { title: "Day 1", minutes: 15, youtube: "" }]) {
      assert.throws(() => rules.sessionBody(body, { creating: true }), ValidationError, JSON.stringify(body));
    }
  });

  it("editing takes any of them; a session always keeps a video", () => {
    assert.throws(() => rules.sessionBody({ youtube: "" }, { creating: false }), ValidationError);
    assert.deepEqual(rules.sessionBody({ youtube: "https://youtu.be/aBcDeFgHiJk" }, { creating: false }), { youtubeId: "aBcDeFgHiJk" });
    assert.deepEqual(rules.sessionBody({ minutes: 20 }, { creating: false }), { minutes: 20 });
    assert.throws(() => rules.sessionBody({}, { creating: false }), ValidationError);
  });

  it("refuses playlists, files and anything else", () => {
    for (const body of [
      { title: "Day 1", minutes: 15, youtube: "https://www.youtube.com/playlist?list=PLpa0d6IJAhbjxlK1l2-WcD5F64jNg58t0" },
      { title: "Day 1", minutes: 15, youtube: "https://example.com/video.mp4" },
      { title: "Day 1", minutes: 15, youtube: "dQw4w9WgXcQ", file: "data:video/mp4;base64,AAAA" },
      { title: "Day 1", minutes: 4, youtube: "dQw4w9WgXcQ" },
      { title: "Day 1", minutes: "15", youtube: "dQw4w9WgXcQ" },
      { title: "x", minutes: 15, youtube: "dQw4w9WgXcQ" },
      { title: "x".repeat(61), minutes: 15, youtube: "dQw4w9WgXcQ" },
    ]) {
      assert.throws(() => rules.sessionBody(body, { creating: true }), ValidationError, JSON.stringify(body).slice(0, 60));
    }
  });
});
