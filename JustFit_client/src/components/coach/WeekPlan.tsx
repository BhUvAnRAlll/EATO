import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { weekdayChoices } from "@/data/coach";
import type { CoachPlan, PlanSlot, PlanWorkout } from "@/lib/coach";
import { useThemeColors } from "@/theme";

type Props = {
  plan: CoachPlan;
  // Null when the plan has no workout week yet: every day shows its meals only
  workout: PlanWorkout | null;
};

const SLOT: Record<PlanSlot, string> = { breakfast: "Breakfast", morning_snack: "Morning snack", lunch: "Lunch", evening_snack: "Evening snack", dinner: "Dinner" };

// The Week tab on the AI Coach: one card per day, Mon to Sun, each with that day's workout (or
// rest) and the day's meals. The coach makes one meal plan for every day, so the meals repeat;
// the workout follows the weekday. Today's card is marked. The workout row opens the workouts,
// the meals open the meal plan.
export function WeekPlan({ plan, workout }: Props) {
  const colors = useThemeColors();
  const today = new Date().getDay();
  const kcal = plan.totals.kcal.toLocaleString("en-IN");

  return (
    <View className="gap-3">
      {weekdayChoices.map(({ id, label }) => {
        const session = workout?.sessions.find((s) => s.weekday === id) ?? null;
        const isToday = id === today;
        const workoutLine = session ? `${session.title} · ${session.minutes} min` : workout ? "Rest day · Recover well" : "No workout planned";
        return (
          <View key={id} className={isToday ? "coach__weekday coach__weekday--today" : "coach__weekday"} accessibilityLabel={`${label}${isToday ? ", today" : ""}: ${workoutLine}, ${plan.meals.length} meals, ${kcal} kcal`}>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Text className="coach__weekday-name">{label}</Text>
                {isToday && (
                  <View className="coach__tag">
                    <Text className="coach__tag-label">Today</Text>
                  </View>
                )}
              </View>
              <Text className="coach__hint">{`${kcal} kcal`}</Text>
            </View>

            <Pressable onPress={() => router.push("/workout")} disabled={!workout} className="coach__weekday-row" accessibilityRole="button" accessibilityLabel={`${label} workout: ${workoutLine}`}>
              <SymbolView
                name={session ? { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" } : { ios: "moon.zzz.fill", android: "bedtime", web: "bedtime" }}
                size={16}
                tintColor={colors.leaf}
              />
              <Text className="coach__row-value flex-1" numberOfLines={1}>{workoutLine}</Text>
              {workout && <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={12} tintColor={colors.faint} />}
            </Pressable>

            <Pressable onPress={() => router.push("/coach/meal-plan")} className="coach__weekday-meals" accessibilityRole="button" accessibilityLabel={`${label} meals: ${plan.meals.map((m) => m.name).join(", ")}`}>
              {plan.meals.map((meal) => (
                <View key={meal.id} className="flex-row items-center gap-3">
                  <Text className="coach__hint w-28" numberOfLines={1}>{SLOT[meal.slot]}</Text>
                  <Text className="coach__weekday-meal flex-1" numberOfLines={1}>{meal.name}</Text>
                  <Text className="coach__hint">{Math.round(meal.totals.kcal)}</Text>
                </View>
              ))}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
