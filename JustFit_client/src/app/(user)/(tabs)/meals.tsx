import { useCallback, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { LoadError } from "@/components/macro/LoadError";
import { AccessLocation } from "@/components/meals/AccessLocation";
import { MealCard } from "@/components/meals/cards/MealCard";
import { CartBar } from "@/components/meals/home/CartBar";
import { MealSearch } from "@/components/meals/home/MealSearch";
import { ShopHeader } from "@/components/meals/home/ShopHeader";
import { ShopSections } from "@/components/meals/home/ShopSections";
import { MealFilterSheet, NO_MEAL_FILTERS, hasMealFilters, type MealFilters } from "@/components/meals/MealFilterSheet";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenSkeleton } from "@/components/Skeleton";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { listPerf } from "@/lib/listPerf";
import { DIET_FILTERS, MEAL_SORTS, byDiet, orderAgain, orderedText, popularMeals, searchExamples, searchWithFallback, shopSections, sortMeals, suggestions, type QuickList } from "@/lib/mealRules";
import { mealsApi, type MealBanner, type MenuMeal, type Order } from "@/lib/mealsApi";
import { useAddressBook } from "@/lib/useAddressBook";
import { useSessionToken } from "@/lib/session";
import { useAddressDraft } from "@/store/addressDraft";
import { cartCount, useCartStore } from "@/store/cart";
import { useHomeStore } from "@/store/home";
import { useMealSearchStore } from "@/store/mealSearch";
import { useStorefront } from "@/store/storefront";
import { useThemeColors } from "@/theme";

const GUTTER = 16;
const GAP = 12;

