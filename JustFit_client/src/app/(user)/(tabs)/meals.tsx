import { useCallback, useMemo, useState } from "react";
import { FlatList, Platform, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { BrandWordmark } from "@/components/BrandWordmark";
import { AccessLocation } from "@/components/meals/AccessLocation";
import { EmptyState } from "@/components/EmptyState";
import { FieldInput } from "@/components/FieldInput";
import { LoadError } from "@/components/macro/LoadError";
import { MealRow } from "@/components/meals/MealRow";
import { MealFilterSheet, NO_MEAL_FILTERS, type MealFilters } from "@/components/meals/MealFilterSheet";
import { SubscriptionTab } from "@/components/meals/SubscriptionTab";
import { BannerCarousel, CategoryTile, CouponCard, FoodCircle, MealCard, QuickTile, SectionTitle } from "@/components/meals/ShopParts";
import { PressableScale } from "@/components/PressableScale";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { KIND_LABEL } from "@/lib/addressRules";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { listPerf } from "@/lib/listPerf";
import { byDiet, popularMeals, searchMeals, shopSections, sortMeals, suggestions, type QuickList } from "@/lib/mealRules";
import { mealsApi, type MealBanner, type MenuMeal } from "@/lib/mealsApi";
import { useAddressBook } from "@/lib/useAddressBook";
import { useSessionToken } from "@/lib/session";
import { useAddressDraft } from "@/store/addressDraft";
import { cartCount, useCartStore } from "@/store/cart";
import { useHomeStore } from "@/store/home";
import { useStorefront } from "@/store/storefront";
import { useThemeColors } from "@/theme";

type Mode = "order" | "subscription";

// The Meals tab (rebuilt 2026-11-10 from the user's design; the 2026-11-09 Swiggy-style storefront
// before it). Top to bottom: the logo, the bell and the cart; Meals; Order Meals | Meal Subscription;
// where it's delivered (Edit opens the address book); the search (meal, cuisine or ingredient) with
// suggestions and the filter button (diet, sort); five quick tiles; the banner carousel; Popular
// Meals; then the admin's collections, featured rows, food categories, specials, high protein,
// offers and every meal. All of it comes from one storefront read (store/storefront.ts).
// Meal Subscription (phase 5, the design's second phone) is components/meals/SubscriptionTab.
export default function Meals() {
  const colors = useThemeColors();
  const { width, fontScale } = useWindowDimensions();
  // Narrow phones (or larger text): the switch drops its icons so both labels fit
  const narrow = width / fontScale < 360;
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
  const locationAsked = useAddressDraft((state) => state.locationAsked);
  const setLocationAsked = useAddressDraft((state) => state.setLocationAsked);
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [mode, setMode] = useState<Mode>("order");
  const [filters, setFilters] = useState<MealFilters>(NO_MEAL_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  useFocusEffect(useCallback(() => { getToken().then((t) => read(t)); }, [getToken, read]));
  const { refreshControl } = usePullToRefresh(useCallback(async () => read(await getToken(), { force: true }), [getToken, read]), colors.mealPrimary);

  const store = load.state === "ready" ? load.data : null;
  const sections = useMemo(() => (store ? shopSections(sortMeals(byDiet(store.meals, filters.diet), filters.sort), store.categories, false) : null), [store, filters]);
  const popular = useMemo(() => (sections ? popularMeals(sections.meals) : []), [sections]);
  const filtered = filters.diet !== null || filters.sort !== "recommended";
  const query = search.trim();
  const results = useMemo(() => (store && sections && query ? searchMeals(sections.meals, store.categories, query) : null), [store, sections, query]);
  const hints = useMemo(() => (store && focused ? suggestions(store.meals, store.categories, query) : []), [store, focused, query]);
  const count = cartCount(items);

  const address = addressLoad.state === "ready" ? addressLoad.book.addresses.find((a) => a.isDefault) ?? null : null;
  const place = address ? [address.deliveryArea ?? address.street, address.city].filter(Boolean).join(", ") : "";
  const proteinLeft = nutrition ? Math.max(0, nutrition.targets.proteinG - nutrition.consumed.proteinG) : 0;

  // Sizes from the screen's width, so a narrow phone still shows a card and a bit of the next
  const cardWidth = Math.round(Math.min(220, Math.max(148, (width - 44) / 2)));
  const quickWidth = Math.floor((Math.min(width, 760) - 32) / 5);
  const tileSize = Math.round(Math.min(96, Math.max(76, (width - 62) / 3.8)));
  const circleSize = Math.round(Math.min(72, Math.max(56, (width - 62) / 5)));

  const open = (meal: MenuMeal) => router.push({ pathname: "/meals/[id]", params: { id: meal.id } });
  const browse = (params: { category?: string; tag?: string; list?: QuickList }) => router.push({ pathname: "/meals/browse", params });
  const switchTo = (next: Mode) => {
    if (next === mode) return;
    haptic.select();
    setMode(next);
  };
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

  const quick: { list: QuickList; label: string; icon: Parameters<typeof QuickTile>[0]["icon"]; ground: string; tint: string }[] = [
    { list: "high_protein", label: "High Protein", icon: { ios: "flame.fill", android: "local_fire_department", web: "local_fire_department" }, ground: colors.tintPeach, tint: colors.iconPeach },
    { list: "low_calorie", label: "Low Calorie", icon: { ios: "leaf.fill", android: "eco", web: "eco" }, ground: colors.tintGreen, tint: colors.iconGreen },
    { list: "veg", label: "Veg", icon: { ios: "leaf.fill", android: "eco", web: "eco" }, ground: colors.mealLight, tint: colors.mealPrimary },
    { list: "non_veg", label: "Non-Veg", icon: { ios: "fish.fill", android: "set_meal", web: "set_meal" }, ground: colors.tintRose, tint: colors.iconRose },
    { list: "combos", label: "Combos", icon: { ios: "square.stack.3d.up.fill", android: "layers", web: "layers" }, ground: colors.tintYellow, tint: colors.iconYellow },
  ];

  const header = (
    <View style={{ gap: 18, paddingBottom: 16 }}>
      {/* The logo, the bell, the cart; Meals and its line; Order Meals | Meal Subscription */}
      <View className="px-4 pt-2" style={{ gap: 14 }}>
        <View className="flex-row items-center" style={{ gap: 4 }}>
          <BrandWordmark width={58} tagline={false} />
          <View className="flex-1" />
          <PressableScale onPress={() => router.push("/notifications")} className="shop-cart" accessibilityRole="button" accessibilityLabel="Notifications">
            <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" }} size={23} tintColor={colors.ink} />
          </PressableScale>
          <PressableScale onPress={() => router.push("/meals/cart")} className="shop-cart" accessibilityRole="button" accessibilityLabel={count ? `Cart, ${count} meals` : "Cart, empty"}>
            <SymbolView name={{ ios: "cart", android: "shopping_cart", web: "shopping_cart" }} size={23} tintColor={colors.ink} />
            {count > 0 && <View className="shop-cart__count"><Text className="shop-cart__count-label">{count}</Text></View>}
          </PressableScale>
        </View>
        <View style={{ gap: 2 }}>
          <Text className="shop-title" accessibilityRole="header">Meals</Text>
          <Text className="shop-subtitle">Nutritious meals for your fitness goals</Text>
        </View>
        <View className="shop-switch" accessibilityRole="tablist">
          {([
            { value: "order", label: "Order Meals", icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" } },
            { value: "subscription", label: "Meal Subscription", icon: { ios: "calendar", android: "calendar_month", web: "calendar_month" } },
          ] as const).map((o) => {
            const on = mode === o.value;
            return (
              <PressableScale key={o.value} onPress={() => switchTo(o.value)} className={on ? "shop-switch__option shop-switch__option--on" : "shop-switch__option"} style={narrow ? { paddingHorizontal: 4 } : undefined} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                {!narrow && <SymbolView name={o.icon} size={18} tintColor={on ? colors.white : colors.ink} />}
                <Text className={on ? "shop-switch__label shop-switch__label--on" : "shop-switch__label"} numberOfLines={1} style={narrow ? { fontSize: 12, lineHeight: 16 } : undefined}>{o.label}</Text>
              </PressableScale>
            );
          })}
        </View>
      </View>

      {mode === "order" && (
        <>
          {/* Deliver to */}
          <View className="px-4">
            {/* Two buttons side by side, never one inside the other (a nested <button> is invalid
                on the web build and its error toast covered the screen, 2026-11-10) */}
            <View className="shop-deliver">
              <PressableScale scaleTo={0.99} onPress={() => router.push({ pathname: "/addresses", params: { pick: "1" } })} className="min-w-0 flex-1 flex-row items-center" style={{ gap: 12 }} accessibilityRole="button" accessibilityLabel={address ? `Delivering to ${KIND_LABEL[address.kind]}, ${place || address.pincode}. Change` : "Add a delivery address"}>
                <SymbolView name={{ ios: "mappin.circle.fill", android: "location_on", web: "location_on" }} size={22} tintColor={colors.mealPrimary} />
                <View className="min-w-0 flex-1">
                  <Text className="shop-deliver__label">Deliver to</Text>
                  <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Text className="shop-deliver__place" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {address ? (
                        <>
                          <Text className="shop-deliver__kind">{KIND_LABEL[address.kind]}</Text>
                          {` · ${place || address.pincode}`}
                        </>
                      ) : (
                        <Text className="shop-deliver__kind">Add a delivery address</Text>
                      )}
                    </Text>
                    <SymbolView name={{ ios: "chevron.down", android: "expand_more", web: "expand_more" }} size={12} tintColor={colors.ink} />
                  </View>
                </View>
              </PressableScale>
              <PressableScale onPress={() => router.push("/addresses")} hitSlop={6} className="shop-deliver__edit" accessibilityRole="button" accessibilityLabel="Edit delivery addresses">
                <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={15} tintColor={colors.ink} />
              </PressableScale>
            </View>
          </View>

          {/* Search and the filter button */}
          <View className="px-4" style={{ gap: 8 }}>
            <View className="flex-row items-center" style={{ gap: 10 }}>
              <View className="shop-search" style={focused ? { borderColor: colors.mealPrimary } : undefined}>
                <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.ink} />
                <FieldInput
                  className="field-input flex-1"
                  value={search}
                  onChangeText={setSearch}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setTimeout(() => setFocused(false), 150)}
                  placeholder="Search meals, cuisine or ingredients"
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
              <PressableScale onPress={() => setShowFilters(true)} className="shop-filter" accessibilityRole="button" accessibilityLabel={filtered ? "Filters, some on" : "Filters"}>
                <SymbolView name={{ ios: "slider.horizontal.3", android: "tune", web: "tune" }} size={20} tintColor={colors.ink} />
                {filtered && <View className="shop-filter__dot" />}
              </PressableScale>
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
          </View>

          {results ? (
            <View className="px-4"><Text className="meta-text">{results.length ? `${results.length} ${results.length === 1 ? "meal" : "meals"} for “${query}”` : ""}</Text></View>
          ) : (
            store && sections && (
              <>
                <View className="flex-row px-4">
                  {quick.map((q) => <QuickTile key={q.list} label={q.label} icon={q.icon} ground={q.ground} tint={q.tint} width={quickWidth} onPress={() => browse({ list: q.list })} />)}
                </View>
                {store.banners.length > 0 && <BannerCarousel banners={store.banners} width={width} onOpen={openBanner} />}
                {popular.length > 0 && (
                  <View style={{ gap: 12 }}>
                    <SectionTitle title="Popular Meals" onSeeAll={popular.length > 2 ? () => browse({ list: "popular" }) : undefined} />
                    {row(popular)}
                  </View>
                )}
                {sections.tiles.length > 0 && (
                  <View style={{ gap: 12 }}>
                    <SectionTitle title="Collections" />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
                      {sections.tiles.map((c) => <CategoryTile key={c.id} category={c} size={tileSize} onPress={() => browse({ category: String(c.id) })} />)}
                    </ScrollView>
                  </View>
                )}
                {sections.rows.map(({ category, meals }) => (
                  <View key={category.id} style={{ gap: 12 }}>
                    <SectionTitle title={category.name} subtitle={category.subtitle} onSeeAll={meals.length > 2 ? () => browse({ category: String(category.id) }) : undefined} />
                    {row(meals)}
                  </View>
                ))}
                {sections.foods.length > 0 && (
                  <View style={{ gap: 12 }}>
                    <SectionTitle title="What's on your mind?" />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
                      {sections.foods.map((c) => <FoodCircle key={c.id} category={c} size={circleSize} onPress={() => browse({ category: String(c.id) })} />)}
                    </ScrollView>
                  </View>
                )}
                {sections.specials.length > 0 && (
                  <View style={{ gap: 12 }}>
                    <SectionTitle title="Today's specials" subtitle="Popular picks and deals" onSeeAll={sections.specials.length > 2 ? () => browse({ list: "specials" }) : undefined} />
                    {row(sections.specials)}
                  </View>
                )}
                {sections.highProtein.length > 0 && (
                  <View style={{ gap: 12 }}>
                    <SectionTitle
                      title="High protein"
                      subtitle={proteinLeft > 0 ? `You need ${Math.round(proteinLeft)} g more protein today` : "Meals that help you hit your protein target"}
                      onSeeAll={sections.highProtein.length > 2 ? () => browse({ list: "high_protein" }) : undefined}
                    />
                    {row(sections.highProtein, (m) => (proteinLeft > 0 ? `${Math.min(100, Math.round((m.proteinG / proteinLeft) * 100))}% of your protein left today` : null))}
                  </View>
                )}
                {store.coupons.length > 0 && (
                  <View style={{ gap: 12 }}>
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
        </>
      )}
    </View>
  );

  // No delivery address yet: ask for the phone's location first (once a session), then the map
  if (addressLoad.state === "ready" && addressLoad.book.addresses.length === 0 && !locationAsked) {
    const toMap = (at?: { latitude: number; longitude: number }) => {
      setLocationAsked();
      router.push(at ? { pathname: "/addresses/location", params: { lat: String(at.latitude), lng: String(at.longitude) } } : "/addresses/location");
    };
    return (
      <View className="flex-1 bg-surface">
        <StatusBar style="dark" />
        <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
          <AccessLocation onFound={toMap} onManual={() => toMap()} />
        </SafeAreaView>
      </View>
    );
  }

  const list = mode === "subscription" ? [] : results ?? sections?.meals ?? [];
  return (
    <View className="flex-1 meal-page--white">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <FlatList
          {...listPerf}
          data={list}
          keyExtractor={(m) => m.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: 28 }}
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
            <View className={mode === "subscription" ? undefined : "px-4"}>
              {mode === "subscription" ? <SubscriptionTab width={width} /> : null}
              {mode === "order" && load.state === "loading" && <ScreenSkeleton label="Loading meals" hero />}
              {mode === "order" && load.state === "failed" && <LoadError tone="meal" title="Meals couldn't load" message={load.error} onRetry={async () => read(await getToken(), { force: true })} />}
              {mode === "order" && load.state === "ready" && (
                <EmptyState
                  tone="meal"
                  icon={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }}
                  title={query ? "No meals match" : filters.diet ? "No meals for this diet yet" : "No meals yet"}
                  message={query ? "Try another meal, cuisine or ingredient." : filters.diet ? "Clear the filters to see every meal." : "New meals will appear here soon."}
                />
              )}
            </View>
          }
        />
        {showFilters && <MealFilterSheet value={filters} onApply={setFilters} onClose={() => setShowFilters(false)} />}
      </SafeAreaView>
    </View>
  );
}
