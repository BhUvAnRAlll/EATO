// The member's allergies and diet, checked in code on every AI meal (coach/planRules.js
// foodGuard): Indian names of an allergy, the diet type, and the dishes that only look like a
// match. Pure: no database, no model.
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const plan = require("../coach/planRules.js");

const blocked = (food, names) => names.filter((n) => plan.forbidden(n, plan.foodGuard(food)));
const meal = { name: "Idli and sambar", time: "08:00", totals: { kcal: 400, proteinG: 14, carbsG: 70, fatG: 6 } };
const food = (name, kcal = 200) => ({ name, quantity: 1, unit: "bowl", kcal, proteinG: 8, carbsG: 20, fatG: 6 });

describe("food guard: an allergy by its Indian names", () => {
  it("peanuts catch groundnut and moongphali, not sprouts", () => {
    assert.deepEqual(blocked("peanuts", ["Groundnut chutney", "Moongphali chaat", "Peanut chikki", "Sprouts chaat", "Poha"]), ["Groundnut chutney", "Moongphali chaat", "Peanut chikki"]);
  });

  it("dairy catches paneer, dahi, ghee and lassi; coconut chutney and dosa stay", () => {
    assert.deepEqual(blocked("no dairy", ["Paneer tikka", "Dahi", "Ghee rice", "Sweet lassi", "Coconut chutney", "Masala dosa"]), ["Paneer tikka", "Dahi", "Ghee rice", "Sweet lassi"]);
    assert.deepEqual(blocked("lactose intolerant", ["Curd rice"]), ["Curd rice"]);
  });

  it("gluten catches roti, rava and maida; idli and rice stay", () => {
    assert.deepEqual(blocked("gluten", ["Phulka", "Rava upma", "Maida paratha", "Idli", "Brown rice"]), ["Phulka", "Rava upma", "Maida paratha"]);
  });

  it("shellfish catches prawn and jhinga but not fish; fish catches machli and meen", () => {
    assert.deepEqual(blocked("shellfish", ["Prawn curry", "Jhinga masala", "Fish curry"]), ["Prawn curry", "Jhinga masala"]);
    assert.deepEqual(blocked("fish", ["Machli fry", "Meen kuzhambu", "Shellfish soup", "Dal"]), ["Machli fry", "Meen kuzhambu", "Shellfish soup"]);
  });

  it("a short Indian name only matches at the start of a word: til is sesame, lentil is not", () => {
    assert.deepEqual(blocked("sesame", ["Til laddu", "Gingelly oil rice", "Lentil dal"]), ["Til laddu", "Gingelly oil rice"]);
  });

  it("the member's own word still matches anywhere, as before", () => {
    assert.deepEqual(blocked("strawberry", ["Strawberry smoothie", "Banana"]), ["Strawberry smoothie"]);
    assert.deepEqual(blocked("none", ["Peanut chikki"]), []);
    assert.deepEqual(blocked(null, ["Peanut chikki"]), []);
  });
});

describe("food guard: the diet type", () => {
  it("vegetarian leaves out meat, fish and egg; eggplant, chickpea and paneer keema stay", () => {
    assert.deepEqual(
      blocked({ diet: "vegetarian" }, ["Egg bhurji", "Boiled eggs", "Chicken biryani", "Fish fry", "Mutton curry", "Eggplant bharta", "Chickpea salad", "Paneer keema", "Eggless cake"]),
      ["Egg bhurji", "Boiled eggs", "Chicken biryani", "Fish fry", "Mutton curry"],
    );
  });

  it("eggetarian allows eggs but not meat", () => {
    assert.deepEqual(blocked({ diet: "eggetarian" }, ["Egg curry", "Mutton keema", "Soya keema"]), ["Mutton keema"]);
  });

  it("vegan also leaves out dairy and honey, but not peanut butter or coconut milk", () => {
    assert.deepEqual(
      blocked({ diet: "vegan" }, ["Curd rice", "Butter naan", "Honey lemon water", "Peanut butter toast", "Coconut milk curry", "Almond milk", "Soya chunks curry"]),
      ["Curd rice", "Butter naan", "Honey lemon water"],
    );
  });

  it("non-vegetarian and no diet leave everything in", () => {
    assert.deepEqual(blocked({ diet: "non-vegetarian" }, ["Chicken curry", "Egg bhurji"]), []);
    assert.deepEqual(blocked({ diet: null }, ["Chicken curry"]), []);
  });
});

