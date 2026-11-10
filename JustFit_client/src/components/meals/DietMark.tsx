import { View } from "react-native";

import { DIET_LABEL, type Diet } from "@/lib/mealRules";
import { useThemeColors } from "@/theme";

// The square with a dot that Indian menus print: green for veg and vegan, brown for non-veg, amber for egg
export function DietMark({ diet }: { diet: Diet }) {
  const colors = useThemeColors();
  const color = diet === "non-vegetarian" ? colors.mealNonveg : diet === "eggetarian" ? colors.warning : colors.mealPrimary;
  return (
    <View className="meal-diet" style={{ borderColor: color }} accessibilityLabel={DIET_LABEL[diet]}>
      <View className="meal-diet__dot" style={{ backgroundColor: color }} />
    </View>
  );
}
