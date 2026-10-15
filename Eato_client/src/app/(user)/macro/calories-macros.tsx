import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { MacroHeader } from "@/components/macro/MacroHeader";
import { Ring } from "@/components/macro/Ring";
import { Segmented } from "@/components/macro/Segmented";
import { calorieSplit, macro, todayIso, weekdayInitial, whole, type Period, type Summary } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";
import type { Icon } from "@/types/profile";

const periods: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const periodWords: Record<Period, string> = { today: "day", week: "week", month: "month" };

const macroRows: { key: "proteinG" | "carbsG" | "fatG"; split: "protein" | "carbs" | "fat"; label: string; color: string; icon: Icon }[] = [
  { key: "proteinG", split: "protein", label: "Protein", color: colors.protein, icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" } },
  { key: "carbsG", split: "carbs", label: "Carbs", color: colors.carbs, icon: { ios: "leaf.fill", android: "grass", web: "grass" } },
  { key: "fatG", split: "fat", label: "Fat", color: colors.fat, icon: { ios: "drop.fill", android: "water_drop", web: "water_drop" } },
];

// Averages for today, this week or this month: the macro split by share of calories, each
// macro against its target, and the last 7 days' calories against the daily target
export default function CaloriesMacros() {
  const getToken = useSessionToken();
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState<Period>("today");
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined); // undefined = loading
  const [notice, setNotice] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const result = await macro.summary(await getToken().catch(() => null), period, todayIso());
        if (!cancelled && result.ok) setSummary(result.data.summary);
      })();
      return () => {
        cancelled = true;
      };
    }, [getToken, period]),
  );

  const share = async () => {
    if (!summary) return;
    setNotice(null);
    const { avg, targets } = summary;
    const message = `My ${periodWords[summary.period]} on EATO: ${whole(avg.kcal)} / ${targets.kcal} kcal · P ${whole(avg.proteinG)}g · C ${whole(avg.carbsG)}g · F ${whole(avg.fatG)}g`;
    try {
      await Share.share({ message });
    } catch {
      setNotice("Couldn't share. Try again in a moment.");
    }
  };

  const ringSize = width < 375 ? 120 : 148;
  const stroke = width < 375 ? 13 : 16;

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <MacroHeader
          title="Calories & macros"
          right={
            summary ? (
              <Pressable onPress={share} hitSlop={10} className="h-11 w-11 items-end justify-center" accessibilityRole="button" accessibilityLabel="Share">
                <SymbolView name={{ ios: "square.and.arrow.up", android: "share", web: "share" }} size={20} tintColor={colors.forestInk} />
              </Pressable>
            ) : undefined
          }
        />

        {summary === undefined ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={colors.forest} />
          </View>
        ) : summary === null ? (
          <View className="px-5 pt-4">
            <DashedBlock
              icon={{ ios: "chart.pie", android: "pie_chart", web: "pie_chart" }}
              title="Calorie target not set up yet"
              text="Finish your profile to see your calories and macros here."
              onPress={() => router.push("/profile")}
            />
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
              <Segmented options={periods} value={period} onChange={setPeriod} label="Period" />
              {notice && <Text className="macro__error" accessibilityRole="alert">{notice}</Text>}
              <SplitCard summary={summary} size={ringSize} stroke={stroke} />
              <View className="flex-row gap-2.5">
                {macroRows.map((row) => {
                  const value = summary.avg[row.key];
                  const target = summary.targets[row.key];
                  const pct = target > 0 ? Math.round((value / target) * 100) : 0;
                  return (
                    <View key={row.key} className="macro__tile" accessibilityLabel={`${row.label}: ${whole(value)} grams, ${pct}% of ${target} grams`}>
                      <SymbolView name={row.icon} size={18} tintColor={row.color} />
                      <Text className="macro__stat-value mt-2">{whole(value)}g</Text>
                      <Text className="macro__bar-label">{row.label}</Text>
                      <View className="macro__track mt-2">
                        <View className="h-full rounded-pill" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: row.color }} />
                      </View>
                      <Text className="macro__bar-value mt-1.5">{pct}% of {target}g</Text>
                    </View>
                  );
                })}
              </View>
              <WeekCard summary={summary} />
            </ScrollView>
            <View className="px-5 pb-3 pt-2">
              <Pressable onPress={() => router.push("/macro/adjust-targets")} className="btn-outline flex-row gap-2" accessibilityRole="button">
                <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={16} tintColor={colors.forestInk} />
                <Text className="btn-outline__label">Adjust targets</Text>
              </Pressable>
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

