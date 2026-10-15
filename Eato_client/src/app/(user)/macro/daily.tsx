import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { MacroHeader } from "@/components/macro/MacroHeader";
import { MealDetailSheet } from "@/components/macro/MealDetailSheet";
import { Ring } from "@/components/macro/Ring";
import { clockTime, isValidIso, litres, longDate, macro, slotInfo, timeLabel, todayIso, whole, type DayView, type Meal, type Slot, type WaterDay } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore } from "@/store/macro";
import { colors } from "@/theme";

// The timeline's slot order (snack sits between lunch and dinner)
const timelineSlots: Slot[] = ["breakfast", "lunch", "snack", "dinner"];

type TimelineRow = { slot: Slot; meal: Meal | null };

// Every slot shows: each logged meal in it, or one "Not logged yet" row
function timeline(meals: Meal[]): TimelineRow[] {
  return timelineSlots.flatMap((slot): TimelineRow[] => {
    const logged = meals.filter((m) => m.slot === slot);
    return logged.length ? logged.map((meal) => ({ slot, meal })) : [{ slot, meal: null }];
  });
}

// One day in full: what's left, macro progress against the targets, and the meals as a
// timeline. Reads the day shared with the Macro tab; a `date` link param moves it.
export default function DailyCalories() {
  const params = useLocalSearchParams<{ date?: string }>();
  const getToken = useSessionToken();
  const { selectedDate, jumpToDate } = useMacroStore();
  const [day, setDay] = useState<DayView | null>(null);
  const [water, setWater] = useState<WaterDay | null>(null);
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  const today = todayIso();
  const isToday = selectedDate === today;

  // A deep link's date (valid and not in the future) becomes the shared day
  useEffect(() => {
    if (isValidIso(params.date) && params.date <= todayIso()) jumpToDate(params.date);
  }, [params.date, jumpToDate]);

  const load = useCallback(async () => {
    const token = await getToken().catch(() => null);
    const [result, waterResult] = await Promise.all([macro.day(token, selectedDate), macro.water(token, selectedDate)]);
    if (result.ok) setDay(result.data);
    // The water card only appears once its data has loaded (nothing shifts before that)
    setWater(waterResult.ok ? waterResult.data : null);
  }, [getToken, selectedDate]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const backToToday = () => {
    jumpToDate(today);
    if (router.canGoBack()) router.back();
  };

  // The day on screen must be the selected one; the previous day stays, dimmed, while it loads
  const showing = day;
  const switching = day !== null && day.date !== selectedDate;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader title="Daily calories" subtitle={longDate(selectedDate)} />

        {!showing ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={colors.forest} />
          </View>
        ) : !showing.targets ? (
          <View className="px-5 pt-4">
            <DashedBlock
              icon={{ ios: "flame", android: "local_fire_department", web: "local_fire_department" }}
              title="Calorie target not set up yet"
              text="Finish your profile (weight, height, birthday, workout days and goal) to see your daily calories here."
              onPress={() => router.push("/profile")}
            />
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 16, opacity: switching ? 0.55 : 1 }} showsVerticalScrollIndicator={false}>
              <Hero day={showing} />
              {water && water.date === showing.date && <WaterCard water={water} />}
              <MacrosCard day={showing} />

              <View className="gap-3">
                <Text className="setup__section">Meals timeline</Text>
                <View>
                  {timeline(showing.meals).map((row, index, rows) => (
                    <TimelineItem
                      key={row.meal?.id ?? row.slot}
                      row={row}
                      last={index === rows.length - 1}
                      onOpen={row.meal ? () => setOpenMeal(row.meal) : undefined}
                      onAdd={!row.meal && isToday ? () => router.push({ pathname: "/macro/add-meal", params: { slot: row.slot } }) : undefined}
                    />
                  ))}
                </View>
              </View>
            </ScrollView>

            <View className="px-5 pb-3 pt-2">
              {isToday ? (
                <Pressable onPress={() => router.push("/macro/add-meal")} className="btn-forest" accessibilityRole="button">
                  <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={16} tintColor={colors.white} />
                  <Text className="btn-forest__label">Add meal</Text>
                </Pressable>
              ) : (
                <Pressable onPress={backToToday} className="btn-forest" accessibilityRole="button">
                  <SymbolView name={{ ios: "arrow.uturn.backward", android: "undo", web: "undo" }} size={16} tintColor={colors.white} />
                  <Text className="btn-forest__label">Back to today</Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </SafeAreaView>

      <MealDetailSheet meal={openMeal} onClose={() => setOpenMeal(null)} onDeleted={() => load()} />
    </View>
  );
}

// Remaining calories on the dark hero card, the share eaten on a ring, eaten and target below
function Hero({ day }: { day: DayView }) {
  const target = day.targets?.kcal ?? 0;
  const eaten = day.totals.kcal;
  const remaining = Math.max(0, target - eaten);
  const percent = target > 0 ? Math.round((eaten / target) * 100) : 0;
  return (
    <View className="macro__hero" accessibilityLabel={`${whole(remaining)} kcal remaining of ${target}. ${percent}% eaten.`}>
      <View className="flex-row items-center gap-4">
        <View className="flex-1 gap-1">
          <Text className="macro__hero-overline">Remaining</Text>
          <Text className="macro__hero-remaining">{whole(remaining).toLocaleString("en-IN")}</Text>
          <Text className="macro__hero-caption">kcal to reach your {target.toLocaleString("en-IN")} target</Text>
        </View>
        <Ring size={100} stroke={10} progress={target > 0 ? eaten / target : 0} color={colors.primary} trackColor="rgba(255,255,255,0.14)">
          <Text className="macro__hero-percent">{percent}%</Text>
        </Ring>
      </View>
      <View className="my-4 h-px" style={{ backgroundColor: "rgba(255,255,255,0.14)" }} />
      <View className="flex-row">
        <View className="flex-1">
          <Text className="macro__hero-caption">Eaten</Text>
          <Text className="macro__hero-stat">{whole(eaten).toLocaleString("en-IN")} kcal</Text>
        </View>
        <View className="flex-1">
          <Text className="macro__hero-caption">Target</Text>
          <Text className="macro__hero-stat">{target.toLocaleString("en-IN")} kcal</Text>
        </View>
      </View>
    </View>
  );
}

// Water for the day against its estimated target; opens the Water screen
function WaterCard({ water }: { water: WaterDay }) {
  const percent = Math.round(water.progress * 100);
  return (
    <Pressable onPress={() => router.push("/macro/water")} className="home__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Water: ${litres(water.consumedMl)} of ${litres(water.targetMl)} litres, ${percent}%. Open water`}>
      <View className="macro__thumb" style={{ backgroundColor: colors.infoSoft }}>
        <SymbolView name={{ ios: "drop.fill", android: "water_drop", web: "water_drop" }} size={20} tintColor={colors.fat} />
      </View>
      <View className="flex-1 gap-1.5">
        <View className="flex-row items-center justify-between">
          <Text className="card__title">Water <Text className="post__time">{percent}%</Text></Text>
          <Text className="macro__bar-value">{litres(water.consumedMl)} / {litres(water.targetMl)} L</Text>
        </View>
        <View className="macro__track">
          <View className="h-full rounded-pill" style={{ width: `${Math.min(100, percent)}%`, backgroundColor: colors.fat }} />
        </View>
      </View>
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.faint} />
    </Pressable>
  );
}

