// Super Admin › App Usage phase 3, the pure parts: retention off a cohort's activity, the
// member list's query checks, the feature id check and a member's most-used feature. No database.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const rules = require("../admin/retentionRules");
const { ValidationError } = require("../profile");

describe("retention", () => {
  const rows = [
    { userId: "a", daysAfterJoin: 0 }, { userId: "a", daysAfterJoin: 1 }, { userId: "a", daysAfterJoin: 9 },
    { userId: "b", daysAfterJoin: 0 }, { userId: "b", daysAfterJoin: 2 },
    { userId: "c", daysAfterJoin: 0 },
    { userId: "d", daysAfterJoin: 31 },
  ];

  it("day-N retention is the share of the cohort active on or after day N", () => {
    assert.equal(rules.retentionFor(4, rows, 1, 40), 75, "a, b, d came back on day 1 or later; c never did");
    assert.equal(rules.retentionFor(4, rows, 7, 40), 50, "a and d");
    assert.equal(rules.retentionFor(4, rows, 30, 40), 25, "only d");
  });

  it("is null while the cohort is too young for that day, and for an empty cohort", () => {
    assert.equal(rules.retentionFor(4, rows, 7, 5), null);
    assert.equal(rules.retentionFor(4, rows, 1, 5), 75, "day 1 has arrived");
    assert.equal(rules.retentionFor(0, [], 1, 100), null);
  });

  it("counts a member once however many days they were active", () => {
    const busy = Array.from({ length: 50 }, (_, i) => ({ userId: "a", daysAfterJoin: i + 1 }));
    assert.equal(rules.retentionFor(2, busy, 1, 60), 50);
  });

  it("cohort unit defaults to week and refuses anything else", () => {
    assert.deepEqual(rules.cohortQuery({}), { unit: "week", cohorts: 8 });
    assert.deepEqual(rules.cohortQuery({ unit: "month" }), { unit: "month", cohorts: 6 });
    assert.throws(() => rules.cohortQuery({ unit: "day" }), ValidationError);
  });
});

describe("the member list's query", () => {
  it("defaults to last active, page 1", () => {
    assert.deepEqual(rules.membersQuery({}), { sort: "last_active", search: "", page: 1, limit: 25, offset: 0 });
  });

  it("knows every sort, trims the search, pages", () => {
    for (const sort of rules.MEMBER_SORTS) assert.equal(rules.membersQuery({ sort }).sort, sort);
    assert.equal(rules.membersQuery({ search: "  Priya " }).search, "Priya");
    assert.equal(rules.membersQuery({ page: "3" }).offset, 50);
  });

  it("refuses an unknown sort, a huge search, a bad page", () => {
    assert.throws(() => rules.membersQuery({ sort: "u.id; DROP TABLE users" }), ValidationError);
    assert.throws(() => rules.membersQuery({ search: "x".repeat(81) }), ValidationError);
    for (const page of ["0", "-1", "1.5", "abc", "99999999"]) assert.throws(() => rules.membersQuery({ page }), ValidationError, page);
  });
});

describe("a feature from the path, and a member's most-used feature", () => {
  it("only catalogue ids pass", () => {
    assert.equal(rules.featureId("meal_log").id, "meal_log");
    for (const bad of ["meals", "users", "meal_log; DROP TABLE users", "", undefined]) assert.throws(() => rules.featureId(bad), ValidationError, String(bad));
  });

  it("most used is the feature with the most uses; none when they used nothing", () => {
    assert.deepEqual(rules.mostUsed({ meal_log: 3, workout_started: 9, like: 9 }), { id: "workout_started", label: "Workouts started", uses: 9 }, "ties go to catalogue order");
    assert.equal(rules.mostUsed({ meal_log: 0 }), null);
    assert.equal(rules.mostUsed({}), null);
  });
});
