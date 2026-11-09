import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { LoadError } from "@/components/macro/LoadError";
import { DietMark } from "@/components/meals/MealRow";
import { QuantityStepper } from "@/components/meals/QuantityStepper";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { DIET_LABEL, TAG_LABEL, discountText, rupees } from "@/lib/mealRules";
import { mealImage, mealsApi, type MenuMeal } from "@/lib/mealsApi";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { MAX_PER_MEAL, cartCount, useCartStore } from "@/store/cart";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; meal: MenuMeal };

// One meal: its photo, diet, name, what's in it, calories and macros, the favourite heart, and
// Add to cart (then − n + and View cart) pinned at the bottom.
export default function MealDetail() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const token = useAuthStore((state) => state.token);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [saving, setSaving] = useState(false);
  const items = useCartStore((state) => state.items);
  const add = useCartStore((state) => state.add);
  const setQuantity = useCartStore((state) => state.setQuantity);

  const read = useCallback(async () => {
    const answer = await mealsApi.meal(await getToken(), String(id));
    setLoad(answer.ok ? { state: "ready", meal: answer.data.meal } : { state: "failed", error: answer.error });
  }, [getToken, id]);
  useFocusEffect(useCallback(() => { read(); }, [read]));

  const toggleFavorite = async () => {
    if (load.state !== "ready" || saving) return;
    const next = !load.meal.favorite;
    haptic.select();
    setSaving(true);
    setLoad({ state: "ready", meal: { ...load.meal, favorite: next } }); // shown at once, put back on failure
    const answer = await mealsApi.favorite(await getToken(), load.meal.id, next);
    setSaving(false);
    if (!answer.ok) {
      setLoad({ state: "ready", meal: { ...load.meal, favorite: !next } });
      hud.error("Couldn't save your favourite");
    }
  };

  const meal = load.state === "ready" ? load.meal : null;
  const quantity = meal ? items[meal.id] ?? 0 : 0;
  const inCart = cartCount(items);
  const off = meal ? discountText(meal.price, meal.mrp) : null;
  const facts = meal
    ? [
        { label: "Calories", value: `${meal.calories}`, unit: "kcal" },
        { label: "Protein", value: `${Math.round(meal.proteinG)}`, unit: "g" },
        { label: "Carbs", value: `${Math.round(meal.carbsG)}`, unit: "g" },
        { label: "Fat", value: `${Math.round(meal.fatG)}`, unit: "g" },
      ]
    : [];

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader
          title="Meal"
          fallback="/meals"
          right={
            meal ? (
              <PressableScale haptic="select" onPress={toggleFavorite} className="meal__heart" style={{ position: "relative", top: 0, right: 0, width: 44, height: 44 }} accessibilityRole="button" accessibilityLabel={meal.favorite ? "Remove from favourites" : "Add to favourites"} accessibilityState={{ selected: !!meal.favorite }}>
                <SymbolView name={meal.favorite ? { ios: "heart.fill", android: "favorite", web: "favorite" } : { ios: "heart", android: "favorite", web: "favorite" }} size={20} tintColor={meal.favorite ? colors.mealPrimary : colors.ink} />
              </PressableScale>
            ) : undefined
          }
        />
        {load.state === "loading" && <View className="px-4"><ScreenSkeleton label="Loading the meal" cards={2} hero /></View>}
        {load.state === "failed" && <View className="px-4"><LoadError tone="meal" title="This meal couldn't load" message={load.error} onRetry={() => { setLoad({ state: "loading" }); read(); }} /></View>}
        {meal && (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }} showsVerticalScrollIndicator={false}>
              <View className="meal__card" style={{ aspectRatio: 4 / 3 }}>
                <Image source={mealImage(meal.imageUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} transition={150} accessibilityLabel={meal.name} />
              </View>
              <View style={{ gap: 6 }}>
                <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
                  <DietMark diet={meal.diet} />
                  <Text className="meta-text">{DIET_LABEL[meal.diet]}</Text>
                  {meal.tags.map((t) => (
                    <View key={t} className="meal-row__macros"><Text className="shop-macros" style={{ fontSize: 11 }}>{TAG_LABEL[t]}</Text></View>
                  ))}
                </View>
                <Text className="type-title text-forest-ink" accessibilityRole="header">{meal.name}</Text>
                <View className="flex-row items-baseline" style={{ gap: 8 }}>
                  <Text className="meal-price" style={{ fontSize: 20, lineHeight: 26 }}>{rupees(meal.price)}</Text>
                  {off && meal.mrp ? <Text className="shop-mrp" style={{ fontSize: 14 }}>{rupees(meal.mrp)}</Text> : null}
                  {off ? <Text className="shop-macros">{off}</Text> : null}
                </View>
                {meal.servingSize ? <Text className="meta-text">{`Serving: ${meal.servingSize}`}</Text> : null}
                {meal.description ? <Text className="type-body text-muted">{meal.description}</Text> : null}
              </View>
              <View className="meal-facts">
                {facts.map((f, i) => (
                  <View key={f.label} className="flex-1 items-center" style={{ borderLeftWidth: i === 0 ? 0 : 1, borderColor: colors.mealLine, gap: 2 }}>
                    <Text className="admin-stat__value" style={{ fontSize: 20, lineHeight: 26, color: colors.mealDark }}>
                      {f.value}
                      <Text className="meta-text">{` ${f.unit}`}</Text>
                    </Text>
                    <Text className="meta-text">{f.label}</Text>
                  </View>
                ))}
              </View>
              {meal.ingredients ? (
                <View className="shop-card" style={{ padding: 14, gap: 4 }}>
                  <Text className="card__title">Ingredients</Text>
                  <Text className="type-body text-muted">{meal.ingredients}</Text>
                </View>
              ) : null}
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <SymbolView name={{ ios: "chart.pie.fill", android: "pie_chart", web: "pie_chart" }} size={14} tintColor={colors.mealDark} />
                <Text className="meta-text flex-1">Delivered meals are added to your Macro diary by themselves.</Text>
              </View>
            </ScrollView>
            <View className="px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12), gap: 10, backgroundColor: colors.mealSurface }}>
              {quantity === 0 ? (
                <PrimaryButton tone="meal" label={`Add to cart · ${rupees(meal.price)}`} onPress={() => { add(meal.id); haptic.select(); }} />
              ) : (
                <View className="flex-row items-center" style={{ gap: 12 }}>
                  <QuantityStepper quantity={quantity} max={MAX_PER_MEAL} name={meal.name} onChange={(q) => setQuantity(meal.id, q)} />
                  <View className="flex-1">
                    <PrimaryButton tone="meal" label={`View cart (${inCart})`} onPress={() => router.push("/meals/cart")} />
                  </View>
                </View>
              )}
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}
