import { useCallback, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { IconButton } from "@/components/IconButton";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { MealTimeline, timelineRows } from "@/components/macro/MealTimeline";
import { MealDetailSheet } from "@/components/macro/MealDetailSheet";
import { MonthCalendarSheet } from "@/components/macro/MonthCalendarSheet";
import { CaloriesCard } from "@/components/macro/CaloriesCard";
import { WeekStrip } from "@/components/macro/WeekStrip";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { longDate, macro, todayIso, whole, type DayProgress, type DayView, type Meal } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore, useMacroWeek } from "@/store/macro";
import { useThemeColors } from "@/theme";

// The Macro tab: a week of days, the day at a glance (calories left in a ring, eaten and
// target, the macros), the day's logged meals, and the way into logging (water is in the header). The selected day is shared
// with the Macro screens.

export default function MacroHub() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { width } = useWindowDimensions();
  const { selectedDate, selectDate, jumpToDate } = useMacroStore();
  const week = useMacroWeek();
  const today = todayIso();
  const isToday = selectedDate === today;

  const [day, setDay] = useState<DayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<Record<string, DayProgress>>({});
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
    const [dayResult, weekResult] = await Promise.all([macro.day(token, selectedDate), macro.progress(token, week)]);
    if (request !== latest.current) return;
    if (dayResult.ok) {
      setDay(dayResult.data);
      setLoading(false);
      fade.setValue(0.4);
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
    if (weekResult.ok) setProgress(Object.fromEntries(weekResult.data.days.map((d) => [d.date, d])));
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

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
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
            <ScreenSkeleton hero label="Loading your day" />
          ) : (
            <Animated.View style={{ opacity: switching ? 0.55 : fade, gap: 16 }}>
              {/* Calories left in a ring, eaten and target beside it, the three macros under; opens the daily view */}
              {targets ? (
                <CaloriesCard totals={showing.totals} targets={targets} onPress={() => router.push("/macro/daily")} />
              ) : (
                <DashedBlock
                  icon={{ ios: "flame", android: "local_fire_department", web: "local_fire_department" }}
                  title="Calorie target not set up yet"
                  text="Finish your profile (weight, height, birthday, workout days and goal) to see your daily calorie target here."
                  onPress={() => router.push("/profile")}
                />
              )}

              <Pressable onPress={() => router.push("/macro/calories-macros")} className="home__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel="Calories and macros: split, weekly trend and targets">
                <View className="macro__icon-tile" style={{ backgroundColor: colors.surfaceAlt }}>
                  <SymbolView name={{ ios: "chart.pie", android: "pie_chart", web: "pie_chart" }} size={20} tintColor={colors.ink} />
                </View>
                <View className="flex-1">
                  <Text className="card__title">Calories & macros</Text>
                  <Text className="meta-text">Split, weekly trend & targets</Text>
                </View>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
              </Pressable>

              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="home__card-title">{isToday ? "Today's meals" : "Meals"}</Text>
                  {showing.meals.length > 0 && <Text className="home__note">{`${showing.meals.length} ${showing.meals.length === 1 ? "meal" : "meals"} · ${whole(eaten).toLocaleString("en-IN")} kcal`}</Text>}
                </View>
                {showing.meals.length > 0 && (
                  <Pressable onPress={() => router.push("/macro/daily")} className="flex-row items-center" style={{ gap: 2 }} hitSlop={8} accessibilityRole="button" accessibilityLabel="View all meals">
                    <Text className="meta-text">View all</Text>
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
                <MealTimeline rows={timelineRows(showing.meals)} onOpen={setOpenMeal} />
              )}
            </Animated.View>
          )}
        </ScrollView>

        {/* Floating action: log on today, otherwise a way back to today */}
        <Pressable
          onPress={isToday ? () => router.push("/macro/add-meal") : () => jumpToDate(today)}
          className="macro__fab"
          style={{ backgroundColor: colors.inverse, height: 60, paddingLeft: 8, paddingRight: 22, gap: 12 }}
          accessibilityRole="button"
          accessibilityLabel={isToday ? "Add meal" : "Back to today"}
        >
          <View className="items-center justify-center rounded-pill" style={{ width: 44, height: 44, backgroundColor: colors.primary }}>
            <SymbolView name={isToday ? { ios: "plus", android: "add", web: "add" } : { ios: "arrow.uturn.backward", android: "undo", web: "undo" }} size={20} tintColor={colors.white} />
          </View>
          <Text className="btn-forest__label" style={{ color: colors.onInverse, fontSize: 17 }}>{isToday ? "Add meal" : "Back to today"}</Text>
        </Pressable>
      </SafeAreaView>

      <MealDetailSheet meal={openMeal} onClose={() => setOpenMeal(null)} onDeleted={() => load()} />
      <MonthCalendarSheet visible={calendarOpen} selectedDate={selectedDate} today={today} onPick={jumpToDate} onClose={() => setCalendarOpen(false)} />
    </View>
  );
}
