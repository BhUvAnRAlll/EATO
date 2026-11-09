import { memo, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Image } from "expo-image";
import { useReducedMotion } from "react-native-reanimated";

import { DietMark } from "@/components/meals/MealRow";
import { QuantityStepper } from "@/components/meals/QuantityStepper";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { DIET_LABEL, cardBadge, discountText, rupees } from "@/lib/mealRules";
import { mealImage, type Coupon, type MealBanner, type MealCategory, type MenuMeal } from "@/lib/mealsApi";
import { useAuthStore } from "@/store/auth";
import { MAX_PER_MEAL } from "@/store/cart";
import { useThemeColors } from "@/theme";

// The Meals tab's storefront pieces (2026-11-09 redesign, Swiggy/Zomato-style in the Meals green):
// the product card, a section title, category tiles, food-category circles, the banner carousel and
// a coupon card. Every picture comes from the admin's uploads (or the bundled meal photos).

export function SectionTitle({ title, subtitle, onSeeAll }: { title: string; subtitle?: string | null; onSeeAll?: () => void }) {
  return (
    <View className="flex-row items-end px-4" style={{ gap: 12 }}>
      <View className="min-w-0 flex-1">
        <Text className="shop-section__title" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text className="meta-text" numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {onSeeAll && (
        <PressableScale onPress={onSeeAll} hitSlop={8} accessibilityRole="button" accessibilityLabel={`See all ${title}`}>
          <Text className="meal-link">See all</Text>
        </PressableScale>
      )}
    </View>
  );
}

type MealCardProps = {
  meal: MenuMeal;
  width: number;
  quantity: number;
  onOpen: () => void;
  onAdd: () => void;
  onQuantity: (q: number) => void;
  onFavorite: () => void;
  // An extra line under the macros ("30% of your protein left today")
  note?: string | null;
};

