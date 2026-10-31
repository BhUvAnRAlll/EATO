import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { clockTime, slotInfo, whole, type Meal } from "@/lib/macro";
import { colors } from "@/theme";

type MealCardProps = { meal: Meal; onPress: () => void };

// One logged meal: slot glyph, slot, the foods, kcal and the time it was eaten
export function MealCard({ meal, onPress }: MealCardProps) {
  const slot = slotInfo[meal.slot];
  const foods = meal.items.map((item) => item.name).join(", ");
  return (
    <Pressable onPress={onPress} className="home__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`${slot.label}: ${meal.title}, ${whole(meal.totals.kcal)} kcal at ${clockTime(meal.loggedAt)}`}>
      <View className="macro__thumb" style={{ backgroundColor: `${slot.tint}1F` }}>
        <SymbolView name={slot.icon} size={22} tintColor={slot.tint} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="macro__overline">{slot.label}</Text>
        <Text className="card__title" numberOfLines={1}>{meal.title}</Text>
        {foods !== meal.title && <Text className="post__time" numberOfLines={1}>{foods}</Text>}
      </View>
      <View className="items-end gap-0.5">
        <Text className="macro__kcal">{whole(meal.totals.kcal)} kcal</Text>
        <Text className="post__time">{clockTime(meal.loggedAt)}</Text>
      </View>
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
    </Pressable>
  );
}
