import { Text, View } from "react-native";

import { CircularNutritionProgress } from "@/components/home/CircularNutritionProgress";
import { SectionHeader } from "@/components/home/SectionHeader";
import type { NutritionToday } from "@/data/home";

// The mockup's "Edit Goal" link is navy
const LINK_COLOR = "#2B4C7E";

type NutritionProgressCardProps = {
  heading: string;
  actionLabel: string;
  nutrition: NutritionToday;
  // Inner width of the page (screen width minus the page padding)
  width: number;
  onEditGoal: () => void;
};

// Ring colours: restrained accents, one per nutrient (from the home mockup)
const rings = [
  { key: "calories", label: "Calories", unit: "kcal", color: "#3B5BA5", icon: { ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" } },
  { key: "proteinG", label: "Protein", unit: "g", color: "#A78BFA", icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" } },
  { key: "carbsG", label: "Carbs", unit: "g", color: "#D8B48E", icon: { ios: "leaf.fill", android: "grass", web: "grass" } },
  { key: "fatG", label: "Fats", unit: "g", color: "#8FC1F5", icon: { ios: "drop.fill", android: "water_drop", web: "water_drop" } },
] as const;

// "Today's Nutrition": four rings (calories, protein, carbs, fats) against the targets
export function NutritionProgressCard({ heading, actionLabel, nutrition, width, onEditGoal }: NutritionProgressCardProps) {
  // Card padding (16 × 2), panel padding (12 × 2) and three gaps between four rings. Never under
  // 60pt: four 60pt rings still fit a 320pt phone and keep their labels readable.
  const ringSize = Math.round(Math.min(76, Math.max(60, (width - 32 - 24 - 24) / 4)));

  return (
    <View className="home__card">
      <SectionHeader title={heading} actionLabel={actionLabel} onAction={onEditGoal} actionColor={LINK_COLOR} />
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
      <View className="mt-3 h-px bg-cream-line" />
      <Text className="home__note mt-3 px-1">
        {nutrition.source === "sample" ? "Sample numbers: your targets couldn't be loaded." : "Nothing logged yet today."}
      </Text>
    </View>
  );
}
