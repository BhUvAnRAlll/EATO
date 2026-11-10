import { FinishProfileCard } from "@/components/FinishProfileCard";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, ScrollView, Text, View } from "react-native";
import { useResponsive } from "@/lib/responsive";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { HomeHeader } from "@/components/home/HomeHeader";
import { PopularMealCard } from "@/components/home/PopularMealCard";
import { PromotionCarousel } from "@/components/home/PromotionCarousel";
import { QuickActionCard } from "@/components/home/QuickActionCard";
import { SectionHeader } from "@/components/home/SectionHeader";
import { TodayDelivery } from "@/components/home/TodayDelivery";
import { TodayRingsCard } from "@/components/home/TodayRingsCard";
import { WeeklyActivityCard } from "@/components/home/WeeklyActivityCard";
import { WorkoutHeroCard } from "@/components/home/WorkoutHeroCard";
import { LoadError } from "@/components/macro/LoadError";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { SkeletonCard } from "@/components/Skeleton";
import { routeFor, sampleNutrition } from "@/data/home";
import { formatShortDate } from "@/lib/date";
import { todayIso } from "@/lib/macro";
import { firstNameOf } from "@/lib/me";
import { useSessionToken } from "@/lib/session";
import { useAuthStore } from "@/store/auth";
import { useCartStore } from "@/store/cart";
import { isOpen } from "@/lib/mealRules";
import { mealsApi, type Order } from "@/lib/mealsApi";
import { useAddressBook } from "@/lib/useAddressBook";
import { useHomeStore } from "@/store/home";
import { OrderRemindersRow } from "@/components/meals/OrderRemindersRow";
import { RecommendedMeals } from "@/components/meals/RecommendedMeals";
import { indiaHour, matchMeals, mealTimesLeft, remainingReason, targetFromRemaining } from "@/lib/mealMatch";
import { refreshOrderReminders } from "@/lib/orderReminders";
import { useMyFood } from "@/store/myFood";
import { useStorefront } from "@/store/storefront";

// Space on each side of the page content
const PAGE_PADDING = 16;
const GAP = 8;

