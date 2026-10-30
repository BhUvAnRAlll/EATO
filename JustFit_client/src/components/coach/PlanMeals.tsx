import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import type { CoachPlan, PlanItem, PlanSlot } from "@/lib/coach";
import { colors } from "@/theme";

const SLOT_LABEL: Record<PlanSlot, string> = {
  breakfast: "Breakfast",
  morning_snack: "Morning snack",
  lunch: "Lunch",
  evening_snack: "Evening snack",
  dinner: "Dinner",
};

const amount = (item: PlanItem) => `${item.quantity} ${item.unit}`;

type Props = {
  plan: CoachPlan;
  // The meal being logged right now, if any
  logging: string | null;
  onLog: (mealId: string) => void;
};

// The coach's day of meals: the day's total against the target, then each meal with its time,
// foods and a Log button (Logged once it is in today's Macro diary)
export function PlanMeals({ plan, logging, onLog }: Props) {
  return (
    <View className="coach__card">
      <View className="flex-row items-end justify-between gap-3">
        <Text className="coach__section">{"Today's meals"}</Text>
        <Text className="coach__hint">{`${plan.totals.kcal} / ${plan.targets.calories} kcal`}</Text>
      </View>
      <Text className="coach__hint">{`Protein ${Math.round(plan.totals.proteinG)} g · Carbs ${Math.round(plan.totals.carbsG)} g · Fat ${Math.round(plan.totals.fatG)} g`}</Text>

      {plan.meals.map((meal) => (
        <View key={meal.id} className="coach__meal">
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="coach__hint">{`${meal.time} · ${SLOT_LABEL[meal.slot]}`}</Text>
              <Text className="coach__option-title">{meal.name}</Text>
            </View>
            <Pressable
              onPress={() => onLog(meal.id)}
              disabled={meal.logged || logging !== null}
              className={meal.logged ? "coach__log coach__log--done" : "coach__log"}
              accessibilityRole="button"
              accessibilityLabel={meal.logged ? `${meal.name} logged` : `Log ${meal.name}`}
            >
              {logging === meal.id ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : meal.logged ? (
                <>
                  <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={12} tintColor={colors.leaf} />
                  <Text className="coach__log-label coach__log-label--done">Logged</Text>
                </>
              ) : (
                <Text className="coach__log-label">Log</Text>
              )}
            </Pressable>
          </View>
          {meal.items.map((item, i) => (
            <Text key={`${meal.id}-${i}`} className="coach__meal-food">{`${item.name} · ${amount(item)} · ${Math.round(item.kcal)} kcal`}</Text>
          ))}
          <Text className="coach__hint">{`${meal.totals.kcal} kcal · P ${Math.round(meal.totals.proteinG)} g · C ${Math.round(meal.totals.carbsG)} g · F ${Math.round(meal.totals.fatG)} g`}</Text>
          {meal.note && <Text className="coach__meal-food">{`Tip: ${meal.note}`}</Text>}
        </View>
      ))}
    </View>
  );
}
