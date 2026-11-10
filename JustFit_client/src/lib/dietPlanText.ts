// Trainer diet plans' words and meal times (pure, unit-tested): shared by the trainer's editor and
// the member's Meal Plan tab. The server's gym/dietPlanRules.js holds the same five meal times.
import type { MemberFood } from "./mealMatch.ts";

export type DietSlot = "breakfast" | "mid_morning" | "lunch" | "evening" | "dinner";
export const DIET_SLOTS: { id: DietSlot; label: string; orderable: boolean }[] = [
  { id: "breakfast", label: "Breakfast", orderable: true },
  { id: "mid_morning", label: "Mid-morning", orderable: false },
  { id: "lunch", label: "Lunch", orderable: true },
  { id: "evening", label: "Evening snack", orderable: false },
  { id: "dinner", label: "Dinner", orderable: true },
];
export const DIET_SLOT_LABEL = Object.fromEntries(DIET_SLOTS.map((s) => [s.id, s.label])) as Record<DietSlot, string>;
export const MAX_DIET_MEALS = 8;
export const MAX_DIET_PICKS = 3;

/** "13:30" → "1:30 PM" */
export function dietTime(time: string | null): string | null {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Vegetarian · allergic to peanuts · avoids brinjal" from shared answers */
export function sharedFoodText(food: MemberFood | null): string {
  if (!food) return "No food answers yet";
  const diet = food.diet ? { vegetarian: "Vegetarian", vegan: "Vegan", eggetarian: "Eggetarian", "non-vegetarian": "Non-vegetarian" }[food.diet] : null;
  return [diet, food.allergies ? `allergic to ${food.allergies}` : null, food.dislikes ? `avoids ${food.dislikes}` : null].filter(Boolean).join(" · ") || "No food answers yet";
}