// Home for members (restructured 2026-11-10): the greeting, then sections in one rhythm:
// Shortcuts, Today (rings for calories, protein and water, today's workout, today's delivery),
// Picked for you (menu meals for what's left of today, with order reminders), This week (training minutes), then promotions and popular meals to order. Promotions and labels come from the server
// (admins edit them); the numbers and today's delivery are the member's own.
export default function Home() {
  const { width, compact } = useResponsive();
  const getToken = useSessionToken();
  const { promotions, content, nutrition, hasTargets, water, workout, activity, load, refreshIntake, loading, error, source } = useHomeStore();
  const cart = useCartStore();
  // Read again whenever Home shows, so an address picked a moment ago is in the pill
  const { load: addressLoad } = useAddressBook();
  const deliveryPincode = addressLoad.state === "ready" ? addressLoad.book.addresses.find((a) => a.isDefault)?.pincode ?? null : null;
  const [favorites, setFavorites] = useState<string[]>([]);
  // Today's meal deliveries (null until read, or when orders can't be read)
  const [todayOrders, setTodayOrders] = useState<Order[] | null>(null);

  // Picked for you: the menu meals that fit what's left of today, never against the member's diet
  // or allergies (lib/mealMatch.ts, on the phone: no AI, no cost). Shown once the menu and the
  // member's food answers are read and only with their real targets.
  const menu = useStorefront((state) => state.load);
  const readMenu = useStorefront((state) => state.read);
  const food = useMyFood((state) => state.food);
  const foodRead = useMyFood((state) => state.read);
  const loadFood = useMyFood((state) => state.load);
  const picked = useMemo(() => {
    if (!nutrition || nutrition.source !== "targets" || menu.state !== "ready" || !foodRead) return null;
    const timesLeft = mealTimesLeft(indiaHour(new Date()));
    if (timesLeft === 0) return null;
    const left = { kcal: Math.round(nutrition.targets.calories - nutrition.consumed.calories), proteinG: Math.max(0, Math.round(nutrition.targets.proteinG - nutrition.consumed.proteinG)) };
    const target = targetFromRemaining(left, timesLeft);
    if (!target) return null;
    const items = matchMeals(menu.data.meals, food, target, { max: 2 }).map((m) => ({ meal: m.meal, note: remainingReason(m.meal, left) }));
    return items.length > 0 ? { left, items } : null;
  }, [nutrition, menu, food, foodRead]);
  const pick = picked ? { name: picked.items[0].meal.name, price: picked.items[0].meal.price } : null;
  const pickKey = pick ? `${pick.name}:${pick.price}` : "";
  // The menu and food answers for Picked for you, and the order reminders rescheduled with today's
  // orders, whenever Home shows
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const token = await getToken().catch(() => null);
        readMenu(token);
        loadFood(token);
        refreshOrderReminders(token, pickKey ? { name: pickKey.slice(0, pickKey.lastIndexOf(":")), price: Number(pickKey.slice(pickKey.lastIndexOf(":") + 1)) } : null).catch(() => {});
      })();
    }, [getToken, readMenu, loadFood, pickKey]),
  );

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
  // (within its freshness window, or at once after a target change) and today's numbers.
  // A load that ran (or was already running) has just read them, so they're read again only
  // when the content was still fresh and skipped
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const token = await getToken().catch(() => null);
        if (!(await load(token))) refreshIntake(token);
      })();
    }, [getToken, load, refreshIntake]),
  );

  // Today's deliveries, read whenever Home shows (the admin moves them on during the day)
  const readOrders = useCallback(async () => {
    const answer = await mealsApi.orders(await getToken().catch(() => null));
    if (answer.ok) setTodayOrders(answer.data.orders.filter((o) => o.date === todayIso() && o.status !== "cancelled"));
  }, [getToken]);
  useFocusEffect(useCallback(() => { readOrders(); }, [readOrders]));

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
    await Promise.all([load(token, { force: true }), readOrders()]);
  }, [getToken, load, readOrders]);
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

  const todayDelivery = todayOrders?.find((o) => isOpen(o.status)) ?? todayOrders?.[todayOrders.length - 1] ?? null;

  const quickActions = content.quickActions;
  // Four cards across on standard phones; below 360pt that leaves under 70pt per card, so
  // narrow phones get two per row (the row wraps, keeping the admin's order)
  const perRow = Math.min(compact ? 2 : 4, Math.max(1, quickActions.length));
  const quickWidth = Math.floor((contentWidth - GAP * (perRow - 1)) / perRow);
  // Only meals the admin picked: sample meals shown as "popular" would read as real ones
  const popularMeals = content.popularMeals;
  const mealWidth = Math.round(Math.min(200, Math.max(150, contentWidth * 0.5)));

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }} refreshControl={refreshControl}>
          <HomeHeader
            name={firstName}
            // The selected delivery address's pincode (hidden until one is saved); no unread dot
            // until notifications exist
            pincode={deliveryPincode}
            hasUnread={false}
            onLocationPress={() => router.push("/addresses")}
            onNotificationsPress={() => router.push("/notifications")}
            onProfilePress={() => router.push("/profile")}
          />

          {/* 1. Shortcuts the admin picked, first so they're one tap from opening the app */}
          {quickActions.length > 0 && (
            <HomeSection title="Shortcuts">
              <View className="flex-row flex-wrap" style={{ gap: GAP }}>
                {quickActions.map((action) => (
                  <QuickActionCard key={action.id} action={action} width={quickWidth} onPress={() => open(action.destination)} />
                ))}
              </View>
            </HomeSection>
          )}

          {/* 2. Today: what the member eats, trains and gets delivered today */}
          <HomeSection title={content.todayHeading} action={formatShortDate()}>
            {/* Until the first read answers the rings are a skeleton: the bundled sample said
                "couldn't be loaded" on every cold start */}
            {hasTargets === false ? (
              // No targets yet (setup asks only the personal details): never the bundled sample numbers
              <FinishProfileCard origin="home" />
            ) : nutrition === null && source === "default" && (loading || error === null) ? (
              <SkeletonCard tall />
            ) : (
              <TodayRingsCard heading={content.nutritionHeading} nutrition={nutrition ?? sampleNutrition} water={water} width={contentWidth} onOpen={() => router.navigate("/macro")} />
            )}
            {error && !loading && <LoadError title="Home couldn't load" message={error} onRetry={reload} />}
            {workout && <WorkoutHeroCard workout={workout} onOpen={openWorkout} />}
            {content.showTodaySection && todayOrders !== null && (
              <TodayDelivery
                order={todayDelivery}
                actionLabel={content.todayActionLabel}
                onOpenOrder={(id) => router.push({ pathname: "/orders/[id]", params: { id } })}
                onOrder={() => router.navigate("/meals")}
              />
            )}
          </HomeSection>

          {/* 3. Meals picked for what's left of today, ready to order */}
          {picked && (
            <HomeSection title="Picked for you">
              <Text className="meta-text">{`You still need ${picked.left.proteinG} g protein and ${picked.left.kcal.toLocaleString("en-IN")} kcal today`}</Text>
              <RecommendedMeals items={picked.items} />
              <OrderRemindersRow pick={pick} />
            </HomeSection>
          )}

          {/* 4. Minutes trained this week (only with a plan) */}
          {activity && (
            <HomeSection title="This week">
              <WeeklyActivityCard activity={activity} onOpen={() => router.push("/workout")} />
            </HomeSection>
          )}

          {/* 5. Offers and meals to order */}
          {promotions.length > 0 && (
            <View className="mt-6">
              <PromotionCarousel promotions={promotions} width={width} onOpen={open} />
            </View>
          )}

          {/* Popular meals (only when the admin has picked some) */}
          {popularMeals.length > 0 && (
            <View className="mt-6">
              <View className="px-4">
                <SectionHeader title={content.popularHeading} actionLabel={content.popularActionLabel} onAction={() => router.navigate("/meals")} />
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: PAGE_PADDING, paddingTop: 12, paddingBottom: 4, gap: 12 }}
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
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// One Home section: a heading, then its cards with the same gap between them, so every
// section sits the same distance apart
function HomeSection({ title, action, children }: { title: string; action?: string; children: ReactNode }) {
  return (
    <View className="mt-6 px-4">
      <SectionHeader title={title} actionLabel={action} />
      <View className="mt-3" style={{ gap: 12 }}>
        {children}
      </View>
    </View>
  );
}
