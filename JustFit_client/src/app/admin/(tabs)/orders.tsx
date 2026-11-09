import { useCallback, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";

import { DashedBlock } from "@/components/macro/DashedBlock";
import { StatusPill } from "@/components/meals/OrderParts";
import { PressableScale } from "@/components/PressableScale";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { hud } from "@/lib/hud";
import { todayIso } from "@/lib/macro";
import { MEAL_SLOTS, NEXT_STEP_LABEL, SLOT_LABEL, addDays, dayLabel, directionsUrl, isOpen, rupees, timeRange } from "@/lib/mealRules";
import { kitchenApi, type Order } from "@/lib/mealsApi";
import { showActions } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Filter = "todo" | "delivered" | "cancelled" | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];
const CANCEL_REASONS = ["Out of stock today", "Can't deliver to this address", "The member asked to cancel", "Kitchen closed today"];

// Super Admin › Orders: the admin is the kitchen and the delivery person. One day at a time
// (today by default, ‹ › to move), grouped by meal time. Each order shows who, where (Call,
// Directions), what, and one big button for its next step: Start preparing → Out for delivery →
// Mark delivered (which logs it into the member's Macro diary). Meals and delivery times are in
// the header.
export default function AdminOrders() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const today = todayIso();
  const [day, setDay] = useState(today);
  const [filter, setFilter] = useState<Filter>("todo");
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback((token: string | null) => kitchenApi.orders(token, day), [day]);
  const { result, retry, refreshing, refresh, update, reload } = useGymData(load);

  const replace = (order: Order) =>
    update((data) => {
      const orders = data.orders.map((o) => (o.id === order.id ? { ...o, ...order } : o));
      const counts: Record<string, number> = { all: orders.length };
      for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1;
      return { ...data, orders, counts };
    });

  const advance = async (order: Order) => {
    if (busyId) return;
    setBusyId(order.id);
    const answer = await kitchenApi.advance(await getToken(), order.id, order.status);
    setBusyId(null);
    if (!answer.ok) {
      hud.error(answer.error);
      reload();
      return;
    }
    replace(answer.data.order);
    const next = answer.data.order.status;
    hud.success(next === "delivered" ? (answer.data.macroLogged === false ? "Delivered" : "Delivered · added to Macro") : next === "preparing" ? "Preparing" : "Out for delivery");
  };

  const cancel = (order: Order) =>
    showActions({
      title: `Cancel order #${order.code}?`,
      message: "Pick the reason the member will see.",
      actions: CANCEL_REASONS.map((reason) => ({
        label: reason,
        destructive: true,
        onPress: async () => {
          setBusyId(order.id);
          const answer = await kitchenApi.cancel(await getToken(), order.id, reason);
          setBusyId(null);
          if (!answer.ok) {
            hud.error(answer.error);
            reload();
            return;
          }
          replace(answer.data.order);
          hud.success("Order cancelled");
        },
      })),
    });

  const open = (url: string | null, what: string) => {
    if (!url) return;
    Linking.openURL(url).catch(() => hud.error(`Couldn't open ${what}`));
  };

  const data = result.state === "ready" ? result.data : null;
  const shown = (data?.orders ?? []).filter((o) => (filter === "all" ? true : filter === "todo" ? isOpen(o.status) : o.status === filter));
  const countOf = (f: Filter) => (data ? (f === "all" ? data.orders.length : data.orders.filter((o) => (f === "todo" ? isOpen(o.status) : o.status === f)).length) : 0);

  const card = (o: Order) => {
    const next = NEXT_STEP_LABEL[o.status];
    const busy = busyId === o.id;
    return (
      <View key={o.id} className="card" style={{ gap: 10 }}>
        <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
          <View className="min-w-0 flex-1">
            <Text className="card__title" numberOfLines={1}>{o.address.receiverName ?? o.memberName ?? "Member"}</Text>
            <Text className="meta-text">{`#${o.code} · ${rupees(o.total)} · ${o.payment?.method === "razorpay" ? "paid" : "test payment"}`}</Text>
          </View>
          <StatusPill status={o.status} />
        </View>
        <View style={{ gap: 2 }}>
          {o.items.map((item, i) => (
            <Text key={`${item.name}-${i}`} className="type-body text-forest-ink">{`${item.quantity} × ${item.name}`}</Text>
          ))}
        </View>
        <View className="rounded-md p-3" style={{ backgroundColor: colors.creamDeep, gap: 2 }}>
          <Text className="meta-text" style={{ color: colors.ink }}>{o.address.line}</Text>
          {o.address.instructions ? <Text className="meta-text">{`Note: ${o.address.instructions}`}</Text> : null}
        </View>
        <View className="flex-row" style={{ gap: 8 }}>
          {o.address.receiverPhone ? (
            <PressableScale onPress={() => open(`tel:${o.address.receiverPhone}`, "the phone app")} className="admin-chip flex-1 flex-row" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel={`Call ${o.address.receiverName ?? "the member"}`}>
              <SymbolView name={{ ios: "phone.fill", android: "call", web: "call" }} size={15} tintColor={colors.leaf} />
              <Text className="admin-segment__label admin-segment__label--on">Call</Text>
            </PressableScale>
          ) : null}
          <PressableScale onPress={() => open(directionsUrl(o.address), "maps")} className="admin-chip flex-1 flex-row" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Directions">
            <SymbolView name={{ ios: "map.fill", android: "map", web: "map" }} size={15} tintColor={colors.leaf} />
            <Text className="admin-segment__label admin-segment__label--on">Directions</Text>
          </PressableScale>
        </View>
        {o.status === "cancelled" && o.cancelReason ? <Text className="meta-text">{`${o.cancelledBy === "member" ? "Member cancelled" : o.cancelledBy === "system" ? "Cancelled" : "You cancelled"}: ${o.cancelReason}`}</Text> : null}
        {o.status === "cancelled" && !o.cancelReason ? <Text className="meta-text">{o.cancelledBy === "member" ? "The member cancelled." : "Cancelled."}</Text> : null}
        {next && (
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <PressableScale haptic="tap" onPress={() => advance(o)} disabled={busy} className="btn-forest flex-1" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={`${next} for order ${o.code}`}>
              <Text className="btn-forest__label">{busy ? "Saving…" : next}</Text>
            </PressableScale>
            <Pressable onPress={() => cancel(o)} disabled={busy} hitSlop={8} className="admin-chip" accessibilityRole="button" accessibilityLabel={`Cancel order ${o.code}`}>
              <Text className="admin-segment__label" style={{ color: colors.danger }}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 110, gap: 14 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} progressBackgroundColor={colors.surface} />}
        >
          <View className="flex-row items-end px-4 pt-2" style={{ gap: 8 }}>
            <View className="flex-1">
              <Text className="type-overline text-muted">justFit kitchen</Text>
              <Text className="type-title text-forest-ink">Orders</Text>
            </View>
            <Pressable onPress={() => router.push("/admin/meal-ops")} className="admin-chip flex-row" style={{ minHeight: 40, gap: 6 }} accessibilityRole="button" accessibilityLabel="Meal operations dashboard">
              <SymbolView name={{ ios: "chart.bar", android: "bar_chart", web: "bar_chart" }} size={14} tintColor={colors.primaryText} />
              <Text className="admin-segment__label admin-segment__label--on">Dashboard</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/admin/meals")} className="btn-forest" style={{ minHeight: 40, paddingHorizontal: 16 }} accessibilityRole="button" accessibilityLabel="Meals and delivery times">
              <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={14} tintColor={colors.onPrimary} />
              <Text className="btn-forest__label">Meals</Text>
            </Pressable>
          </View>

          {/* The day */}
          <View className="mx-4 flex-row items-center card" style={{ paddingVertical: 8, paddingHorizontal: 8 }}>
            <Pressable onPress={() => setDay(addDays(day, -1))} disabled={day <= addDays(today, -365)} hitSlop={8} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Previous day">
              <SymbolView name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} size={18} tintColor={colors.ink} />
            </Pressable>
            <Pressable onPress={() => setDay(today)} className="flex-1 items-center" accessibilityRole="button" accessibilityLabel="Go to today">
              <Text className="card__title">{dayLabel(day, today)}</Text>
              <Text className="meta-text">{new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</Text>
            </Pressable>
            <Pressable onPress={() => setDay(addDays(day, 1))} disabled={day >= addDays(today, 6)} hitSlop={8} className="screen-bar__back" style={{ opacity: day >= addDays(today, 6) ? 0.3 : 1 }} accessibilityRole="button" accessibilityLabel="Next day">
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={18} tintColor={colors.ink} />
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {FILTERS.map((f) => {
              const on = f.value === filter;
              return (
                <PressableScale key={f.value} haptic="select" onPress={() => setFilter(f.value)} className={on ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text className={on ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"}>{`${f.label} · ${countOf(f.value)}`}</Text>
                </PressableScale>
              );
            })}
          </ScrollView>

          <View className="px-4" style={{ gap: 12 }}>
            {result.state === "loading" && <ScreenSkeleton label="Loading orders" />}
            {result.state === "failed" && (
              <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load orders" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
            )}
            {data && shown.length === 0 && (
              <DashedBlock
                icon={{ ios: "bag", android: "shopping_bag", web: "shopping_bag" }}
                title={data.orders.length === 0 ? `No orders for ${dayLabel(day, today).toLowerCase()}` : "Nothing here"}
                text={data.orders.length === 0 ? "Orders members place for this day show here, by meal time." : "Try another filter."}
                onPress={refresh}
              />
            )}
            {data &&
              MEAL_SLOTS.map((slot) => {
                const list = shown.filter((o) => o.slot === slot);
                if (list.length === 0) return null;
                const first = list[0];
                return (
                  <View key={slot} style={{ gap: 10 }}>
                    <View className="flex-row items-baseline" style={{ gap: 8 }}>
                      <Text className="type-headline text-forest-ink">{SLOT_LABEL[slot]}</Text>
                      <Text className="meta-text">{`${first.slotStartsAt && first.slotEndsAt ? `${timeRange(first.slotStartsAt, first.slotEndsAt)} · ` : ""}${list.length} ${list.length === 1 ? "order" : "orders"}`}</Text>
                    </View>
                    {list.map(card)}
                  </View>
                );
              })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
