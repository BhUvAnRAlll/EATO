import { homeImages } from "@/constants/images";

// The Meals tab's promotional section when the Super Admin has no live banners yet (2026-11-10): the
// two things worth knowing about justFit meals. Each opens a list; nothing here changes a price.
export type MealPromo = { id: string; badge: string; title: string; text: string; cta: string; image: number; list: "popular" | "high_protein" };

export const MEAL_PROMOS: MealPromo[] = [
  { id: "subscribe", badge: "SUBSCRIBE & SAVE", title: "Your meal, every day", text: "Subscribe to any meal and save up to 10%", cta: "Pick a meal", image: homeImages["meal-grilled-chicken"], list: "popular" },
  { id: "protein", badge: "FOR YOUR GOAL", title: "High protein meals", text: "25 g of protein or more, cooked fresh", cta: "Order now", image: homeImages["meal-paneer-tikka"], list: "high_protein" },
];