describe("food guard: on every meal the coach writes", () => {
  it("a swap drops a forbidden food and refuses a forbidden dish", () => {
    const veg = { diet: "vegetarian", allergies: "peanuts" };
    const swap = plan.normalizeMeal({ name: "Poha plate", note: "", items: [food("Poha"), food("Boiled egg", 80), food("Groundnut chutney", 90)] }, meal, veg);
    assert.deepEqual(swap.items.map((i) => i.name), ["Poha"]);
    assert.throws(() => plan.normalizeMeal({ name: "Chicken biryani", note: "", items: [food("Basmati rice"), food("Raita")] }, meal, veg), (e) => e.status === 502);
  });

  it("a day plan with a non-veg dish for a vegetarian is unusable", () => {
    const day = structuredClone(plan.FAKE_DIET);
    day.meals[2].name = "Chicken curry and rice";
    const targets = { calories: 2000, proteinG: 120, carbsG: 220, fatG: 60 };
    assert.throws(() => plan.normalizeDiet(day, targets, { diet: "vegetarian" }), (e) => e.status === 502);
    assert.equal(plan.normalizeDiet(day, targets, { diet: "non-vegetarian" }).meals.length, 5);
  });

  it("Swap Meal's options leave out what a vegan can't eat", () => {
    const options = plan.normalizeOptions(plan.FAKE_OPTIONS, meal, { diet: "vegan" });
    assert.ok(options.every((o) => !/paneer|curd/i.test(o.name) && o.items.every((i) => !/paneer|curd/i.test(i.name))));
    assert.ok(options.length > 0);
  });
});

describe("the numbers the coach writes", () => {
  const targets = { calories: 2600, proteinG: 150, carbsG: 300, fatG: 80 };

  it("a food's calories follow its macros when the two disagree by far", () => {
    const [item] = plan.normalizeMeal({ name: "Dal", note: "", items: [{ name: "Dal", quantity: 1, unit: "bowl", kcal: 900, proteinG: 12, carbsG: 30, fatG: 5 }] }, meal, "", 0).items;
    assert.equal(item.kcal, 213, "4 × 12 + 4 × 30 + 9 × 5");
    const [close] = plan.normalizeMeal({ name: "Dal", note: "", items: [{ name: "Dal", quantity: 1, unit: "bowl", kcal: 230, proteinG: 12, carbsG: 30, fatG: 5 }] }, meal, "", 0).items;
    assert.equal(close.kcal, 230, "a close number is kept as written");
  });

  it("a day far too small is doubled at most, and the coach's note says it is still short", () => {
    const day = structuredClone(plan.FAKE_DIET);
    for (const m of day.meals) for (const i of m.items) Object.assign(i, { kcal: Math.round(i.kcal / 4), proteinG: i.proteinG / 4, carbsG: i.carbsG / 4, fatG: i.fatG / 4 });
    const diet = plan.normalizeDiet(day, targets);
    assert.match(diet.message, /These meals come to about \d+ kcal against your 2600 kcal target/);
  });

  it("a day within reach of the target says nothing extra", () => {
    const diet = plan.normalizeDiet(plan.FAKE_DIET, { ...targets, calories: 1600 });
    assert.doesNotMatch(diet.message, /against your/);
  });
});

describe("Swap Meal's goal line", () => {
  it("has a line for every Coach intake goal", () => {
    for (const goal of ["build_muscle", "lose_weight", "get_stronger", "endurance", "stay_active", "flexibility", "sport", "comeback"]) {
      assert.ok(plan.GOAL_LINE[goal], goal);
    }
  });
});

describe("when a day plan is asked for again", () => {
  it("a day within 10% of the target is kept; one further off is asked for once more", () => {
    const close = plan.normalizeDiet(plan.FAKE_DIET, { calories: 1600, proteinG: 100, carbsG: 200, fatG: 50 });
    assert.ok(plan.dayMiss(close, { calories: 1600 }) <= plan.MISS_WARNING);
    const huge = { calories: 5000, proteinG: 250, carbsG: 600, fatG: 160 };
    const far = plan.normalizeDiet(plan.FAKE_DIET, huge);
    assert.ok(plan.dayMiss(far, huge) > plan.MISS_WARNING, "doubled at most, still far from 5000");
  });
});
