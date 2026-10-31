import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import type { CoachPlan, PlanMeal, PlanSlot } from "@/lib/coach";
import { dateOf } from "@/lib/macro";
import { GOAL_LABEL, LEVEL_LABEL, type DayExercise, type DayStatus, type Plan, type TrainingDay } from "@/lib/workoutApi";
import { colors } from "@/theme";
import type { Icon } from "@/types/profile";

// Today's workout from the workout plan, for the timeline's last entry
export type TodayWorkout = {
  plan: Plan;
  status: DayStatus;
  // Null on a rest day
  day: TrainingDay | null;
  week: { date: string; status: DayStatus }[];
  // Exercises with at least one set logged today
  doneIds: Set<string>;
};

type Props = {
  plan: CoachPlan;
  // The meal being logged right now, if any
  logging: string | null;
  onLog: (mealId: string) => void;
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

// "4 × 10", "3 × 30 s" or "2 × 8-12": how many sets, and the reps or time of each
function setsLabel(exercise: DayExercise) {
  const count = exercise.sets.length;
  const first = exercise.sets[0];
  if (first?.durationSec !== undefined) return `${count} × ${first.durationSec} s`;
  if (first?.reps !== undefined) return `${count} × ${first.reps}`;
  if (exercise.repsMin !== null && exercise.repsMax !== null) return `${count} × ${exercise.repsMin}-${exercise.repsMax}`;
  return `${count} sets`;
}

const weekLabel = (iso: string) => dateOf(iso).toLocaleDateString("en-GB", { weekday: "short" });

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
function MealEntry({ meal, last, logging, onLog }: { meal: PlanMeal; last: boolean; logging: string | null; onLog: (id: string) => void }) {
  const slot = SLOT[meal.slot];
  const [open, setOpen] = useState(false);
  const ingredients = meal.items.map((i) => i.name).join(", ");
  const macros: [string, number][] = [["P", meal.totals.proteinG], ["C", meal.totals.carbsG], ["F", meal.totals.fatG]];
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
          <Pressable
            onPress={() => onLog(meal.id)}
            disabled={meal.logged || logging !== null}
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

// Today's workout from the workout plan as a card of its own (it is not part of the meal plan):
// the day's exercises with what's done, the goal line, Start / Continue, and the week
export function WorkoutCard({ workout, onStart }: { workout: TodayWorkout; onStart: () => void }) {
  const { day, status, plan, week, doneIds } = workout;
  const main = day ? day.exercises.filter((e) => e.section === "workout").slice(0, 4) : [];
  const done = status === "completed";
  return (
    <View className="coach__meal-card" accessibilityLabel={day ? `Today's workout: ${day.title}, ${day.minutes} minutes` : "Today's workout: rest day"}>
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 8 }}>
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <View className="coach__tl-icon" style={{ width: 36, height: 36, backgroundColor: colors.accentSoft }}>
            <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={16} tintColor={colors.primary} />
          </View>
          <View className="coach__slot-pill">
            <Text className="coach__slot-pill-label">Workout</Text>
          </View>
        </View>
        {day && <Text className="coach__meal-kcal">{`${day.minutes} min`}</Text>}
      </View>
      <Text className="coach__meal-name">{day ? day.title : "Rest day"}</Text>
      {day ? (
        <View style={{ gap: 6 }}>
          {main.map((exercise) => {
            const ticked = done || doneIds.has(exercise.id);
            return (
              <View key={exercise.id} className="flex-row items-center gap-2" accessibilityLabel={`${exercise.name}, ${setsLabel(exercise)}${ticked ? ", done" : ""}`}>
                <View className={ticked ? "coach__done coach__done--on" : "coach__done"}>
                  {ticked && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={10} tintColor={colors.onPrimary} />}
                </View>
                <Text className="coach__food flex-1" numberOfLines={1}>
                  <Text className="text-forest-ink">{exercise.name}</Text>
                  {`  ${setsLabel(exercise)}`}
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text className="coach__meal-ings">Recover well, and drink enough water.</Text>
      )}
      <View className="flex-row flex-wrap items-end justify-between" style={{ gap: 10 }}>
        <View className="coach__goal" style={{ flexGrow: 1, flexShrink: 1, minWidth: 160 }}>
          <SymbolView name={{ ios: "target", android: "track_changes", web: "track_changes" }} size={20} tintColor={colors.primary} />
          <View className="min-w-0 flex-1">
            <Text className="coach__macro" numberOfLines={1}>{GOAL_LABEL[plan.goal]}</Text>
            <Text className="coach__week-label" numberOfLines={1}>{`${plan.daysPerWeek} days/week · ${LEVEL_LABEL[plan.level]}`}</Text>
          </View>
        </View>
        {day && (
          <Pressable onPress={onStart} disabled={done} className={done ? "coach__log coach__log--meal coach__log--done" : "coach__log coach__log--meal"} accessibilityRole="button" accessibilityLabel={done ? "Workout done" : "Start workout"}>
            {done ? (
              <>
                <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={12} tintColor={colors.leaf} />
                <Text className="coach__log-label coach__log-label--done">Done</Text>
              </>
            ) : (
              <Text className="coach__log-label">{status === "in_progress" ? "Continue" : "Start"}</Text>
            )}
          </Pressable>
        )}
      </View>
      <View className="flex-row justify-between px-1">
        {week.map((d) => (
          <View key={d.date} className="items-center gap-1" accessibilityLabel={`${weekLabel(d.date)}: ${d.status.replace("_", " ")}`}>
            <View className={d.status === "completed" ? "coach__week-day coach__week-day--done" : d.status === "rest" ? "coach__week-day coach__week-day--rest" : "coach__week-day"}>
              {d.status === "completed" && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={11} tintColor={colors.onPrimary} />}
            </View>
            <Text className="coach__week-label">{weekLabel(d.date)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// The meal plan: the coach's meals in time order down a timeline, each a card with its macros
// and a Log Meal button. The workout is not on it (see WorkoutCard).
export function PlanTimeline({ plan, logging, onLog }: Props) {
  return (
    <View>
      {plan.meals.map((meal, i) => (
        <MealEntry key={meal.id} meal={meal} last={i === plan.meals.length - 1} logging={logging} onLog={onLog} />
      ))}
    </View>
  );
}
