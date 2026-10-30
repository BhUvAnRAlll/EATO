import type { ReactNode } from "react";
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
  workout: TodayWorkout | null;
  // The meal being logged right now, if any
  logging: string | null;
  onLog: (mealId: string) => void;
  onStartWorkout: () => void;
};

const SLOT: Record<PlanSlot, { label: string; icon: Icon; tint: string; color: string }> = {
  breakfast: { label: "Breakfast", icon: { ios: "sun.max.fill", android: "wb_sunny", web: "wb_sunny" }, tint: colors.tintPeach, color: colors.iconPeach },
  morning_snack: { label: "Morning snack", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" }, tint: colors.tintGreen, color: colors.iconGreen },
  lunch: { label: "Lunch", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" }, tint: colors.tintBlue, color: colors.iconBlue },
  evening_snack: { label: "Evening snack", icon: { ios: "cup.and.saucer.fill", android: "local_cafe", web: "local_cafe" }, tint: colors.tintLavender, color: colors.iconLavender },
  dinner: { label: "Dinner", icon: { ios: "moon.fill", android: "dark_mode", web: "dark_mode" }, tint: colors.tintBlue, color: colors.iconBlue },
};

const MACRO_ICONS: { key: "kcal" | "proteinG" | "carbsG" | "fatG"; prefix: string; suffix: string; icon: Icon; color: string }[] = [
  { key: "kcal", prefix: "", suffix: " kcal", icon: { ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }, color: colors.primary },
  { key: "proteinG", prefix: "P ", suffix: " g", icon: { ios: "bolt.fill", android: "bolt", web: "bolt" }, color: colors.protein },
  { key: "carbsG", prefix: "C ", suffix: " g", icon: { ios: "leaf.fill", android: "eco", web: "eco" }, color: colors.carbs },
  { key: "fatG", prefix: "F ", suffix: " g", icon: { ios: "drop.fill", android: "water_drop", web: "water_drop" }, color: colors.fat },
];

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

// One entry on the timeline: the icon circle on the line, the grey header row and the content
function Step({ icon, iconColor, time, title, right, last, children }: { icon: Icon; iconColor: string; time?: string; title: string; right?: ReactNode; last?: boolean; children: ReactNode }) {
  return (
    <View className="flex-row gap-2.5">
      <View>
        <View className="coach__step-icon">
          <SymbolView name={icon} size={16} tintColor={iconColor} />
        </View>
        {!last && <View className="coach__step-line" />}
      </View>
      <View className="flex-1 gap-2.5">
        <View className="coach__step-head">
          {time && <Text className="coach__step-time">{time}</Text>}
          <Text className="coach__option-title flex-1" numberOfLines={1}>{title}</Text>
          {right}
        </View>
        {children}
      </View>
    </View>
  );
}

function MealStep({ meal, last, logging, onLog }: { meal: PlanMeal; last: boolean; logging: string | null; onLog: (id: string) => void }) {
  const slot = SLOT[meal.slot];
  return (
    <Step
      icon={slot.icon}
      iconColor={slot.color}
      time={meal.time}
      title={slot.label}
      last={last}
      right={
        <Pressable
          onPress={() => onLog(meal.id)}
          disabled={meal.logged || logging !== null}
          className={meal.logged ? "coach__log coach__log--small coach__log--done" : "coach__log coach__log--small"}
          accessibilityRole="button"
          accessibilityLabel={meal.logged ? `${meal.name} logged` : `Log ${meal.name}`}
        >
          {logging === meal.id ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : meal.logged ? (
            <>
              <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={11} tintColor={colors.leaf} />
              <Text className="coach__log-label coach__log-label--done">Logged</Text>
            </>
          ) : (
            <Text className="coach__log-label">Log</Text>
          )}
        </Pressable>
      }
    >
      <View className="flex-row gap-3">
        <View className="coach__thumb" style={{ backgroundColor: slot.tint }}>
          <SymbolView name={slot.icon} size={30} tintColor={slot.color} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="coach__option-title">{meal.name}</Text>
          {meal.items.map((item, i) => (
            <Text key={`${meal.id}-${i}`} className="coach__food" numberOfLines={1}>{`${item.name} · ${item.quantity} ${item.unit} · ${Math.round(item.kcal)} kcal`}</Text>
          ))}
        </View>
      </View>
      <View className="coach__macros" accessibilityLabel={`${meal.totals.kcal} kcal, protein ${Math.round(meal.totals.proteinG)} g, carbs ${Math.round(meal.totals.carbsG)} g, fat ${Math.round(meal.totals.fatG)} g`}>
        {MACRO_ICONS.map((m) => (
          <View key={m.key} className="flex-row items-center gap-1">
            <SymbolView name={m.icon} size={13} tintColor={m.color} />
            <Text className="coach__macro">{`${m.prefix}${Math.round(meal.totals[m.key])}${m.suffix}`}</Text>
          </View>
        ))}
      </View>
      {meal.note && <Text className="coach__food">{`Tip: ${meal.note}`}</Text>}
    </Step>
  );
}

function WorkoutStep({ workout, onStart }: { workout: TodayWorkout; onStart: () => void }) {
  const { day, status, plan, week, doneIds } = workout;
  const main = day ? day.exercises.filter((e) => e.section === "workout").slice(0, 4) : [];
  const done = status === "completed";
  return (
    <Step
      icon={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }}
      iconColor={colors.primary}
      title="Today's workout"
      last
      right={day ? <Text className="coach__step-time" numberOfLines={1}>{`${day.title} · ${day.minutes} min`}</Text> : undefined}
    >
      {day ? (
        <View className="flex-row gap-3">
          <View className="coach__thumb" style={{ backgroundColor: colors.accentSoft }}>
            <SymbolView name={{ ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" }} size={30} tintColor={colors.primary} />
          </View>
          <View className="flex-1 gap-1.5">
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
        </View>
      ) : (
        <Text className="coach__hint">Rest day. Recover well, and drink enough water.</Text>
      )}

      {day && (
        <Pressable onPress={onStart} disabled={done} className="coach__start self-start" accessibilityRole="button" accessibilityLabel={done ? "Workout done" : "Start workout"}>
          <SymbolView name={done ? { ios: "checkmark", android: "check", web: "check" } : { ios: "play.fill", android: "play_arrow", web: "play_arrow" }} size={14} tintColor={colors.primary} />
          <Text className="coach__start-label">{done ? "Done for today" : status === "in_progress" ? "Continue workout" : "Start workout"}</Text>
        </Pressable>
      )}

      <View className="coach__goal">
        <SymbolView name={{ ios: "target", android: "track_changes", web: "track_changes" }} size={22} tintColor={colors.primary} />
        <View className="flex-1">
          <Text className="coach__macro" numberOfLines={1}>{GOAL_LABEL[plan.goal]}</Text>
          <Text className="coach__week-label" numberOfLines={1}>{`${plan.daysPerWeek} days/week · ${LEVEL_LABEL[plan.level]}`}</Text>
        </View>
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
    </Step>
  );
}

// The Today tab of "Today's plan": the coach's meals in time order on a timeline (each with its
// foods, macros and a Log button), then today's workout from the workout plan and the week
export function PlanTimeline({ plan, workout, logging, onLog, onStartWorkout }: Props) {
  return (
    <View className="gap-3">
      {plan.meals.map((meal, i) => (
        <MealStep key={meal.id} meal={meal} last={i === plan.meals.length - 1 && !workout} logging={logging} onLog={onLog} />
      ))}
      {workout && <WorkoutStep workout={workout} onStart={onStartWorkout} />}
    </View>
  );
}
