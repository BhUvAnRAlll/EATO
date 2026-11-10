// Which justFit menu meals to recommend to a member (pure, unit-tested; 2026-11-10, the user's
// "market our meals so they order"). Used by Home's "Picked for you", the Meal Plan's "Order from
// justFit" and the order reminders. Two steps:
//   1. Safety: never a meal that breaks the member's diet or names one of their allergies. A meal
//      that names something they dislike is kept but ranked last.
//   2. Fit: the meals closest to a target (a planned meal's kcal and protein, or what's left of
//      the day), with more protein counting as better and too many calories as worse.
// No React Native or "@/" imports, so the server can load it like lib/nutrition (no AI, no cost).

export type MatchDiet = "vegetarian" | "non-vegetarian" | "eggetarian" | "vegan";
export type MatchMeal = { id: string; name: string; description: string | null; ingredients: string | null; diet: MatchDiet; calories: number; proteinG: number; tags?: string[] };
export type MemberFood = { diet: MatchDiet | null; allergies: string | null; dislikes: string | null };
export type MatchTarget = { kcal: number; proteinG: number };
export type Match<M extends MatchMeal> = { meal: M; kcalDiff: number; proteinDiff: number; disliked: boolean };

// The meal diets each member diet may eat
export const DIET_ALLOWS: Record<MatchDiet, MatchDiet[]> = {
  vegan: ["vegan"],
  vegetarian: ["vegetarian", "vegan"],
  eggetarian: ["vegetarian", "vegan", "eggetarian"],
  "non-vegetarian": ["vegetarian", "vegan", "eggetarian", "non-vegetarian"],
};

/**
 * The words of a member's allergies or dislikes ("Peanuts, shellfish and brinjal" → ["peanuts",
 * "shellfish", "brinjal"]): split on commas, semicolons, slashes, new lines, "and" and "or"; 3+ letters.
 */