// "On track" when protein has reached 55% of its target and calories are within the target
function MacrosCard({ day }: { day: DayView }) {
  const targets = day.targets!;
  const onTrack = day.totals.proteinG >= targets.proteinG * 0.55 && day.totals.kcal <= targets.kcal;
  const rows = [
    { label: "Protein", value: day.totals.proteinG, target: targets.proteinG, color: colors.protein },
    { label: "Carbs", value: day.totals.carbsG, target: targets.carbsG, color: colors.carbs },
    { label: "Fat", value: day.totals.fatG, target: targets.fatG, color: colors.fat },
  ];
  return (
    <View className="home__card gap-4">
      <View className="flex-row items-center justify-between">
        <Text className="card__title">Macros</Text>
        <View className="flex-row items-center gap-1 rounded-pill px-2.5 py-1" style={{ backgroundColor: onTrack ? colors.successSoft : colors.warningSoft }}>
          <SymbolView
            name={onTrack ? { ios: "checkmark", android: "check", web: "check" } : { ios: "exclamationmark", android: "priority_high", web: "priority_high" }}
            size={12}
            tintColor={onTrack ? colors.success : colors.warning}
          />
          <Text className="macro__badge" style={{ color: onTrack ? colors.success : colors.warning }}>{onTrack ? "On track" : "Behind target"}</Text>
        </View>
      </View>
      {rows.map((row) => (
        <View key={row.label} className="gap-1.5" accessibilityLabel={`${row.label} ${whole(row.value)} of ${row.target} grams`}>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: row.color }} />
              <Text className="macro__bar-label">{row.label}</Text>
            </View>
            <Text className="macro__bar-value">{whole(row.value)}g / {row.target}g</Text>
          </View>
          <View className="macro__track">
            <View className="h-full rounded-pill" style={{ width: `${Math.min(1, row.target > 0 ? row.value / row.target : 0) * 100}%`, backgroundColor: row.color }} />
          </View>
        </View>
      ))}
    </View>
  );
}

