import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { OrderTimelineSheet } from "@/components/admin/OrderTimelineSheet";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { StatusPill } from "@/components/meals/OrderParts";
import { PressableScale } from "@/components/PressableScale";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { hud } from "@/lib/hud";
import { todayIso } from "@/lib/macro";
import { DELIVERY_STEP_LABEL, FAILURE_LABEL, NEXT_DELIVERY_LABEL } from "@/data/delivery";
import { deliveryApi } from "@/lib/deliveryApi";
import { kitchensApi, type Kitchen } from "@/lib/kitchensApi";
import { LEGACY_NEXT_STEP_LABEL, MEAL_SLOTS, NEXT_STEP_LABEL, SLOT_LABEL, addDays, dayLabel, directionsUrl, isOpen, rupees, timeRange } from "@/lib/mealRules";
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
const STATUS_TEXT: Record<string, string> = { accepted: "Accepted", preparing: "Preparing", quality_check: "Quality checked", ready: "Ready for pickup", out_for_delivery: "Out for delivery" };
const OVERRIDE_REASONS = ["Stock arriving before cooking", "The count was wrong", "Using a substitute"];

// Super Admin › Orders: the admin is the kitchen and the delivery person. One day at a time
// (today by default, ‹ › to move), grouped by meal time. Each order shows who, where (Call,
// Directions), what, and one big button for its next step: Start preparing → Out for delivery →
// Mark delivered (which logs it into the member's Macro diary). Meals and delivery times are in
// the header. Since phase 3 (orders through kitchens): a row of kitchen chips filters the day
// (`?kitchen=` opens on one), each card names its kitchen, the steps are Accept → Start preparing →
// Quality check done → Ready for pickup → Out for delivery → Mark delivered, Reject before cooking,
// a stock override with a reason when the kitchen is short, and ⋯ for Change kitchen and Timeline.
// Phase 4 (deliveries): from preparing on, Assign partner (the best free one) or Pick one; then the
// partner's steps (accepted → at the kitchen → picked up → out for delivery → at the customer →
// delivered), Failed with a reason, and Retry or Cancel after a failure.
export default function AdminOrders() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const today = todayIso();
  const params = useLocalSearchParams<{ kitchen?: string }>();
  const [day, setDay] = useState(today);
  const [kitchen, setKitchen] = useState<number | "none" | null>(params.kitchen ? (params.kitchen === "none" ? "none" : Number(params.kitchen)) : null);
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  const [timeline, setTimeline] = useState<{ id: string; code: string } | null>(null);
  // Opened again with another ?kitchen= (the tab stays mounted): follow it
  const [seenParam, setSeenParam] = useState(params.kitchen);
  if (params.kitchen !== seenParam) {
    setSeenParam(params.kitchen);
    if (params.kitchen) setKitchen(params.kitchen === "none" ? "none" : Number(params.kitchen));
  }
  const [filter, setFilter] = useState<Filter>("todo");
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback((token: string | null) => kitchenApi.orders(token, day, kitchen), [day, kitchen]);
  const { result, retry, refreshing, refresh, update, reload } = useGymData(load);
  const viaKitchens = result.state === "ready" && result.data.kitchens === true;
  const viaDelivery = result.state === "ready" && result.data.deliveries === true;
  useEffect(() => {
    if (!viaKitchens) return;
    (async () => {
      const answer = await kitchensApi.list(await getToken(), {});
      if (answer.ok) setKitchens(answer.data.kitchens);
    })();
  }, [viaKitchens, getToken]);

  const replace = (order: Order) =>
    update((data) => {
      const orders = data.orders.map((o) => (o.id === order.id ? { ...o, ...order } : o));
      const counts: Record<string, number> = { all: orders.length };
      for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1;
      return { ...data, orders, counts };
    });

  const advance = async (order: Order, override?: { note: string }) => {
    if (busyId) return;
    setBusyId(order.id);
    const answer = await kitchenApi.advance(await getToken(), order.id, order.status, override);
    setBusyId(null);
    if (!answer.ok) {
      // The kitchen is short of an ingredient: start anyway only with a reason
      if (answer.status === 409 && answer.error.startsWith("Not enough") && !override) {
        showActions({
          title: "Start without enough stock?",
          message: answer.error,
          actions: OVERRIDE_REASONS.map((note) => ({ label: note, onPress: () => void advance(order, { note }) })),
        });
        return;
      }
      hud.error(answer.error);
      reload();
      return;
    }
    replace(answer.data.order);
    const next = answer.data.order.status;
    hud.success(next === "delivered" ? (answer.data.macroLogged === false ? "Delivered" : "Delivered · added to Macro") : STATUS_TEXT[next] ?? "Saved");
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

  // Phase 4: a delivery partner for an order (none picked: the best free one), its steps, a failure
  const deliveryCall = async (order: Order, call: (token: string | null) => Promise<{ ok: true; data: { order: Order; macroLogged?: boolean | null } } | { ok: false; error: string }>, success: string) => {
    if (busyId) return;
    setBusyId(order.id);
    const answer = await call(await getToken());
    setBusyId(null);
    if (!answer.ok) {
      hud.error(answer.error);
      reload();
      return;
    }
    replace(answer.data.order);
    hud.success(answer.data.order.status === "delivered" && answer.data.macroLogged !== false ? "Delivered · added to Macro" : success);
  };
  const pickPartner = async (order: Order) => {
    const answer = await deliveryApi.board(await getToken());
    if (!answer.ok) return hud.error(answer.error);
    const free = answer.data.partners.filter((p) => p.active && p.available && p.idStatus === "verified" && p.id !== order.delivery?.partner?.id);
    if (free.length === 0) return hud.error("No partner is available right now");
    showActions({
      title: "Give it to",
      actions: free.map((p) => ({
        label: `${p.name} · carrying ${p.carrying}/${p.maxOrders}`,
        onPress: () => void deliveryCall(order, (t) => kitchenApi.assignDelivery(t, order.id, p.id), `Given to ${p.name}`),
      })),
    });
  };
  const failDelivery = (order: Order) =>
    showActions({
      title: "Why did the delivery fail?",
      actions: (["customer_unavailable", "wrong_address", "customer_rejected", "partner_issue"] as const).map((reason) => ({
        label: FAILURE_LABEL[reason],
        destructive: true,
        onPress: () => void deliveryCall(order, (t) => kitchenApi.failDelivery(t, order.id, reason), "Marked as failed"),
      })),
    });

  const moveKitchen = (order: Order) =>
    showActions({
      title: "Move to which kitchen?",
      message: order.kitchen?.name ? `Now: ${order.kitchen.name}` : "It has no kitchen yet.",
      actions: kitchens.filter((k) => k.id !== order.kitchen?.id && k.status === "active").map((k) => ({
        label: k.name,
        onPress: async () => {
          setBusyId(order.id);
          const answer = await kitchenApi.changeKitchen(await getToken(), order.id, k.id);
          setBusyId(null);
          if (!answer.ok) return hud.error(answer.error);
          replace(answer.data.order);
          hud.success(`Moved to ${k.name}`);
        },
      })),
    });
  const more = (order: Order) =>
    showActions({
      title: `Order #${order.code}`,
      actions: [
        ...(order.status === "placed" || order.status === "accepted" ? [{ label: "Change kitchen", onPress: () => moveKitchen(order) }] : []),
        { label: "Timeline", onPress: () => setTimeline({ id: order.id, code: order.code }) },
      ],
    });

  const open = (url: string | null, what: string) => {
    if (!url) return;
    Linking.openURL(url).catch(() => hud.error(`Couldn't open ${what}`));
  };

  const data = result.state === "ready" ? result.data : null;
  const shown = (data?.orders ?? []).filter((o) => (filter === "all" ? true : filter === "todo" ? isOpen(o.status) : o.status === filter));
  const countOf = (f: Filter) => (data ? (f === "all" ? data.orders.length : data.orders.filter((o) => (f === "todo" ? isOpen(o.status) : o.status === f)).length) : 0);

  const card = (o: Order) => {
    const d = o.delivery ?? null;
    // With a partner on it, leaving and delivering are the delivery's steps, not the kitchen's
    const partnerHasIt = viaDelivery && !!d && d.status !== "failed";
    const next = partnerHasIt && (o.status === "ready" || o.status === "out_for_delivery") ? undefined : (viaKitchens ? NEXT_STEP_LABEL : LEGACY_NEXT_STEP_LABEL)[o.status];
    const deliveryNext = d ? NEXT_DELIVERY_LABEL[d.status] : undefined;
    const showDelivery = viaDelivery && (["preparing", "quality_check", "ready", "out_for_delivery", "failed"].includes(o.status) || !!d);
    const beforeCooking = o.status === "placed" || o.status === "accepted";
    const busy = busyId === o.id;
    return (
      <View key={o.id} className="card" style={{ gap: 10 }}>
        <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
          <View className="min-w-0 flex-1">
            <Text className="card__title" numberOfLines={1}>{o.address.receiverName ?? o.memberName ?? "Member"}</Text>
            <Text className="meta-text">{`#${o.code} · ${rupees(o.total)} · ${o.payment?.method === "razorpay" ? "paid" : "test payment"}`}</Text>
            {viaKitchens ? <Text className="meta-text" numberOfLines={1}>{o.kitchen?.name ? `Kitchen: ${o.kitchen.name}` : "No kitchen"}</Text> : null}
          </View>
          <StatusPill status={o.status} />
          {viaKitchens ? (
            <Pressable onPress={() => more(o)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`More for order ${o.code}`}>
              <SymbolView name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }} size={18} tintColor={colors.ink} />
            </Pressable>
          ) : null}
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
        {showDelivery && (
          <View className="rounded-md p-3" style={{ backgroundColor: colors.creamDeep, gap: 8 }}>
            <Text className="meta-text" style={{ color: colors.ink }}>
              {!d ? "No delivery partner yet" : d.status === "failed" ? `Delivery failed: ${d.failureReason ? FAILURE_LABEL[d.failureReason] : ""}${d.failureNote ? ` · ${d.failureNote}` : ""}` : `${d.partner?.name ?? "Partner"} · ${DELIVERY_STEP_LABEL[d.status]}${d.attempts > 1 ? ` · try ${d.attempts}` : ""}`}
            </Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {(!d || d.status === "failed") && o.status !== "cancelled" ? (
                <>
                  <Pressable onPress={() => deliveryCall(o, (t) => kitchenApi.assignDelivery(t, o.id), d ? "Sent out again" : "Partner assigned")} disabled={busy} className="admin-chip admin-chip--on" accessibilityRole="button">
                    <Text className="admin-segment__label admin-segment__label--on">{d ? "Retry delivery" : "Assign partner"}</Text>
                  </Pressable>
                  <Pressable onPress={() => pickPartner(o)} disabled={busy} className="admin-chip" accessibilityRole="button">
                    <Text className="admin-segment__label">Pick partner</Text>
                  </Pressable>
                </>
              ) : null}
              {d && deliveryNext ? (
                <Pressable onPress={() => deliveryCall(o, (t) => kitchenApi.advanceDelivery(t, o.id, d.status), DELIVERY_STEP_LABEL[d.status])} disabled={busy} className="btn-forest flex-1" style={{ minHeight: 40, opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={`${deliveryNext} for order ${o.code}`}>
                  <Text className="btn-forest__label">{busy ? "Saving…" : deliveryNext}</Text>
                </Pressable>
              ) : null}
              {d && ["assigned", "accepted", "at_kitchen"].includes(d.status) ? (
                <Pressable onPress={() => pickPartner(o)} disabled={busy} className="admin-chip" accessibilityRole="button">
                  <Text className="admin-segment__label">Change partner</Text>
                </Pressable>
              ) : null}
              {d && deliveryNext ? (
                <Pressable onPress={() => failDelivery(o)} disabled={busy} className="admin-chip" accessibilityRole="button">
                  <Text className="admin-segment__label" style={{ color: colors.danger }}>Failed</Text>
                </Pressable>
              ) : null}
              {o.status === "failed" ? (
                <Pressable onPress={() => cancel(o)} disabled={busy} className="admin-chip" accessibilityRole="button">
                  <Text className="admin-segment__label" style={{ color: colors.danger }}>Cancel order</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
        {o.status === "cancelled" && o.cancelReason ? <Text className="meta-text">{`${o.cancelledBy === "member" ? "Member cancelled" : o.cancelledBy === "system" ? "Cancelled" : "You cancelled"}: ${o.cancelReason}`}</Text> : null}
        {o.status === "cancelled" && !o.cancelReason ? <Text className="meta-text">{o.cancelledBy === "member" ? "The member cancelled." : "Cancelled."}</Text> : null}
        {next && (
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <PressableScale haptic="tap" onPress={() => advance(o)} disabled={busy} className="btn-forest flex-1" style={{ opacity: busy ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={`${next} for order ${o.code}`}>
              <Text className="btn-forest__label">{busy ? "Saving…" : next}</Text>
            </PressableScale>
            <Pressable onPress={() => cancel(o)} disabled={busy} hitSlop={8} className="admin-chip" accessibilityRole="button" accessibilityLabel={`Cancel order ${o.code}`}>
              <Text className="admin-segment__label" style={{ color: colors.danger }}>{viaKitchens && beforeCooking ? "Reject" : "Cancel"}</Text>
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

          {viaKitchens && kitchens.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {([{ id: null, name: "All kitchens" }, ...kitchens.map((k) => ({ id: k.id as number | "none", name: k.name })), { id: "none" as const, name: "No kitchen" }] as { id: number | "none" | null; name: string }[]).map((k) => {
                const on = kitchen === k.id;
                return (
                  <PressableScale key={String(k.id)} haptic="select" onPress={() => setKitchen(k.id)} className={on ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Text className={on ? "admin-segment__label admin-segment__label--on" : "admin-segment__label"} numberOfLines={1}>{k.name}</Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          ) : null}

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
      {timeline && <OrderTimelineSheet orderId={timeline.id} code={timeline.code} onClose={() => setTimeline(null)} />}
    </View>
  );
}
