import type { ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";

import { BannerCarousel, type PromoSlide } from "@/components/meals/home/BannerCarousel";
import { CouponCard, FoodCircle, SectionTitle } from "@/components/meals/home/ShopTiles";
import { QuickTiles } from "@/components/meals/home/QuickTiles";
import { hud } from "@/lib/hud";
import { shopSections, type QuickList } from "@/lib/mealRules";
import { MEAL_PROMOS } from "@/data/mealPromos";
import { mealImage, type MealBanner, type MealCategory, type MenuMeal, type Storefront } from "@/lib/mealsApi";
import { useAuthStore } from "@/store/auth";

// Each horizontal row draws this many cards when the tab opens (See all has the rest), and at most
// this many of the admin's featured categories get a row (every category is still a circle). The
// rows aren't virtualised, so these keep the tab's first draw small.
const ROW_CARDS = 6;
const FEATURED_ROWS = 2;

type Sections = ReturnType<typeof shopSections<MenuMeal, MealCategory>>;
type Browse = (params: { category?: string; tag?: string; list?: QuickList }) => void;

type ShopSectionsProps = {
  store: Storefront;
  sections: Sections;
  popular: MenuMeal[];
  // Meals from the member's past orders still on the menu (Order again), with a note each
  again: { meal: MenuMeal; note: string }[];
  proteinLeft: number;
  couponCode: string | null;
  onCoupon: (code: string) => void;
  // A meal card for a horizontal row (the screen owns the cart and favourites)
  card: (meal: MenuMeal, note?: string | null) => ReactNode;
  browse: Browse;
  onBanner: (banner: MealBanner) => void;
};

// The Meals tab under the search, Zomato-style (the user's 2026-11-10 ask), top to bottom: the
// today's offers first (the user's 2026-11-10 ask: coupons on top), the
// promotional section (the Super Admin's live banners, else justFit's own two promos), quick tiles,
// What's on your mind? (every category as a circle), Popular, For your goal (high protein, with
// what's left of today's protein), the admin's first two featured rows (Today's specials are already in Popular); All meals
// follows as the screen's grid. Each section shows only when it has something.
export function ShopSections({ store, sections, popular, again, proteinLeft, couponCode, onCoupon, card, browse, onBanner }: ShopSectionsProps) {
  const { width } = useWindowDimensions();
  const token = useAuthStore((state) => state.token);
  const circleSize = Math.round(Math.min(76, Math.max(58, (width - 62) / 4.6)));
  const explore = [...sections.tiles, ...sections.foods];
  const slides: PromoSlide[] =
    store.banners.length > 0
      ? store.banners.map((b) => ({ key: `b${b.id}`, title: b.title, text: b.description, badge: b.badge, cta: b.ctaLabel, image: b.imageUrl ? mealImage(b.imageUrl, token) : null, onPress: () => onBanner(b) }))
      : MEAL_PROMOS.map((p) => ({ key: p.id, title: p.title, text: p.text, badge: p.badge, cta: p.cta, image: p.image, onPress: () => browse({ list: p.list }) }));
  const row = (meals: MenuMeal[], note?: (m: MenuMeal) => string | null) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4, gap: 12 }}>
      {meals.slice(0, ROW_CARDS).map((m) => card(m, note?.(m)))}
    </ScrollView>
  );
  const seeAll = (count: number, params: Parameters<Browse>[0]) => (count > 2 ? () => browse(params) : undefined);

  return (
    <View style={{ gap: 24 }}>
      {store.coupons.length > 0 && (
        <View style={{ gap: 10 }}>
          <SectionTitle title="Offers for you" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
            {store.coupons.map((c) => (
              <CouponCard
                key={c.id}
                coupon={c}
                width={store.coupons.length === 1 ? width - 32 : Math.min(320, width - 64)}
                applied={couponCode === c.code}
                onApply={() => { onCoupon(c.code); hud.success(`${c.code} applied`); }}
              />
            ))}
          </ScrollView>
        </View>
      )}
      <BannerCarousel banners={slides} width={width} />
      <QuickTiles width={width} onPick={(list) => browse({ list })} />
      {explore.length > 0 && (
        <View style={{ gap: 12 }}>
          <SectionTitle title="What's on your mind?" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {explore.map((c) => <FoodCircle key={c.id} category={c} size={circleSize} onPress={() => browse({ category: String(c.id) })} />)}
          </ScrollView>
        </View>
      )}
      {again.length > 0 && (
        <View style={{ gap: 10 }}>
          <SectionTitle title="Order again" />
          {row(again.map((a) => a.meal), (m) => again.find((a) => a.meal.id === m.id)?.note ?? null)}
        </View>
      )}
      {popular.length > 0 && (
        <View style={{ gap: 10 }}>
          <SectionTitle title="Popular Meals" onSeeAll={seeAll(popular.length, { list: "popular" })} />
          {row(popular)}
        </View>
      )}
      {sections.highProtein.length > 0 && (
        <View style={{ gap: 10 }}>
          <SectionTitle
            title="For your goal"
            subtitle={proteinLeft > 0 ? `High protein · you need ${Math.round(proteinLeft)} g more today` : "High protein meals for your target"}
            onSeeAll={seeAll(sections.highProtein.length, { list: "high_protein" })}
          />
          {row(sections.highProtein, (m) => (proteinLeft > 0 ? `${Math.min(100, Math.round((m.proteinG / proteinLeft) * 100))}% of your protein left today` : null))}
        </View>
      )}
      {sections.rows.slice(0, FEATURED_ROWS).map(({ category, meals }) => (
        <View key={category.id} style={{ gap: 10 }}>
          <SectionTitle title={category.name} subtitle={category.subtitle} onSeeAll={seeAll(meals.length, { category: String(category.id) })} />
          {row(meals)}
        </View>
      ))}
      {sections.meals.length > 0 && <SectionTitle title="All meals" subtitle={`${sections.meals.length} ${sections.meals.length === 1 ? "meal" : "meals"} on the menu`} />}
    </View>
  );
}
