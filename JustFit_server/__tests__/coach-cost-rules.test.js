// The cost-saving rules of the AI Coach (coach/chatRules.js modelHistory, coach/planRules.js meal
// swap): pure functions, no database, no model.
//
//   yarn test
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const chat = require("../coach/chatRules.js");
const plan = require("../coach/planRules.js");

const turn = (i, role = i % 2 ? "coach" : "member", text = `Message ${i}`) => ({ role, text });

describe("coach chat: what the model is shown", () => {
  it("keeps the newest ten turns of a long conversation, ending with the member's message", () => {
    const messages = Array.from({ length: 20 }, (_, i) => turn(i));
    const shown = chat.modelHistory(messages);
    assert.equal(shown.length, chat.limits.modelTurns);
    assert.deepEqual(shown.at(-1), messages.at(-1));
    assert.deepEqual(shown[0], messages[10]);
  });

  it("stays within the character budget, but always includes the latest message", () => {
    const long = Array.from({ length: 6 }, (_, i) => turn(i, i % 2 ? "coach" : "member", "x".repeat(1000)));
    assert.equal(chat.modelHistory(long).length, 4, "4,000 characters of turns");
    const huge = [turn(0, "member", "y".repeat(900)), turn(1, "member", "z".repeat(5000))];
    assert.deepEqual(chat.modelHistory(huge), [huge[1]], "the latest message alone when it fills the budget");
    assert.deepEqual(chat.modelHistory([turn(0)]), [turn(0)]);
  });

  it("the instructions keep replies short unless detail is asked for", () => {
    const text = chat.chatInstructions({ coach: "priya", coachStyle: "supportive" });
    assert.match(text, /two to five sentences/);
    assert.match(text, /only when they ask for detail/i);
    assert.match(text, /not medical advice/);
  });
});