// A product card for the horizontal rows: the photo with a badge and a heart, the diet mark and
// name, the serving, kcal and macros, the price (struck original and % off when discounted), Add.
function MealCardBase({ meal, width, quantity, onOpen, onAdd, onQuantity, onFavorite, note }: MealCardProps) {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  const badge = cardBadge(meal);
  const off = discountText(meal.price, meal.mrp);
  return (
    <View className="shop-card" style={{ width }}>
      <PressableScale scaleTo={0.98} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${meal.name}, ${DIET_LABEL[meal.diet]}, ${meal.calories} kcal, ${Math.round(meal.proteinG)} grams protein, ${rupees(meal.price)}`}>
        <View style={{ width, aspectRatio: 4 / 3, backgroundColor: colors.creamDeep }}>
          <Image source={mealImage(meal.imageUrl, token)} recyclingKey={meal.id} contentFit="cover" transition={150} style={{ width: "100%", height: "100%" }} />
          {off ? (
            <View className="shop-badge shop-badge--deal"><Text className="shop-badge__label shop-badge__label--deal">{off}</Text></View>
          ) : badge ? (
            <View className="shop-badge"><Text className="shop-badge__label">{badge}</Text></View>
          ) : null}
        </View>
        <View style={{ padding: 10, paddingBottom: 4, gap: 3 }}>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <DietMark diet={meal.diet} />
            {meal.servingSize ? <Text className="meta-text flex-1" style={{ fontSize: 11 }} numberOfLines={1}>{meal.servingSize}</Text> : null}
          </View>
          <Text className="meal__name" numberOfLines={2} style={{ minHeight: 38, fontSize: 14 }}>{meal.name}</Text>
          <Text className="shop-macros" numberOfLines={1}>{`${meal.calories} kcal · ${Math.round(meal.proteinG)}g P`}</Text>
          <Text className="meta-text" style={{ fontSize: 11 }} numberOfLines={1}>{`${Math.round(meal.carbsG)}g carbs · ${Math.round(meal.fatG)}g fat`}</Text>
          {note ? <Text className="shop-note" numberOfLines={1}>{note}</Text> : null}
        </View>
      </PressableScale>
      <PressableScale onPress={onFavorite} hitSlop={6} className="meal__heart" accessibilityRole="button" accessibilityLabel={meal.favorite ? `Remove ${meal.name} from favourites` : `Add ${meal.name} to favourites`} accessibilityState={{ selected: !!meal.favorite }}>
        <SymbolView name={meal.favorite ? { ios: "heart.fill", android: "favorite", web: "favorite" } : { ios: "heart", android: "favorite", web: "favorite" }} size={16} tintColor={meal.favorite ? colors.danger : colors.inkSoft} />
      </PressableScale>
      <View className="flex-row items-center justify-between" style={{ paddingHorizontal: 10, paddingBottom: 10, gap: 6 }}>
        <View className="min-w-0 flex-1">
          <Text className="meal-price" numberOfLines={1}>{rupees(meal.price)}</Text>
          {off && meal.mrp ? <Text className="shop-mrp" numberOfLines={1}>{rupees(meal.mrp)}</Text> : null}
        </View>
        {quantity > 0 ? (
          <QuantityStepper quantity={quantity} max={MAX_PER_MEAL} name={meal.name} onChange={onQuantity} size="sm" />
        ) : (
          <PressableScale haptic="select" onPress={onAdd} className="shop-add" accessibilityRole="button" accessibilityLabel={`Add ${meal.name} to cart`}>
            <Text className="shop-add__label">ADD</Text>
          </PressableScale>
        )}
      </View>
    </View>
  );
}
export const MealCard = memo(MealCardBase);

// A promotional tile (Under ₹99, High Protein): the admin's picture with the name under it
export function CategoryTile({ category, size, onPress }: { category: MealCategory; size: number; onPress: () => void }) {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  return (
    <PressableScale scaleTo={0.96} onPress={onPress} style={{ width: size, gap: 6 }} accessibilityRole="button" accessibilityLabel={`${category.name}${category.badge ? `, ${category.badge}` : ""}`}>
      <View className="shop-tile" style={{ width: size, height: size }}>
        {category.imageUrl ? (
          <Image source={mealImage(category.imageUrl, token)} recyclingKey={`c${category.id}`} contentFit="cover" transition={150} style={{ width: "100%", height: "100%" }} />
        ) : (
          <View className="flex-1 items-center justify-center"><SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={28} tintColor={colors.mealDark} /></View>
        )}
        {category.badge ? <View className="shop-tile__badge"><Text className="shop-tile__badge-label" numberOfLines={1}>{category.badge}</Text></View> : null}
      </View>
      <Text className="shop-tile__name" numberOfLines={2}>{category.name}</Text>
    </PressableScale>
  );
}

// A food category as a round picture with its name (Biryani & Rice Bowls, Paratha Meals…)
export function FoodCircle({ category, size, onPress }: { category: MealCategory; size: number; onPress: () => void }) {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  return (
    <PressableScale scaleTo={0.95} onPress={onPress} className="items-center" style={{ width: size + 8, gap: 6 }} accessibilityRole="button" accessibilityLabel={category.name}>
      <View className="shop-circle" style={{ width: size, height: size }}>
        {category.imageUrl ? (
          <Image source={mealImage(category.imageUrl, token)} recyclingKey={`f${category.id}`} contentFit="cover" transition={150} style={{ width: "100%", height: "100%" }} />
        ) : (
          <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={24} tintColor={colors.mealDark} />
        )}
      </View>
      <Text className="shop-tile__name text-center" numberOfLines={2}>{category.name}</Text>
    </PressableScale>
  );
}

// The big banner carousel: swipe, or it moves on every 5 s (never with Reduce Motion, or while the
// app is in the background); dots under it show where it is
export function BannerCarousel({ banners, width, onOpen }: { banners: MealBanner[]; width: number; onOpen: (banner: MealBanner) => void }) {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  const reduceMotion = useReducedMotion();
  const list = useRef<FlatList<MealBanner>>(null);
  const [index, setIndex] = useState(0);
  const slide = width - 32;
  const step = slide + 12;

  useEffect(() => {
    if (reduceMotion || banners.length < 2) return;
    let active = AppState.currentState === "active";
    const sub = AppState.addEventListener("change", (s) => { active = s === "active"; });
    const timer = setInterval(() => {
      if (!active) return;
      setIndex((i) => {
        const next = (i + 1) % banners.length;
        list.current?.scrollToOffset({ offset: next * step, animated: true });
        return next;
      });
    }, 5000);
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [banners.length, reduceMotion, step]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.max(0, Math.min(banners.length - 1, Math.round(e.nativeEvent.contentOffset.x / step))));

  return (
    <View style={{ gap: 10 }}>
      <FlatList
        ref={list}
        data={banners}
        keyExtractor={(b) => String(b.id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        onMomentumScrollEnd={onScroll}
        getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
        renderItem={({ item }) => (
          <PressableScale scaleTo={0.98} onPress={() => onOpen(item)} className="shop-banner" style={{ width: slide }} accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.ctaLabel}`}>
            <View style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: colors.mealDark }}>
              {item.imageUrl && <Image source={mealImage(item.imageUrl, token)} recyclingKey={`b${item.id}`} contentFit="cover" transition={200} style={{ width: "100%", height: "100%" }} />}
              <View className="shop-banner__shade" />
              <View className="shop-banner__body">
                {item.badge ? <View className="shop-banner__badge"><Text className="shop-banner__badge-label" numberOfLines={1}>{item.badge}</Text></View> : null}
                <Text className="shop-banner__title" numberOfLines={2}>{item.title}</Text>
                {item.description ? <Text className="shop-banner__text" numberOfLines={2}>{item.description}</Text> : null}
                <View className="shop-banner__cta"><Text className="shop-banner__cta-label">{item.ctaLabel}</Text></View>
              </View>
            </View>
          </PressableScale>
        )}
      />
      {banners.length > 1 && (
        <View className="flex-row justify-center" style={{ gap: 6 }} accessibilityLabel={`Banner ${index + 1} of ${banners.length}`}>
          {banners.map((b, i) => <View key={b.id} className={i === index ? "shop-dot shop-dot--on" : "shop-dot"} />)}
        </View>
      )}
    </View>
  );
}