type TimelineItemProps = { row: TimelineRow; last: boolean; onOpen?: () => void; onAdd?: () => void };

// A slot marker with a connector to the next row, the time, the foods and the kcal. An
// unlogged slot is dashed; on today it opens Add meal with that slot chosen.
function TimelineItem({ row, last, onOpen, onAdd }: TimelineItemProps) {
  const info = slotInfo[row.slot];
  const time = row.meal ? clockTime(row.meal.loggedAt) : timeLabel(...info.defaultTime);
  const body = (
    <View className={row.meal ? "macro__timeline-card" : "macro__timeline-card macro__timeline-card--empty"}>
      <View className="flex-1 gap-0.5">
        <Text className="macro__overline">{info.label} · {time}</Text>
        <Text className={row.meal ? "card__title" : "post__time"} numberOfLines={2}>
          {row.meal ? row.meal.items.map((i) => i.name).join(" · ") : "Not logged yet"}
        </Text>
      </View>
      {row.meal ? (
        <Text className="macro__kcal">{whole(row.meal.totals.kcal)} kcal</Text>
      ) : onAdd ? (
        <SymbolView name={{ ios: "plus.circle", android: "add_circle_outline", web: "add_circle_outline" }} size={20} tintColor={colors.faint} />
      ) : null}
    </View>
  );
  return (
    <View className="flex-row gap-3">
      <View className="items-center" style={{ width: 28 }}>
        <View className="h-7 w-7 items-center justify-center rounded-pill" style={{ backgroundColor: `${info.tint}22` }}>
          <SymbolView name={info.icon} size={14} tintColor={info.tint} />
        </View>
        {!last && <View className="w-0.5 flex-1" style={{ backgroundColor: colors.creamLine }} />}
      </View>
      <View className="flex-1 pb-3">
        {onOpen || onAdd ? (
          <Pressable
            onPress={onOpen ?? onAdd}
            accessibilityRole="button"
            accessibilityLabel={row.meal ? `${info.label} at ${time}: ${row.meal.title}, ${whole(row.meal.totals.kcal)} kcal` : `${info.label}: not logged yet. Add ${info.label.toLowerCase()}`}
          >
            {body}
          </Pressable>
        ) : (
          body
        )}
      </View>
    </View>
  );
}
