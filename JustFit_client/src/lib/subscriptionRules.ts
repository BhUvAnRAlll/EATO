import { SLOT_LABEL, type MealSlot } from "./mealRules.ts";

// Meal subscriptions on the phone (pure, unit-tested in lib/__tests__/subscriptions.test.ts)

/** What a meal subscription costs at the menu price (the server prices it again): rounded to the rupee */
export function subscriptionPrice(unitPrice: number, quantity: number, days: number, percentOff: number) {
  const full = unitPrice * quantity * days;
  return { full, total: Math.round((full * (100 - percentOff)) / 100) };
}

export const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** What a subscription is, in one line: "Lunch · 2 a day" (a plan from before 2027-01-10: "3 meals a day") */
export const subscriptionLine = (sub: { meal: { slot: MealSlot; quantity: number } | null; mealsPerDay: number }) =>
  sub.meal ? `${SLOT_LABEL[sub.meal.slot]} · ${sub.meal.quantity} a day` : `${sub.mealsPerDay} meals a day`;
