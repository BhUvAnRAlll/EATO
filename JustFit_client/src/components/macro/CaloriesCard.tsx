import { Pressable, Text, View } from "react-native";
import { useResponsive } from "@/lib/responsive";

import { macroRows } from "@/components/macro/MacroSplit";
import { Ring } from "@/components/macro/Ring";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { whole, type Totals } from "@/lib/macro";
import { useTween } from "@/lib/useTween";
import { useThemeColors } from "@/theme";

// The Macro tab's day summary: a large ring with the calories left inside (filling as the day's
// kcal are eaten, red once over), Eaten and Target beside it, then protein / carbs / fat as
// "eaten/target g" over a thin bar. The whole card opens the daily view. When a meal is logged
// the ring and bars ease to the new day and the figures roll (still with Reduce Motion on).

type Props = {
  totals: Totals;
  targets: Totals;
  onPress: () => void;
};

export function CaloriesCard({ totals, targets, onPress }: Props) {
  const colors = useThemeColors();
  // The ring follows the screen width, between 128 and 160
  const { scale } = useResponsive();
  const ring = scale(148, { min: 128, max: 160 });
  const eaten = whole(totals.kcal);
  const over = eaten > targets.kcal;
  const left = Math.abs(targets.kcal - eaten);
  const fmt = (n: number) => n.toLocaleString("en-IN");
  const ringProgress = useTween(targets.kcal > 0 ? eaten / targets.kcal : 0);

  return (
    <Pressable
      onPress={onPress}
      className="home__card"
      style={{ paddingVertical: 24 }}
      accessibilityRole="button"
      accessibilityLabel={`${fmt(left)} kcal ${over ? "over" : "left"}. Eaten ${fmt(eaten)} of ${fmt(targets.kcal)} kcal. Open daily calories`}
    >
      <View className="flex-row items-center" style={{ gap: 20 }}>
        <Ring size={ring} stroke={12} progress={ringProgress} color={over ? colors.danger : colors.primary} trackColor={colors.creamLine}>
          <AnimatedNumber className="macro__hero-number" style={{ fontSize: ring < 140 ? 26 : 30, lineHeight: ring < 140 ? 30 : 36 }} numberOfLines={1} adjustsFontSizeToFit>{fmt(left)}</AnimatedNumber>
          <Text className="macro__intake-of">{over ? "kcal over" : "kcal left"}</Text>
        </Ring>
        <View className="min-w-0 flex-1" style={{ gap: 14 }}>
          {([["Eaten", eaten], ["Target", targets.kcal]] as const).map(([label, value]) => (
            <View key={label} style={{ gap: 2 }}>
              <Text className="macro__overline">{label}</Text>
              <View className="flex-row items-baseline" style={{ gap: 4 }}>
                <AnimatedNumber className="macro__stat-value" style={{ fontSize: 22, lineHeight: 28 }} numberOfLines={1} adjustsFontSizeToFit>{fmt(value)}</AnimatedNumber>
                <Text className="macro__intake-of">kcal</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View className="mt-6 flex-row" style={{ gap: 14 }}>
        {macroRows(colors).map((m) => (
          <MacroColumn key={m.key} label={m.label} color={m.color} value={whole(totals[m.key])} target={whole(targets[m.key])} />
        ))}
      </View>
    </Pressable>
  );
}

// One macro: "Protein" over "52/120g" over a thin bar that eases to its new width. Always stacked:
// side by side, each column wrapped on its own, so Protein and Carbs broke onto two lines while Fat
// stayed on one and the three bars sat at different heights (the owner's photo, 2026-11-08)
function MacroColumn({ label, color, value, target }: { label: string; color: string; value: number; target: number }) {
  const width = useTween(target > 0 ? Math.min(100, (value / target) * 100) : 0);
  return (
    <View className="min-w-0 flex-1" style={{ gap: 8 }} accessibilityLabel={`${label} ${value} of ${target} grams`}>
      <View style={{ gap: 2 }}>
        <Text className="macro__bar-value" numberOfLines={1}>{label}</Text>
        <AnimatedNumber className="macro__stat-label" numberOfLines={1} adjustsFontSizeToFit>{`${value}/${target}g`}</AnimatedNumber>
      </View>
      <View className="macro__track">
        <View className="h-full rounded-pill" style={{ width: `${width}%`, backgroundColor: color }} />
      </View>
    </View>
  );
}
