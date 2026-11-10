import { Text, View } from "react-native";
import { Image } from "expo-image";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView, type SymbolViewProps } from "@/components/SymbolView";
import { mealImage, type Coupon, type MealCategory } from "@/lib/mealsApi";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

// The Meals tab's small pieces: a section title with See all, a quick tile, a category tile and
// circle (pictures from the admin's uploads), and an offer card. White and ink; green is kept for
// the actions on the meal cards.

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
            <Text className="shop-see-all__label">See all</Text>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={13} tintColor={colors.muted} />
          </View>
        </PressableScale>
      )}
    </View>
  );
}

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
          <View className="flex-1 items-center justify-center"><SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={28} tintColor={colors.faint} /></View>
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
          <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={24} tintColor={colors.faint} />
        )}
      </View>
      <Text className="shop-tile__name text-center" numberOfLines={2}>{category.name}</Text>
    </PressableScale>
  );
}

// A coupon: what it takes off, above what, its code, till when, and Apply (Applied once in the cart)
export function CouponCard({ coupon, applied, width, onApply }: { coupon: Coupon; applied: boolean; width: number; onApply: () => void }) {
  const colors = useThemeColors();
  return (
    <View className="shop-coupon" style={{ width }}>
      <View className="shop-coupon__icon"><SymbolView name={{ ios: "tag.fill", android: "sell", web: "sell" }} size={18} tintColor={colors.iconPeach} /></View>
      <View className="min-w-0 flex-1" style={{ gap: 1 }}>
        {coupon.firstOrderOnly ? <Text className="shop-coupon__tag">Welcome offer · first order</Text> : null}
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
