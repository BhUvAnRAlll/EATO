import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { MacroBar } from "@/components/macro/MacroBar";
import { MealCard } from "@/components/macro/MealCard";
import { MealDetailSheet } from "@/components/macro/MealDetailSheet";
import { MonthCalendarSheet } from "@/components/macro/MonthCalendarSheet";
import { Ring } from "@/components/macro/Ring";
import { WeekStrip } from "@/components/macro/WeekStrip";
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
  const ringSize = width < 375 ? 120 : 148;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 110, gap: 16 }} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View className="flex-row items-center pt-2">
            <View className="flex-1">
              <Text className="home__note" numberOfLines={1}>{longDate(selectedDate)}</Text>
              <Text className="type-title text-forest-ink">Macro</Text>
            </View>
            <View className="flex-row gap-2">
              <Pressable onPress={() => router.push("/macro/water")} className="home__icon-button" accessibilityRole="button" accessibilityLabel="Water">
                <SymbolView name={{ ios: "drop.fill", android: "water_drop", web: "water_drop" }} size={20} tintColor={colors.fat} />
              </Pressable>
              <Pressable onPress={() => setCalendarOpen(true)} className="home__icon-button" accessibilityRole="button" accessibilityLabel="Jump to a day">
                <SymbolView name={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} size={20} tintColor={colors.forestInk} />
              </Pressable>
            </View>
          </View>

          <WeekStrip week={week} selectedDate={selectedDate} today={today} progress={progress} onSelect={selectDate} width={width - 40} />

          {!showing ? (
            <ActivityIndicator color={colors.forest} className="mt-10" />
          ) : (
            <Animated.View style={{ opacity: switching ? 0.55 : fade, gap: 16 }}>
              {targets ? (
                <Pressable onPress={() => router.push("/macro/daily")} className="home__card gap-4" accessibilityRole="button" accessibilityLabel={`${whole(left)} kcal left. Eaten ${whole(eaten)} of ${targets.kcal}. Open daily calories`}>
                  <View className="flex-row items-center gap-4">
                    <Ring size={ringSize} stroke={width < 375 ? 11 : 13} progress={eaten / targets.kcal} color={colors.leaf}>
                      <Text className="macro__hero-number" style={{ fontSize: ringSize < 140 ? 26 : 32, lineHeight: ringSize < 140 ? 30 : 36 }}>{whole(left).toLocaleString("en-IN")}</Text>
                      <Text className="macro__stat-label">kcal left</Text>
                    </Ring>
                    <View className="flex-1 gap-4">
                      <View>
                        <Text className="macro__stat-label">Eaten</Text>
                        <Text className="macro__stat-value">{whole(eaten).toLocaleString("en-IN")} <Text className="macro__stat-label">kcal</Text></Text>
                      </View>
                      <View>
                        <Text className="macro__stat-label">Target</Text>
                        <Text className="macro__stat-value">{targets.kcal.toLocaleString("en-IN")} <Text className="macro__stat-label">kcal</Text></Text>
                      </View>
                    </View>
                  </View>
                  <View className="flex-row gap-3">
                    <MacroBar label="Protein" value={showing.totals.proteinG} target={targets.proteinG} color={colors.protein} />
                    <MacroBar label="Carbs" value={showing.totals.carbsG} target={targets.carbsG} color={colors.carbs} />
                    <MacroBar label="Fat" value={showing.totals.fatG} target={targets.fatG} color={colors.fat} />
                  </View>
                </Pressable>
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
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.faint} />
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
