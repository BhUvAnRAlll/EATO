import { useCallback, useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { LoadError } from "@/components/macro/LoadError";
import { DietMark } from "@/components/meals/DietMark";
import { QuantityPill } from "@/components/meals/QuantityStepper";
import { SubscriptionChoice } from "@/components/meals/SubscriptionChoice";
import { PressableScale } from "@/components/PressableScale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { DIET_LABEL, TAG_LABEL, discountText, rupees } from "@/lib/mealRules";
import { mealImage, mealsApi, type MenuMeal } from "@/lib/mealsApi";
import { useSessionToken } from "@/lib/session";
import { subscriptionPrice } from "@/lib/subscriptionRules";
import { subscriptionsApi, type SubscriptionLength } from "@/lib/subscriptionsApi";
import { useAuthStore } from "@/store/auth";
import { MAX_PER_MEAL, useCartStore } from "@/store/cart";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; meal: MenuMeal };
type Mode = "once" | "subscribe";

// One meal (the user's 2026-11-10 design): the photo, diet, name, price per meal, what's in it, the
// calories and macros, then Choose How You Want It: One-time Order (the cart) or Meal Subscription
// (the Super Admin's lengths with their % off; Add Subscription goes on to the start day, meal time,
// address and Pay). The quantity and the button are pinned at the bottom. The heart is red.
export default function MealDetail() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  // Narrow screens: shorter words in the bar and the switch, smaller figures (phones are scaled to 430)
  const { width } = useWindowDimensions();
  const narrow = width < 380;
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const token = useAuthStore((state) => state.token);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // The lengths only (null until read, [] when subscriptions aren't on this server yet)
  const [lengths, setLengths] = useState<SubscriptionLength[] | null>(null);
  const [mode, setMode] = useState<Mode>("once");
  const [lengthId, setLengthId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const items = useCartStore((state) => state.items);
  const setCartQuantity = useCartStore((state) => state.setQuantity);

  const read = useCallback(async () => {
    const t = await getToken();
    const [answer, offered] = await Promise.all([mealsApi.meal(t, String(id)), subscriptionsApi.lengths(t)]);
    setLoad(answer.ok ? { state: "ready", meal: answer.data.meal } : { state: "failed", error: answer.error });
    const list = offered.ok ? offered.data.lengths : [];
    setLengths(list);
    // The longest length starts picked, as the design shows
    setLengthId((current) => (current && list.some((l) => l.id === current) ? current : list[list.length - 1]?.id ?? null));
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
  const inCart = meal ? items[meal.id] ?? 0 : 0;
  const canSubscribe = (lengths?.length ?? 0) > 0;
  const subscribing = mode === "subscribe" && canSubscribe;
  const length = lengths?.find((l) => l.id === lengthId) ?? null;
  // One-time: once the meal is in the cart the pill changes the cart itself
  const shown = subscribing ? quantity : inCart || quantity;
  const off = meal ? discountText(meal.price, meal.mrp) : null;
  const facts = meal
    ? [
        { label: "Calories", value: `${meal.calories}`, unit: "kcal" },
        { label: "Protein", value: `${Math.round(meal.proteinG)}`, unit: "g" },
        { label: "Carbs", value: `${Math.round(meal.carbsG)}`, unit: "g" },
        { label: "Fat", value: `${Math.round(meal.fatG)}`, unit: "g" },
      ]
    : [];

  const changeQuantity = (q: number) => {
    if (!meal) return;
    if (!subscribing && inCart > 0) setCartQuantity(meal.id, q);
    else setQuantity(q);
  };
  const subscribe = () => {
    if (!meal || !length) return;
    haptic.tap();
    router.push({ pathname: "/meals/subscribe", params: { meal: meal.id, length: String(length.id), quantity: String(quantity) } });
  };
  const addToCart = () => {
    if (!meal) return;
    setCartQuantity(meal.id, Math.min(MAX_PER_MEAL, quantity));
    hud.success("Added to cart");
  };

  let action: { label: string; onPress: () => void } | null = null;
  if (meal && subscribing && length) action = { label: `${narrow ? "Subscribe" : "Add Subscription"} · ${rupees(subscriptionPrice(meal.price, quantity, length.days, length.percentOff).total)}`, onPress: subscribe };
  else if (meal && !subscribing) action = inCart > 0 ? { label: `View cart · ${rupees(meal.price * inCart)}`, onPress: () => router.push("/meals/cart") } : { label: `Add to cart · ${rupees(meal.price * quantity)}`, onPress: addToCart };

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader
          title="Meal"
          fallback="/meals"
          right={
            meal ? (
              <PressableScale haptic="select" onPress={toggleFavorite} className="meal__heart" style={{ position: "relative", top: 0, right: 0, width: 44, height: 44, backgroundColor: colors.surface }} accessibilityRole="button" accessibilityLabel={meal.favorite ? "Remove from favourites" : "Add to favourites"} accessibilityState={{ selected: !!meal.favorite }}>
                <SymbolView name={meal.favorite ? { ios: "heart.fill", android: "favorite", web: "favorite" } : { ios: "heart", android: "favorite", web: "favorite" }} size={21} tintColor={meal.favorite ? colors.danger : colors.ink} />
              </PressableScale>
            ) : undefined
          }
        />
        {load.state === "loading" && <View className="px-4"><ScreenSkeleton label="Loading the meal" cards={2} hero /></View>}
        {load.state === "failed" && <View className="px-4"><LoadError tone="meal" title="This meal couldn't load" message={load.error} onRetry={() => { setLoad({ state: "loading" }); read(); }} /></View>}
        {meal && (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 18 }} showsVerticalScrollIndicator={false}>
              <View className="meal__card" style={{ aspectRatio: 5 / 3 }}>
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
                <Text className="shop-title" style={{ fontSize: 26, lineHeight: 34 }} accessibilityRole="header">{meal.name}</Text>
                <View className="flex-row items-baseline flex-wrap" style={{ gap: 6 }}>
                  <Text className="shop-title" style={{ fontSize: 26, lineHeight: 34 }}>{rupees(meal.price)}</Text>
                  <Text className="type-body text-forest-ink">per meal</Text>
                  {off && meal.mrp ? <Text className="shop-mrp" style={{ fontSize: 14 }}>{rupees(meal.mrp)}</Text> : null}
                  {off ? <Text className="shop-macros">{off}</Text> : null}
                </View>
                {meal.servingSize ? <Text className="meta-text">{`Serving: ${meal.servingSize}`}</Text> : null}
                {meal.description ? <Text className="type-body text-muted">{meal.description}</Text> : null}
              </View>
              <View className="meal-facts">
                {facts.map((f, i) => (
                  <View key={f.label} className="flex-1 items-center" style={{ borderLeftWidth: i === 0 ? 0 : 1, borderColor: colors.creamLine, gap: 2 }}>
                    <Text className="admin-stat__value" numberOfLines={1} style={{ fontSize: narrow ? 17 : 20, lineHeight: 26, color: colors.ink }}>
                      {f.value}
                      <Text className="meta-text">{` ${f.unit}`}</Text>
                    </Text>
                    <Text className="meta-text">{f.label}</Text>
                  </View>
                ))}
              </View>
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <SymbolView name={{ ios: "chart.pie.fill", android: "pie_chart", web: "pie_chart" }} size={15} tintColor={colors.muted} />
                <Text className="meta-text flex-1">Delivered meals are added to your Macro diary by themselves.</Text>
              </View>
              {meal.ingredients ? (
                <View className="shop-card" style={{ padding: 14, gap: 4 }}>
                  <Text className="card__title">Ingredients</Text>
                  <Text className="type-body text-muted">{meal.ingredients}</Text>
                </View>
              ) : null}

              {canSubscribe && (
                <View style={{ gap: 12 }}>
                  <Text className="meal-section__title" accessibilityRole="header">Choose How You Want It</Text>
                  <View className="meal-mode" accessibilityRole="tablist">
                    {([
                      { value: "once", label: "One-time Order" },
                      { value: "subscribe", label: "Meal Subscription" },
                    ] as const).map((o) => {
                      const on = mode === o.value;
                      return (
                        <PressableScale key={o.value} haptic="select" onPress={() => setMode(o.value)} className={on ? "meal-mode__option meal-mode__option--on" : "meal-mode__option"} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                          {o.value === "subscribe" && on && width >= 400 ? <SymbolView name={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} size={17} tintColor={colors.white} /> : null}
                          <Text className={on ? "meal-mode__label meal-mode__label--on" : "meal-mode__label"} numberOfLines={1}>{o.label}</Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                </View>
              )}
              {subscribing && lengths && (
                <SubscriptionChoice lengths={lengths} unitPrice={meal.price} quantity={quantity} selectedId={lengthId} onSelect={setLengthId} onContinue={subscribe} />
              )}
            </ScrollView>
            <View className="meal-buybar" style={{ paddingBottom: Math.max(insets.bottom, 14) }}>
              <QuantityPill quantity={shown} max={MAX_PER_MEAL} name={meal.name} onChange={changeQuantity} />
              <View className="min-w-0 flex-1">
                {action ? (
                  <PressableScale haptic="tap" scaleTo={0.98} onPress={action.onPress} className="sub-cta" accessibilityRole="button" accessibilityLabel={action.label}>
                    <Text className="sub-cta__label" numberOfLines={1} style={{ fontSize: 15 }}>{action.label}</Text>
                  </PressableScale>
                ) : null}
              </View>
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}
