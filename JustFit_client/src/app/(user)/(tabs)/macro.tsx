import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { IconButton } from "@/components/IconButton";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { IntakeCard } from "@/components/macro/IntakeCard";
import { MealCard } from "@/components/macro/MealCard";
import { MealDetailSheet } from "@/components/macro/MealDetailSheet";
import { MonthCalendarSheet } from "@/components/macro/MonthCalendarSheet";
import { WeekStrip } from "@/components/macro/WeekStrip";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { longDate, macro, todayIso, whole, type DayProgress, type DayView, type Meal, type WaterDay } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore, useMacroWeek } from "@/store/macro";
import { colors } from "@/theme";

// The Macro tab: the day at a glance (what was eaten against the target, the macros, water,
// calories left), a week of day tiles, and the way into logging. The selected day is shared
// with the Macro screens.
// "1.5 L" (or "1.5" without the unit) from millilitres
const litres = (ml: number, unit = true) => `${(ml / 1000).toFixed(1).replace(/\.0$/, "")}${unit ? " L" : ""}`;

export default function MacroHub() {
  const getToken = useSessionToken();
  const { width } = useWindowDimensions();
  const { selectedDate, selectDate, jumpToDate } = useMacroStore();
  const week = useMacroWeek();
  const today = todayIso();
  const isToday = selectedDate === today;

  const [day, setDay] = useState<DayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<Record<string, DayProgress>>({});
  const [water, setWater] = useState<WaterDay | null>(null);
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [fade] = useState(() => new Animated.Value(1));
  const latest = useRef(0);

  // The selected day and the week strip. While another day loads the previous one stays
  // on screen, dimmed, so the screen never flashes empty. A failed read keeps loading.
  const load = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    const token = await getToken().catch(() => null);
    const [dayResult, weekResult, waterResult] = await Promise.all([macro.day(token, selectedDate), macro.progress(token, week), macro.water(token, selectedDate)]);
    if (request !== latest.current) return;
    if (dayResult.ok) {
      setDay(dayResult.data);
      setLoading(false);
      fade.setValue(0.4);
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
    if (weekResult.ok) setProgress(Object.fromEntries(weekResult.data.days.map((d) => [d.date, d])));
    // The water card only with a day's water; without it (or on a medical note) the card is left out
    setWater(waterResult.ok && waterResult.data.medicalNote === null ? waterResult.data : null);
  }, [getToken, selectedDate, week, fade]);

  // Loads when the tab comes into view (so a meal saved in the logging flow is there on
  // return) and again whenever the day or the week moves
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A pull reads the day and the week strip again
  const { refreshControl } = usePullToRefresh(load);

  const showing = day;
  const switching = loading && day !== null;
  const targets = showing?.targets ?? null;
  const eaten = showing?.totals.kcal ?? 0;
  const left = targets ? Math.max(0, targets.kcal - eaten) : 0;
  // How the day stands against its target, for the Calories left card's pill
  const standing = eaten === 0 ? "Nothing logged" : targets && eaten > targets.kcal ? "Over target" : "On track";
  const standingColor = standing === "Over target" ? { tint: colors.dangerSoft, text: colors.danger } : { tint: colors.successSoft, text: colors.success };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140, gap: 16 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          {/* Header */}
          <View className="flex-row items-center pt-2">
            <View className="flex-1">
              <Text className="home__note" numberOfLines={1}>{longDate(selectedDate)}</Text>
              <Text className="type-title text-forest-ink">Macro</Text>
            </View>
            <View className="flex-row gap-2">
              <IconButton icon={{ ios: "drop", android: "water_drop", web: "water_drop" }} label="Water" onPress={() => router.push("/macro/water")} />
              <IconButton icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} label="Jump to a day" onPress={() => setCalendarOpen(true)} />
            </View>
          </View>

          <WeekStrip week={week} selectedDate={selectedDate} today={today} progress={progress} onSelect={selectDate} width={width - 32} />

          {!showing ? (
            <ActivityIndicator color={colors.forest} className="mt-10" />
          ) : (
            <Animated.View style={{ opacity: switching ? 0.55 : fade, gap: 16 }}>
              {targets ? (
                <>
                  <IntakeCard title={isToday ? "Today's intake" : "Intake"} totals={showing.totals} targets={targets} width={width - 32} onPress={() => router.push("/macro/daily")} />

                  {/* Water and calories left, side by side (stacked on a 320pt phone) */}
                  <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                    {water && (
                      <Pressable onPress={() => router.push("/macro/water")} className="home__card" style={{ flexGrow: 1, flexBasis: 150, gap: 10 }} accessibilityRole="button" accessibilityLabel={`Water intake: ${litres(water.consumedMl)} of ${litres(water.targetMl)}. Open water`}>
                        <View className="flex-row items-center" style={{ gap: 10 }}>
                          <View className="macro__icon-tile" style={{ backgroundColor: colors.tintBlue }}>
                            <SymbolView name={{ ios: "drop.fill", android: "water_drop", web: "water_drop" }} size={18} tintColor={colors.iconBlue} />
                          </View>
                          <Text className="card__title flex-1" numberOfLines={1}>Water intake</Text>
                          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                        </View>
                        <View className="flex-row items-baseline" style={{ gap: 6 }}>
                          <Text className="home__stat-big" numberOfLines={1}>{litres(water.consumedMl, false)}</Text>
                          <Text className="home__stat-unit" numberOfLines={1}>{`/ ${litres(water.targetMl)}`}</Text>
                        </View>
                        <View className="macro__water-track">
                          <View className="macro__water-fill" style={{ width: `${Math.round(Math.min(1, water.targetMl > 0 ? water.consumedMl / water.targetMl : 0) * 100)}%` }} />
                        </View>
                        <Text className="home__note" numberOfLines={1}>{`${litres(water.consumedMl)} consumed  ·  ${litres(Math.max(0, water.remainingMl))} remaining`}</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => router.push("/macro/daily")} className="home__card" style={{ flexGrow: 1, flexBasis: 150, gap: 10, backgroundColor: colors.tintPeach }} accessibilityRole="button" accessibilityLabel={`Calories left: ${whole(left).toLocaleString("en-IN")} kcal, ${standing.toLowerCase()}. Open daily calories`}>
                      <View className="flex-row items-center" style={{ gap: 10 }}>
                        <View className="macro__icon-tile" style={{ backgroundColor: colors.accentSoft }}>
                          <SymbolView name={{ ios: "target", android: "track_changes", web: "track_changes" }} size={18} tintColor={colors.primary} />
                        </View>
                        <Text className="card__title flex-1" numberOfLines={1}>Calories left</Text>
                        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
                      </View>
                      <View className="flex-row items-baseline" style={{ gap: 6 }}>
                        <Text className="home__stat-big" numberOfLines={1} adjustsFontSizeToFit>{whole(left).toLocaleString("en-IN")}</Text>
                        <Text className="home__stat-unit">Kcal</Text>
                      </View>
                      <View className="macro__chip flex-row self-start" style={{ backgroundColor: standingColor.tint, gap: 4, height: 26, paddingHorizontal: 10 }}>
                        <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={12} tintColor={standingColor.text} />
                        <Text className="macro__chip-label" style={{ color: standingColor.text }}>{standing}</Text>
                      </View>
                    </Pressable>
                  </View>
                </>
              ) : (
                <DashedBlock
                  icon={{ ios: "flame", android: "local_fire_department", web: "local_fire_department" }}
                  title="Calorie target not set up yet"
                  text="Finish your profile (weight, height, birthday, workout days and goal) to see your daily calorie target here."
                  onPress={() => router.push("/profile")}
                />
              )}

              <Pressable onPress={() => router.push("/macro/calories-macros")} className="home__card flex-row items-center gap-3" style={{ backgroundColor: colors.accentSoft }} accessibilityRole="button" accessibilityLabel="Calories and macros: split, weekly trend and targets">
                <View className="macro__icon-tile" style={{ backgroundColor: colors.white }}>
                  <SymbolView name={{ ios: "chart.pie.fill", android: "pie_chart", web: "pie_chart" }} size={20} tintColor={colors.primary} />
                </View>
                <View className="flex-1">
                  <Text className="card__title">Calories & macros</Text>
                  <Text className="post__time">Split, weekly trend & targets</Text>
                </View>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
              </Pressable>

              <View className="flex-row items-center justify-between">
                <Text className="home__card-title">{isToday ? "Today's meals" : "Meals"}</Text>
                {showing.meals.length > 0 && (
                  <Pressable onPress={() => router.push("/macro/daily")} className="flex-row items-center" style={{ gap: 2 }} hitSlop={8} accessibilityRole="button" accessibilityLabel="View all meals">
                    <Text className="post__time">View all</Text>
                    <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={12} tintColor={colors.faint} />
                  </Pressable>
                )}
              </View>
              {showing.meals.length === 0 ? (
                <DashedBlock
                  icon={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }}
                  title={isToday ? "Nothing logged yet" : "Nothing was logged"}
                  text={isToday ? "Add your first meal to start today." : "This day has no meals. You can only log meals on the day you eat them."}
                  onPress={isToday ? () => router.push("/macro/add-meal") : undefined}
                />
              ) : (
                <View className="gap-2.5">
                  {showing.meals.map((meal) => (
                    <MealCard key={meal.id} meal={meal} onPress={() => setOpenMeal(meal)} />
                  ))}
                </View>
              )}
            </Animated.View>
          )}
        </ScrollView>

        {/* Floating action: log on today, otherwise a way back to today */}
        <Pressable
          onPress={isToday ? () => router.push("/macro/add-meal") : () => jumpToDate(today)}
          className="macro__fab"
          accessibilityRole="button"
          accessibilityLabel={isToday ? "Add meal" : "Back to today"}
        >
          <SymbolView name={isToday ? { ios: "plus", android: "add", web: "add" } : { ios: "arrow.uturn.backward", android: "undo", web: "undo" }} size={18} tintColor={colors.white} />
          <Text className="btn-forest__label">{isToday ? "Add meal" : "Back to today"}</Text>
        </Pressable>
      </SafeAreaView>

      <MealDetailSheet meal={openMeal} onClose={() => setOpenMeal(null)} onDeleted={() => load()} />
      <MonthCalendarSheet visible={calendarOpen} selectedDate={selectedDate} today={today} onPick={jumpToDate} onClose={() => setCalendarOpen(false)} />
    </View>
  );
}
