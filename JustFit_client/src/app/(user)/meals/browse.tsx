import { useCallback, useMemo, useState } from "react";
import { FlatList, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/macro/LoadError";
import { MealCard } from "@/components/meals/ShopParts";
import { PressableScale } from "@/components/PressableScale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { TAG_LIST_TITLE, isVeg, shopSections, type Tag } from "@/lib/mealRules";
import { mealsApi, type MenuMeal } from "@/lib/mealsApi";
import { useSessionToken } from "@/lib/session";
import { useCartStore } from "@/store/cart";
import { useStorefront } from "@/store/storefront";

type Sort = "recommended" | "price" | "protein" | "calories";
const SORTS: { value: Sort; label: string }[] = [
  { value: "recommended", label: "Recommended" },
  { value: "protein", label: "Most protein" },
  { value: "calories", label: "Fewest kcal" },
  { value: "price", label: "Price: low to high" },
];

// One list of meals, two cards a row: a category (?category=id), a tag (?tag=high_protein) or a
// section's See all (?list=specials | high_protein), with Veg only and a sort. Reads the storefront
// the Meals tab already holds (store/storefront.ts), so opening it costs no extra request.
export default function BrowseMeals() {
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ category?: string; tag?: string; list?: string }>();
  const getToken = useSessionToken();
  const load = useStorefront((state) => state.load);
  const read = useStorefront((state) => state.read);
  const markFavorite = useStorefront((state) => state.setFavorite);
  const items = useCartStore((state) => state.items);
  const add = useCartStore((state) => state.add);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const [sort, setSort] = useState<Sort>("recommended");
  const [vegOnly, setVegOnly] = useState(false);

  useFocusEffect(useCallback(() => { getToken().then((t) => read(t)); }, [getToken, read]));

  const store = load.state === "ready" ? load.data : null;
  const { title, subtitle, meals } = useMemo(() => {
    if (!store) return { title: "Meals", subtitle: null as string | null, meals: [] as MenuMeal[] };
    const sections = shopSections(store.meals, store.categories, false);
    if (params.category) {
      const c = store.categories.find((x) => String(x.id) === params.category);
      const byId = new Map(store.meals.map((m) => [m.id, m]));
      return { title: c?.name ?? "Meals", subtitle: c?.subtitle ?? null, meals: (c?.mealIds ?? []).map((id) => byId.get(id)).filter((m): m is MenuMeal => !!m) };
    }
    if (params.list === "specials") return { title: "Today's specials", subtitle: "Popular picks and deals", meals: sections.specials };
    if (params.list === "high_protein") return { title: "High protein", subtitle: "Most protein first", meals: sections.highProtein };
    const tag = params.tag as Tag | undefined;
    if (tag && tag in TAG_LIST_TITLE) return { title: TAG_LIST_TITLE[tag], subtitle: null, meals: store.meals.filter((m) => m.tags.includes(tag)) };
    return { title: "All meals", subtitle: null, meals: store.meals };
  }, [store, params.category, params.list, params.tag]);

  const shown = useMemo(() => {
    const list = vegOnly ? meals.filter((m) => isVeg(m.diet)) : [...meals];
    if (sort === "price") list.sort((a, b) => a.price - b.price);
    if (sort === "protein") list.sort((a, b) => b.proteinG - a.proteinG);
    if (sort === "calories") list.sort((a, b) => a.calories - b.calories);
    return list;
  }, [meals, sort, vegOnly]);

  const cardWidth = Math.floor((width - 16 * 2 - 12) / 2);
  const toggleFavorite = async (meal: MenuMeal) => {
    haptic.select();
    markFavorite(meal.id, !meal.favorite);
    const answer = await mealsApi.favorite(await getToken(), meal.id, !meal.favorite);
    if (!answer.ok) {
      markFavorite(meal.id, !!meal.favorite);
      hud.error("Couldn't save your favourite");
    }
  };

  const chips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 14 }}>
      <PressableScale haptic="select" onPress={() => setVegOnly(!vegOnly)} className={vegOnly ? "meal-chip meal-chip--on" : "meal-chip"} accessibilityRole="button" accessibilityState={{ selected: vegOnly }}>
        <Text className="admin-segment__label admin-segment__label--on">Veg only</Text>
      </PressableScale>
      {SORTS.map((s) => (
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
              quantity={items[item.id] ?? 0}
              onOpen={() => router.push({ pathname: "/meals/[id]", params: { id: item.id } })}
              onAdd={() => add(item.id)}
              onQuantity={(q) => setQuantity(item.id, q)}
              onFavorite={() => toggleFavorite(item)}
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
