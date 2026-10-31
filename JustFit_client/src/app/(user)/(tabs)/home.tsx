import { useCallback, useEffect, useState } from "react";
import { AppState, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { HomeHeader } from "@/components/home/HomeHeader";
import { PopularMealCard } from "@/components/home/PopularMealCard";
import { PromotionCarousel } from "@/components/home/PromotionCarousel";
import { QuickActionCard } from "@/components/home/QuickActionCard";
import { SectionHeader } from "@/components/home/SectionHeader";
import { TodayMealCard } from "@/components/home/TodayMealCard";
import { TodayRingsCard } from "@/components/home/TodayRingsCard";
import { WeeklyActivityCard } from "@/components/home/WeeklyActivityCard";
import { WorkoutHeroCard } from "@/components/home/WorkoutHeroCard";
import { ActiveVisitCard } from "@/components/owner/ActiveVisitCard";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { routeFor, sampleDeliveryPincode, sampleMeals, sampleNutrition, sampleTodayOrder } from "@/data/home";
import { formatShortDate } from "@/lib/date";
import { todayIso } from "@/lib/macro";
import { firstNameOf } from "@/lib/me";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useCartStore } from "@/store/cart";
import { useHomeStore } from "@/store/home";

// Space on each side of the page content
const PAGE_PADDING = 16;
const GAP = 8;

// Home for members (2026-10-31 look): the greeting, then today's rings (calories, protein,
// water), today's workout as a dark hero, the week's training minutes, hero promotions, quick
// actions, popular meals and today's delivery. Promotions and labels come from the server
// (admins edit them); the numbers are the member's own; orders aren't built yet, so that
// card is a sample.
export default function Home() {
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const { promotions, content, nutrition, water, workout, activity, load, refreshIntake } = useHomeStore();
  const cart = useCartStore();
  const [favorites, setFavorites] = useState<string[]>([]);

  const contentWidth = width - PAGE_PADDING * 2;
  const firstName = useAuthStore((state) => firstNameOf(state.user?.fullName));

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

  // Back on Home (after logging a meal, a workout, or changing the target): the content
  // (within its freshness window, or at once after a target change) and today's numbers
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

  // A pull reads everything again, past the freshness window: the content, promotions and
  // today's numbers (a forced load reads the same numbers refreshIntake does)
  const reload = useCallback(async () => {
    const token = await getToken().catch(() => null);
    await load(token, { force: true });
  }, [getToken, load]);
  const { refreshControl } = usePullToRefresh(reload);

  // Only destinations the app knows are ever opened (see destinationRoutes)
  const open = (destination: string) => {
    const href = routeFor(destination);
    if (href) router.navigate(href);
  };

  const toggleFavorite = (mealId: string) =>
    setFavorites((current) => (current.includes(mealId) ? current.filter((id) => id !== mealId) : [...current, mealId]));

  // A session still to do opens the player; a rest day or a finished one, the Workout hub
  const openWorkout = () => {
    if (workout?.day && workout.status !== "completed" && workout.status !== "rest") router.push({ pathname: "/workout/session", params: { date: todayIso() } });
    else router.push("/workout");
  };

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
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }} refreshControl={refreshControl}>
          <HomeHeader
            name={firstName}
            pincode={sampleDeliveryPincode}
            hasUnread
            onLocationPress={() => router.push("/addresses")}
            onNotificationsPress={() => router.push("/notifications")}
            onProfilePress={() => router.push("/profile")}
          />

          {/* The member's active gym session (only while checked in somewhere) */}
          <ActiveVisitCard />

          {/* Today: calories, protein and water against their targets */}
          <View className="mt-4 px-4">
            <TodayRingsCard heading={content.nutritionHeading} nutrition={nutrition ?? sampleNutrition} water={water} width={contentWidth} onOpen={() => router.navigate("/macro")} />
          </View>

          {/* Today's workout (only with a plan) */}
          {workout && (
            <View className="mt-3 px-4">
              <WorkoutHeroCard workout={workout} onOpen={openWorkout} />
            </View>
          )}

          {/* Minutes trained this week */}
          {activity && (
            <View className="mt-3 px-4">
              <WeeklyActivityCard activity={activity} onOpen={() => router.push("/workout")} />
            </View>
          )}

          <View className="mt-5">
            <PromotionCarousel promotions={promotions} width={width} onOpen={open} />
          </View>

          {/* Quick actions */}
          {quickActions.length > 0 && (
            <View className="mt-5 flex-row flex-wrap px-4" style={{ gap: GAP }}>
              {quickActions.map((action) => (
                <QuickActionCard key={action.id} action={action} width={quickWidth} onPress={() => open(action.destination)} />
              ))}
            </View>
          )}

          {/* Popular meals */}
          <View className="mt-5 px-4">
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
            <View className="mt-3 px-4">
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
