import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";

import { whole } from "@/lib/macro";
import { useThemeColors } from "@/theme";

type FoodCardProps = {
  name: string;
  kcal: number;
  width: number;
  selected: boolean;
  onSelect: () => void;
  // "Today", "Yesterday" or MM/DD under the calories (Repeat a meal)
  dayLabel?: string;
  // A filled heart that removes the favourite (Favourites)
  onUnheart?: () => void;
};

// A food in a two-column grid: picture area, name and calories. Tapping selects it. The heart
// is a sibling of the card, never inside it (no button inside a button on web).
export function FoodCard({ name, kcal, width, selected, onSelect, dayLabel, onUnheart }: FoodCardProps) {
  const colors = useThemeColors();
  return (
    <View style={{ width }}>
      <PressableScale scaleTo={0.98}
        onPress={onSelect}
        className="macro__food-card w-full gap-2"
        style={selected ? { borderColor: colors.forest, borderWidth: 2 } : undefined}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${name}, ${whole(kcal)} kcal${dayLabel ? `, ${dayLabel}` : ""}`}
      >
        <View className="macro__food-art" style={{ backgroundColor: colors.forestSoft }}>
          <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={26} tintColor={colors.leaf} />
        </View>
        <Text className="card__title" numberOfLines={2}>{name}</Text>
        <Text className="meta-text">{whole(kcal)} kcal{dayLabel ? ` · ${dayLabel}` : ""}</Text>
      </PressableScale>
      {onUnheart && (
        <PressableScale scaleTo={0.98} onPress={onUnheart} hitSlop={8} className="macro__heart" accessibilityRole="button" accessibilityLabel={`Remove ${name} from favourites`}>
          <SymbolView name={{ ios: "heart.fill", android: "favorite", web: "favorite" }} size={16} tintColor={colors.danger} />
        </PressableScale>
      )}
    </View>
  );
}
