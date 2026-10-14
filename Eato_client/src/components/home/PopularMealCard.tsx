import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";

import type { Meal } from "@/data/home";
import { resolveImage } from "@/lib/home";
import { colors } from "@/theme";

type PopularMealCardProps = {
  meal: Meal;
  width: number;
  favorite: boolean;
  // How many are in the cart (shown on the add button as confirmation)
  quantity: number;
  onToggleFavorite: () => void;
  onAdd: () => void;
};

// Photo with a heart, then the name, calories and macros, and a round add button
export function PopularMealCard({ meal, width, favorite, quantity, onToggleFavorite, onAdd }: PopularMealCardProps) {
  const line1 = `${meal.calories} kcal | ${Math.round(meal.proteinG)}g P`;
  const line2 = `${Math.round(meal.carbsG)}g C | ${Math.round(meal.fatG)}g F`;
  // Narrow cards (under 165pt): smaller macro text and a smaller add button
  const narrow = width < 165;
  const small = narrow ? { fontSize: 11 } : undefined;

  return (
    <View className="meal__card" style={{ width }}>
      <View>
        <Image source={resolveImage(meal.imageUrl)} contentFit="cover" style={{ width, height: Math.round(width * 0.7) }} accessibilityLabel={meal.name} />
        <Pressable
          onPress={onToggleFavorite}
          className="meal__heart"
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={favorite ? `Remove ${meal.name} from favourites` : `Add ${meal.name} to favourites`}
          accessibilityState={{ selected: favorite }}
        >
          <SymbolView
            name={favorite ? { ios: "heart.fill", android: "favorite", web: "favorite" } : { ios: "heart", android: "favorite", web: "favorite" }}
            size={16}
            tintColor={favorite ? colors.danger : colors.inkSoft}
          />
        </Pressable>
      </View>

      <View className="p-3">
        <Text className="meal__name" numberOfLines={2} style={{ minHeight: 38 }}>
          {meal.name}
        </Text>
        <View className="mt-1" style={{ paddingRight: narrow ? 34 : 40 }}>
          <Text className="meal__macros" numberOfLines={1} style={small}>
            {line1}
          </Text>
          <Text className="meal__macros" numberOfLines={1} style={small}>
            {line2}
          </Text>
        </View>
        <View className="absolute bottom-3 right-3">
          <Pressable
            onPress={onAdd}
            className="meal__add"
            style={narrow ? { width: 34, height: 34 } : undefined}
            accessibilityRole="button"
            accessibilityLabel={quantity > 0 ? `Add another ${meal.name}. ${quantity} in cart` : `Add ${meal.name} to cart`}
          >
            {quantity > 0 ? (
              <Text className="meal__add-label">{quantity}</Text>
            ) : (
              <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={18} tintColor={colors.white} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
