import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { whole } from "@/lib/macro";
import { colors } from "@/theme";

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
  return (
    <View style={{ width }}>
      <Pressable
        onPress={onSelect}
        className="macro__food-card w-full gap-2"
        style={selected ? { borderColor: colors.forest, borderWidth: 2 } : undefined}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${name}, ${whole(kcal)} kcal${dayLabel ? `, ${dayLabel}` : ""}`}
      >
        <View className="macro__food-art" style={{ backgroundColor: colors.forestSoft }}>
          <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={26} tintColor={colors.forest} />
        </View>
        <Text className="card__title" numberOfLines={2}>{name}</Text>
        <Text className="post__time">{whole(kcal)} kcal{dayLabel ? ` · ${dayLabel}` : ""}</Text>
      </Pressable>
      {onUnheart && (
        <Pressable onPress={onUnheart} hitSlop={8} className="macro__heart" accessibilityRole="button" accessibilityLabel={`Remove ${name} from favourites`}>
          <SymbolView name={{ ios: "heart.fill", android: "favorite", web: "favorite" }} size={16} tintColor={colors.danger} />
        </Pressable>
      )}
    </View>
  );
}
