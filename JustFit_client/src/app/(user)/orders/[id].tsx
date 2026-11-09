import { useCallback, useState } from "react";
import { AppState, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { LoadError } from "@/components/macro/LoadError";
import { OrderTimeline, StatusPill } from "@/components/meals/OrderParts";
import { ReportIssueSheet } from "@/components/meals/ReportIssueSheet";
import { ISSUE_CATEGORY_LABEL, ISSUE_STATUS_LABEL, ORDER_CATEGORIES } from "@/data/issues";
import { issuesApi, type Issue } from "@/lib/issuesApi";
import { PressableScale } from "@/components/PressableScale";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { hud } from "@/lib/hud";
import { todayIso } from "@/lib/macro";
import { SLOT_LABEL, dayLabel, rupees, timeRange } from "@/lib/mealRules";
import { mealsApi, type Order } from "@/lib/mealsApi";
import { confirmChoice } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; order: Order };

// One order: where it is (placed → preparing → on the way → delivered), what's in it, where it
// goes, the test payment, and Cancel while it is still only placed; Report a problem (phase 6) and
// what justFit did about it. Read again when the screen or the app comes back to the front, and on a pull.
export default function OrderDetail() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [reporting, setReporting] = useState(false);

  const read = useCallback(async () => {
    const answer = await mealsApi.order(await getToken(), String(id));
    setLoad((current) => (answer.ok ? { state: "ready", order: answer.data.order } : current.state === "ready" ? current : { state: "failed", error: answer.error }));
    // This order's reports (none before the issues migration: the list just stays empty)
    const mine = await issuesApi.mine(await getToken());
    if (mine.ok) setIssues(mine.data.issues.filter((i) => i.orderId === String(id)));
  }, [getToken, id]);
  useFocusEffect(
    useCallback(() => {
      read();
      const sub = AppState.addEventListener("change", (s) => s === "active" && read());
      return () => sub.remove();
    }, [read]),
  );
  const { refreshControl } = usePullToRefresh(read, colors.mealPrimary);

  const cancel = async (order: Order) => {
    if (cancelling) return;
    const sure = await confirmChoice({ title: "Cancel this order?", message: `${SLOT_LABEL[order.slot]} for ${dayLabel(order.date, todayIso())} won't be delivered.`, confirmLabel: "Cancel order", cancelLabel: "Keep order", destructive: true });
    if (!sure) return;
    setCancelling(true);
    setError("");
    const answer = await mealsApi.cancel(await getToken(), order.id);
    setCancelling(false);
    if (!answer.ok) {
      setError(answer.error);
      read();
      return;
    }
    setLoad({ state: "ready", order: answer.data.order });
    hud.success("Order cancelled");
  };

  const order = load.state === "ready" ? load.order : null;
  return (
    <View className="flex-1 meal-page">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title="Order" subtitle={order ? `#${order.code}` : undefined} fallback="/orders" />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 14 }} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
          {load.state === "loading" && <ScreenSkeleton label="Loading the order" />}
          {load.state === "failed" && <LoadError tone="meal" title="This order couldn't load" message={load.error} onRetry={() => { setLoad({ state: "loading" }); read(); }} />}
          {order && (
            <>
              <View className="card" style={{ gap: 14 }}>
                <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
                  <View className="flex-1">
                    <Text className="type-headline text-forest-ink">{`${SLOT_LABEL[order.slot]} · ${dayLabel(order.date, todayIso())}`}</Text>
                    {order.slotStartsAt && order.slotEndsAt && <Text className="meta-text">{`Delivery ${timeRange(order.slotStartsAt, order.slotEndsAt)}`}</Text>}
                  </View>
                  <StatusPill status={order.status} />
                </View>
                {order.status === "cancelled" ? (
                  <Text className="type-body text-muted">
                    {order.cancelledBy === "admin" ? `Cancelled by justFit${order.cancelReason ? `: ${order.cancelReason}` : "."}` : "You cancelled this order."}
                  </Text>
                ) : (
                  <OrderTimeline status={order.status} />
                )}
                {order.status === "delivered" && <Text className="meta-text">Added to your Macro diary.</Text>}
              </View>

              <View className="admin-list">
                {order.items.map((item, i) => (
                  <View key={`${item.name}-${i}`} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"}>
                    <Text className="card__title" style={{ minWidth: 28 }}>{`${item.quantity}×`}</Text>
                    <View className="min-w-0 flex-1">
                      <Text className="card__title" numberOfLines={2}>{item.name}</Text>
                      <Text className="meta-text">{`${item.calories * item.quantity} kcal · ${Math.round(item.proteinG * item.quantity)}g protein`}</Text>
                    </View>
                    <Text className="type-body text-forest-ink">{rupees(item.price * item.quantity)}</Text>
                  </View>
                ))}
                {order.discount > 0 && (
                  <View className="admin-row admin-row--divided">
                    <Text className="type-body text-muted flex-1">{`Coupon ${order.couponCode ?? ""}`.trim()}</Text>
                    <Text className="type-body" style={{ color: colors.mealDark }}>{`− ${rupees(order.discount)}`}</Text>
                  </View>
                )}
                <View className="admin-row admin-row--divided">
                  <Text className="card__title flex-1">Total paid</Text>
                  <Text className="card__title">{rupees(order.total)}</Text>
                </View>
              </View>

              <View className="card" style={{ gap: 4 }}>
                <Text className="type-overline text-muted">Deliver to</Text>
                <Text className="card__title">{order.address.receiverName}</Text>
                <Text className="meta-text">{order.address.line}</Text>
                {order.address.instructions ? <Text className="meta-text">{`Note: ${order.address.instructions}`}</Text> : null}
              </View>

              {order.payment && (
                <View className="card" style={{ gap: 4 }}>
                  <Text className="type-overline text-muted">Payment</Text>
                  <Text className="card__title">Test payment · no money taken</Text>
                  <Text className="meta-text">{`Reference ${order.payment.ref}`}</Text>
                </View>
              )}

              {error ? <FormAlert message={error} /> : null}
              {order.status === "placed" && (
                <PressableScale onPress={() => cancel(order)} disabled={cancelling} className="admin-chip self-center" style={{ paddingHorizontal: 20, opacity: cancelling ? 0.6 : 1 }} accessibilityRole="button">
                  <Text className="admin-segment__label" style={{ color: colors.danger }}>{cancelling ? "Cancelling…" : "Cancel order"}</Text>
                </PressableScale>
              )}
              {order.status === "placed" && <Text className="meta-text text-center">You can cancel until we start preparing it.</Text>}
              {order.status !== "placed" && order.status !== "cancelled" && order.status !== "delivered" && (
                <Text className="meta-text text-center">{"We've started on it, so it can't be cancelled now."}</Text>
              )}
              {issues.map((issue) => (
                <View key={issue.id} className="card" style={{ gap: 4 }}>
                  <Text className="type-overline text-muted">{`Your report ${issue.code} · ${ISSUE_STATUS_LABEL[issue.status]}`}</Text>
                  <Text className="card__title">{ISSUE_CATEGORY_LABEL[issue.category]}</Text>
                  <Text className="meta-text">{issue.description}</Text>
                  {issue.resolutionNote ? <Text className="type-body text-forest-ink">{`justFit: ${issue.resolutionNote}`}</Text> : null}
                  {issue.refund ? <Text className="meta-text">{`Refund of ${rupees(issue.refund)} approved (test mode: no money moves).`}</Text> : null}
                </View>
              ))}
              {order.status !== "placed" && !issues.some((i) => i.status === "open" || i.status === "in_progress") && (
                <PressableScale onPress={() => setReporting(true)} className="self-center" accessibilityRole="button">
                  <Text className="meal-link" style={{ color: colors.danger }}>Report a problem</Text>
                </PressableScale>
              )}
              <PressableScale onPress={() => router.navigate("/meals")} className="self-center" accessibilityRole="button">
                <Text className="meal-link">Order more meals</Text>
              </PressableScale>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      {reporting && load.state === "ready" && (
        <ReportIssueSheet
          target={{ orderId: load.order.id }}
          categories={ORDER_CATEGORIES}
          onSent={(issue) => { setIssues((now) => [issue, ...now]); hud.success("Report sent"); }}
          onClose={() => setReporting(false)}
        />
      )}
    </View>
  );
}
