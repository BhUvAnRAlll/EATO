// The coach's tip on the Macro tab: worked out on the phone from what's logged today, the day's
// targets and the coach's plan for the rest of the day. No AI call, so it costs nothing; the
// tip's question opens the chat for a fuller answer.

type Totals = { kcal: number; proteinG: number };

export type CoachTip = {
  kind: "protein_short" | "protein_covered" | "over_kcal";
  // What the coach says on the card
  message: string;
  // The question it puts in the chat box (sent only if the member sends it)
  ask: string;
};

// Vegetarian Indian additions with about how much protein each adds, so a tip suits every
// member (the intake doesn't record veg or non-veg). Rounded down to stay honest.
export const PROTEIN_ADDS = [
  { name: "100 g paneer", proteinG: 18 },
  { name: "a bowl of Greek curd", proteinG: 15 },
  { name: "a bowl of sprouts", proteinG: 10 },
  { name: "a handful of roasted chana", proteinG: 7 },
] as const;

const whole = (n: number) => Math.max(0, Math.round(n));

// Up to two additions that together cover `gap` grams, biggest first; the smallest that covers
// it on its own when one is enough
export function proteinAdds(gap: number): { name: string; proteinG: number }[] {
  if (gap <= 0) return [];
  const single = [...PROTEIN_ADDS].reverse().find((add) => add.proteinG >= gap);
  if (single) return [single];
  const [first, ...rest] = PROTEIN_ADDS;
  const second = rest.find((add) => first.proteinG + add.proteinG >= gap) ?? rest[0];
  return [first, second];
}

const list = (adds: { name: string; proteinG: number }[]) => adds.map((a) => `${a.name} (+${a.proteinG} g)`).join(" and ");

// `planned`: what the plan's meals not logged yet add (null without a plan for today)
export function coachTip(eaten: Totals, targets: Totals | null, planned: Totals | null): CoachTip | null {
  if (!targets || targets.kcal <= 0 || eaten.kcal <= 0) return null;

  const over = eaten.kcal - targets.kcal;
  if (over > targets.kcal * 0.05) {
    return {
      kind: "over_kcal",
      message: `You’re ${whole(over).toLocaleString("en-IN")} kcal over today’s target. A lighter dinner, like dal, sabzi and salad, keeps the week on track.`,
      ask: "I’m over my calories today. What should I have for dinner?",
    };
  }

  if (targets.proteinG <= 0) return null;
  const had = whole(eaten.proteinG);
  const coming = whole(planned?.proteinG ?? 0);
  const gap = whole(targets.proteinG - had - coming);
  const target = whole(targets.proteinG);

  if (gap <= 5) {
    if (!planned || coming === 0) return null;
    return {
      kind: "protein_covered",
      message: `You’ve had ${had} of ${target} g protein. Your planned meals add ${coming} g, so the rest of today has you covered.`,
      ask: "What should I eat for the rest of today?",
    };
  }

  const adds = proteinAdds(gap);
  const covers = adds.reduce((sum, add) => sum + add.proteinG, 0) >= gap;
  const lead = planned && coming > 0 ? `You’ve had ${had} of ${target} g protein, and your planned meals add ${coming} g, so you’re ${gap} g short.` : `You’ve had ${had} of ${target} g protein, ${gap} g to go.`;
  // Two additions at most: when they don't close the whole gap, the tip says so
  return { kind: "protein_short", message: `${lead} Add ${list(adds)}${covers ? "" : " to close most of it"}.`, ask: "How can I reach my protein goal today?" };
}

type PlanSlot = "breakfast" | "morning_snack" | "lunch" | "evening_snack" | "dinner";
type DiarySlot = "breakfast" | "lunch" | "snack" | "dinner";
const DIARY_SLOT: Record<PlanSlot, DiarySlot> = { breakfast: "breakfast", morning_snack: "snack", lunch: "lunch", evening_snack: "snack", dinner: "dinner" };

// What the plan still adds today: its meals not logged from the plan, and whose slot has nothing
// logged in the diary either (a lunch logged by hand counts as that day's lunch, so the planned
// one isn't counted twice)
export function plannedStill(meals: { slot: PlanSlot; logged: boolean; totals: Totals }[], loggedSlots: readonly DiarySlot[]): Totals {
  const taken = new Set(loggedSlots);
  return meals
    .filter((meal) => !meal.logged && !taken.has(DIARY_SLOT[meal.slot]))
    .reduce((sum, meal) => ({ kcal: sum.kcal + meal.totals.kcal, proteinG: sum.proteinG + meal.totals.proteinG }), { kcal: 0, proteinG: 0 });
}