describe("coach plan: swapping one meal", () => {
  const profile = { diet: "vegetarian", cuisines: ["north indian"], allergies: "peanuts", dislikes: "karela" };
  const intake = { cookingTime: "quick", foodBudget: "medium", conditions: ["diabetes"] };
  const meal = {
    id: "m1", slot: "lunch", name: "Dal, rice and sabzi", time: "13:30", note: null,
    items: [{ name: "Dal tadka", quantity: 1, unit: "bowl", kcal: 180, proteinG: 9, carbsG: 22, fatG: 6 }, { name: "Rice", quantity: 150, unit: "g", kcal: 195, proteinG: 4, carbsG: 42, fatG: 0.5 }],
    totals: { kcal: 375, proteinG: 13, carbsG: 64, fatG: 6.5 },
  };

  it("the brief carries only the food facts and the meal being replaced, never the whole plan", () => {
    const brief = plan.mealBrief({ profile, intake, meal });
    assert.match(brief, /vegetarian/);
    assert.match(brief, /Allergies \(never include\): peanuts/);
    assert.match(brief, /Dislikes \(avoid\): karela/);
    assert.match(brief, /Health conditions: diabetes/);
    assert.match(brief, /Replace this lunch: "Dal, rice and sabzi" \(375 kcal, protein 13 g/);
    assert.doesNotMatch(brief, /breakfast|dinner|workout|Goal:/);
    assert.ok(brief.length < 700, `a short brief (${brief.length} characters)`);
  });

  it("the replacement is cleaned and scaled to the replaced meal's calories", () => {
    const next = plan.normalizeMeal({ name: "  Paneer   wrap ", note: "", items: [{ name: "Paneer wrap", quantity: 1, unit: "piece", kcal: 750, proteinG: 30, carbsG: 60, fatG: 30 }] }, meal);
    assert.equal(next.name, "Paneer wrap");
    assert.equal(next.note, null);
    assert.equal(next.items[0].quantity, 0.5, "halved to land on 375 kcal");
    assert.equal(plan.totalsOf(next.items).kcal, 375);
    const close = plan.normalizeMeal({ name: "Poha", note: "Tip", items: [{ name: "Poha", quantity: 1, unit: "bowl", kcal: 360, proteinG: 8, carbsG: 60, fatG: 8 }] }, meal);
    assert.equal(close.items[0].kcal, 360, "within 8%: left as it is");
    assert.equal(close.note, "Tip");
  });

  it("a food named after one of the member's allergies never reaches the plan, whatever the model wrote", () => {
    assert.deepEqual(plan.allergenWords("Peanuts, tree nuts and shellfish; no dairy"), ["peanut", "tree nut", "shellfish", "no dairy"]);
    assert.deepEqual(plan.allergenWords("none"), []);
    assert.deepEqual(plan.allergenWords(null), []);
    const raw = { name: "Chaat", note: "Skip the peanuts if you like", items: [
      { name: "Peanut chutney", quantity: 2, unit: "tbsp", kcal: 90, proteinG: 4, carbsG: 4, fatG: 7 },
      { name: "Sprouts chaat", quantity: 1, unit: "bowl", kcal: 300, proteinG: 18, carbsG: 44, fatG: 4 },
    ] };
    const safe = plan.normalizeMeal(raw, meal, "peanuts");
    assert.deepEqual(safe.items.map((i) => i.name), ["Sprouts chaat"]);
    assert.equal(safe.note, "Skip the peanuts if you like", "a tip may mention the allergen; a food may not");
    assert.throws(() => plan.normalizeMeal({ name: "x", note: "", items: [raw.items[0]] }, meal, "peanuts"), (e) => e.status === 502, "nothing safe left");
    const day = structuredClone(plan.FAKE_DIET);
    day.meals[1].items.push({ name: "Roasted peanuts", quantity: 30, unit: "g", kcal: 170, proteinG: 7, carbsG: 5, fatG: 14 });
    const diet = plan.normalizeDiet(day, { calories: 2000, proteinG: 120, carbsG: 220, fatG: 60 }, "peanut");
    assert.ok(diet.meals.every((m) => m.items.every((i) => !/peanut/i.test(i.name))));
    assert.equal(diet.meals.length, 5);
  });

  it("an unusable answer is a 502 the member can act on", () => {
    for (const raw of [null, {}, { items: [] }, { items: [{ name: "", kcal: 100 }] }]) {
      assert.throws(() => plan.normalizeMeal(raw, meal), (e) => e instanceof plan.CoachPlanError && e.status === 502);
    }
  });

  it("the test stand-in is a valid meal and the schema asks for exactly one", () => {
    assert.ok(plan.normalizeMeal(plan.FAKE_MEAL, meal).items.length === 2);
    assert.deepEqual(plan.mealSchema.required, ["name", "note", "items"]);
    assert.match(plan.MEAL_INSTRUCTIONS, /Never include anything from their allergies/);
    for (const text of [plan.DIET_INSTRUCTIONS, plan.MEAL_INSTRUCTIONS, plan.OPTIONS_INSTRUCTIONS]) {
      assert.match(text, /experienced Indian coach/, "every meal prompt plans like an Indian coach");
      assert.match(text, /Don't default to oats, salads, smoothies or Western foods/);
      assert.match(text, /real ingredients/);
    }
  });
});

describe("coach plan: Swap Meal options (five dishes for one meal, made for the member and the day)", () => {
  const profile = { diet: "vegetarian", cuisines: ["south indian"], allergies: "peanuts", dislikes: "karela" };
  const intake = { goal: "fat_loss", cookingTime: "quick", foodBudget: "low", conditions: ["diabetes"] };
  const targets = { calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 };
  const meal = {
    id: "m1", slot: "lunch", name: "Dal, rice and sabzi", time: "13:30", note: null,
    items: [{ name: "Dal tadka", quantity: 1, unit: "bowl", kcal: 180, proteinG: 9, carbsG: 22, fatG: 6 }, { name: "Rice", quantity: 150, unit: "g", kcal: 195, proteinG: 4, carbsG: 42, fatG: 0.5 }],
    totals: { kcal: 375, proteinG: 13, carbsG: 64, fatG: 6.5 },
  };

  it("what's left of the day comes from the targets less the diary, giving back a meal already logged", () => {
    const eaten = { kcal: 800, proteinG: 60, carbsG: 90, fatG: 30 };
    assert.deepEqual(plan.remainingFor(targets, eaten), { kcal: 1200, proteinG: 90, carbsG: 110, fatG: 30 });
    assert.deepEqual(plan.remainingFor(targets, eaten, meal.totals), { kcal: 1575, proteinG: 103, carbsG: 174, fatG: 36.5 });
    assert.equal(plan.remainingFor(targets, { kcal: 2300, proteinG: 0, carbsG: 0, fatG: 0 }).kcal, -300, "over the target goes negative");
  });

  it("an option aims at the meal's calories, or what's left of the day when that is less (never under half the meal); lighter takes a quarter off", () => {
    assert.equal(plan.optionTargetKcal(375, 1200), 375);
    assert.equal(plan.optionTargetKcal(375, 200), 200);
    assert.equal(plan.optionTargetKcal(375, 100), 188, "half the meal is the floor");
    assert.equal(plan.optionTargetKcal(375, -50), 375, "a day already over: the meal's own size (the brief says to keep it light)");
    assert.equal(plan.optionTargetKcal(375, 1200, "lighter"), 281);
    assert.equal(plan.optionTargetKcal(375, 250, "lighter"), 250);
  });

  it("the brief carries the goal, the day's room, the food facts, the meal, the chip and the dishes not to repeat", () => {
    const remaining = { kcal: 1200, proteinG: 90, carbsG: 110, fatG: 30 };
    const brief = plan.optionsBrief({ profile, intake, targets, remaining, meal, targetKcal: 375, exclude: ["Vegetable poha", "Idli sambar"], preference: "more_protein" });
    assert.match(brief, /^Goal: fat loss: filling, high-fibre/);
    assert.match(brief, /Daily targets: 2000 kcal, protein 150 g/);
    assert.match(brief, /Left for today: 1200 kcal, protein 90 g, carbs 110 g, fat 30 g\./);
    assert.match(brief, /Cuisines they like: south indian/);
    assert.match(brief, /Allergies \(never include\): peanuts/);
    assert.match(brief, /Dislikes \(avoid\): karela/);
    assert.match(brief, /Health conditions: diabetes/);
    assert.match(brief, /Replace this lunch: "Dal, rice and sabzi" \(375 kcal/);
    assert.match(brief, /Aim for about 375 kcal each, with at least 13 g protein\./);
    assert.match(brief, /The member asked for more protein/);
    assert.match(brief, /Don't suggest these again: Vegetable poha; Idli sambar\./);
    assert.match(brief, /Give 5 different lunch options\./);
    assert.doesNotMatch(brief, /breakfast|dinner|workout/);
    assert.ok(brief.length < 1100, `a short brief (${brief.length} characters)`);
    const over = plan.optionsBrief({ profile, intake, targets, remaining: { kcal: -300, proteinG: -5, carbsG: 0, fatG: 0 }, meal, targetKcal: 375 });
    assert.match(over, /already used up \(over by 300 kcal\): keep the options light/);
    assert.doesNotMatch(over, /The member asked for|Don't suggest/);
    const noNegatives = plan.optionsBrief({ profile, intake, targets, remaining: { kcal: 100, proteinG: -5, carbsG: 10, fatG: -1 }, meal, targetKcal: 100 });
    assert.match(noNegatives, /Left for today: 100 kcal, protein 0 g, carbs 10 g, fat 0 g\./);
  });

  it("the fake options give five dishes: cleaned, scaled, no allergen, no dish twice, nothing from the exclude list", () => {
    const options = plan.normalizeOptions(plan.FAKE_OPTIONS, meal, "peanuts", { exclude: [meal.name] });
    assert.deepEqual(options.map((o) => o.name), ["Paneer tikka wrap", "Rajma chawal", "Curd rice with vegetables", "Moong dal khichdi", "Vegetable upma and sambar"]);
    assert.deepEqual(options[0].items.map((i) => i.name), ["Paneer tikka wrap"], "the peanut chutney is gone");
    assert.equal(options[0].description, "Protein-rich and quick, so it keeps you full on a training day.");
    assert.equal(options[1].note, null);
    for (const o of options) assert.ok(Math.abs(plan.totalsOf(o.items).kcal - 375) / 375 <= 0.15, `${o.name} lands near the meal (${plan.totalsOf(o.items).kcal} kcal)`);
    // Dishes offered recently go last, after everything new; the meal itself never comes back
    const fewer = plan.normalizeOptions(plan.FAKE_OPTIONS, meal, "", { exclude: ["RAJMA CHAWAL", "curd rice with vegetables", meal.name] });
    assert.deepEqual(fewer.map((o) => o.name), ["Paneer tikka wrap", "Moong dal khichdi", "Vegetable upma and sambar", "Rajma chawal", "Curd rice with vegetables"]);
    assert.equal(fewer[0].items.length, 2, "no allergy: the chutney stays");
    const sameMeal = { ...meal, name: "Rajma chawal" };
    assert.deepEqual(plan.normalizeOptions(plan.FAKE_OPTIONS, sameMeal, "").map((o) => o.name), ["Paneer tikka wrap", "Curd rice with vegetables", "Moong dal khichdi", "Vegetable upma and sambar"], "the dish being replaced is never an option");
    // Lighter: every option scaled towards 281 kcal, as far as measurable portions allow (a single bowl stays a bowl)
    const plain = plan.normalizeOptions(plan.FAKE_OPTIONS, meal, "");
    const lighter = plan.normalizeOptions(plan.FAKE_OPTIONS, meal, "", { targetKcal: 281 });
    for (const [i, o] of lighter.entries()) assert.ok(plan.totalsOf(o.items).kcal <= plan.totalsOf(plain[i].items).kcal, `${o.name} no heavier than before (${plan.totalsOf(o.items).kcal} kcal)`);
    assert.equal(plan.totalsOf(lighter[1].items).kcal, 228, "half a bowl of rajma and 87 g rice: 228 kcal");
    assert.throws(() => plan.normalizeOptions({ options: [] }, meal), (e) => e.status === 502);
    assert.throws(() => plan.normalizeOptions({ options: [{ name: "x", description: "", note: "", items: [{ name: "Peanut bar", quantity: 1, unit: "piece", kcal: 200, proteinG: 5, carbsG: 20, fatG: 10 }] }] }, meal, "peanuts"), (e) => e.status === 502, "nothing safe left");
    assert.throws(() => plan.normalizeOptions(null, meal), (e) => e.status === 502);
  });

  it("the member's portions set each food's numbers again; a portion of 0 leaves the food out; stored foods are cleaned again", () => {
    const items = plan.storedItems(JSON.stringify([
      { name: "Rajma", quantity: 1, unit: "bowl", kcal: 230, proteinG: 13, carbsG: 36, fatG: 4 },
      { name: "Rice", quantity: 120, unit: "g", kcal: 156, proteinG: 3, carbsG: 34, fatG: 0.4 },
    ]));
    assert.deepEqual(plan.editedItems(items, [2, 0]).map((i) => [i.name, i.quantity, i.kcal, i.proteinG]), [["Rajma", 2, 460, 26]]);
    assert.deepEqual(plan.editedItems(items, [1, 30]).map((i) => [i.name, i.quantity, i.kcal]), [["Rajma", 1, 230], ["Rice", 30, 39]]);
    assert.deepEqual(plan.editedItems(items, [1.26, 120])[0].quantity, 1.5, "a bowl moves in halves, and the numbers follow the rounded portion");
    assert.equal(plan.editedItems(items, [1.26, 120])[0].kcal, 345);
    assert.deepEqual(plan.editedItems(items, [0, 0]), []);
    assert.throws(() => plan.storedItems("[]"), (e) => e.status === 502);
    assert.throws(() => plan.storedItems(JSON.stringify([{ name: "", quantity: 1, unit: "g", kcal: 1, proteinG: 0, carbsG: 0, fatG: 0 }])), (e) => e.status === 502);
    assert.deepEqual(plan.storedItems(JSON.stringify([{ name: "Rice", quantity: -5, unit: "stone", kcal: 99999, proteinG: "x", carbsG: 3, fatG: 1 }])), [{ name: "Rice", quantity: 1, unit: "piece", kcal: 5000, proteinG: 0, carbsG: 3, fatG: 1 }]);
  });
});
