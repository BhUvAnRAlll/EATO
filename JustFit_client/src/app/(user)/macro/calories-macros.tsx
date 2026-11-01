import { useCallback, useState } from "react";
import { Pressable, ScrollView, Share, Text, useWindowDimensions, View } from "react-native";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { MacroHeader } from "@/components/macro/MacroHeader";
import { MacroTiles, SplitCard } from "@/components/macro/MacroSplit";
import { Segmented } from "@/components/macro/Segmented";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { macro, todayIso, weekdayInitial, whole, type Period, type Summary } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const periods: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];
const periodWords: Record<Period, string> = { today: "day", week: "week", month: "month" };

// Averages for today, this week or this month: the macro split by share of calories, each
// macro against its target, and the last 7 days' calories against the daily target
export default function CaloriesMacros() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState<Period>("today");
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined); // undefined = loading
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await macro.summary(await getToken().catch(() => null), period, todayIso());
    if (result.ok) setSummary(result.data.summary);
  }, [getToken, period]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A pull reads the period's summary again
  const { refreshControl } = usePullToRefresh(load);

  const share = async () => {
    if (!summary) return;
    setNotice(null);
    const { avg, targets } = summary;
    const message = `My ${periodWords[summary.period]} on justFit: ${whole(avg.kcal)} / ${targets.kcal} kcal · P ${whole(avg.proteinG)}g · C ${whole(avg.carbsG)}g · F ${whole(avg.fatG)}g`;
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
      <StatusBar style="auto" />
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
          <View className="px-4 pt-2">
            <ScreenSkeleton />
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
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
              <Segmented options={periods} value={period} onChange={setPeriod} label="Period" />
              {notice && <Text className="macro__error" accessibilityRole="alert">{notice}</Text>}
              <SplitCard totals={summary.avg} targets={summary.targets} size={ringSize} stroke={stroke} />
              <MacroTiles totals={summary.avg} targets={summary.targets} />
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

// The last 7 days against the daily target: today's bar in the accent colour
function WeekCard({ summary }: { summary: Summary }) {
  const colors = useThemeColors();
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
          <Text className="meta-text">Avg {summary.trendAvg.toLocaleString("en-IN")} kcal · target {target.toLocaleString("en-IN")}</Text>
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
