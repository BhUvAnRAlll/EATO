import { Text, View } from "react-native";
import { Image } from "expo-image";

import { DietMark } from "@/components/meals/DietMark";
import { QuantityStepper } from "@/components/meals/QuantityStepper";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { DIET_LABEL, macroLine, rupees } from "@/lib/mealRules";
import { mealImage, type MenuMeal } from "@/lib/mealsApi";
import { useAuthStore } from "@/store/auth";
import { MAX_PER_MEAL } from "@/store/cart";
import { useThemeColors } from "@/theme";

type MealRowProps = {
  meal: MenuMeal;
  quantity: number;
  onOpen: () => void;
  onAdd: () => void;
  onQuantity: (quantity: number) => void;
  // Why it's recommended ("30 kcal under your lunch · 4 g more protein"), under the macros
  note?: string | null;
};

// One meal as a row: photo, diet, name, macros, an optional reason, price, then Add or the − n +
// stepper (Home's Picked for you, the Meal Plan's Order from justFit)
export function MealRow({ meal, quantity, onOpen, onAdd, onQuantity, note }: MealRowProps) {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  return (
    // A card with two tap areas (the photo and words open the meal; the buttons change the cart),
    // never a button inside a button
    <View className="meal-row">
      <PressableScale scaleTo={0.97} onPress={onOpen} className="meal-row__photo" accessibilityRole="button" accessibilityLabel={`Open ${meal.name}`}>
        <Image source={mealImage(meal.imageUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} transition={150} />
      </PressableScale>
      <View className="min-w-0 flex-1 justify-between" style={{ gap: 6 }}>
        <PressableScale scaleTo={0.99} onPress={onOpen} style={{ gap: 3 }} accessibilityRole="button" accessibilityLabel={`${meal.name}, ${DIET_LABEL[meal.diet]}, ${meal.calories} kcal, ${rupees(meal.price)}`}>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <DietMark diet={meal.diet} />
            <Text className="meta-text" numberOfLines={1}>{DIET_LABEL[meal.diet]}</Text>
            {meal.favorite ? <SymbolView name={{ ios: "heart.fill", android: "favorite", web: "favorite" }} size={12} tintColor={colors.danger} /> : null}
          </View>
          <Text className="meal__name" numberOfLines={2}>{meal.name}</Text>
          <Text className="meal-row__macros" numberOfLines={1}>{macroLine(meal)}</Text>
          {note ? <Text className="meal-row__note" numberOfLines={2}>{note}</Text> : null}
        </PressableScale>
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <Text className="meal-price">{rupees(meal.price)}</Text>
          {quantity > 0 ? (
            <QuantityStepper quantity={quantity} max={MAX_PER_MEAL} name={meal.name} onChange={onQuantity} size="sm" />
          ) : (
            <PressableScale haptic="select" onPress={onAdd} className="meal-btn" style={{ minHeight: 34, paddingHorizontal: 16 }} accessibilityRole="button" accessibilityLabel={`Add ${meal.name} to cart`}>
              <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={13} tintColor={colors.onPrimary} />
              <Text className="btn-forest__label" style={{ fontSize: 13 }}>Add</Text>
            </PressableScale>
          )}
        </View>
      </View>
    </View>
  );
}
