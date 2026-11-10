import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/macro/LoadError";
import { StatusPill } from "@/components/meals/OrderParts";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { todayIso } from "@/lib/macro";
import { SLOT_LABEL, dayLabel, isOpen, itemsLine, rupees, timeRange } from "@/lib/mealRules";
import { mealsApi, type Order } from "@/lib/mealsApi";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; orders: Order[] };

// My orders: the ones still on their way first (soonest first), then past ones. A card opens the
// order with its steps. Read again whenever the screen shows, so the admin's steps appear.
export default function Orders() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const read = useCallback(async () => {
    const answer = await mealsApi.orders(await getToken());
    setLoad((current) => (answer.ok ? { state: "ready", orders: answer.data.orders } : current.state === "ready" ? current : { state: "failed", error: answer.error }));
  }, [getToken]);
  useFocusEffect(useCallback(() => { read(); }, [read]));
  const { refreshControl } = usePullToRefresh(read, colors.ink);

  const today = todayIso();
  const orders = load.state === "ready" ? load.orders : [];
  const upcoming = orders.filter((o) => isOpen(o.status)).sort((a, b) => a.date.localeCompare(b.date) || slotRank(a) - slotRank(b));
  const past = orders.filter((o) => !isOpen(o.status));

  const card = (o: Order) => (
    <PressableScale
      key={o.id}
      scaleTo={0.98}
      onPress={() => router.push({ pathname: "/orders/[id]", params: { id: o.id } })}
      className="card"
      style={{ gap: 6 }}
      accessibilityRole="button"
      accessibilityLabel={`${SLOT_LABEL[o.slot]}, ${dayLabel(o.date, today)}, ${itemsLine(o.items)}, ${rupees(o.total)}`}
    >
      <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
        <View className="flex-1">
          <Text className="card__title">{`${SLOT_LABEL[o.slot]} · ${dayLabel(o.date, today)}`}</Text>
          {o.slotStartsAt && o.slotEndsAt && <Text className="meta-text">{timeRange(o.slotStartsAt, o.slotEndsAt)}</Text>}
        </View>
        <StatusPill status={o.status} />
      </View>
      <Text className="type-body text-forest-ink" numberOfLines={2}>{itemsLine(o.items)}</Text>
      <Text className="meta-text">{`${rupees(o.total)} · ${o.totals.calories} kcal · #${o.code}`}</Text>
    </PressableScale>
  );

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title="My orders" fallback="/meals" />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
          {load.state === "loading" && <ScreenSkeleton label="Loading your orders" />}
          {load.state === "failed" && <LoadError tone="meal" title="Orders couldn't load" message={load.error} onRetry={() => { setLoad({ state: "loading" }); read(); }} />}
          {load.state === "ready" && orders.length === 0 && (
            <EmptyState tone="meal" icon={{ ios: "shippingbox", android: "inventory_2", web: "inventory_2" }} title="No orders yet" message="Order a meal and follow it here until it reaches you.">
              <PrimaryButton tone="meal" label="Browse meals" onPress={() => router.navigate("/meals")} />
            </EmptyState>
          )}
          {upcoming.length > 0 && <Text className="type-headline text-forest-ink">On the way</Text>}
          {upcoming.map(card)}
          {past.length > 0 && <Text className="type-headline text-forest-ink" style={{ marginTop: upcoming.length ? 8 : 0 }}>Past orders</Text>}
          {past.map(card)}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const slotRank = (o: Order) => ["breakfast", "lunch", "dinner"].indexOf(o.slot);
