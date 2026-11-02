// AI Coach Insights rules (coach/insightsRules.js): pure functions, no database, no model.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../coach/insightsRules.js");
const { ValidationError } = require("../profile.js");

// Wednesday 4 November 2026, midday in India
const NOW = Date.UTC(2026, 10, 4, 6, 30);
const TODAY = "2026-11-04";
const targets = { kcal: 2000, proteinG: 120, carbsG: 220, fatG: 60 };
const refuses = (fn, pattern) => assert.throws(fn, (e) => e instanceof ValidationError && pattern.test(e.message));

describe("coach insights: the requests", () => {
  it("reads today and the week (this week by default)", () => {
    assert.deepEqual(rules.insightsQuery({ today: TODAY }, NOW), { today: TODAY, week: "this" });
    assert.deepEqual(rules.insightsQuery({ today: TODAY, week: "last" }, NOW), { today: TODAY, week: "last" });
  });

  it("refuses a day far from the server's and an unknown week", () => {
    refuses(() => rules.insightsQuery({ today: "2026-10-01" }, NOW), /server's date/);
    refuses(() => rules.insightsQuery({ today: TODAY, week: "next" }, NOW), /this week or last week/);
    refuses(() => rules.insightsQuery({}, NOW), /YYYY-MM-DD/);
  });

  it("the review body takes only today, week and refresh", () => {
    assert.deepEqual(rules.reviewBody({ today: TODAY, refresh: true }, NOW), { today: TODAY, week: "this", refresh: true });
    refuses(() => rules.reviewBody({ today: TODAY, userId: "someone-else" }, NOW), /Unexpected field: userId/);
    refuses(() => rules.reviewBody({ today: TODAY, refresh: "yes" }, NOW), /true or false/);
    refuses(() => rules.reviewBody(null, NOW), /week to review/);
  });
});

describe("coach insights: the week", () => {
  it("this week runs Monday to Sunday, counted to today", () => {
    const w = rules.weekOf(TODAY, "this");
    assert.equal(w.start, "2026-11-02");
    assert.equal(w.end, "2026-11-08");
    assert.equal(w.elapsed, 3);
    assert.equal(w.lastDay, TODAY);
  });

  it("last week is the seven days before, all counted", () => {
    const w = rules.weekOf(TODAY, "last");
    assert.deepEqual([w.start, w.end, w.elapsed, w.lastDay], ["2026-10-26", "2026-11-01", 7, "2026-11-01"]);
  });

  it("a Sunday belongs to the week that began the Monday before", () => {
    assert.equal(rules.weekOf("2026-11-08", "this").start, "2026-11-02");
    assert.equal(rules.weekOf("2026-11-08", "this").elapsed, 7);
  });
});

describe("coach insights: nutrition", () => {
  const w = rules.weekOf(TODAY, "this");
  const day = (kcal, proteinG, carbsG = 200, fatG = 60) => ({ kcal, proteinG, carbsG, fatG });

  it("is null with nothing logged, or with no target", () => {
    assert.equal(rules.nutritionStats(w, new Map(), targets), null);
    assert.equal(rules.nutritionStats(w, new Map([[TODAY, day(1800, 100)]]), null), null);
  });

  it("averages only the days that were logged, never counting a blank day as zero", () => {
    const n = rules.nutritionStats(w, new Map([["2026-11-02", day(2000, 130)], [TODAY, day(1600, 80)]]), targets);
    assert.equal(n.daysLogged, 2);
    assert.equal(n.daysCounted, 3);
    assert.equal(n.avg.kcal, 1800);
    assert.equal(n.totalKcal, 3600);
    assert.equal(n.targetKcal, 4000);
    assert.equal(n.macros.proteinG.avg, 105);
    assert.equal(n.macros.proteinG.percent, 88);
    assert.equal(n.days.length, 3);
    assert.equal(n.days[1].logged, false);
  });

  it("counts days on target, protein hits, and says which macros run low or high", () => {
    const n = rules.nutritionStats(w, new Map([["2026-11-02", day(2000, 120, 300, 40)], ["2026-11-03", day(2500, 60, 300, 40)], [TODAY, day(1900, 100, 300, 40)]]), targets);
    assert.equal(n.onTargetDays, 2); // 2000 and 1900; 2500 is over 115%
    assert.equal(n.proteinHitDays, 1); // only 120 g reaches 90% of 120
    assert.equal(n.macros.carbsG.verdict, "high");
    assert.equal(n.macros.fatG.verdict, "low");
    assert.equal(n.macros.kcal.verdict, "ok");
  });

  it("leaves days after today out of this week", () => {
    const n = rules.nutritionStats(w, new Map([["2026-11-06", day(2000, 120)]]), targets);
    assert.equal(n, null);
  });
});

describe("coach insights: workouts", () => {
  const resolved = [
    { date: "2026-11-02", status: "completed" },
    { date: "2026-11-03", status: "missed" },
    { date: "2026-11-04", status: "rest" },
    { date: "2026-11-05", status: "planned" },
    { date: "2026-11-06", status: "rest" },
  ];

  it("counts done, missed and still ahead, and the rate only over days that have come", () => {
    const s = rules.workoutStats(resolved, new Map([["2026-11-02", 42]]), [{ group: "legs", sets: 9 }, { group: "core", sets: 3 }], true);
    assert.deepEqual([s.planned, s.done, s.missed, s.upcoming, s.completionRate], [3, 1, 1, 1, 50]);
    assert.equal(s.totalMinutes, 42);
    assert.equal(s.activeDays, 1);
    assert.deepEqual(s.muscleGroups, [{ group: "legs", sets: 9, share: 75 }, { group: "core", sets: 3, share: 25 }]);
  });

  it("has no rate before any session's day has come", () => {
    const s = rules.workoutStats([{ date: "2026-11-05", status: "planned" }], new Map(), [], true);
    assert.equal(s.completionRate, null);
  });

  it("is null with no plan and no training", () => {
    assert.equal(rules.workoutStats([{ date: TODAY, status: "rest" }], new Map(), [], false), null);
  });
});

describe("coach insights: weight", () => {
  it("is null when the member never entered a weight", () => {
    assert.equal(rules.weightStats([], TODAY, "fat_loss"), null);
  });

  it("one weigh-in: the current weight, no change", () => {
    const w = rules.weightStats([{ date: "2026-10-20", kg: 80 }], TODAY, "fat_loss");
    assert.deepEqual(w.current, { date: "2026-10-20", kg: 80 });
    assert.equal(w.previous, null);
    assert.equal(w.change, null);
    assert.equal(w.direction, "lose");
  });

  it("current, previous and first, ignoring entries after the week and keeping the weigh-in over a report on the same day", () => {
    const points = [
      { date: "2026-11-01", kg: 78.4 }, // weigh-in
      { date: "2026-10-01", kg: 81 },
      { date: "2026-10-20", kg: 79.6 },
      { date: "2026-11-01", kg: 77 }, // report, same day
      { date: "2026-11-07", kg: 76 }, // after the week asked about
    ];
    const w = rules.weightStats(points, "2026-11-01", "muscle_gain");
    assert.deepEqual(w.current, { date: "2026-11-01", kg: 78.4 });
    assert.deepEqual(w.previous, { date: "2026-10-20", kg: 79.6 });
    assert.equal(w.change, -1.2);
    assert.equal(w.changeSinceFirst, -2.6);
    assert.equal(w.direction, "gain");
    assert.equal(w.points.length, 3);
  });
});

describe("coach insights: the review", () => {
  const w = rules.weekOf(TODAY, "this");

  it("the brief quotes the real numbers and says plainly when there's no data", () => {
    const nutrition = rules.nutritionStats(w, new Map([[TODAY, { kcal: 1800, proteinG: 90, carbsG: 200, fatG: 60 }]]), targets);
    const brief = rules.reviewBrief({ week: w, nutrition, workouts: null, weight: null, member: null });
    assert.match(brief, /logged on 1 of 3 days/);
    assert.match(brief, /protein 90 g \(75%\)/);
    assert.match(brief, /no plan and no sessions/);
    assert.doesNotMatch(brief, /Weight/);
  });

  it("the instructions forbid invented numbers and medical advice", () => {
    const text = rules.reviewInstructions({ coach: "priya", coachStyle: "direct" });
    assert.match(text, /Coach Priya/);
    assert.match(text, /never invent a number/);
    assert.match(text, /not medical advice/);
  });

  it("cleans the answer: markdown off, one tip per area, unknown areas dropped, capped", () => {
    const raw = {
      summary: "**Great** week!",
      tips: [
        { area: "protein", text: "Add curd at lunch." },
        { area: "protein", text: "A second protein tip." },
        { area: "sleep", text: "Not an area." },
        { area: "workout", text: "x".repeat(400) },
      ],
    };
    const clean = rules.cleanReview(raw, { diet: "vegetarian", allergies: "" });
    assert.equal(clean.summary, "Great week!");
    assert.deepEqual(clean.tips.map((t) => t.area), ["protein", "workout"]);
    assert.equal(clean.tips[1].text.length, rules.limits.tip);
  });

  it("drops a tip naming food outside the member's diet or from their allergies", () => {
    const raw = { summary: "Good week.", tips: [{ area: "protein", text: "Have grilled chicken at dinner." }, { area: "nutrition", text: "Snack on peanuts." }, { area: "next_week", text: "Log every day." }] };
    const clean = rules.cleanReview(raw, { diet: "vegetarian", allergies: "peanut" });
    assert.deepEqual(clean.tips.map((t) => t.area), ["next_week"]);
  });

  it("is null when nothing usable is left", () => {
    assert.equal(rules.cleanReview({ summary: "", tips: [] }, null), null);
    assert.equal(rules.cleanReview({ summary: "Fine.", tips: [{ area: "x", text: "y" }] }, null), null);
    assert.equal(rules.cleanReview(null, null), null);
  });
});
