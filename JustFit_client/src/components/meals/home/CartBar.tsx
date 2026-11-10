import { Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown, ReduceMotion } from "react-native-reanimated";
import { router } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { rupees } from "@/lib/mealRules";
import type { MenuMeal } from "@/lib/mealsApi";
import { cartCount } from "@/store/cart";
import { useThemeColors } from "@/theme";

// The floating cart bar on the Meals tab, shown while the cart has meals: how many, what they come
// to at the menu's prices (the cart and the server price it again), and View cart. The one big
// green thing on the page, because it's the next step.
export function CartBar({ items, meals }: { items: Record<string, number>; meals: MenuMeal[] }) {
  const colors = useThemeColors();
  const count = cartCount(items);
  if (count === 0) return null;
  const total = meals.reduce((sum, m) => sum + (items[m.id] ?? 0) * m.price, 0);
  return (
    <Animated.View entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)} exiting={FadeOutDown.duration(160).reduceMotion(ReduceMotion.System)} pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 80 }}>
      <PressableScale haptic="tap" scaleTo={0.98} onPress={() => router.push("/meals/cart")} className="meal-cartbar" accessibilityRole="button" accessibilityLabel={`View cart, ${count} ${count === 1 ? "meal" : "meals"}, ${rupees(total)}`}>
        <View className="shop-cartbar__count"><Text className="shop-cartbar__label" style={{ fontSize: 13 }}>{count}</Text></View>
        <View className="min-w-0 flex-1">
          <Text className="shop-cartbar__label" numberOfLines={1}>{rupees(total)}</Text>
          <Text className="shop-cartbar__meta" numberOfLines={1}>{`${count} ${count === 1 ? "meal" : "meals"} in your cart`}</Text>
        </View>
        <Text className="shop-cartbar__label">View cart</Text>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={15} tintColor={colors.white} />
      </PressableScale>
    </Animated.View>
  );
}
