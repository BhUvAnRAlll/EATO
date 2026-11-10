import { memo } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";

import { DietMark } from "@/components/meals/DietMark";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { DIET_LABEL, cardBadge, discountText, rupees } from "@/lib/mealRules";
import { mealImage, type MenuMeal } from "@/lib/mealsApi";
import { useAuthStore } from "@/store/auth";
import { MAX_PER_MEAL, useCartStore } from "@/store/cart";
import { useThemeColors } from "@/theme";

type MealCardProps = {
  meal: MenuMeal;
  width: number;
  // Both get the meal, so a screen can pass one stable function for every card (memo then skips
  // the cards whose meal didn't change). The quantity comes from the cart store, per card.
  onOpen: (meal: MenuMeal) => void;
  onFavorite: (meal: MenuMeal) => void;
  // An extra line under the macros ("30% of your protein left today")
  note?: string | null;
  // "row": a wide, short photo for the horizontal rows; "grid": a taller photo for the 2-column list
  variant?: "row" | "grid";
};

// A product card: the photo with one chip (a deal or Bestseller… on a dark chip, else the diet on a
// white one) and a heart, the name, kcal and macros, the price (struck original when discounted),
// then Add + or − n +. Green is only on Add and the stepper's plus.
function MealCardBase({ meal, width, onOpen, onFavorite, note, variant = "row" }: MealCardProps) {
  const colors = useThemeColors();
  const quantity = useCartStore((state) => state.items[meal.id] ?? 0);
  const add = useCartStore((state) => state.add);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const token = useAuthStore((state) => state.token);
  const badge = discountText(meal.price, meal.mrp) ?? cardBadge(meal);
  return (
    <View className="shop-card" style={{ width }}>
      <PressableScale scaleTo={0.98} onPress={() => onOpen(meal)} accessibilityRole="button" accessibilityLabel={`${meal.name}, ${DIET_LABEL[meal.diet]}, ${meal.calories} kcal, ${Math.round(meal.proteinG)} grams protein, ${rupees(meal.price)}`}>
        <View style={{ width, aspectRatio: variant === "grid" ? 1.3 : 2.1, backgroundColor: colors.creamDeep }}>
          <Image source={mealImage(meal.imageUrl, token)} recyclingKey={meal.id} contentFit="cover" transition={150} style={{ width: "100%", height: "100%" }} />
          {badge ? (
            <View className="shop-badge shop-badge--deal"><Text className="shop-badge__label shop-badge__label--deal">{badge}</Text></View>
          ) : (
            <View className="shop-badge">
              <DietMark diet={meal.diet} />
              <Text className="shop-badge__label">{DIET_LABEL[meal.diet]}</Text>
            </View>
          )}
        </View>
        <View style={{ paddingHorizontal: 10, paddingTop: 8, gap: 2 }}>
          <Text className="meal__name" numberOfLines={variant === "grid" ? 2 : 1} style={{ fontSize: 14 }}>{meal.name}</Text>
          <Text className="shop-macros" numberOfLines={1}>{`${meal.calories} kcal | P ${Math.round(meal.proteinG)}g C ${Math.round(meal.carbsG)}g F ${Math.round(meal.fatG)}g`}</Text>
          {note ? <Text className="shop-note" numberOfLines={1}>{note}</Text> : null}
        </View>
      </PressableScale>
      <PressableScale onPress={() => onFavorite(meal)} hitSlop={6} className="meal__heart" accessibilityRole="button" accessibilityLabel={meal.favorite ? `Remove ${meal.name} from favourites` : `Add ${meal.name} to favourites`} accessibilityState={{ selected: !!meal.favorite }}>
        <SymbolView name={meal.favorite ? { ios: "heart.fill", android: "favorite", web: "favorite" } : { ios: "heart", android: "favorite", web: "favorite" }} size={16} tintColor={meal.favorite ? colors.danger : colors.ink} />
      </PressableScale>
      <View className="mt-auto flex-row items-center justify-between" style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 6 }}>
        <View className="min-w-0 flex-1 flex-row items-baseline" style={{ gap: 4 }}>
          <Text className="meal-price" numberOfLines={1}>{rupees(meal.price)}</Text>
          {meal.mrp && meal.mrp > meal.price ? <Text className="shop-mrp" numberOfLines={1}>{rupees(meal.mrp)}</Text> : null}
        </View>
        {quantity > 0 ? (
          <CardStepper quantity={quantity} name={meal.name} onChange={(q) => setQuantity(meal.id, q)} />
        ) : (
          <PressableScale haptic="select" onPress={() => add(meal.id)} className="shop-add" accessibilityRole="button" accessibilityLabel={`Add ${meal.name} to cart`}>
            <Text className="shop-add__label">Add</Text>
            <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={13} tintColor={colors.white} />
          </PressableScale>
        )}
      </View>
    </View>
  );
}

// − 1 + on a card: at 1, minus takes the meal out of the cart; plus stops at MAX_PER_MEAL
function CardStepper({ quantity, name, onChange }: { quantity: number; name: string; onChange: (q: number) => void }) {
  const colors = useThemeColors();
  const full = quantity >= MAX_PER_MEAL;
  return (
    <View className="shop-stepper" accessibilityLabel={`${quantity} ${name} in cart`}>
      <PressableScale haptic="select" onPress={() => onChange(quantity - 1)} hitSlop={6} className="shop-stepper__button" accessibilityRole="button" accessibilityLabel={quantity === 1 ? `Remove ${name} from cart` : `One less ${name}`}>
        <SymbolView name={{ ios: "minus", android: "remove", web: "remove" }} size={13} tintColor={colors.ink} />
      </PressableScale>
      <Text className="shop-stepper__count">{quantity}</Text>
      <PressableScale
        haptic="select"
        onPress={() => !full && onChange(quantity + 1)}
        disabled={full}
        hitSlop={6}
        className="shop-stepper__button shop-stepper__button--on"
        style={{ opacity: full ? 0.4 : 1 }}
        accessibilityRole="button"
        accessibilityLabel={full ? `At most ${MAX_PER_MEAL} of ${name}` : `One more ${name}`}
        accessibilityState={{ disabled: full }}
      >
        <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={13} tintColor={colors.white} />
      </PressableScale>
    </View>
  );
}

export const MealCard = memo(MealCardBase);