// A donut split by each macro's share of calories (stacked arcs: fat underneath, carbs over
// it up to protein + carbs, protein on top), the average kcal inside, and a legend
function SplitCard({ summary, size, stroke }: { summary: Summary; size: number; stroke: number }) {
  const eaten = calorieSplit(summary.avg);
  const target = calorieSplit(summary.targets);
  return (
    <View className="home__card flex-row items-center gap-5">
      <View style={{ width: size, height: size }}>
        <View style={{ position: "absolute" }}>
          <Ring size={size} stroke={stroke} progress={1} color={colors.fat} caps={false} />
        </View>
        <View style={{ position: "absolute" }}>
          <Ring size={size} stroke={stroke} progress={(eaten.protein + eaten.carbs) / 100} color={colors.carbs} caps={false} trackColor="transparent" />
        </View>
        <Ring size={size} stroke={stroke} progress={eaten.protein / 100} color={colors.protein} caps={false} trackColor="transparent">
          <Text className="macro__hero-number" style={{ fontSize: size < 140 ? 24 : 28, lineHeight: size < 140 ? 28 : 32 }}>{whole(summary.avg.kcal).toLocaleString("en-IN")}</Text>
          <Text className="macro__stat-label">kcal</Text>
        </Ring>
      </View>
      <View className="flex-1 gap-2">
        {macroRows.map((row) => (
          <View key={row.key} className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <View className="h-2.5 w-2.5 rounded-pill" style={{ backgroundColor: row.color }} />
              <Text className="macro__bar-label">{row.label}</Text>
            </View>
            <Text className="macro__bar-label">{eaten.empty ? "—" : `${eaten[row.split]}%`}</Text>
          </View>
        ))}
        <View className="my-1 h-px bg-cream-line" />
        <View>
          <Text className="macro__bar-value">Target split</Text>
          <Text className="macro__bar-label">{target.protein} / {target.carbs} / {target.fat}</Text>
        </View>
      </View>
    </View>
  );
}

// The last 7 days against the daily target: today's bar in the accent colour
function WeekCard({ summary }: { summary: Summary }) {
  const target = summary.targets.kcal;
  const delta = summary.trendAvg - target;
  const under = delta <= 0;
  const max = Math.max(target * 1.15, ...summary.trend.map((d) => d.kcal), 1);
  const today = todayIso();
  return (
    <View className="home__card gap-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="card__title">This week</Text>
          <Text className="post__time">Avg {summary.trendAvg.toLocaleString("en-IN")} kcal · target {target.toLocaleString("en-IN")}</Text>
        </View>
        <View className="flex-row items-center gap-1 rounded-pill px-2.5 py-1" style={{ backgroundColor: under ? colors.successSoft : colors.warningSoft }}>
          <SymbolView name={under ? { ios: "arrow.down.right", android: "south_east", web: "south_east" } : { ios: "arrow.up.right", android: "north_east", web: "north_east" }} size={12} tintColor={under ? colors.success : colors.warning} />
          <Text className="macro__badge" style={{ color: under ? colors.success : colors.warning }}>
            {delta > 0 ? "+" : ""}{delta.toLocaleString("en-IN")} avg
          </Text>
        </View>
      </View>
      <View className="flex-row items-end justify-between" style={{ height: 96 }} accessibilityLabel={`Last 7 days: ${summary.trend.map((d) => `${d.kcal} kcal`).join(", ")}`}>
        {summary.trend.map((d) => (
          <View key={d.date} className="flex-1 items-center">
            <View className="w-5" style={{ height: Math.max(4, Math.round((d.kcal / max) * 96)), borderRadius: 5, backgroundColor: d.date === today ? colors.leaf : colors.creamLine }} />
          </View>
        ))}
      </View>
      <View className="-mt-2 flex-row justify-between">
        {summary.trend.map((d) => (
          <Text key={d.date} className="macro__weekday flex-1 text-center" style={d.date === today ? { color: colors.leaf } : undefined}>{weekdayInitial(d.date)}</Text>
        ))}
      </View>
    </View>
  );
}
