import type { Macros } from "./types.ts";

export type NutritionValues = Macros & { calories: number };

export type Ingredient = {
  id: string;
  name: string;
  quantity: number;
  unit: string; // e.g. "g", "ml", "piece"
  // Nutrition for this quantity, from a referenced data source. null = unknown.
  nutrition: NutritionValues | null;
  source: string | null; // e.g. "IFCT 2017", "USDA FoodData Central #171705"
};

export type Meal = {
  id: string;
  name: string;
  ingredients: Ingredient[];
};

export type NutritionTotals = NutritionValues & {
  // true when any ingredient has no nutrition data; totals are then a lower bound
  incomplete: boolean;
  missing: string[]; // names of ingredients without data
};

const zero = (): NutritionTotals => ({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0, incomplete: false, missing: [] });

const round1 = (n: number) => Math.round(n * 10) / 10;

function tidy(totals: NutritionTotals): NutritionTotals {
  return {
    ...totals,
    calories: Math.round(totals.calories),
    proteinG: round1(totals.proteinG),
    carbsG: round1(totals.carbsG),
    fatG: round1(totals.fatG),
  };
}

// Meal totals = sum of its ingredients' actual quantities
export function mealNutrition(meal: Meal): NutritionTotals {
  const totals = zero();
  for (const ingredient of meal.ingredients) {
    if (!ingredient.nutrition) {
      totals.incomplete = true;
      totals.missing.push(ingredient.name);
      continue;
    }
    totals.calories += ingredient.nutrition.calories;
    totals.proteinG += ingredient.nutrition.proteinG;
    totals.carbsG += ingredient.nutrition.carbsG;
    totals.fatG += ingredient.nutrition.fatG;
  }
  return tidy(totals);
}

// Day totals = sum of the selected meals
export function dailyNutrition(meals: Meal[]): NutritionTotals {
  const totals = zero();
  for (const meal of meals) {
    const m = mealNutrition(meal);
    totals.calories += m.calories;
    totals.proteinG += m.proteinG;
    totals.carbsG += m.carbsG;
    totals.fatG += m.fatG;
    totals.incomplete ||= m.incomplete;
    totals.missing.push(...m.missing);
  }
  return tidy(totals);
}

// What's left of the daily target (negative = over)
export function remainingNutrition(target: NutritionValues, eaten: NutritionTotals): NutritionTotals {
  return tidy({
    calories: target.calories - eaten.calories,
    proteinG: target.proteinG - eaten.proteinG,
    carbsG: target.carbsG - eaten.carbsG,
    fatG: target.fatG - eaten.fatG,
    incomplete: eaten.incomplete,
    missing: eaten.missing,
  });
}
