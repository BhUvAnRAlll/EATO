// Which meal reminders to schedule for a day of the coach's plan. Pure: no React Native imports,
// so it runs under `npm test`; lib/mealReminders.ts hands the result to expo-notifications.

type PlanSlot = "breakfast" | "morning_snack" | "lunch" | "evening_snack" | "dinner";
type ReminderMeal = { id: string; slot: PlanSlot; name: string; time: string; logged: boolean; totals: { kcal: number } };

export type MealReminder = {
  // Stable per day and meal, so scheduling again replaces rather than duplicates
  id: string;
  at: Date;
  title: string;
  body: string;
};

// Every meal reminder's identifier starts with this, so they can be cleared without touching
// any other notification
export const REMINDER_PREFIX = "justfit-meal-";

const SLOT: Record<PlanSlot, string> = { breakfast: "Breakfast", morning_snack: "Morning snack", lunch: "Lunch", evening_snack: "Evening snack", dinner: "Dinner" };

// "13:30" → "1:30 PM" (the plan keeps 24-hour times)
export function clockLabel(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

// The day's reminders: one at each planned meal's time, for meals not logged yet whose time is
// still at least a minute away. `date` is the plan's day (YYYY-MM-DD) on the phone's clock.
export function mealReminders(meals: readonly ReminderMeal[], date: string, now: Date): MealReminder[] {
  const [y, m, d] = date.split("-").map(Number);
  const soonest = now.getTime() + 60_000;
  return meals.flatMap((meal) => {
    const [hour, minute] = meal.time.split(":").map(Number);
    if (meal.logged || !Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return [];
    const at = new Date(y, m - 1, d, hour, minute);
    if (Number.isNaN(at.getTime()) || at.getTime() < soonest) return [];
    return [
      {
        id: `${REMINDER_PREFIX}${date}-${meal.id}`,
        at,
        title: `${SLOT[meal.slot]} at ${clockLabel(hour, minute)}`,
        body: `${meal.name} · ${Math.round(meal.totals.kcal).toLocaleString("en-IN")} kcal. Tap to log it when you eat.`,
      },
    ];
  });
}
