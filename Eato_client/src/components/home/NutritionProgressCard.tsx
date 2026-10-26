import { Pressable, Text, View } from "react-native";

import { ProgressRing } from "@/components/ProgressRing";
import { SectionHeader } from "@/components/home/SectionHeader";
import type { NutritionToday } from "@/data/home";
import { colors } from "@/theme";

type NutritionProgressCardProps = {
  heading: string;
  actionLabel: string;
  nutrition: NutritionToday;
  // Inner width of the page (screen width minus the page padding)
  width: number;
  onEditGoal: () => void;
  // Opens the Macro tab (today's meals and logging)
  onOpen: () => void;
};

const stats = [
  { key: "calories", label: "Calories", unit: "kcal", color: colors.leaf },
  { key: "proteinG", label: "Protein", unit: "g", color: colors.protein },
  { key: "carbsG", label: "Carbs", unit: "g", color: colors.carbs },
  { key: "fatG", label: "Fats", unit: "g", color: colors.fat },
] as const;

const amount = (n: number, unit: string) => (unit === "kcal" ? n.toLocaleString("en-IN") : `${n}g`);

// "Today's Macros" (the admins' heading): one card with a ring for the share of today's
// calories eaten and the four amounts beside it. The card opens the Macro tab; "Edit Goal" stays
// a separate link (no button inside a button).
export function NutritionProgressCard({ heading, actionLabel, nutrition, width, onEditGoal, onOpen }: NutritionProgressCardProps) {
  const { consumed, targets } = nutrition;
  const share = targets.calories > 0 ? consumed.calories / targets.calories : 0;
  const ringSize = width < 330 ? 84 : 96;

  return (
    <View>
      <SectionHeader title={heading} actionLabel={actionLabel} onAction={onEditGoal} />
      <Pressable
        onPress={onOpen}
        className="card mt-3"
        accessibilityRole="button"
        accessibilityLabel={`${heading}: ${consumed.calories} of ${targets.calories} kcal eaten. Open Macro`}
      >
        <View className="flex-row items-center gap-4">
          <ProgressRing progress={share} size={ringSize} stroke={9}>
            {(shown) => <Text className="type-number-stat text-ink">{`${Math.round(Math.min(share, 9.99) * 100 * shown)}%`}</Text>}
          </ProgressRing>
          <View className="flex-1" accessibilityLabel={`Calories: ${amount(consumed.calories, "kcal")} of ${amount(targets.calories, "kcal")} kcal`}>
            <Text className="type-number-big text-ink" numberOfLines={1}>
              {amount(consumed.calories, "kcal")}
            </Text>
            <Text className="type-caption text-muted">{`of ${amount(targets.calories, "kcal")} kcal eaten`}</Text>
          </View>
        </View>
        <View className="mt-4 flex-row border-t border-line pt-3.5">
          {stats
            .filter((stat) => stat.key !== "calories")
            .map((stat) => (
              <View key={stat.key} className="flex-1" accessibilityLabel={`${stat.label}: ${amount(consumed[stat.key], stat.unit)} of ${amount(targets[stat.key], stat.unit)}`}>
                <View className="flex-row items-center gap-1.5">
                  <View className="h-2 w-2 rounded-full" style={{ backgroundColor: stat.color }} />
                  <Text className="type-caption text-muted">{stat.label}</Text>
                </View>
                <Text className="type-subhead mt-0.5 text-ink" numberOfLines={1}>
                  {amount(consumed[stat.key], stat.unit)}
                  <Text className="type-caption text-muted">{` / ${amount(targets[stat.key], stat.unit)}`}</Text>
                </Text>
              </View>
            ))}
        </View>
        <Text className="home__note mt-3">
          {nutrition.source === "sample"
            ? "Sample numbers: your targets couldn't be loaded."
            : consumed.calories > 0
              ? `${consumed.calories.toLocaleString("en-IN")} kcal logged today. Tap to see your meals.`
              : "Nothing logged yet today. Tap to log a meal."}
        </Text>
      </Pressable>
    </View>
  );
}
