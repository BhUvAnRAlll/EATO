import { View } from "react-native";
import Animated, { FadeInDown, LinearTransition, ReduceMotion } from "react-native-reanimated";

import { MealCard } from "@/components/MealCard";
import { clockTime, slotInfo, type Meal, type Slot } from "@/lib/macro";
import { useNewKeys } from "@/lib/useNewKeys";

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

const ENTER = FadeInDown.duration(320).reduceMotion(ReduceMotion.System);
const MOVE = LinearTransition.duration(260).reduceMotion(ReduceMotion.System);

// A meal logged while the screen is open slides in and the cards below make room; what the day
// opened with is shown in place. Key this by the day so switching days doesn't animate.
export function MealTimeline({ rows, onOpen }: Props) {
  const added = useNewKeys(rows.map((row) => row.meal.id));
  return (
    <View style={{ gap: 16 }}>
      {rows.map((row) => (
        <Animated.View key={row.meal.id} entering={added.has(row.meal.id) ? ENTER : undefined} layout={MOVE}>
          <MealCard
            label={slotInfo[row.meal.slot].label}
            time={clockTime(row.meal.loggedAt)}
            title={row.meal.title}
            foods={row.meal.items.map((item) => item.name)}
            totals={row.meal.totals}
            onDetails={() => onOpen(row.meal)}
          />
        </Animated.View>
      ))}
    </View>
  );
}
