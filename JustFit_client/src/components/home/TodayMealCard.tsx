import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";
import { Image } from "expo-image";
import { SymbolView } from "@/components/SymbolView";

import type { TodayOrder } from "@/data/home";
import { resolveImage } from "@/lib/home";
import { useThemeColors } from "@/theme";

type TodayMealCardProps = {
  order: TodayOrder;
  // True when the order is placeholder data, not a real delivery
  isSample: boolean;
  actionLabel: string;
  onViewAll: () => void;
};

// One delivery: thumbnail, meal slot and name, nutrition chips, status and a "View all" link
export function TodayMealCard({ order, isSample, actionLabel, onViewAll }: TodayMealCardProps) {
  const colors = useThemeColors();
  const { meal } = order;
  const chips = [`${meal.calories} kcal`, `${Math.round(meal.proteinG)}g P`, `${Math.round(meal.carbsG)}g C`, `${Math.round(meal.fatG)}g F`];

  return (
    <View className="today__card">
      <View className="flex-row gap-3">
        <Image source={resolveImage(meal.imageUrl)} contentFit="cover" style={{ width: 64, height: 64, borderRadius: 14 }} accessibilityLabel={meal.name} />
        <View className="flex-1">
          <Text className="today__slot">{order.slot}</Text>
          <Text className="today__name mt-0.5" numberOfLines={3}>
            {meal.name}
          </Text>
        </View>
        <PressableScale scaleTo={0.98} onPress={onViewAll} hitSlop={8} className="flex-row items-center gap-1.5 self-start" accessibilityRole="button">
          <Text className="home__link">{actionLabel}</Text>
          <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={14} tintColor={colors.leaf} />
        </PressableScale>
      </View>

      <View className="mt-3 flex-row items-end justify-between gap-3">
        <View className="flex-1 flex-row flex-wrap gap-1.5">
          {chips.map((chip) => (
            <View key={chip} className="today__chip">
              <Text className="today__chip-label">{chip}</Text>
            </View>
          ))}
        </View>
        <View className="today__status" style={isSample ? { backgroundColor: colors.creamTab } : undefined} accessibilityLabel={`Status: ${order.status}`}>
          <Text className="today__status-label" style={isSample ? { color: colors.inkSoft } : undefined}>
            {order.status}
          </Text>
        </View>
      </View>
    </View>
  );
}
