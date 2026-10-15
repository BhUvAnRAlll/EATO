// macro/validate.js and the pure parts of macro/diary.js: what the Macro diary accepts.
// No server, no database. The clock is passed in, so "today" is fixed.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

process.env.CLERK_SECRET_KEY ||= "sk_test_unit"; // diary.js loads auth.js through community/members
const v = require("../macro/validate.js");
const { ValidationError } = require("../profile.js");
const { grade, totalsOf } = require("../macro/diary.js");

const NOW = Date.parse("2026-10-14T09:00:00Z");
const TODAY = "2026-10-14";
const food = (over = {}) => ({ name: "Paneer bowl", quantity: 350, unit: "g", kcal: 480, proteinG: 32, carbsG: 40, fatG: 18, ...over });
const meal = (over = {}) => ({ date: TODAY, slot: "lunch", title: "Paneer bowl", loggedAt: NOW, items: [food()], ...over });
const rejects = (fn, pattern) => assert.throws(fn, (error) => error instanceof ValidationError && pattern.test(error.message));

describe("macro: meals", () => {
  it("accepts a normal meal and defaults the source to manual", () => {
    const m = v.validateMeal(meal(), NOW);
    assert.equal(m.source, "manual");
    assert.equal(m.items.length, 1);
    assert.deepEqual(m.items[0], food());
  });

  it("logs only for today: any zone's today is fine, yesterday-but-one and the future are refused", () => {
    for (const date of ["2026-10-13", "2026-10-14", "2026-10-15"]) assert.equal(v.validateMeal(meal({ date }), NOW).date, date);
    for (const date of ["2026-10-12", "2026-10-16", "2025-10-14"]) rejects(() => v.validateMeal(meal({ date }), NOW), /only be logged for today/);
  });

  it("refuses malformed dates, slots, times and sources", () => {
    for (const date of ["14-10-2026", "2026-13-01", "2026-02-30", "", 20261014, "2026-10-14' OR 1=1"]) rejects(() => v.validateMeal(meal({ date }), NOW), /date/i);
    for (const slot of ["brunch", "", null, "LUNCH"]) rejects(() => v.validateMeal(meal({ slot }), NOW), /breakfast, lunch/);
    for (const loggedAt of ["now", NaN, Infinity, NOW - 37 * 3600_000, NOW + 19 * 3600_000]) rejects(() => v.validateMeal(meal({ loggedAt }), NOW), /meal time/);
    rejects(() => v.validateMeal(meal({ source: "favorite" }), NOW), /source/);
    assert.equal(v.validateMeal(meal({ source: "repeat" }), NOW).source, "repeat");
  });

  it("needs 1–50 foods with numbers in range", () => {
    rejects(() => v.validateMeal(meal({ items: [] }), NOW), /at least one food/);
    rejects(() => v.validateMeal(meal({ items: "x" }), NOW), /at least one food/);
    rejects(() => v.validateMeal(meal({ items: Array.from({ length: 51 }, () => food()) }), NOW), /Too many foods/);
    rejects(() => v.validateMeal(meal({ items: [food({ quantity: 0 })] }), NOW), /quantity/i);
    rejects(() => v.validateMeal(meal({ items: [food({ quantity: 10001 })] }), NOW), /quantity/i);
    rejects(() => v.validateMeal(meal({ items: [food({ kcal: 5001 })] }), NOW), /Calories/);
    rejects(() => v.validateMeal(meal({ items: [food({ kcal: -1 })] }), NOW), /Calories/);
    rejects(() => v.validateMeal(meal({ items: [food({ proteinG: 2001 })] }), NOW), /Protein/);
    rejects(() => v.validateMeal(meal({ items: [food({ fatG: "10" })] }), NOW), /Fat/);
    assert.equal(v.validateMeal(meal({ items: [food({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 })] }), NOW).items[0].kcal, 0, "zero is allowed");
  });

  it("trims and truncates names instead of refusing them, and never accepts an empty one", () => {
    const m = v.validateMeal(meal({ title: `  ${"x".repeat(200)}  `, items: [food({ name: "  Dal\n\tchawal  ", unit: " cup " })] }), NOW);
    assert.equal(m.title.length, 120);
    assert.equal(m.items[0].name, "Dal chawal");
    assert.equal(m.items[0].unit, "cup");
    rejects(() => v.validateMeal(meal({ title: "   " }), NOW), /meal name/);
    rejects(() => v.validateMeal(meal({ items: [food({ name: "" })] }), NOW), /food name/);
  });

  it("refuses unexpected fields, so the owner can't be sent in the body", () => {
    rejects(() => v.validateMeal({ ...meal(), userId: "user_other" }, NOW), /unexpected field: userId/);
    rejects(() => v.validateMeal(meal({ items: [{ ...food(), userId: "x" }] }), NOW), /unexpected field: userId/);
    rejects(() => v.validateMeal([], NOW), /as an object/);
    rejects(() => v.validateMeal(null, NOW), /as an object/);
  });
});