export function foodWords(text: string | null | undefined): string[] {
  if (typeof text !== "string") return [];
  const words = text
    .toLowerCase()
    .split(/[,;/\n]|\band\b|\bor\b/)
    .map((w) => w.replace(/\b(allerg(y|ic)|to|no|avoid|i|am|don'?t|like)\b/g, " ").replace(/[^a-z\s]/g, " ").trim().replace(/\s+/g, " "))
    .filter((w) => w.length >= 3);
  return [...new Set(words)].slice(0, 20);
}

// "peanuts" also finds "peanut"; matched at the start of a word, so "egg" finds "egg curry" and "eggs"
function mentions(hay: string, word: string): boolean {
  const stem = word.endsWith("s") && word.length > 4 ? word.slice(0, -1) : word;
  return new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(hay);
}

/** { block } when the meal breaks the diet or names an allergy, { warn } for a dislike, {} when it fits */
export function mealConflict(meal: MatchMeal, food: MemberFood | null): { block?: string; warn?: string } {
  if (!food) return {};
  if (food.diet && !DIET_ALLOWS[food.diet].includes(meal.diet)) return { block: "diet" };
  const hay = `${meal.name} ${meal.description ?? ""} ${meal.ingredients ?? ""}`.toLowerCase();
  const allergy = foodWords(food.allergies).find((w) => mentions(hay, w));
  if (allergy) return { block: `allergy:${allergy}` };
  const dislike = foodWords(food.dislikes).find((w) => mentions(hay, w));
  return dislike ? { warn: dislike } : {};
}

/** The meals the member may be offered at all (diet and allergies) */
export function safeMeals<M extends MatchMeal>(meals: M[], food: MemberFood | null): M[] {
  return meals.filter((m) => !mealConflict(m, food).block);
}

// How far a meal is from the target: relative kcal distance, extra weight on going over, and a
// bonus for protein (up to the target) so a high-protein choice wins a tie
function distance(meal: MatchMeal, target: MatchTarget): number {
  const kcal = Math.max(target.kcal, 1);
  const over = Math.max(0, meal.calories - target.kcal) / kcal;
  const under = Math.max(0, target.kcal - meal.calories) / kcal;
  const protein = target.proteinG > 0 ? Math.min(meal.proteinG, target.proteinG * 1.5) / target.proteinG : 0;
  return over * 1.5 + under - protein * 0.4;
}

/**
 * Up to `max` safe meals closest to the target, best first. Meals over 1.4× the target's kcal are
 * left out (never push a member far over), disliked ones go last, and `exclude` ids (already
 * recommended elsewhere on the screen) are skipped.
 */
export function matchMeals<M extends MatchMeal>(meals: M[], food: MemberFood | null, target: MatchTarget, { max = 3, exclude = [] as string[] } = {}): Match<M>[] {
  if (!(target.kcal > 0)) return [];
  return meals
    .filter((m) => !exclude.includes(m.id) && m.calories <= target.kcal * 1.4)
    .map((meal) => ({ meal, conflict: mealConflict(meal, food) }))
    .filter((x) => !x.conflict.block)
    .map(({ meal, conflict }) => ({ meal, kcalDiff: Math.round(meal.calories - target.kcal), proteinDiff: Math.round(meal.proteinG - target.proteinG), disliked: Boolean(conflict.warn), score: distance(meal, target) }))
    .sort((a, b) => Number(a.disliked) - Number(b.disliked) || a.score - b.score || a.meal.name.localeCompare(b.meal.name))
    .slice(0, max)
    .map(({ score: _score, ...match }) => match);
}

/** Why a meal suits a planned meal: "30 kcal under your lunch · 4 g more protein" */
export function planReason(match: Match<MatchMeal>, slotLabel: string): string {
  const slot = slotLabel.toLowerCase();
  const kcal = Math.abs(match.kcalDiff) <= 25 ? `About the same kcal as your ${slot}` : `${Math.abs(match.kcalDiff)} kcal ${match.kcalDiff < 0 ? "under" : "over"} your ${slot}`;
  const protein = match.proteinDiff >= 3 ? `${match.proteinDiff} g more protein` : match.proteinDiff <= -3 ? `${-match.proteinDiff} g less protein` : "same protein";
  return `${kcal} · ${protein}`;
}

/**
 * What one meal should aim for from what's left of the day: the calories and protein left, shared
 * over the meal times still to come (at least one), capped at 800 kcal. null when little is left
 * (under 150 kcal): nothing to recommend.
 */
export function targetFromRemaining(left: MatchTarget, mealsLeft: number): MatchTarget | null {
  if (left.kcal < 150) return null;
  const share = Math.max(1, mealsLeft);
  return { kcal: Math.min(800, Math.round(left.kcal / share)), proteinG: Math.max(0, Math.round(left.proteinG / share)) };
}

/** Why a meal suits what's left: "38 g of the 64 g protein you still need" */
export function remainingReason(meal: MatchMeal, left: MatchTarget): string {
  if (left.proteinG >= 10 && meal.proteinG >= 10) return `${Math.round(Math.min(meal.proteinG, left.proteinG))} g of the ${Math.round(left.proteinG)} g protein you still need`;
  return `${meal.calories} kcal of the ${Math.round(left.kcal)} kcal left today`;
}

/** Breakfast, lunch or dinner still worth ordering at this India hour (for "meals left today") */
export function mealTimesLeft(hourInIndia: number): number {
  if (hourInIndia < 10) return 3;
  if (hourInIndia < 16) return 2;
  if (hourInIndia < 22) return 1;
  return 0;
}

/** The hour in India (UTC+5:30), 0-23, whatever the phone's own time zone */
export function indiaHour(now: Date): number {
  const minutes = ((Math.floor(now.getTime() / 60000 + 330) % 1440) + 1440) % 1440;
  return Math.floor(minutes / 60);
}

// After a workout (the gym check-out): a meal of about 500 kcal with plenty of protein
export const REFUEL_TARGET: MatchTarget = { kcal: 500, proteinG: 30 };
export const REFUEL_MIN_PROTEIN_G = 20;

/** Up to `max` meals to refuel with: protein-rich ones (20 g+) when the menu has them, else any safe ones */
export function refuelMeals<M extends MatchMeal>(meals: M[], food: MemberFood | null, max = 2): Match<M>[] {
  const rich = meals.filter((m) => m.proteinG >= REFUEL_MIN_PROTEIN_G);
  const picks = matchMeals(rich, food, REFUEL_TARGET, { max });
  return picks.length > 0 ? picks : matchMeals(meals, food, REFUEL_TARGET, { max });
}

/** "32 g protein to help your muscles recover" */
export function refuelReason(meal: MatchMeal): string {
  return meal.proteinG >= REFUEL_MIN_PROTEIN_G ? `${Math.round(meal.proteinG)} g protein to help your muscles recover` : `${meal.calories} kcal to refuel after your workout`;
}
