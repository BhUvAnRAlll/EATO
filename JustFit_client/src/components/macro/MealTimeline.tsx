import { View } from "react-native";

import { MealCard } from "@/components/MealCard";
import { clockTime, slotInfo, type Meal, type Slot } from "@/lib/macro";

// The day's logged meals as a stack of the shared meal cards (components/MealCard); View meal opens
// the meal's detail sheet.

// The timeline's slot order (snack sits between lunch and dinner)
const timelineSlots: Slot[] = ["breakfast", "lunch", "snack", "dinner"];

export type TimelineRow = { slot: Slot; meal: Meal };

// Only the meals actually logged, in slot order (time order within a slot); empty slots are left out
export function timelineRows(meals: Meal[]): TimelineRow[] {
  return timelineSlots.flatMap((slot): TimelineRow[] =>
    meals
      .filter((m) => m.slot === slot)
      .sort((a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime())
      .map((meal) => ({ slot, meal })),
  );
}

type Props = {
  rows: TimelineRow[];
  onOpen: (meal: Meal) => void;
};

export function MealTimeline({ rows, onOpen }: Props) {
  return (
    <View style={{ gap: 16 }}>
      {rows.map((row) => (
        <MealCard
          key={row.meal.id}
          label={slotInfo[row.meal.slot].label}
          time={clockTime(row.meal.loggedAt)}
          title={row.meal.title}
          foods={row.meal.items.map((item) => item.name)}
          totals={row.meal.totals}
          onDetails={() => onOpen(row.meal)}
        />
      ))}
    </View>
  );
}
