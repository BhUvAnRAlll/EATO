import { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { HomeHeader } from "@/components/home/HomeHeader";
import { NutritionProgressCard } from "@/components/home/NutritionProgressCard";
import { PopularMealCard } from "@/components/home/PopularMealCard";
import { PromotionCarousel } from "@/components/home/PromotionCarousel";
import { QuickActionCard } from "@/components/home/QuickActionCard";
import { SectionHeader } from "@/components/home/SectionHeader";
import { TodayMealCard } from "@/components/home/TodayMealCard";
import { ActiveVisitCard } from "@/components/owner/ActiveVisitCard";
import { routeFor, sampleDeliveryPincode, sampleMeals, sampleNutrition, sampleTodayOrder } from "@/data/home";
import { formatShortDate } from "@/lib/date";
import { useSessionToken } from "@/lib/session";
import { useCartStore } from "@/store/cart";
import { useHomeStore } from "@/store/home";

// Space on each side of the page content
const PAGE_PADDING = 20;
const GAP = 8;

// Home for members: hero promotions, quick actions, today's nutrition, popular meals and
// today's delivery. Promotions and labels come from the server (admins edit them); the
// nutrition targets are the member's own; orders aren't built yet, so that card is a sample.
export default function Home() {
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const { promotions, content, nutrition, load, refreshIntake } = useHomeStore();
  const cart = useCartStore();
  const [favorites, setFavorites] = useState<string[]>([]);

  const contentWidth = width - PAGE_PADDING * 2;
  // The header pill shrinks before the wordmark does
  const pill = width < 360 ? "icon" : width < 430 ? "pincode" : "full";

  // First load: the home content and the member's targets (the store's freshness window
  // keeps repeat mounts to one request per minute)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!cancelled) load(token);
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, load]);

  // Back on Home (after logging a meal or changing the target on the Macro tab): the content
  // (within its freshness window, or at once after a target change) and today's eaten totals
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const token = await getToken().catch(() => null);
        await load(token);
        refreshIntake(token);
      })();
    }, [getToken, load, refreshIntake]),
  );

  // Back from the background: pick up any changes an admin made
  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (state) => {
      if (state === "active") load(await getToken(), { force: true });
    });
    return () => subscription.remove();
  }, [getToken, load]);

  // Only destinations the app knows are ever opened (see destinationRoutes)
  const open = (destination: string) => {
    const href = routeFor(destination);
    if (href) router.navigate(href);
  };

  const toggleFavorite = (mealId: string) =>
    setFavorites((current) => (current.includes(mealId) ? current.filter((id) => id !== mealId) : [...current, mealId]));

  const quickActions = content.quickActions;
  // Four cards across on standard phones; below 360pt that leaves under 70pt per card, so
  // narrow phones get two per row (the row wraps, keeping the admin's order)
  const perRow = Math.min(width < 360 ? 2 : 4, Math.max(1, quickActions.length));
  const quickWidth = Math.floor((contentWidth - GAP * (perRow - 1)) / perRow);
  const popularMeals = content.popularMeals.length > 0 ? content.popularMeals : sampleMeals;
  const mealWidth = Math.round(Math.min(200, Math.max(150, contentWidth * 0.5)));

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <HomeHeader
            pincode={sampleDeliveryPincode}
            hasUnread
            pill={pill}
            onLocationPress={() => router.push("/addresses")}
            onNotificationsPress={() => router.push("/notifications")}
            onProfilePress={() => router.push("/profile")}
          />

          {/* The member's active gym session (only while checked in somewhere) */}
          <ActiveVisitCard />

          <View className="mt-3">
            <PromotionCarousel promotions={promotions} width={width} onOpen={open} />
          </View>

          {/* Quick actions */}
          {quickActions.length > 0 && (
            <View className="mt-5 flex-row flex-wrap px-5" style={{ gap: GAP }}>
              {quickActions.map((action) => (
                <QuickActionCard key={action.id} action={action} width={quickWidth} onPress={() => open(action.destination)} />
              ))}
            </View>
          )}

          {/* Today's nutrition */}
          <View className="mt-5 px-5">
            <NutritionProgressCard
              heading={content.nutritionHeading}
              actionLabel={content.nutritionActionLabel}
              nutrition={nutrition ?? sampleNutrition}
              width={contentWidth}
              onEditGoal={() => router.push("/goals")}
              onOpen={() => router.navigate("/macro")}
            />
          </View>

          {/* Popular meals */}
          <View className="mt-6 px-5">
            <SectionHeader title={content.popularHeading} actionLabel={content.popularActionLabel} onAction={() => router.navigate("/meals")} />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: PAGE_PADDING, paddingVertical: 12, gap: 12 }}
          >
            {popularMeals.map((meal) => (
              <PopularMealCard
                key={meal.id}
                meal={meal}
                width={mealWidth}
                favorite={favorites.includes(meal.id)}
                quantity={cart.items[meal.id] ?? 0}
                onToggleFavorite={() => toggleFavorite(meal.id)}
                onAdd={() => cart.add(meal.id)}
              />
            ))}
          </ScrollView>

          {/* Today's delivery (sample until orders exist) */}
          {content.showTodaySection && (
            <View className="mt-3 px-5">
              <SectionHeader
                title={content.todayHeading}
                badge={
                  <View className="live__badge live__badge--sample">
                    <View className="live__dot live__dot--sample" />
                    <Text className="live__label live__label--sample">Sample</Text>
                  </View>
                }
                actionLabel={formatShortDate()}
              />
              <View className="mt-3">
                <TodayMealCard order={sampleTodayOrder} isSample actionLabel={content.todayActionLabel} onViewAll={() => router.navigate("/orders")} />
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
