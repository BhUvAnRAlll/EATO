import { Pressable, Text, View } from "react-native";

import { Ring } from "@/components/macro/Ring";
import { SymbolView } from "@/components/SymbolView";
import { calorieSplit, whole, type Totals } from "@/lib/macro";
import { useThemeColors, type Palette } from "@/theme";
import type { Icon } from "@/types/profile";

// The macro split as the Calories & macros screen draws it, shared with the Macro tab: a donut
// split by each macro's share of calories with the kcal inside and a legend beside it, then
// the three macros as tiles (grams, a bar against the target, the share).

export const macroRows = (colors: Palette): { key: "proteinG" | "carbsG" | "fatG"; split: "protein" | "carbs" | "fat"; label: string; color: string; icon: Icon }[] => [
  { key: "proteinG", split: "protein", label: "Protein", color: colors.protein, icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" } },
  { key: "carbsG", split: "carbs", label: "Carbs", color: colors.carbs, icon: { ios: "leaf.fill", android: "grass", web: "grass" } },
  { key: "fatG", split: "fat", label: "Fat", color: colors.fat, icon: { ios: "drop.fill", android: "water_drop", web: "water_drop" } },
];

type SplitCardProps = {
  // What was eaten (or the period's average) and the targets
  totals: Totals;
  targets: Totals;
  size: number;
  stroke: number;
  // Tappable (the Macro tab opens the daily view); the label describes the card for a screen reader
  onPress?: () => void;
  accessibilityLabel?: string;
};

// A donut split by each macro's share of calories (stacked arcs: fat underneath, carbs over
// it up to protein + carbs, protein on top), the kcal inside, and a legend with the target split
export function SplitCard({ totals, targets, size, stroke, onPress, accessibilityLabel }: SplitCardProps) {
  const colors = useThemeColors();
  const eaten = calorieSplit(totals);
  const target = calorieSplit(targets);
  const body = (
    <>
      <View style={{ width: size, height: size }}>
        <View style={{ position: "absolute" }}>
          <Ring size={size} stroke={stroke} progress={1} color={colors.fat} caps={false} />
        </View>
        <View style={{ position: "absolute" }}>
          <Ring size={size} stroke={stroke} progress={(eaten.protein + eaten.carbs) / 100} color={colors.carbs} caps={false} trackColor="transparent" />
        </View>
        <Ring size={size} stroke={stroke} progress={eaten.protein / 100} color={colors.protein} caps={false} trackColor="transparent">
          <Text className="macro__hero-number" style={{ fontSize: size < 140 ? 24 : 28, lineHeight: size < 140 ? 28 : 32 }}>{whole(totals.kcal).toLocaleString("en-IN")}</Text>
          <Text className="macro__stat-label">kcal</Text>
        </Ring>
      </View>
      <View className="flex-1 gap-2">
        {macroRows(colors).map((row) => (
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
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} className="home__card flex-row items-center gap-5" accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {body}
    </Pressable>
  ) : (
    <View className="home__card flex-row items-center gap-5" accessibilityLabel={accessibilityLabel}>
      {body}
    </View>
  );
}

// The three macros side by side: the icon, the grams, the name, a bar and the share of the target
export function MacroTiles({ totals, targets }: { totals: Totals; targets: Totals }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row gap-2.5">
      {macroRows(colors).map((row) => {
        const value = totals[row.key];
        const target = targets[row.key];
        const pct = target > 0 ? Math.round((value / target) * 100) : 0;
        return (
          <View key={row.key} className="macro__tile" accessibilityLabel={`${row.label}: ${whole(value)} grams, ${pct}% of ${target} grams`}>
            <SymbolView name={row.icon} size={18} tintColor={row.color} />
            <Text className="macro__stat-value mt-2">{whole(value)}g</Text>
            <Text className="macro__bar-label">{row.label}</Text>
            <View className="macro__track mt-2">
              <View className="h-full rounded-pill" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: row.color }} />
            </View>
            <Text className="macro__bar-value mt-1.5" numberOfLines={1} adjustsFontSizeToFit>{pct}% of {target}g</Text>
          </View>
        );
      })}
    </View>
  );
}
