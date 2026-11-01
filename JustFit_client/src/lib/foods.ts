// Search and maths for the built-in food list (data/foods.ts). Pure, so it is unit-tested directly.
import { FOODS, type Food, type FoodUnit } from "../data/foods.ts";

export type Nutrients = { kcal: number; proteinG: number; carbsG: number; fatG: number };

const normalize = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// How well `query` matches one name: 3 the whole name starts with it, 2 a word in it starts
// with it, 1 every typed word is somewhere in it, 0 no match
function score(name: string, query: string): number {
  const n = normalize(name);
  if (n.startsWith(query)) return 3;
  if (n.split(" ").some((word) => word.startsWith(query))) return 2;
  return query.split(" ").every((word) => n.includes(word)) ? 1 : 0;
}

/** Up to `limit` foods matching what was typed (its name or another name for it), best first. */
export function searchFoods(text: string, limit = 5, foods: Food[] = FOODS): Food[] {
  const query = normalize(text);
  if (query.length < 2) return [];
  return foods
    // "Roti / chapati" is scored as each of its names
    .map((food) => ({ food, s: Math.max(...food.name.split(" / ").map((n) => score(n, query)), ...food.aka.map((a) => score(a, query) - 0.5)) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.food.name.length - b.food.name.length || a.food.name.localeCompare(b.food.name))
    .slice(0, limit)
    .map((r) => r.food);
}

/** The units a food can be measured in: ml for a drink, else g, plus pieces when it is counted. */
export function unitsFor(food: Food | null): FoodUnit[] {
  if (!food) return ["g", "ml", "piece"];
  const base: FoodUnit[] = [food.liquid ? "ml" : "g"];
  return food.pieceG ? [...base, "piece"] : base;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Calories and macros for `amount` of a food in `unit` (pieces use the food's piece weight). */
export function nutrientsFor(food: Food, amount: number, unit: FoodUnit): Nutrients | null {
  if (!(amount > 0)) return null;
  const base = unit === "piece" ? (food.pieceG ? amount * food.pieceG : null) : amount;
  if (base === null) return null;
  const f = base / 100;
  return { kcal: Math.round(food.per100.kcal * f), proteinG: round1(food.per100.proteinG * f), carbsG: round1(food.per100.carbsG * f), fatG: round1(food.per100.fatG * f) };
}

/** Numbers known for `amount` of something, rescaled to another amount in the same unit (an AI estimate). */
export function rescale(known: Nutrients, knownAmount: number, amount: number): Nutrients | null {
  if (!(knownAmount > 0) || !(amount > 0)) return null;
  const f = amount / knownAmount;
  return { kcal: Math.round(known.kcal * f), proteinG: round1(known.proteinG * f), carbsG: round1(known.carbsG * f), fatG: round1(known.fatG * f) };
}

export const findFood = (id: string | null) => (id ? FOODS.find((f) => f.id === id) ?? null : null);
