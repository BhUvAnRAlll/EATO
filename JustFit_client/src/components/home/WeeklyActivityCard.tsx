import { Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import type { WeekActivity } from "@/lib/workoutApi";
import { colors } from "@/theme";

type WeeklyActivityCardProps = {
  activity: WeekActivity;
  // Opens the workout history
  onOpen: () => void;
};

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const BAR_AREA = 72;

// Minutes trained on each day of this week as a bar chart, today's bar in red and the rest
// grey, with the week's total and how it compares with last week.
export function WeeklyActivityCard({ activity, onOpen }: WeeklyActivityCardProps) {
  const { week, today, totalMinutes, changePercent } = activity;
  // Bars scale to the week's longest day, but never below half an hour, so a two-minute
  // session doesn't fill the chart
  const most = Math.max(30, ...week.map((d) => d.minutes));
  const change = changePercent === null ? null : changePercent === 0 ? "Same as last week" : `${changePercent > 0 ? "+" : ""}${changePercent}% vs last week`;
  const spoken = week.map((d, i) => `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]} ${d.minutes} min`).join(", ");

  return (
    <Pressable onPress={onOpen} className="home__card" accessibilityRole="button" accessibilityLabel={`Active this week: ${totalMinutes} minutes. ${change ?? ""} ${spoken}. Open workout history`}>
      <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
        <View className="min-w-0 flex-1">
          <Text className="home__card-title">Active this week</Text>
          <Text className="home__stat-big mt-1">
            {totalMinutes.toLocaleString("en-IN")}
            <Text className="home__stat-unit"> min</Text>
          </Text>
        </View>
        {change && (
          <View className={changePercent !== null && changePercent < 0 ? "home__pill-soft home__pill-soft--grey" : "home__pill-soft"}>
            <SymbolView
              name={changePercent !== null && changePercent < 0 ? { ios: "arrow.down.right", android: "trending_down", web: "trending_down" } : { ios: "arrow.up.right", android: "trending_up", web: "trending_up" }}
              size={13}
              tintColor={changePercent !== null && changePercent < 0 ? colors.muted : colors.primaryText}
            />
            <Text className={changePercent !== null && changePercent < 0 ? "home__pill-soft-label home__pill-soft-label--grey" : "home__pill-soft-label"}>{change}</Text>
          </View>
        )}
      </View>

      {totalMinutes === 0 && (
        <Text className="home__note mt-3">No sessions yet this week. Your first one shows up here.</Text>
      )}
      <View className="mt-4 flex-row items-end justify-between" style={{ gap: 6, height: (totalMinutes === 0 ? 28 : BAR_AREA) + 22 }}>
        {week.map((d, i) => {
          const isToday = d.date === today;
          const height = d.minutes > 0 ? Math.max(6, Math.round((d.minutes / most) * BAR_AREA)) : 6;
          return (
            <View key={d.date} className="flex-1 items-center" style={{ gap: 6 }}>
              <View className={isToday ? "home__bar home__bar--today" : d.minutes > 0 ? "home__bar home__bar--filled" : "home__bar"} style={{ height }} />
              <Text className={isToday ? "home__bar-label home__bar-label--today" : "home__bar-label"}>{DAY_LETTERS[i]}</Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}