// The Meals tab (calm pass 2026-11-10: green only for Add, the cart bar and what's selected). The
// screen holds the state and wires the pieces in components/meals/home, Zomato-style: where it's
// delivered (with the bell and cart), the search, the promotional section and the rest
// (ShopSections), then every meal (or the search's results) as a two-column
// grid, and the floating cart bar. One storefront read (store/storefront.ts) feeds it all.
// Subscribing starts on a meal's page; running subscriptions are in Profile › My subscriptions.
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
  const locationAsked = useAddressDraft((state) => state.locationAsked);
  const setLocationAsked = useAddressDraft((state) => state.setLocationAsked);
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [filters, setFilters] = useState<MealFilters>(NO_MEAL_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  useFocusEffect(useCallback(() => { getToken().then((t) => read(t)); }, [getToken, read]));
  const { refreshControl } = usePullToRefresh(useCallback(async () => read(await getToken(), { force: true }), [getToken, read]), colors.ink);

  const store = load.state === "ready" ? load.data : null;
  const sections = useMemo(() => (store ? shopSections(sortMeals(byDiet(store.meals, filters.diet), filters.sort), store.categories, false) : null), [store, filters]);
  const popular = useMemo(() => (sections ? popularMeals(sections.meals) : []), [sections]);
  // Order again (marketing phase 3): the member's past orders, read whenever the tab shows
  const [pastOrders, setPastOrders] = useState<Order[]>([]);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const answer = await mealsApi.orders(await getToken().catch(() => null));
        if (live && answer.ok) setPastOrders(answer.data.orders);
      })();
      return () => {
        live = false;
      };
    }, [getToken]),
  );
  const again = useMemo(() => (sections ? orderAgain(pastOrders, sections.meals).map((a) => ({ meal: a.meal, note: orderedText(a.times) })) : []), [pastOrders, sections]);
  const filtered = hasMealFilters(filters);
  // The filters on, as chips under the search: each removes itself, Clear all removes both
  const activeFilters = [
    ...(filters.diet ? [{ key: "diet", label: DIET_FILTERS.find((d) => d.value === filters.diet)?.label ?? filters.diet, clear: { ...filters, diet: null } }] : []),
    ...(filters.sort !== "recommended" ? [{ key: "sort", label: MEAL_SORTS.find((m) => m.value === filters.sort)?.label ?? filters.sort, clear: { ...filters, sort: NO_MEAL_FILTERS.sort } }] : []),
  ];
  const query = search.trim();
  const found = useMemo(() => (store && sections && query ? searchWithFallback(sections.meals, store.categories, query) : null), [store, sections, query]);
  const results = found?.meals ?? null;
  const recent = useMealSearchStore((s) => s.recent);
  const rememberSearch = useMealSearchStore((s) => s.remember);
  const forgetSearch = useMealSearchStore((s) => s.forget);
  const clearRecent = useMealSearchStore((s) => s.clear);
  const pickSearch = (term: string) => {
    setSearch(term);
    rememberSearch(term);
  };
  const examples = useMemo(() => (store ? searchExamples(store.meals, store.categories) : []), [store]);
  const hints = useMemo(() => (store && focused ? suggestions(store.meals, store.categories, query) : []), [store, focused, query]);
  const count = cartCount(items);
  const address = addressLoad.state === "ready" ? addressLoad.book.addresses.find((a) => a.isDefault) ?? null : null;
  const proteinLeft = nutrition ? Math.max(0, nutrition.targets.proteinG - nutrition.consumed.proteinG) : 0;

  // A row card shows one card and a bit of the next; the grid fits two cards a row
  const rowWidth = Math.round(Math.min(220, Math.max(148, (width - 44) / 2)));
  const gridWidth = Math.floor((Math.min(width, 760) - GUTTER * 2 - GAP) / 2);

  const open = (meal: MenuMeal) => {
    if (query) rememberSearch(query); // a meal opened from the results keeps its search as a recent one
    router.push({ pathname: "/meals/[id]", params: { id: meal.id } });
  };
  const browse = (params: { category?: string; tag?: string; list?: QuickList }) => router.push({ pathname: "/meals/browse", params });
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
  const card = (meal: MenuMeal, cardWidth: number, variant: "row" | "grid", note?: string | null) => (
    <MealCard
      key={meal.id}
      meal={meal}
      width={cardWidth}
      variant={variant}
      quantity={items[meal.id] ?? 0}
      note={note}
      onOpen={() => open(meal)}
      onAdd={() => add(meal.id)}
      onQuantity={(q) => setQuantity(meal.id, q)}
      onFavorite={() => toggleFavorite(meal)}
    />
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

  const header = (
    <View style={{ gap: 18, paddingBottom: 14 }}>
      <ShopHeader address={address} count={count} />
          <MealSearch value={search} onChange={setSearch} focused={focused} onFocus={setFocused} hints={hints} filtered={filtered} onFilters={() => setShowFilters(true)} examples={examples} recent={recent} onPick={pickSearch} onForget={forgetSearch} onClearRecent={clearRecent} />
          {activeFilters.length > 0 && (
            <View className="flex-row flex-wrap items-center px-4" style={{ gap: 8 }}>
              {activeFilters.map((f) => (
                <PressableScale key={f.key} haptic="select" onPress={() => setFilters(f.clear)} className="shop-active-filter" accessibilityRole="button" accessibilityLabel={`Remove filter ${f.label}`}>
                  <Text className="shop-active-filter__text">{f.label}</Text>
                  <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={11} tintColor={colors.ink} />
                </PressableScale>
              ))}
              <Pressable onPress={() => setFilters(NO_MEAL_FILTERS)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear all filters">
                <Text className="shop-suggest__clear">Clear all</Text>
              </Pressable>
            </View>
          )}
          {results ? (
            <View className="px-4" style={{ gap: 4 }}>
              {found?.kind !== "exact" && <Text className="shop-search__miss">{found?.kind === "popular" ? `No meals for “${query}”` : `No exact match for “${query}”`}</Text>}
              {found?.didYouMean && (
                <Pressable onPress={() => pickSearch(found.didYouMean ?? "")} accessibilityRole="button" hitSlop={8}>
                  <Text className="meta-text">Did you mean <Text className="shop-search__fix">{found.didYouMean}</Text>?</Text>
                </Pressable>
              )}
              <Text className="meta-text">
                {found?.kind === "exact"
                  ? results.length ? `${results.length} ${results.length === 1 ? "meal" : "meals"} for “${query}”` : ""
                  : found?.kind === "popular" ? "Popular meals you might like" : "Related meals"}
              </Text>
            </View>
          ) : (
            store && sections && (
              <ShopSections
                store={store}
                sections={sections}
                popular={popular}
                again={again}
                proteinLeft={proteinLeft}
                couponCode={couponCode}
                onCoupon={setCoupon}
                card={(m, note) => card(m, rowWidth, "row", note)}
                browse={browse}
                onBanner={openBanner}
              />
            )
          )}
    </View>
  );

  const list = results ?? sections?.meals ?? [];
  const showCart = count > 0;
  return (
    <View className="flex-1 meal-page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <FlatList
          {...listPerf}
          data={list}
          numColumns={2}
          keyExtractor={(m) => m.id}
          ListHeaderComponent={header}
          columnWrapperStyle={{ paddingHorizontal: GUTTER, gap: GAP }}
          contentContainerStyle={{ paddingBottom: showCart ? 100 : 28 }}
          ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          refreshControl={refreshControl}
          renderItem={({ item }) => card(item, gridWidth, "grid")}
          ListEmptyComponent={
            <View className="px-4">
              {load.state === "loading" && <ScreenSkeleton label="Loading meals" hero />}
              {load.state === "failed" && <LoadError tone="meal" title="Meals couldn't load" message={load.error} onRetry={async () => read(await getToken(), { force: true })} />}
              {load.state === "ready" && (
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
        {showCart && <CartBar items={items} meals={store?.meals ?? []} />}
        {showFilters && <MealFilterSheet value={filters} onApply={setFilters} onClose={() => setShowFilters(false)} countFor={(f) => (store ? byDiet(store.meals, f.diet).length : 0)} />}
      </SafeAreaView>
    </View>
  );
}
