import { Pressable, Text, useWindowDimensions, View } from "react-native";

import { macroRows } from "@/components/macro/MacroSplit";
import { Ring } from "@/components/macro/Ring";
import { whole, type Totals } from "@/lib/macro";
import { useThemeColors } from "@/theme";

// The Macro tab's day summary: a large ring with the calories left inside (filling as the day's
// kcal are eaten, red once over), Eaten and Target beside it, then protein / carbs / fat as
// "eaten/target g" over a thin bar. The whole card opens the daily view.

type Props = {
  totals: Totals;
  targets: Totals;
  onPress: () => void;
};

export function CaloriesCard({ totals, targets, onPress }: Props) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const ring = width < 375 ? 128 : 148;
  const eaten = whole(totals.kcal);
  const over = eaten > targets.kcal;
  const left = Math.abs(targets.kcal - eaten);
  const fmt = (n: number) => n.toLocaleString("en-IN");

  return (
    <Pressable
      onPress={onPress}
      className="home__card"
      style={{ paddingVertical: 24 }}
      accessibilityRole="button"
      accessibilityLabel={`${fmt(left)} kcal ${over ? "over" : "left"}. Eaten ${fmt(eaten)} of ${fmt(targets.kcal)} kcal. Open daily calories`}
    >
      <View className="flex-row items-center" style={{ gap: 20 }}>
        <Ring size={ring} stroke={12} progress={targets.kcal > 0 ? eaten / targets.kcal : 0} color={over ? colors.danger : colors.primary} trackColor={colors.creamLine}>
          <Text className="macro__hero-number" style={{ fontSize: ring < 140 ? 26 : 30, lineHeight: ring < 140 ? 30 : 36 }} numberOfLines={1} adjustsFontSizeToFit>{fmt(left)}</Text>
          <Text className="macro__intake-of">{over ? "kcal over" : "kcal left"}</Text>
        </Ring>
        <View className="min-w-0 flex-1" style={{ gap: 14 }}>
          {([["Eaten", eaten], ["Target", targets.kcal]] as const).map(([label, value]) => (
            <View key={label} style={{ gap: 2 }}>
              <Text className="macro__overline">{label}</Text>
              <View className="flex-row items-baseline" style={{ gap: 4 }}>
                <Text className="macro__stat-value" style={{ fontSize: 22, lineHeight: 28 }} numberOfLines={1} adjustsFontSizeToFit>{fmt(value)}</Text>
                <Text className="macro__intake-of">kcal</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View className="mt-6 flex-row" style={{ gap: 14 }}>
        {macroRows(colors).map((m) => {
          const value = whole(totals[m.key]);
          const target = whole(targets[m.key]);
          return (
            <View key={m.key} className="min-w-0 flex-1" style={{ gap: 8 }} accessibilityLabel={`${m.label} ${value} of ${target} grams`}>
              <View className="flex-row flex-wrap items-baseline justify-between" style={{ columnGap: 4 }}>
                <Text className="macro__bar-value" numberOfLines={1}>{m.label}</Text>
                <Text className="macro__stat-label" numberOfLines={1}>{`${value}/${target}g`}</Text>
              </View>
              <View className="macro__track">
                <View className="h-full rounded-pill" style={{ width: `${target > 0 ? Math.min(100, (value / target) * 100) : 0}%`, backgroundColor: m.color }} />
              </View>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}
