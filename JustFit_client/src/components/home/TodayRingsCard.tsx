import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";

import { ProgressRing } from "@/components/ProgressRing";
import { SymbolView } from "@/components/SymbolView";
import type { NutritionToday } from "@/data/home";
import { useThemeColors } from "@/theme";

type TodayRingsCardProps = {
  // The admins' heading for this card ("Today's Macros")
  heading: string;
  nutrition: NutritionToday;
  // Today's water against its target; without one the third ring shows carbs instead
  water: { consumedMl: number; targetMl: number } | null;
  // Inner width of the page (screen width minus the page padding)
  width: number;
  // Opens the Macro tab (today's meals and logging)
  onOpen: () => void;
};

const kcal = (n: number) => n.toLocaleString("en-IN");
const share = (done: number, target: number) => (target > 0 ? Math.min(done / target, 1) : 0);
const litres = (ml: number) => `${(ml / 1000).toFixed(1).replace(/\.0$/, "")} L`;

// Today, as three thin rings (calories eaten, protein, water) each with its value inside and
// "of target" under it, and how many calories are left as a soft pill. The whole card opens
// the Macro tab. Replaces the old dark Peak Fitness card on Home (2026-10-31 design).
export function TodayRingsCard({ heading, nutrition, water, width, onOpen }: TodayRingsCardProps) {
  const colors = useThemeColors();
  const { consumed, targets } = nutrition;
  const left = Math.max(0, targets.calories - consumed.calories);
  const rings = [
    { key: "calories", label: "Calories", value: kcal(consumed.calories), of: `of ${kcal(targets.calories)} kcal`, progress: share(consumed.calories, targets.calories), color: colors.leaf, spoken: `Calories: ${consumed.calories} of ${targets.calories} kcal` },
    { key: "protein", label: "Protein", value: `${consumed.proteinG} g`, of: `of ${targets.proteinG} g`, progress: share(consumed.proteinG, targets.proteinG), color: colors.protein, spoken: `Protein: ${consumed.proteinG} of ${targets.proteinG} g` },
    water
      ? { key: "water", label: "Water", value: litres(water.consumedMl), of: `of ${litres(water.targetMl)}`, progress: share(water.consumedMl, water.targetMl), color: colors.accentBlue, spoken: `Water: ${litres(water.consumedMl)} of ${litres(water.targetMl)}` }
      : { key: "carbs", label: "Carbs", value: `${consumed.carbsG} g`, of: `of ${targets.carbsG} g`, progress: share(consumed.carbsG, targets.carbsG), color: colors.carbs, spoken: `Carbs: ${consumed.carbsG} of ${targets.carbsG} g` },
  ];
  // Three rings with room for their labels: 84pt on standard phones, smaller on narrow ones
  const size = Math.max(64, Math.min(84, Math.floor((width - 32 - 2 * 12) / 3) - 12));

  return (
    <PressableScale scaleTo={0.98} onPress={onOpen} className="home__card" accessibilityRole="button" accessibilityLabel={`${heading}: ${consumed.calories} of ${targets.calories} kcal eaten. Open Macro`}>
      {/* The pill drops under the heading when the two don't fit side by side (320pt phones) */}
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 8 }}>
        <Text className="home__card-title" numberOfLines={1}>{heading}</Text>
        <View className="home__pill-soft">
          <SymbolView name={{ ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }} size={13} tintColor={colors.primaryText} />
          <Text className="home__pill-soft-label">{`${kcal(left)} kcal left`}</Text>
        </View>
      </View>

      <View className="mt-4 flex-row justify-between" style={{ gap: 12 }}>
        {rings.map((ring, index) => (
          <View key={ring.key} className="flex-1 items-center" style={{ gap: 8 }} accessibilityLabel={ring.spoken}>
            <ProgressRing progress={ring.progress} size={size} stroke={7} color={ring.color} delay={index * 120}>
              {() => <Text className="home__ring-value" numberOfLines={1} adjustsFontSizeToFit>{ring.value}</Text>}
            </ProgressRing>
            <View className="items-center">
              <Text className="home__ring-label">{ring.label}</Text>
              <Text className="home__ring-of" numberOfLines={1}>{ring.of}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text className="home__note mt-4">
        {nutrition.source === "sample"
          ? "Sample numbers: your targets couldn't be loaded."
          : consumed.calories > 0
            ? `${kcal(consumed.calories)} kcal logged today. Tap to see your meals.`
            : "Nothing logged yet today. Tap to log a meal."}
      </Text>
    </PressableScale>
  );
}
