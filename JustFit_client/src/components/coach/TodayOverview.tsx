import { Text, View } from "react-native";

import type { Totals } from "@/lib/macro";
import { dateOf } from "@/lib/macro";
import { Palette, useThemeColors } from "@/theme";

type Props = {
  date: string;
  totals: Totals;
  // The member's daily targets (none until setup is finished)
  targets: Totals | null;
};

const columns = (colors: Palette): { key: keyof Totals; label: string; unit: string; color: string }[] => ([
  { key: "kcal", label: "Calories", unit: "kcal", color: colors.leaf },
  { key: "proteinG", label: "Protein", unit: "g", color: colors.protein },
  { key: "carbsG", label: "Carbs", unit: "g", color: colors.carbs },
  { key: "fatG", label: "Fat", unit: "g", color: colors.fat },
]);

const shortDate = (iso: string) => dateOf(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

// Today on the Coach tab: what's been logged in Macro today against each target, as four
// columns (calories, protein, carbs, fat), each a number over its target and a thin bar
export function TodayOverview({ date, totals, targets }: Props) {
  const colors = useThemeColors();
  return (
    <View className="coach__card">
      <View className="flex-row items-baseline justify-between">
        <Text className="coach__section">Logged today</Text>
        <Text className="coach__hint">{shortDate(date)}</Text>
      </View>
      <View className="flex-row gap-3">
        {columns(colors).map((column) => {
          const value = Math.round(totals[column.key]);
          const target = targets ? Math.round(targets[column.key]) : null;
          const percent = target ? Math.min(Math.round((value / target) * 100), 100) : 0;
          return (
            <View
              key={column.key}
              className="coach__stat"
              accessibilityLabel={target ? `${column.label}: ${value} of ${target} ${column.unit}` : `${column.label}: ${value} ${column.unit}`}
            >
              <Text className="coach__stat-label" numberOfLines={1}>{column.label}</Text>
              <Text numberOfLines={1}>
                <Text className="coach__stat-value">{value}</Text>
                {target !== null && <Text className="coach__stat-of">{` / ${target}`}</Text>}
              </Text>
              <View className="coach__bar">
                <View className="coach__bar-fill" style={{ width: `${percent}%`, backgroundColor: column.color }} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
