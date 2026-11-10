import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/macro/LoadError";
import { PressableScale } from "@/components/PressableScale";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { mealImage } from "@/lib/mealsApi";
import { useSessionToken } from "@/lib/session";
import { shortDate, subscriptionLine } from "@/lib/subscriptionRules";
import { subscriptionsApi, type Mine } from "@/lib/subscriptionsApi";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; mine: Mine };

// Profile › My subscriptions (2026-11-10, in the meal page's look): every running meal subscription as
// a photo card (Active / Paused on it, meal time and how many, the dates, meals delivered of all), tap
// to manage; then the
// ones that ended. New ones start from a meal's page (Meal Subscription).
export default function MySubscriptions() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const token = useAuthStore((state) => state.token);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const read = useCallback(async () => {
    const answer = await subscriptionsApi.mine(await getToken());
    setLoad(answer.ok ? { state: "ready", mine: answer.data } : { state: "failed", error: answer.error });
  }, [getToken]);
  useFocusEffect(useCallback(() => { read(); }, [read]));
  const { refreshControl } = usePullToRefresh(read, colors.ink);

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title="My subscriptions" fallback="/profile" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
          {load.state === "loading" && <ScreenSkeleton label="Loading your subscriptions" />}
          {load.state === "failed" && <LoadError tone="meal" title="Your subscriptions couldn't load" message={load.error} onRetry={read} />}
          {load.state === "ready" && load.mine.active.length === 0 && (
            <EmptyState tone="meal" icon={{ ios: "arrow.triangle.2.circlepath", android: "autorenew", web: "autorenew" }} title="No subscriptions yet" message="Open any meal and choose Meal Subscription to get it every day, for less.">
              <PressableScale haptic="select" onPress={() => router.replace("/meals")} className="shop-add self-center" accessibilityRole="button">
                <Text className="shop-add__label">Browse meals</Text>
              </PressableScale>
            </EmptyState>
          )}
          {load.state === "ready" &&
            load.mine.active.map((sub) => {
              const share = sub.mealsTotal > 0 ? Math.min(1, sub.mealsUsed / sub.mealsTotal) : 0;
              return (
                <PressableScale key={sub.id} scaleTo={0.98} onPress={() => router.push({ pathname: "/meals/subscriptions/[id]", params: { id: sub.id } })} className="shop-card" accessibilityRole="button" accessibilityLabel={`${sub.planName}, ${subscriptionLine(sub)}. Manage`}>
                  <View style={{ width: "100%", aspectRatio: 2.4, backgroundColor: colors.creamDeep }}>
                    {sub.meal?.imageUrl ? <Image source={mealImage(sub.meal.imageUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} /> : (
                      <View className="flex-1 items-center justify-center"><SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={28} tintColor={colors.faint} /></View>
                    )}
                    <View className={sub.pausedNow ? "shop-badge" : "shop-badge shop-badge--deal"}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: sub.pausedNow ? colors.warning : colors.primaryBright }} />
                      <Text className={sub.pausedNow ? "shop-badge__label" : "shop-badge__label shop-badge__label--deal"}>{sub.pausedNow ? "Paused" : "Active"}</Text>
                    </View>
                  </View>
                  <View style={{ padding: 14, gap: 10 }}>
                    <View style={{ gap: 2 }}>
                      <Text className="meal-section__title" numberOfLines={1}>{sub.planName}</Text>
                      <Text className="meta-text">{`${subscriptionLine(sub)} · ${shortDate(sub.startsOn)} – ${shortDate(sub.endsOn)}`}</Text>
                    </View>
                    <View style={{ gap: 6 }}>
                      <View className="flex-row justify-between">
                        <Text className="meta-text">{`${sub.mealsUsed} of ${sub.mealsTotal} delivered`}</Text>
                        <Text className="meta-text">{`${sub.mealsLeft} left`}</Text>
                      </View>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.creamTab, overflow: "hidden" }}>
                        <View style={{ height: 6, width: `${Math.round(share * 100)}%`, backgroundColor: colors.mealPrimary }} />
                      </View>
                    </View>
                  </View>
                </PressableScale>
              );
            })}
          {load.state === "ready" && load.mine.past.length > 0 && (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Text className="meal-section__title">Ended</Text>
              {load.mine.past.map((p) => (
                <View key={p.id} className="card" style={{ gap: 2, paddingVertical: 12 }}>
                  <Text className="card__title" numberOfLines={1}>{p.planName}</Text>
                  <Text className="meta-text">{`${subscriptionLine(p)} · ${shortDate(p.startsOn)} – ${shortDate(p.endsOn)} · ${p.status === "cancelled" ? "Cancelled" : "Completed"} · ${p.mealsUsed} delivered`}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
