import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/macro/LoadError";
import { MealCard } from "@/components/meals/cards/MealCard";
import { PressableScale } from "@/components/PressableScale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { MEAL_SORTS, QUICK_LIST_SUBTITLE, QUICK_LIST_TITLE, TAG_LIST_TITLE, isQuickList, isVeg, quickList, sortMeals, type MealSort, type Tag } from "@/lib/mealRules";
import { mealsApi, type MenuMeal } from "@/lib/mealsApi";
import { useSessionToken } from "@/lib/session";
import { useStorefront } from "@/store/storefront";

// One list of meals, two cards a row: a category (?category=id), a tag (?tag=high_protein) or a
// quick list (?list=popular | specials | high_protein | low_calorie | veg | non_veg | combos), with
// Veg only and a sort. Reads the storefront
// the Meals tab already holds (store/storefront.ts), so opening it costs no extra request.
export default function BrowseMeals() {
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ category?: string; tag?: string; list?: string }>();
  const getToken = useSessionToken();
  const load = useStorefront((state) => state.load);
  const read = useStorefront((state) => state.read);
  const markFavorite = useStorefront((state) => state.setFavorite);
  const [sort, setSort] = useState<MealSort>("recommended");
  const [vegOnly, setVegOnly] = useState(false);

  useFocusEffect(useCallback(() => { getToken().then((t) => read(t)); }, [getToken, read]));

  const store = load.state === "ready" ? load.data : null;
  const { title, subtitle, meals } = useMemo(() => {
    if (!store) return { title: "Meals", subtitle: null as string | null, meals: [] as MenuMeal[] };
    if (params.category) {
      const c = store.categories.find((x) => String(x.id) === params.category);
      const byId = new Map(store.meals.map((m) => [m.id, m]));
      return { title: c?.name ?? "Meals", subtitle: c?.subtitle ?? null, meals: (c?.mealIds ?? []).map((id) => byId.get(id)).filter((m): m is MenuMeal => !!m) };
    }
    if (isQuickList(params.list)) return { title: QUICK_LIST_TITLE[params.list], subtitle: QUICK_LIST_SUBTITLE[params.list] ?? null, meals: quickList(store.meals, store.categories, params.list) };
    const tag = params.tag as Tag | undefined;
    if (tag && tag in TAG_LIST_TITLE) return { title: TAG_LIST_TITLE[tag], subtitle: null, meals: store.meals.filter((m) => m.tags.includes(tag)) };
    return { title: "All meals", subtitle: null, meals: store.meals };
  }, [store, params.category, params.list, params.tag]);

  const shown = useMemo(() => {
    return sortMeals(vegOnly ? meals.filter((m) => isVeg(m.diet)) : meals, sort);
  }, [meals, sort, vegOnly]);

  const cardWidth = Math.floor((width - 16 * 2 - 12) / 2);
  const openMeal = useCallback((meal: MenuMeal) => router.push({ pathname: "/meals/[id]", params: { id: meal.id } }), []);
  // Stable for the memoised cards; always calls this render's toggleFavorite
  const favoriteRef = useRef<(meal: MenuMeal) => void>(() => {});
  const onFavorite = useCallback((meal: MenuMeal) => favoriteRef.current(meal), []);
  const toggleFavorite = async (meal: MenuMeal) => {
    haptic.select();
    markFavorite(meal.id, !meal.favorite);
    const answer = await mealsApi.favorite(await getToken(), meal.id, !meal.favorite);
    if (!answer.ok) {
      markFavorite(meal.id, !!meal.favorite);
      hud.error("Couldn't save your favourite");
    }
  };
  useEffect(() => { favoriteRef.current = toggleFavorite; });

  const chips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 14 }}>
      <PressableScale haptic="select" onPress={() => setVegOnly(!vegOnly)} className={vegOnly ? "meal-chip meal-chip--on" : "meal-chip"} accessibilityRole="button" accessibilityState={{ selected: vegOnly }}>
        <Text className="admin-segment__label admin-segment__label--on">Veg only</Text>
      </PressableScale>
      {MEAL_SORTS.map((s) => (
        <PressableScale key={s.value} haptic="select" onPress={() => setSort(s.value)} className={sort === s.value ? "meal-chip meal-chip--on" : "meal-chip"} accessibilityRole="button" accessibilityState={{ selected: sort === s.value }}>
          <Text className={sort === s.value ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{s.label}</Text>
        </PressableScale>
      ))}
    </ScrollView>
  );

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title={title} subtitle={subtitle ?? undefined} fallback="/meals" />
        <FlatList
          data={shown}
          keyExtractor={(m) => m.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          ListHeaderComponent={store ? chips : undefined}
          contentContainerStyle={{ paddingBottom: 32 }}
          initialNumToRender={8}
          renderItem={({ item }) => (
            <MealCard
              meal={item}
              width={cardWidth}
              onOpen={openMeal}
              onFavorite={onFavorite}
            />
          )}
          ListEmptyComponent={
            <View className="px-4">
              {load.state === "loading" && <ScreenSkeleton label="Loading meals" />}
              {load.state === "failed" && <LoadError tone="meal" title="Meals couldn't load" message={load.error} onRetry={async () => read(await getToken(), { force: true })} />}
              {load.state === "ready" && (
                <EmptyState tone="meal" icon={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} title={vegOnly ? "No veg meals here" : "Nothing here yet"} message="Try another category from the Meals tab." />
              )}
            </View>
          }
        />
      </SafeAreaView>
    </View>
  );
}
