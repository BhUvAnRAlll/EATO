import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { ActivityCard } from "@/components/ActivityCard";
import { IconButton } from "@/components/IconButton";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { MealCard } from "@/components/macro/MealCard";
import { MealDetailSheet } from "@/components/macro/MealDetailSheet";
import { MonthCalendarSheet } from "@/components/macro/MonthCalendarSheet";
import { WeekStrip } from "@/components/macro/WeekStrip";
import { MetricCard } from "@/components/MetricCard";
import { ProgressStat } from "@/components/ProgressStat";
import { longDate, macro, todayIso, whole, type DayProgress, type DayView, type Meal } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useMacroStore, useMacroWeek } from "@/store/macro";
import { colors } from "@/theme";

// The Macro tab: the day at a glance (calories left, macros, what was eaten), a week of
// day rings, and the way into logging. The selected day is shared with the Macro screens.
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

  const showing = day;
  const switching = loading && day !== null;
  const targets = showing?.targets ?? null;
  const eaten = showing?.totals.kcal ?? 0;
  const left = targets ? Math.max(0, targets.kcal - eaten) : 0;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140, gap: 16 }} showsVerticalScrollIndicator={false}>
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
                  <ActivityCard
                    title={isToday ? "Today's calories" : "Calories"}
                    metric={whole(eaten).toLocaleString("en-IN")}
                    meta={`/ ${targets.kcal.toLocaleString("en-IN")} Kcal`}
                    progress={targets.kcal > 0 ? eaten / targets.kcal : 0}
                    compact={width < 375}
                    onPress={() => router.push("/macro/daily")}
                    accessibilityLabel={`${whole(left)} kcal left. Eaten ${whole(eaten)} of ${targets.kcal}. Open daily calories`}
                  >
                    <ProgressStat label="Protein" value={`${whole(showing.totals.proteinG)}/${targets.proteinG}`} unit="g" progress={targets.proteinG > 0 ? showing.totals.proteinG / targets.proteinG : 0} color={colors.protein} />
                    <ProgressStat label="Carbs" value={`${whole(showing.totals.carbsG)}/${targets.carbsG}`} unit="g" progress={targets.carbsG > 0 ? showing.totals.carbsG / targets.carbsG : 0} color={colors.carbs} />
                    <ProgressStat label="Fat" value={`${whole(showing.totals.fatG)}/${targets.fatG}`} unit="g" progress={targets.fatG > 0 ? showing.totals.fatG / targets.fatG : 0} color={colors.fat} />
                  </ActivityCard>
                  <View className="flex-row gap-3">
                    <MetricCard
                      tone="peach"
                      label="Left"
                      icon={{ ios: "flame", android: "local_fire_department", web: "local_fire_department" }}
                      value={whole(left).toLocaleString("en-IN")}
                      unit="Kcal"
                      status={left > 0 ? "On track" : "Reached"}
                      onPress={() => router.push("/macro/daily")}
                    />
                    <MetricCard
                      tone="blue"
                      label="Burned"
                      icon={{ ios: "bolt", android: "bolt", web: "bolt" }}
                      value={whole(showing.burned).toLocaleString("en-IN")}
                      unit="Kcal"
                      status={showing.burned > 0 ? "Active" : "Rest"}
                    />
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

              <Pressable onPress={() => router.push("/macro/calories-macros")} className="home__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel="Calories and macros: split, weekly trend and targets">
                <View className="macro__thumb" style={{ backgroundColor: colors.forestSoft }}>
                  <SymbolView name={{ ios: "chart.pie.fill", android: "pie_chart", web: "pie_chart" }} size={20} tintColor={colors.forest} />
                </View>
                <View className="flex-1">
                  <Text className="card__title">Calories & macros</Text>
                  <Text className="post__time">Split, weekly trend & targets</Text>
                </View>
                <IconButton icon={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} label="Open" variant="primary" size={36} />
              </Pressable>

              <Text className="setup__section">{isToday ? "Today's meals" : "Meals"}</Text>
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