// A coupon: what it takes off, above what, its code, till when, and Apply (Applied once in the cart)
export function CouponCard({ coupon, applied, width, onApply }: { coupon: Coupon; applied: boolean; width: number; onApply: () => void }) {
  const colors = useThemeColors();
  return (
    <View className="shop-coupon" style={{ width }}>
      <View className="shop-coupon__icon"><SymbolView name={{ ios: "tag.fill", android: "sell", web: "sell" }} size={18} tintColor={colors.mealDark} /></View>
      <View className="min-w-0 flex-1" style={{ gap: 1 }}>
        <Text className="card__title" numberOfLines={1}>{coupon.off}</Text>
        <Text className="meta-text" numberOfLines={1}>{[`Code ${coupon.code}`, coupon.above].filter(Boolean).join(" | ")}</Text>
        {coupon.endsOn ? <Text className="meta-text" style={{ fontSize: 11 }} numberOfLines={1}>{`Valid till ${new Date(`${coupon.endsOn}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}`}</Text> : null}
      </View>
      <PressableScale haptic="select" onPress={onApply} disabled={applied} className={applied ? "shop-coupon__apply shop-coupon__apply--on" : "shop-coupon__apply"} accessibilityRole="button" accessibilityLabel={applied ? `${coupon.code} applied` : `Apply ${coupon.code}`}>
        <Text className={applied ? "shop-coupon__apply-label shop-coupon__apply-label--on" : "shop-coupon__apply-label"}>{applied ? "Applied" : "Apply"}</Text>
      </PressableScale>
    </View>
  );
}
