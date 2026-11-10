import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cartTotals, clockText, closesAtText, dayLabel, itemsLine, macroLine, macrosMismatch, rupees, shiftTime, stepIndex, timeRange } from "../mealRules.ts";

describe("meal ordering rules", () => {
  it("writes rupees with Indian grouping", () => {
    assert.equal(rupees(249), "₹249");
    assert.equal(rupees(124999), "₹1,24,999");
  });

  it("writes times and ranges the short way", () => {
    assert.equal(clockText("07:00"), "7 am");
    assert.equal(clockText("12:30"), "12:30 pm");
    assert.equal(clockText("00:15"), "12:15 am");
    assert.equal(timeRange("07:00", "09:00"), "7 – 9 am");
    assert.equal(timeRange("12:30", "14:00"), "12:30 – 2 pm");
    assert.equal(timeRange("11:00", "13:00"), "11 am – 1 pm");
  });

  it("moves times in half hours inside the day, and says when orders close", () => {
    assert.equal(shiftTime("07:00", 30), "07:30");
    assert.equal(shiftTime("00:00", -30), "00:00");
    assert.equal(shiftTime("23:30", 30), "23:30");
    assert.equal(closesAtText("12:30", 120), "10:30 am");
    assert.equal(closesAtText("07:00", 120), "5 am");
  });

  it("names days against today", () => {
    assert.equal(dayLabel("2026-11-09", "2026-11-09"), "Today");
    assert.equal(dayLabel("2026-11-10", "2026-11-09"), "Tomorrow");
    assert.equal(dayLabel("2026-11-12", "2026-11-09"), "Thu, 12 Nov");
  });

  it("adds up the cart and the order's lines", () => {
    assert.deepEqual(cartTotals([{ mealId: "a", quantity: 2, price: 249, calories: 520, proteinG: 32 }, { mealId: "b", quantity: 1, price: 149, calories: 300, proteinG: 20 }]), {
      count: 3, total: 647, calories: 1340, proteinG: 84,
    });
    assert.equal(itemsLine([{ name: "Paneer Bowl", quantity: 2 }, { name: "Egg Bhurji", quantity: 1 }]), "2 × Paneer Bowl, Egg Bhurji");
    assert.equal(macroLine({ calories: 520, proteinG: 32.4, carbsG: 48, fatG: 18 }), "520 kcal · 32g P · 48g C · 18g F");
  });

  it("knows the steps and spots macros that don't add up", () => {
    assert.equal(stepIndex("placed"), 0);
    assert.equal(stepIndex("delivered"), 4);
    assert.equal(stepIndex("quality_check"), 2, "quality check and ready show as preparing");
    assert.equal(stepIndex("ready"), 2);
    assert.equal(stepIndex("cancelled"), -1);
    assert.equal(macrosMismatch(520, 32, 48, 18), false); // 482 kcal from macros: close enough
    assert.equal(macrosMismatch(900, 32, 48, 18), true);
  });
});

describe("meal ordering rules: the admin's day and directions", () => {
  it("moves days and builds a directions link", async () => {
    const { addDays, directionsUrl } = await import("../mealRules.ts");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(directionsUrl({ latitude: 13.3392, longitude: 77.1017, line: "x" }), "https://www.google.com/maps/dir/?api=1&destination=13.3392,77.1017");
    assert.equal(directionsUrl({ latitude: null, longitude: null, line: "4B, MG Road" }), "https://www.google.com/maps/dir/?api=1&destination=4B%2C%20MG%20Road");
    assert.equal(directionsUrl({ latitude: null, longitude: null, line: null }), null);
  });
});

