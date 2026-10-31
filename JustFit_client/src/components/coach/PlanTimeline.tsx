import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import type { CoachPlan, PlanMeal, PlanSlot } from "@/lib/coach";
import type { DayStatus, Plan, TrainingDay } from "@/lib/workoutApi";
import { colors } from "@/theme";
import type { Icon } from "@/types/profile";

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

const SLOT: Record<PlanSlot, { label: string; icon: Icon; tint: string; color: string }> = {
  breakfast: { label: "Breakfast", icon: { ios: "sun.max.fill", android: "wb_sunny", web: "wb_sunny" }, tint: colors.tintPeach, color: colors.iconPeach },
  morning_snack: { label: "Morning snack", icon: { ios: "leaf.fill", android: "eco", web: "eco" }, tint: colors.tintGreen, color: colors.iconGreen },
  lunch: { label: "Lunch", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" }, tint: colors.accentSoft, color: colors.primary },
  evening_snack: { label: "Evening snack", icon: { ios: "cup.and.saucer.fill", android: "local_cafe", web: "local_cafe" }, tint: colors.accentSoft, color: colors.primary },
  dinner: { label: "Dinner", icon: { ios: "moon.fill", android: "dark_mode", web: "dark_mode" }, tint: colors.accentSoft, color: colors.primary },
};

// "13:30" → ["01:30", "PM"]: the plan keeps 24-hour times, the timeline shows them as people read them
function clockParts(time: string): [string, string] {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return [time, ""];
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return [`${String(hour12).padStart(2, "0")}:${String(m).padStart(2, "0")}`, h < 12 ? "AM" : "PM"];
}

// One entry on the timeline: the time column (the icon circle, the time, a red dot and the
// dashed line down to the next entry) beside whatever the entry holds
function Entry({ icon, tint, color, time, last, label, children }: { icon: Icon; tint: string; color: string; time?: string; last?: boolean; label: string; children: ReactNode }) {
  const [clock, meridiem] = time ? clockParts(time) : ["", ""];
  return (
    <View className="flex-row" style={{ gap: 12 }}>
      <View className="coach__tl-col" accessibilityLabel={time ? `${label} at ${clock} ${meridiem}` : label}>
        <View className="coach__tl-icon" style={{ backgroundColor: tint }}>
          <SymbolView name={icon} size={20} tintColor={color} />
        </View>
        {time ? (
          <>
            <Text className="coach__tl-time">{clock}</Text>
            <Text className="coach__tl-time">{meridiem}</Text>
          </>
        ) : null}
        <View className="coach__tl-dot" />
        {!last && <View className="coach__tl-line" />}
      </View>
      <View className="min-w-0 flex-1" style={{ paddingBottom: last ? 0 : 16 }}>{children}</View>
    </View>
  );
}

// One meal: the slot, the dish, its ingredients, calories, macros and the Log Meal button. The
// chevron opens the foods with their amounts and the coach's tip.
function MealEntry({ meal, last, logging, onLog, swapping, onSwap }: { meal: PlanMeal; last: boolean; logging: string | null; onLog: (id: string) => void; swapping?: string | null; onSwap?: (id: string) => void }) {
  const slot = SLOT[meal.slot];
  const [open, setOpen] = useState(false);
  const ingredients = meal.items.map((i) => i.name).join(", ");
  const macros: [string, number][] = [["P", meal.totals.proteinG], ["C", meal.totals.carbsG], ["F", meal.totals.fatG]];
  // Busy while any meal is being swapped or logged: one change at a time
  const busy = logging !== null || (swapping ?? null) !== null;
  return (
    <Entry icon={slot.icon} tint={slot.tint} color={slot.color} time={meal.time} last={last} label={slot.label}>
      <View className="coach__meal-card">
        <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 8 }}>
          <View className="coach__slot-pill">
            <Text className="coach__slot-pill-label">{slot.label}</Text>
          </View>
          <Pressable onPress={() => setOpen((v) => !v)} hitSlop={8} className="flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={`${meal.totals.kcal} kcal. ${open ? "Hide" : "Show"} the foods in ${meal.name}`} accessibilityState={{ expanded: open }}>
            <Text className="coach__meal-kcal">{`${meal.totals.kcal} kcal`}</Text>
            <SymbolView name={open ? { ios: "chevron.down", android: "expand_more", web: "expand_more" } : { ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
          </Pressable>
        </View>
        <Text className="coach__meal-name">{meal.name}</Text>
        <Text className="coach__meal-ings" numberOfLines={open ? undefined : 2}>{ingredients}</Text>
        {open && (
          <View style={{ gap: 2 }}>
            {meal.items.map((item, i) => (
              <Text key={`${meal.id}-${i}`} className="coach__food">{`${item.name} · ${item.quantity} ${item.unit} · ${Math.round(item.kcal)} kcal`}</Text>
            ))}
            {meal.note && <Text className="coach__food">{`Tip: ${meal.note}`}</Text>}
          </View>
        )}
        <View className="flex-row flex-wrap items-end justify-between" style={{ gap: 10 }}>
          <View className="flex-row flex-wrap" style={{ gap: 8, flexGrow: 1, flexShrink: 1 }} accessibilityLabel={`Protein ${Math.round(meal.totals.proteinG)} g, carbs ${Math.round(meal.totals.carbsG)} g, fat ${Math.round(meal.totals.fatG)} g`}>
            {macros.map(([k, v]) => (
              <View key={k} className="coach__macro-chip">
                <Text className="coach__macro-chip-label">{`${k} ${Math.round(v)} g`}</Text>
              </View>
            ))}
          </View>
          {onSwap && !meal.logged && (
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
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <SymbolView name={{ ios: "arrow.triangle.2.circlepath", android: "swap_horiz", web: "swap_horiz" }} size={14} tintColor={colors.primary} />
              )}
              <Text className="coach__macro-chip-label" style={{ color: colors.primary }}>{swapping === meal.id ? "Swapping" : "Swap"}</Text>
            </Pressable>
          )}
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
        </View>
      </View>
    </Entry>
  );
}

// The meal plan: the coach's meals in time order down a timeline, each a card with its macros
// and a Log Meal button. The workout is not on it (the AI Coach tab shows it as a row).
export function PlanTimeline({ plan, logging, onLog, swapping, onSwap }: Props) {
  return (
    <View>
      {plan.meals.map((meal, i) => (
        <MealEntry key={meal.id} meal={meal} last={i === plan.meals.length - 1} logging={logging} onLog={onLog} swapping={swapping} onSwap={onSwap} />
      ))}
    </View>
  );
}
