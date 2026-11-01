import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { BottomSheet } from "@/components/BottomSheet";
import { MealCard } from "@/components/MealCard";
import { SymbolView } from "@/components/SymbolView";
import { timeLabel } from "@/lib/macro";
import type { CoachPlan, PlanMeal, PlanSlot } from "@/lib/coach";
import type { DayStatus, Plan, TrainingDay } from "@/lib/workoutApi";
import { useThemeColors } from "@/theme";

// Today's workout from the workout plan, for the Workout row under the meal plan on the AI Coach tab
export type TodayWorkout = {
  plan: Plan;
  status: DayStatus;
  // Null on a rest day
  day: TrainingDay | null;
  week: { date: string; status: DayStatus }[];
};

type Props = {
  plan: CoachPlan;
  // The meal being logged right now, if any
  logging: string | null;
  onLog: (mealId: string) => void;
  // The meal being swapped for a new dish right now, if any (no Swap buttons without onSwap)
  swapping?: string | null;
  onSwap?: (mealId: string) => void;
};

const SLOT: Record<PlanSlot, string> = { breakfast: "Breakfast", morning_snack: "Morning snack", lunch: "Lunch", evening_snack: "Evening snack", dinner: "Dinner" };

// "13:30" → "1:30 PM": the plan keeps 24-hour times
function planTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? timeLabel(h, m) : time;
}

// One plan meal on the shared meal card: Swap (before it's logged) and Log Meal as its buttons,
// View meal opening the foods with their amounts and the coach's tip from the bottom
function MealEntry({ meal, logging, onLog, swapping, onSwap, onDetails }: { meal: PlanMeal; logging: string | null; onLog: (id: string) => void; swapping?: string | null; onSwap?: (id: string) => void; onDetails: () => void }) {
  const colors = useThemeColors();
  // Busy while any meal is being swapped or logged: one change at a time
  const busy = logging !== null || (swapping ?? null) !== null;
  return (
    <MealCard
      label={SLOT[meal.slot]}
      time={planTime(meal.time)}
      title={meal.name}
      foods={meal.items.map((i) => i.name)}
      totals={meal.totals}
      onDetails={onDetails}
      before={
        onSwap && !meal.logged ? (
          <Pressable
            onPress={() => onSwap(meal.id)}
            disabled={busy}
            hitSlop={6}
            className="flex-row items-center"
            style={{ gap: 4, opacity: busy && swapping !== meal.id ? 0.5 : 1 }}
            accessibilityRole="button"
            accessibilityLabel={swapping === meal.id ? `Swapping ${meal.name}` : `Swap ${meal.name} for another dish`}
            accessibilityState={{ disabled: busy }}
          >
            {swapping === meal.id ? (
              <ActivityIndicator size="small" color={colors.leaf} />
            ) : (
              <SymbolView name={{ ios: "arrow.triangle.2.circlepath", android: "swap_horiz", web: "swap_horiz" }} size={14} tintColor={colors.leaf} />
            )}
            <Text className="coach__macro-chip-label" style={{ color: colors.leaf }}>{swapping === meal.id ? "Swapping" : "Swap"}</Text>
          </Pressable>
        ) : null
      }
      after={
        <Pressable
          onPress={() => onLog(meal.id)}
          disabled={meal.logged || busy}
          className={meal.logged ? "coach__log coach__log--meal coach__log--done" : "coach__log coach__log--meal"}
          accessibilityRole="button"
          accessibilityLabel={meal.logged ? `${meal.name} logged` : `Log ${meal.name}`}
        >
          {logging === meal.id ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : meal.logged ? (
            <>
              <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={12} tintColor={colors.leaf} />
              <Text className="coach__log-label coach__log-label--done">Logged</Text>
            </>
          ) : (
            <Text className="coach__log-label">Log Meal</Text>
          )}
        </Pressable>
      }
    />
  );
}

// A plan meal in full, from the bottom: when, the calories and macros, every food with its
// amount and calories, and the coach's tip
function PlanMealSheet({ meal, onClose }: { meal: PlanMeal; onClose: () => void }) {
  const colors = useThemeColors();
  const macros = [
    { key: "proteinG", label: "Protein", color: colors.protein },
    { key: "carbsG", label: "Carbs", color: colors.carbs },
    { key: "fatG", label: "Fat", color: colors.fat },
  ] as const;
  return (
    <BottomSheet onClose={onClose}>
      {(dismiss) => (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16 }}>
          <View className="gap-0.5">
            <Text className="type-headline text-forest-ink">{meal.name}</Text>
            <Text className="meta-text">{`${SLOT[meal.slot]} · ${planTime(meal.time)} · From your coach's plan`}</Text>
          </View>
          <View className="macro__panel flex-row">
            <View className="flex-1 items-center">
              <Text className="macro__stat-value">{Math.round(meal.totals.kcal)}</Text>
              <Text className="macro__stat-label">kcal</Text>
            </View>
            {macros.map((m) => (
              <View key={m.key} className="flex-1 items-center">
                <Text className="macro__stat-value" style={{ color: m.color }}>{Math.round(meal.totals[m.key])}g</Text>
                <Text className="macro__stat-label">{m.label}</Text>
              </View>
            ))}
          </View>
          <View>
            <View className="flex-row border-b border-cream-line pb-2">
              <Text className="macro__table-head flex-1">Food</Text>
              <Text className="macro__table-head w-24 text-right">Amount</Text>
              <Text className="macro__table-head w-20 text-right">Calories</Text>
            </View>
            {meal.items.map((item, i) => (
              <View key={`${meal.id}-${i}`} className="flex-row border-b border-cream-line py-2.5">
                <Text className="macro__table-cell flex-1" numberOfLines={2}>{item.name}</Text>
                <Text className="macro__table-cell w-24 text-right">{`${item.quantity} ${item.unit}`}</Text>
                <Text className="macro__table-cell w-20 text-right">{`${Math.round(item.kcal)} kcal`}</Text>
              </View>
            ))}
          </View>
          {meal.note && <Text className="coach__meal-ings">{`Tip: ${meal.note}`}</Text>}
          <Pressable onPress={dismiss} className="btn-forest" accessibilityRole="button">
            <Text className="btn-forest__label">Done</Text>
          </Pressable>
        </ScrollView>
      )}
    </BottomSheet>
  );
}

// The meal plan: the coach's meals in time order, each on the shared meal card with Swap and
// Log Meal. The workout is not on it (the AI Coach tab shows it as a row).
export function PlanTimeline({ plan, logging, onLog, swapping, onSwap }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = plan.meals.find((m) => m.id === openId) ?? null;
  return (
    <View style={{ gap: 16 }}>
      {plan.meals.map((meal) => (
        <MealEntry key={meal.id} meal={meal} logging={logging} onLog={onLog} swapping={swapping} onSwap={onSwap} onDetails={() => setOpenId(meal.id)} />
      ))}
      {open && <PlanMealSheet key={open.id} meal={open} onClose={() => setOpenId(null)} />}
    </View>
  );
}