describe("meal ordering rules: the storefront", () => {
  const meal = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, description: null, ingredients: null, diet: "vegetarian" as const, tags: [] as ("bestseller" | "gourmet" | "high_protein" | "special")[], proteinG: 10, price: 100, mrp: null as number | null, ...over });
  const meals = [
    meal("Paneer Tikka Bowl", { proteinG: 32, tags: ["bestseller"], ingredients: "paneer, rice" }),
    meal("Chicken Biryani", { diet: "non-vegetarian", proteinG: 40, price: 199, mrp: 249 }),
    meal("Egg Bhurji", { diet: "eggetarian", proteinG: 18, tags: ["special"] }),
    meal("Dal Rice", { diet: "vegan", proteinG: 14 }),
  ];
  const categories = [
    { id: 1, kind: "tile" as const, name: "Under 150", featured: false, mealIds: ["Paneer Tikka Bowl", "Egg Bhurji", "Dal Rice"] },
    { id: 2, kind: "food" as const, name: "Biryani & Rice", featured: true, mealIds: ["Chicken Biryani", "Dal Rice"] },
    { id: 3, kind: "food" as const, name: "Non-veg only", featured: false, mealIds: ["Chicken Biryani"] },
  ];

  it("builds the sections, and Veg only drops non-veg, egg and empty categories", async () => {
    const { shopSections } = await import("../mealRules.ts");
    const all = shopSections(meals, categories, false);
    assert.deepEqual(all.highProtein.map((m) => m.id), ["Chicken Biryani", "Paneer Tikka Bowl"]);
    assert.deepEqual(all.specials.map((m) => m.id), ["Chicken Biryani", "Egg Bhurji"]);
    assert.deepEqual(all.rows.map((r) => r.meals.map((m) => m.id)), [["Chicken Biryani", "Dal Rice"]]);
    const veg = shopSections(meals, categories, true);
    assert.deepEqual(veg.meals.map((m) => m.id), ["Paneer Tikka Bowl", "Dal Rice"]);
    assert.deepEqual(veg.foods.map((c) => c.id), [2], "the non-veg-only category goes");
    assert.deepEqual(veg.specials.map((m) => m.id), ["Paneer Tikka Bowl"], "no specials left, so bestsellers");
  });

  it("keeps recent searches newest first without repeats", async () => {
    const { addRecentSearch } = await import("../mealRules.ts");
    assert.deepEqual(addRecentSearch([], "  paneer  bowl "), ["paneer bowl"]);
    assert.deepEqual(addRecentSearch(["biryani", "Paneer"], "paneer"), ["paneer", "biryani"], "a repeat moves to the top");
    assert.deepEqual(addRecentSearch(["biryani"], "a"), ["biryani"], "one letter isn't kept");
    assert.deepEqual(addRecentSearch(["a1", "a2", "a3"], "new", 3), ["new", "a1", "a2"]);
  });

  it("search box examples come from the menu, else the built-in list", async () => {
    const { searchExamples, SEARCH_EXAMPLES } = await import("../mealRules.ts");
    assert.deepEqual(searchExamples(meals, categories), ["biryani & rice", "non-veg only", "paneer tikka bowl", "chicken biryani", "egg bhurji", "dal rice"]);
    assert.deepEqual(searchExamples(meals, categories, 2), ["biryani & rice", "non-veg only"]);
    assert.deepEqual(searchExamples([], []), SEARCH_EXAMPLES);
  });

  it("search falls back to close and related meals, then popular ones", async () => {
    const { searchWithFallback } = await import("../mealRules.ts");
    const exact = searchWithFallback(meals, categories, "paneer");
    assert.equal(exact.kind, "exact");
    const typo = searchWithFallback(meals, categories, "panner");
    assert.equal(typo.kind, "close");
    assert.deepEqual(typo.meals.map((m) => m.id), ["Paneer Tikka Bowl"]);
    assert.equal(typo.didYouMean, "paneer");
    const biryani = searchWithFallback(meals, categories, "biriyani");
    assert.equal(biryani.kind, "close");
    assert.equal(biryani.meals[0].id, "Chicken Biryani");
    assert.equal(biryani.didYouMean, "biryani");
    const some = searchWithFallback(meals, categories, "paneer pizza");
    assert.equal(some.kind, "related");
    assert.deepEqual(some.meals.map((m) => m.id), ["Paneer Tikka Bowl"]);
    const none = searchWithFallback(meals, categories, "sushi");
    assert.equal(none.kind, "popular");
    assert.equal(none.didYouMean, null);
    assert.ok(none.meals.length > 0, "never an empty screen");
    assert.equal(searchWithFallback(meals, categories, "zz").kind, "popular", "short typos aren't guessed");
  });

  it("searches names, ingredients and categories; suggests names", async () => {
    const { searchMeals, suggestions, discountText, cardBadge } = await import("../mealRules.ts");
    assert.deepEqual(searchMeals(meals, categories, "paneer").map((m) => m.id), ["Paneer Tikka Bowl"]);
    assert.deepEqual(searchMeals(meals, categories, "rice").map((m) => m.id), ["Dal Rice", "Chicken Biryani", "Paneer Tikka Bowl"]);
    assert.deepEqual(searchMeals(meals, categories, "biryani rice dal").map((m) => m.id), ["Dal Rice"]);
    assert.equal(searchMeals(meals, categories, "").length, 4);
    assert.deepEqual(suggestions(meals, categories, "bi"), ["Biryani & Rice", "Chicken Biryani"]);
    assert.deepEqual(suggestions(meals, categories, "b"), []);
    assert.equal(discountText(199, 249), "20% off");
    assert.equal(discountText(199, null), null);
    assert.equal(cardBadge({ tags: ["special", "bestseller"], proteinG: 10 }), "Bestseller");
    assert.equal(cardBadge({ tags: [], proteinG: 30 }), "High protein");
    assert.equal(cardBadge({ tags: [], proteinG: 10 }), null);
  });

  it("builds the quick lists, the popular row, the sort and the diet filter", async () => {
    const { quickList, popularMeals, sortMeals, byDiet, isQuickList } = await import("../mealRules.ts");
    const menu = [
      { ...meals[0], calories: 520 },
      { ...meals[1], calories: 610 },
      { ...meals[2], calories: 320 },
      { ...meals[3], calories: 380 },
      { ...meal("Mini Thali"), calories: 700 },
      { ...meal("Rajma Rice"), calories: 500 },
    ];
    const cats = [...categories, { id: 4, kind: "tile" as const, name: "Combos", featured: false, mealIds: ["Rajma Rice"] }];
    assert.deepEqual(popularMeals(menu).map((m) => m.id), ["Paneer Tikka Bowl", "Chicken Biryani", "Egg Bhurji", "Dal Rice", "Mini Thali", "Rajma Rice"]);
    assert.deepEqual(quickList(menu, cats, "low_calorie").map((m) => m.id), ["Egg Bhurji", "Dal Rice"]);
    assert.deepEqual(quickList(menu, cats, "veg").map((m) => m.id), ["Paneer Tikka Bowl", "Dal Rice", "Mini Thali", "Rajma Rice"]);
    assert.deepEqual(quickList(menu, cats, "non_veg").map((m) => m.id), ["Chicken Biryani", "Egg Bhurji"]);
    assert.deepEqual(quickList(menu, cats, "combos").map((m) => m.id), ["Mini Thali", "Rajma Rice"]);
    assert.deepEqual(sortMeals(menu, "calories").map((m) => m.calories), [320, 380, 500, 520, 610, 700]);
    assert.equal(sortMeals(menu, "recommended")[0].id, "Paneer Tikka Bowl");
    assert.deepEqual(byDiet(menu, "vegan").map((m) => m.id), ["Dal Rice"]);
    assert.equal(byDiet(menu, null).length, 6);
    assert.equal(isQuickList("combos"), true);
    assert.equal(isQuickList("toString"), false);
    assert.equal(isQuickList(undefined), false);
  });
});
