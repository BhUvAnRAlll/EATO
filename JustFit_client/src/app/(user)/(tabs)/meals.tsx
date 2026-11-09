import { useCallback, useMemo, useState } from "react";
import { FlatList, Platform, ScrollView, Switch, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { BrandWordmark } from "@/components/BrandWordmark";
import { EmptyState } from "@/components/EmptyState";
import { FieldInput } from "@/components/FieldInput";
import { LoadError } from "@/components/macro/LoadError";
import { MealRow } from "@/components/meals/MealRow";
import { BannerCarousel, CategoryTile, CouponCard, FoodCircle, MealCard, SectionTitle } from "@/components/meals/ShopParts";
import { PressableScale } from "@/components/PressableScale";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { KIND_LABEL } from "@/lib/addressRules";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { listPerf } from "@/lib/listPerf";
import { rupees, searchMeals, shopSections, suggestions } from "@/lib/mealRules";
import { mealsApi, type MealBanner, type MenuMeal } from "@/lib/mealsApi";
import { useAddressBook } from "@/lib/useAddressBook";
import { useSessionToken } from "@/lib/session";
import { cartCount, useCartStore } from "@/store/cart";
import { useHomeStore } from "@/store/home";
import { useStorefront } from "@/store/storefront";
import { useThemeColors } from "@/theme";

// The Meals tab (2026-11-09 redesign, Swiggy/Zomato-style in the Meals green). Top to bottom: the
// logo, Meals, where it's delivered and the cart; the search (meal, cuisine or ingredient) with
// suggestions and Veg only; the admin's category tiles; the banner carousel; a row of cards for
// each featured food category ("Meal Bowls"); the food categories as circles; today's specials;
// high-protein picks with how much of today's protein each covers; today's coupons; then every
// meal. All of it comes from one storefront read (store/storefront.ts); nothing is hard-coded.
export default function Meals() {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const load = useStorefront((state) => state.load);
  const read = useStorefront((state) => state.read);
  const markFavorite = useStorefront((state) => state.setFavorite);
  const items = useCartStore((state) => state.items);
  const add = useCartStore((state) => state.add);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const couponCode = useCartStore((state) => state.couponCode);
  const setCoupon = useCartStore((state) => state.setCoupon);
  const nutrition = useHomeStore((state) => state.nutrition);
  const { load: addressLoad } = useAddressBook();
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [vegOnly, setVegOnly] = useState(false);

  useFocusEffect(useCallback(() => { getToken().then((t) => read(t)); }, [getToken, read]));
  const { refreshControl } = usePullToRefresh(useCallback(async () => read(await getToken(), { force: true }), [getToken, read]), colors.mealPrimary);

  const store = load.state === "ready" ? load.data : null;
  const sections = useMemo(() => (store ? shopSections(store.meals, store.categories, vegOnly) : null), [store, vegOnly]);
  const query = search.trim();
  const results = useMemo(() => (store && sections && query ? searchMeals(sections.meals, store.categories, query) : null), [store, sections, query]);
  const hints = useMemo(() => (store && focused ? suggestions(store.meals, store.categories, query) : []), [store, focused, query]);
  const count = cartCount(items);
  const total = useMemo(() => {
    const price = new Map((store?.meals ?? []).map((m) => [m.id, m.price]));
    return Object.entries(items).reduce((sum, [id, q]) => sum + (price.get(id) ?? 0) * q, 0);
  }, [items, store]);

  const address = addressLoad.state === "ready" ? addressLoad.book.addresses.find((a) => a.isDefault) ?? null : null;
  const proteinLeft = nutrition ? Math.max(0, nutrition.targets.proteinG - nutrition.consumed.proteinG) : 0;

  // Sizes from the screen's width, so a narrow phone still shows a card and a bit of the next
  const cardWidth = Math.round(Math.min(196, Math.max(148, (width - 44) / 2.25)));
  const tileSize = Math.round(Math.min(96, Math.max(76, (width - 62) / 3.8)));
  const circleSize = Math.round(Math.min(72, Math.max(56, (width - 62) / 5)));

  const open = (meal: MenuMeal) => router.push({ pathname: "/meals/[id]", params: { id: meal.id } });
  const browse = (params: { category?: string; tag?: string; list?: string }) => router.push({ pathname: "/meals/browse", params });
  const toggleFavorite = async (meal: MenuMeal) => {
    const next = !meal.favorite;
    haptic.select();
    markFavorite(meal.id, next);
    const answer = await mealsApi.favorite(await getToken(), meal.id, next);
    if (!answer.ok) {
      markFavorite(meal.id, !next);
      hud.error("Couldn't save your favourite");
    }
  };
  const openBanner = (b: MealBanner) => {
    if (b.target.kind === "meal") router.push({ pathname: "/meals/[id]", params: { id: b.target.ref } });
    else if (b.target.kind === "category") browse({ category: b.target.ref });
    else browse({ tag: b.target.ref });
  };

  const card = (meal: MenuMeal, note?: string | null) => (
    <MealCard
      key={meal.id}
      meal={meal}
      width={cardWidth}
      quantity={items[meal.id] ?? 0}
      note={note}
      onOpen={() => open(meal)}
      onAdd={() => add(meal.id)}
      onQuantity={(q) => setQuantity(meal.id, q)}
      onFavorite={() => toggleFavorite(meal)}
    />
  );
  const row = (meals: MenuMeal[], note?: (m: MenuMeal) => string | null) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4, gap: 12 }}>
      {meals.slice(0, 12).map((m) => card(m, note?.(m)))}
    </ScrollView>
  );

  const header = (
    <View style={{ gap: 20, paddingBottom: 16 }}>
      {/* Brand, Meals, where it goes, the cart */}
      <View className="px-4 pt-2" style={{ gap: 10 }}>
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <BrandWordmark width={78} />
          <View className="flex-1" />
          <PressableScale onPress={() => router.push("/orders")} className="shop-cart" accessibilityRole="button" accessibilityLabel="My orders">
            <SymbolView name={{ ios: "shippingbox", android: "inventory_2", web: "inventory_2" }} size={19} tintColor={colors.mealDark} />
          </PressableScale>
          <PressableScale onPress={() => router.push("/meals/cart")} className="shop-cart" accessibilityRole="button" accessibilityLabel={count ? `Cart, ${count} meals` : "Cart, empty"}>
            <SymbolView name={{ ios: "bag.fill", android: "shopping_bag", web: "shopping_bag" }} size={19} tintColor={colors.mealDark} />
            {count > 0 && <View className="shop-cart__count"><Text className="shop-cart__count-label">{count}</Text></View>}
          </PressableScale>
        </View>
        <View>
          <Text className="type-title text-forest-ink" accessibilityRole="header">Meals</Text>
          <PressableScale onPress={() => router.push({ pathname: "/addresses", params: { pick: "1" } })} className="shop-pill" accessibilityRole="button" accessibilityLabel={address ? `Delivering to ${KIND_LABEL[address.kind]}, ${address.pincode}. Change` : "Add a delivery address"}>
            <SymbolView name={{ ios: "location.fill", android: "location_on", web: "location_on" }} size={13} tintColor={colors.mealDark} />
            <Text className="meal-link" numberOfLines={1} style={{ flexShrink: 1 }}>
              {address ? `Deliver to ${KIND_LABEL[address.kind]} · ${address.pincode}` : "Add a delivery address"}
            </Text>
            <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={12} tintColor={colors.mealDark} />
          </PressableScale>
        </View>
      </View>

      {/* Search and Veg only */}
      <View className="px-4" style={{ gap: 8 }}>
        <View className="setup__field" style={{ minHeight: 50, borderColor: focused ? colors.mealPrimary : colors.mealLine }}>
          <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={17} tintColor={colors.mealDark} />
          <FieldInput
            className="field-input flex-1"
            value={search}
            onChangeText={setSearch}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Search a meal, cuisine or ingredient"
            placeholderTextColor={colors.faint}
            returnKeyType="search"
            autoCorrect={false}
            maxLength={40}
            accessibilityLabel="Search meals"
          />
          {search ? (
            <PressableScale onPress={() => setSearch("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <SymbolView name={{ ios: "xmark.circle.fill", android: "cancel", web: "cancel" }} size={17} tintColor={colors.faint} />
            </PressableScale>
          ) : null}
        </View>
        {hints.length > 0 && (
          <View className="shop-suggest">
            {hints.map((h, i) => (
              <PressableScale key={h} onPress={() => { setSearch(h); setFocused(false); }} className="flex-row items-center" style={{ gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderColor: colors.mealLine }} accessibilityRole="button">
                <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={13} tintColor={colors.faint} />
                <Text className="type-body text-forest-ink flex-1" numberOfLines={1}>{h}</Text>
              </PressableScale>
            ))}
          </View>
        )}
        <View className="flex-row items-center justify-end" style={{ gap: 8 }}>
          <View className="meal-diet" style={{ borderColor: colors.mealPrimary }}><View className="meal-diet__dot" style={{ backgroundColor: colors.mealPrimary }} /></View>
          <Text className="type-body text-forest-ink">Veg only</Text>
          <Switch
            value={vegOnly}
            onValueChange={(v) => { setVegOnly(v); haptic.select(); }}
            trackColor={{ false: colors.creamTab, true: colors.mealPrimary }}
            thumbColor={colors.white}
            ios_backgroundColor={colors.creamTab}
            accessibilityLabel="Veg only"
          />
        </View>
      </View>

      {results ? (
        <View className="px-4"><Text className="meta-text">{results.length ? `${results.length} ${results.length === 1 ? "meal" : "meals"} for “${query}”` : ""}</Text></View>
      ) : (
        store && sections && (
          <>
            {sections.tiles.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
                {sections.tiles.map((c) => <CategoryTile key={c.id} category={c} size={tileSize} onPress={() => browse({ category: String(c.id) })} />)}
              </ScrollView>
            )}
            {store.banners.length > 0 && <BannerCarousel banners={store.banners} width={width} onOpen={openBanner} />}
            {sections.rows.map(({ category, meals }) => (
              <View key={category.id} style={{ gap: 10 }}>
                <SectionTitle title={category.name} subtitle={category.subtitle} onSeeAll={meals.length > 2 ? () => browse({ category: String(category.id) }) : undefined} />
                {row(meals)}
              </View>
            ))}
            {sections.foods.length > 0 && (
              <View style={{ gap: 10 }}>
                <SectionTitle title="What's on your mind?" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
                  {sections.foods.map((c) => <FoodCircle key={c.id} category={c} size={circleSize} onPress={() => browse({ category: String(c.id) })} />)}
                </ScrollView>
              </View>
            )}
            {sections.specials.length > 0 && (
              <View style={{ gap: 10 }}>
                <SectionTitle title="Today's specials" subtitle="Popular picks and deals" onSeeAll={sections.specials.length > 2 ? () => browse({ list: "specials" }) : undefined} />
                {row(sections.specials)}
              </View>
            )}
            {sections.highProtein.length > 0 && (
              <View style={{ gap: 10 }}>
                <SectionTitle
                  title="High protein"
                  subtitle={proteinLeft > 0 ? `You need ${Math.round(proteinLeft)} g more protein today` : "Meals that help you hit your protein target"}
                  onSeeAll={sections.highProtein.length > 2 ? () => browse({ list: "high_protein" }) : undefined}
                />
                {row(sections.highProtein, (m) => (proteinLeft > 0 ? `${Math.min(100, Math.round((m.proteinG / proteinLeft) * 100))}% of your protein left today` : null))}
              </View>
            )}
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
                      onApply={() => { setCoupon(c.code); hud.success(`${c.code} applied`); }}
                    />
                  ))}
                </ScrollView>
              </View>
            )}
            {sections.meals.length > 0 && <SectionTitle title="All meals" subtitle={`${sections.meals.length} ${sections.meals.length === 1 ? "meal" : "meals"} on the menu`} />}
          </>
        )
      )}
    </View>
  );

  const list = results ?? sections?.meals ?? [];
  return (
    <View className="flex-1 meal-page">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <FlatList
          {...listPerf}
          data={list}
          keyExtractor={(m) => m.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: count > 0 ? 96 : 28 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          refreshControl={refreshControl}
          renderItem={({ item }) => (
            <View className="px-4">
              <MealRow meal={item} quantity={items[item.id] ?? 0} onOpen={() => open(item)} onAdd={() => add(item.id)} onQuantity={(q) => setQuantity(item.id, q)} />
            </View>
          )}
          ListEmptyComponent={
            <View className="px-4">
              {load.state === "loading" && <ScreenSkeleton label="Loading meals" hero />}
              {load.state === "failed" && <LoadError tone="meal" title="Meals couldn't load" message={load.error} onRetry={async () => read(await getToken(), { force: true })} />}
              {load.state === "ready" && (
                <EmptyState
                  tone="meal"
                  icon={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }}
                  title={query ? "No meals match" : vegOnly ? "No veg meals yet" : "No meals yet"}
                  message={query ? "Try another meal, cuisine or ingredient." : "New meals will appear here soon."}
                />
              )}
            </View>
          }
        />
        {count > 0 && (
          <PressableScale haptic="tap" scaleTo={0.98} onPress={() => router.push("/meals/cart")} className="meal-cartbar" accessibilityRole="button" accessibilityLabel={`View cart, ${count} meals, ${rupees(total)}`}>
            <SymbolView name={{ ios: "bag.fill", android: "shopping_bag", web: "shopping_bag" }} size={18} tintColor={colors.onPrimary} />
            <Text className="btn-forest__label flex-1">{`${count} ${count === 1 ? "meal" : "meals"} · ${rupees(total)}${couponCode ? ` · ${couponCode}` : ""}`}</Text>
            <Text className="btn-forest__label">View cart</Text>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.onPrimary} />
          </PressableScale>
        )}
      </SafeAreaView>
    </View>
  );
}