describe("macro: favourites, ids and queries", () => {
  const MEAL_ID = "8f14e45f-ceea-467a-9575-1a2b3c4d5e6f";
  it("toggle keys are meal:<uuid> only", () => {
    assert.equal(v.validateFavoriteToggle({ name: "Bowl", items: [food()], sourceKey: `meal:${MEAL_ID.toUpperCase()}` }).sourceKey, `meal:${MEAL_ID}`);
    assert.equal(v.validateFavoriteToggle({ name: "Bowl", items: [food()] }).sourceKey, null);
    for (const sourceKey of ["meal:1", "post:" + MEAL_ID, "meal:" + MEAL_ID + "'", 42]) rejects(() => v.validateFavoriteToggle({ name: "Bowl", items: [food()], sourceKey }), /key/);
    rejects(() => v.validateFavoriteToggle({ name: "Bowl", items: [] }), /at least one food/);
  });

  it("logging a favourite needs today, a slot and a time", () => {
    assert.deepEqual(v.validateFavoriteLog({ date: TODAY, slot: "snack", loggedAt: NOW }, NOW), { date: TODAY, slot: "snack", loggedAt: NOW });
    rejects(() => v.validateFavoriteLog({ date: "2026-10-01", slot: "snack", loggedAt: NOW }, NOW), /only be logged for today/);
  });

  it("ids, date lists and recent queries", () => {
    assert.equal(v.id(MEAL_ID.toUpperCase(), "The meal"), MEAL_ID);
    for (const bad of ["1", "' OR 1=1 --", "", null]) rejects(() => v.id(bad, "The meal"), /isn't valid/);
    assert.deepEqual(v.dateList("2026-10-13,2026-10-14,2026-10-14"), ["2026-10-13", "2026-10-14"]);
    rejects(() => v.dateList(Array.from({ length: 41 }, () => TODAY).join(",")), /at most 40/);
    rejects(() => v.dateList("2026-10-14,nope"), /YYYY-MM-DD/);
    assert.deepEqual(v.recentQuery({ today: TODAY }, NOW), { today: TODAY, limit: 12 });
    rejects(() => v.recentQuery({ today: TODAY, limit: "51" }, NOW), /limit/);
    rejects(() => v.recentQuery({ today: "2026-09-01" }, NOW), /today/);
    assert.equal(v.daysBefore(TODAY, 2), "2026-10-12");
  });
});

describe("macro: totals and grading", () => {
  it("sums totals from the foods", () => {
    assert.deepEqual(totalsOf([food(), food({ kcal: 120.4, proteinG: 0.3 })]), { kcal: 600.4, proteinG: 32.3, carbsG: 80, fatG: 36 });
    assert.deepEqual(totalsOf([]), { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("grades a day against the target: complete ≥ 90%, partial ≥ 50%, low below, none without meals or target", () => {
    assert.equal(grade(1800, 2000, true).status, "complete");
    assert.equal(grade(1000, 2000, true).status, "partial");
    assert.equal(grade(999, 2000, true).status, "low");
    assert.equal(grade(0, 2000, false).status, "none");
    assert.equal(grade(500, null, true).status, "none");
  });
});
