import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

type Totals = { kcal: number; proteinG: number; carbsG: number; fatG: number };

type MealCardProps = {
  // "Breakfast", "Evening snack"…
  label: string;
  // "3:01 PM"
  time: string;
  title: string;
  foods: string[];
  totals: Totals;
  // Opens the meal's details (the bottom sheet)
  onDetails: () => void;
  // Extra buttons before View meal (the plan's Swap) and the last button (the plan's Log Meal)
  before?: ReactNode;
  after?: ReactNode;
};

const round = (n: number) => Math.round(n);

// The one meal card used everywhere a meal is listed (Macro, Daily calories, the coach's Meal
// Plan): the slot and time, calories, the dish, its foods, P / C / F chips, and a footer with a
// View meal button that opens the meal in a bottom sheet. The header opens it too. A card with
// other buttons passes them as `before` / `after` (each its own button, never nested).
export function MealCard({ label, time, title, foods, totals, onDetails, before, after }: MealCardProps) {
  const colors = useThemeColors();
  const foodLine = foods.join(", ");
  const macros: [string, number][] = [["P", totals.proteinG], ["C", totals.carbsG], ["F", totals.fatG]];
  return (
    <View className="coach__meal-card">
      <Pressable onPress={onDetails} style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={`${label} at ${time}: ${title}, ${round(totals.kcal)} kcal. View meal`}>
        <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 8 }}>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <View className="coach__slot-pill">
              <Text className="coach__slot-pill-label">{label}</Text>
            </View>
            <View className="flex-row items-center" style={{ gap: 4 }}>
              <SymbolView name={{ ios: "clock", android: "schedule", web: "schedule" }} size={12} tintColor={colors.faint} />
              <Text className="home__note">{time}</Text>
            </View>
          </View>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <Text className="coach__meal-kcal">{`${round(totals.kcal)} kcal`}</Text>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
          </View>
        </View>
        <Text className="coach__meal-name" numberOfLines={2}>{title}</Text>
        {foodLine !== "" && foodLine !== title && <Text className="coach__meal-ings" numberOfLines={2}>{foodLine}</Text>}
        <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityLabel={`Protein ${round(totals.proteinG)} g, carbs ${round(totals.carbsG)} g, fat ${round(totals.fatG)} g`}>
          {macros.map(([k, v]) => (
            <View key={k} className="coach__macro-chip">
              <Text className="coach__macro-chip-label">{`${k} ${round(v)} g`}</Text>
            </View>
          ))}
        </View>
      </Pressable>
      <View className="flex-row flex-wrap items-center justify-end" style={{ gap: 10 }}>
        {before}
        <Pressable onPress={onDetails} className="coach__log coach__log--meal coach__log--done" accessibilityRole="button" accessibilityLabel={`View ${title}`}>
          <Text className="coach__log-label coach__log-label--done">View meal</Text>
          <SymbolView name={{ ios: "chevron.up", android: "expand_less", web: "expand_less" }} size={12} tintColor={colors.leaf} />
        </Pressable>
        {after}
      </View>
    </View>
  );
}
