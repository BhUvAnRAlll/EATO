import { Pressable, Text, View } from "react-native";

import { CircularNutritionProgress } from "@/components/home/CircularNutritionProgress";
import { SectionHeader } from "@/components/home/SectionHeader";
import type { NutritionToday } from "@/data/home";
import { colors } from "@/theme";

// The "Edit Goal" link uses the app's accent
const LINK_COLOR = colors.leaf;

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

// Ring colours: the theme's accent for calories and its macro colours for the rest
const rings = [
  { key: "calories", label: "Calories", unit: "kcal", color: colors.leaf, icon: { ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" } },
  { key: "proteinG", label: "Protein", unit: "g", color: colors.protein, icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" } },
  { key: "carbsG", label: "Carbs", unit: "g", color: colors.carbs, icon: { ios: "leaf.fill", android: "grass", web: "grass" } },
  { key: "fatG", label: "Fats", unit: "g", color: colors.fat, icon: { ios: "drop.fill", android: "water_drop", web: "water_drop" } },
] as const;

// "Today's Macros": four rings (calories, protein, carbs, fats) against the targets. No outer
// card: the heading, the rings panel and the note sit straight on the page. The panel and the
// note open the Macro tab; "Edit Goal" stays a separate link (no button inside a button).
export function NutritionProgressCard({ heading, actionLabel, nutrition, width, onEditGoal, onOpen }: NutritionProgressCardProps) {
  // Panel padding (12 × 2) and three gaps between four rings. Never under 60pt: four 60pt
  // rings still fit a 320pt phone and keep their labels readable.
  const ringSize = Math.round(Math.min(76, Math.max(60, (width - 24 - 24) / 4)));

  return (
    <View>
      <SectionHeader title={heading} actionLabel={actionLabel} onAction={onEditGoal} actionColor={LINK_COLOR} />
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${heading}: ${nutrition.consumed.calories} of ${nutrition.targets.calories} kcal eaten. Open Macro`}>
        <View className="ring__panel mt-4 flex-row justify-between">
          {rings.map((ring) => (
            <CircularNutritionProgress
              key={ring.key}
              label={ring.label}
              value={nutrition.consumed[ring.key]}
              target={nutrition.targets[ring.key]}
              unit={ring.unit}
              color={ring.color}
              icon={ring.icon}
              size={ringSize}
            />
          ))}
        </View>
        <Text className="home__note mt-3 px-1">
          {nutrition.source === "sample"
            ? "Sample numbers: your targets couldn't be loaded."
            : nutrition.consumed.calories > 0
              ? `${nutrition.consumed.calories.toLocaleString("en-IN")} kcal logged today. Tap to see your meals.`
              : "Nothing logged yet today. Tap to log a meal."}
        </Text>
      </Pressable>
    </View>
  );
}
