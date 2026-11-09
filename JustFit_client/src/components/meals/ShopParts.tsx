import { memo, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Image } from "expo-image";
import { useReducedMotion } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { DIET_LABEL, cardBadge, discountText, isVeg, rupees } from "@/lib/mealRules";
import type { SymbolViewProps } from "@/components/SymbolView";
import { mealImage, type Coupon, type MealBanner, type MealCategory, type MenuMeal } from "@/lib/mealsApi";
import { useAuthStore } from "@/store/auth";
import { MAX_PER_MEAL } from "@/store/cart";
import { useThemeColors } from "@/theme";

// The Meals tab's storefront pieces (2026-11-09 redesign, Swiggy/Zomato-style in the Meals green):
// the product card, a section title, category tiles, food-category circles, the banner carousel and
// a coupon card. Every picture comes from the admin's uploads (or the bundled meal photos).

export function SectionTitle({ title, subtitle, onSeeAll }: { title: string; subtitle?: string | null; onSeeAll?: () => void }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center px-4" style={{ gap: 12 }}>
      <View className="min-w-0 flex-1">
        <Text className="shop-section__title" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text className="meta-text" numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {onSeeAll && (
        <PressableScale onPress={onSeeAll} hitSlop={8} accessibilityRole="button" accessibilityLabel={`See all ${title}`}>
          <View className="shop-see-all">
            <Text className="meal-link">See All</Text>
            <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={14} tintColor={colors.mealDark} />
          </View>
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

// A product card (the 2026-11-10 design): the photo with one badge (a deal, Bestseller, High
// protein…, else Veg or Non-veg) and a heart, the name, kcal and macros, the price (and the struck
// price when discounted), then Add + or − n +.
function MealCardBase({ meal, width, quantity, onOpen, onAdd, onQuantity, onFavorite, note }: MealCardProps) {
  const colors = useThemeColors();
  const token = useAuthStore((state) => state.token);
  const veg = isVeg(meal.diet);
  const badge = discountText(meal.price, meal.mrp) ?? cardBadge(meal);
  return (
    <View className="shop-card" style={{ width }}>
      <PressableScale scaleTo={0.98} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${meal.name}, ${DIET_LABEL[meal.diet]}, ${meal.calories} kcal, ${Math.round(meal.proteinG)} grams protein, ${rupees(meal.price)}`}>
        <View style={{ width, aspectRatio: 2.1, backgroundColor: colors.creamDeep }}>
          <Image source={mealImage(meal.imageUrl, token)} recyclingKey={meal.id} contentFit="cover" transition={150} style={{ width: "100%", height: "100%" }} />
          {badge ? (
            <View className="shop-badge"><Text className="shop-badge__label">{badge}</Text></View>
          ) : (
            <View className={veg ? "shop-badge" : "shop-badge shop-badge--nonveg"}>
              {veg && <SymbolView name={{ ios: "leaf.fill", android: "eco", web: "eco" }} size={10} tintColor={colors.white} />}
              <Text className="shop-badge__label">{DIET_LABEL[meal.diet]}</Text>
            </View>
          )}
        </View>
        <View style={{ paddingHorizontal: 10, paddingTop: 8, gap: 2 }}>
          <Text className="meal__name" numberOfLines={1} style={{ fontSize: 14 }}>{meal.name}</Text>
          <Text className="shop-macros" numberOfLines={1}>{`${meal.calories} kcal  |  P ${Math.round(meal.proteinG)}g  C ${Math.round(meal.carbsG)}g  F ${Math.round(meal.fatG)}g`}</Text>
          {note ? <Text className="shop-note" numberOfLines={1}>{note}</Text> : null}
        </View>
      </PressableScale>
      <PressableScale onPress={onFavorite} hitSlop={6} className="meal__heart" accessibilityRole="button" accessibilityLabel={meal.favorite ? `Remove ${meal.name} from favourites` : `Add ${meal.name} to favourites`} accessibilityState={{ selected: !!meal.favorite }}>
        <SymbolView name={meal.favorite ? { ios: "heart.fill", android: "favorite", web: "favorite" } : { ios: "heart", android: "favorite", web: "favorite" }} size={16} tintColor={meal.favorite ? colors.danger : colors.ink} />
      </PressableScale>
      <View className="flex-row items-center justify-between" style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 6 }}>
        <View className="min-w-0 flex-1 flex-row items-baseline" style={{ gap: 4 }}>
          <Text className="meal-price" numberOfLines={1}>{rupees(meal.price)}</Text>
          {meal.mrp && meal.mrp > meal.price ? <Text className="shop-mrp" numberOfLines={1}>{rupees(meal.mrp)}</Text> : null}
        </View>
        {quantity > 0 ? (
          <CardStepper quantity={quantity} name={meal.name} onChange={onQuantity} />
        ) : (
          <PressableScale haptic="select" onPress={onAdd} className="shop-add" accessibilityRole="button" accessibilityLabel={`Add ${meal.name} to cart`}>
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
        <SymbolView name={{ ios: "minus", android: "remove", web: "remove" }} size={13} tintColor={colors.mealDark} />
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

// A quick tile under the search (High Protein, Low Calorie, Veg, Non-Veg, Combos)
export function QuickTile({ label, icon, ground, tint, width, onPress }: { label: string; icon: SymbolViewProps["name"]; ground: string; tint: string; width: number; onPress: () => void }) {
  return (
    <PressableScale scaleTo={0.95} haptic="select" onPress={onPress} className="shop-quick" style={{ width }} accessibilityRole="button" accessibilityLabel={label}>
      <View className="shop-quick__icon" style={{ backgroundColor: ground, width: Math.min(52, width - 8), height: Math.min(52, width - 8) }}>
        <SymbolView name={icon} size={24} tintColor={tint} />
      </View>
      <Text className="shop-quick__label" numberOfLines={2} style={{ maxWidth: width - 4 }}>{label}</Text>
    </PressableScale>
  );
}

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
            <View style={{ width: "100%", aspectRatio: 2.45 }}>
              {item.imageUrl && <Image source={mealImage(item.imageUrl, token)} recyclingKey={`b${item.id}`} contentFit="cover" transition={200} style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "70%" }} />}
              {/* Green on the left fading into the photo, so the words always read */}
              <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%" preserveAspectRatio="none">
                <Defs>
                  <LinearGradient id={`shopBanner${item.id}`} x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor={colors.mealDark} stopOpacity={1} />
                    <Stop offset="0.42" stopColor={colors.mealDark} stopOpacity={0.96} />
                    <Stop offset="0.68" stopColor={colors.mealDark} stopOpacity={0.25} />
                    <Stop offset="1" stopColor={colors.mealDark} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#shopBanner${item.id})`} />
              </Svg>
              <View className="shop-banner__body">
                {item.badge ? <View className="shop-banner__badge"><Text className="shop-banner__badge-label" numberOfLines={1}>{item.badge}</Text></View> : null}
                <Text className="shop-banner__title" numberOfLines={2}>{item.title}</Text>
                {item.description ? <Text className="shop-banner__text" numberOfLines={2}>{item.description}</Text> : null}
                <View className="shop-banner__cta">
                  <Text className="shop-banner__cta-label">{item.ctaLabel}</Text>
                  <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={13} tintColor={colors.mealDark} />
                </View>
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
