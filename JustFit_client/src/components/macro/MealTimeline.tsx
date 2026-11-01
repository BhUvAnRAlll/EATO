import { Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { clockTime, slotInfo, whole, type Meal, type Slot } from "@/lib/macro";
import { useThemeColors } from "@/theme";

// The day's logged meals as a stack of full-width cards (the coach's `coach__meal-card` look):
// the slot and time, the dish, its foods, calories and P / C / F chips. Each opens its detail sheet.

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

// A logged meal: slot pill, calories, the dish, its foods, the macros and a "Logged" mark. The
// whole card opens the meal (no button inside a button).
function LoggedCard({ meal, onOpen }: { meal: Meal; onOpen: (meal: Meal) => void }) {
  const colors = useThemeColors();
  const info = slotInfo[meal.slot];
  const foods = meal.items.map((item) => item.name).join(", ");
  const macros: [string, number][] = [["P", meal.totals.proteinG], ["C", meal.totals.carbsG], ["F", meal.totals.fatG]];
  return (
    <Pressable onPress={() => onOpen(meal)} className="coach__meal-card" accessibilityRole="button" accessibilityLabel={`${info.label}: ${meal.title}, ${whole(meal.totals.kcal)} kcal at ${clockTime(meal.loggedAt)}`}>
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 8 }}>
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <View className="coach__slot-pill">
            <Text className="coach__slot-pill-label">{info.label}</Text>
          </View>
          <View className="flex-row items-center" style={{ gap: 4 }}>
            <SymbolView name={{ ios: "clock", android: "schedule", web: "schedule" }} size={12} tintColor={colors.faint} />
            <Text className="home__note">{clockTime(meal.loggedAt)}</Text>
          </View>
        </View>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Text className="coach__meal-kcal">{`${whole(meal.totals.kcal)} kcal`}</Text>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
        </View>
      </View>
      <Text className="coach__meal-name" numberOfLines={2}>{meal.title}</Text>
      {foods !== meal.title && <Text className="coach__meal-ings" numberOfLines={2}>{foods}</Text>}
      <View className="flex-row flex-wrap items-end justify-between" style={{ gap: 10 }}>
        <View className="flex-row flex-wrap" style={{ gap: 8, flexGrow: 1, flexShrink: 1 }} accessibilityLabel={`Protein ${whole(meal.totals.proteinG)} g, carbs ${whole(meal.totals.carbsG)} g, fat ${whole(meal.totals.fatG)} g`}>
          {macros.map(([k, v]) => (
            <View key={k} className="coach__macro-chip">
              <Text className="coach__macro-chip-label">{`${k} ${whole(v)} g`}</Text>
            </View>
          ))}
        </View>
        <View className="coach__log coach__log--meal coach__log--done">
          <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={12} tintColor={colors.leaf} />
          <Text className="coach__log-label coach__log-label--done">Logged</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function MealTimeline({ rows, onOpen }: Props) {
  return (
    <View style={{ gap: 16 }}>
      {rows.map((row) => (
        <LoggedCard key={row.meal.id} meal={row.meal} onOpen={onOpen} />
      ))}
    </View>
  );
}
