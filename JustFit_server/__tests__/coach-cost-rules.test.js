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
  });
});
