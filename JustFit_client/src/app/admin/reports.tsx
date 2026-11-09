import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { hud } from "@/lib/hud";
import { exportMealReport, issuesApi } from "@/lib/issuesApi";
import { todayIso } from "@/lib/macro";
import { addDays, rupees } from "@/lib/mealRules";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const RANGES = [{ days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 90, label: "90 days" }];
const Row = ({ label, value }: { label: string; value: string | number }) => (
  <View className="flex-row justify-between" style={{ gap: 12 }}>
    <Text className="type-body text-muted flex-1">{label}</Text>
    <Text className="type-body text-forest-ink">{value}</Text>
  </View>
);

// Super Admin › Meals › Reports (Meal Operations phase 6): the last 7 / 30 / 90 days of business
// (revenue, subscription revenue, orders, average order, the busiest days), kitchens (orders,
// preparation time, waste, how full), delivery (delivered, failed, minutes door to door, each
// partner) and subscriptions (started, active, paused, cancelled, meals delivered of made). Export
// saves it as Excel.
export default function AdminReports() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [days, setDays] = useState(30);
  const [exporting, setExporting] = useState(false);
  const running = useRef(false);
  const to = todayIso();
  const from = addDays(to, -(days - 1));
  const load = useCallback((t: string | null) => issuesApi.report(t, from, to), [from, to]);
  const { result, retry, refresh } = useGymData(load);
  const r = result.state === "ready" ? result.data : null;

  const save = async () => {
    if (running.current) return;
    running.current = true;
    setExporting(true);
    const done = await exportMealReport(await getToken(), from, to);
    running.current = false;
    setExporting(false);
    if (!done.ok) hud.error(done.error);
  };
  const busiest = r ? [...r.business.days].sort((a, b) => b.revenue - a.revenue).slice(0, 3) : [];

  return (
    <AdminScreen
      title="Reports"
      onRefresh={refresh}
      headerRight={
        <Pressable onPress={save} disabled={exporting || !r} className="admin-chip" style={{ opacity: exporting || !r ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Export as Excel">
          <Text className="admin-segment__label admin-segment__label--on">{exporting ? "Exporting…" : "Export"}</Text>
        </Pressable>
      }
    >
      <View style={{ gap: 14 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {RANGES.map((x) => {
            const on = days === x.days;
            return (
              <Pressable key={x.days} onPress={() => setDays(x.days)} className={on ? "filter-chip filter-chip--selected" : "filter-chip"} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text className={on ? "filter-chip__label filter-chip__label--selected" : "filter-chip__label"}>{x.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {result.state === "loading" && <ScreenSkeleton label="Loading the report" />}
        {result.state === "failed" && (
          <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the report" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
        )}
        {r && (
          <>
            <View className="card" style={{ gap: 6 }}>
              <Text className="card__title">Business</Text>
              <Row label="Revenue (orders)" value={rupees(r.business.revenue)} />
              {r.business.subscriptionRevenue !== null ? <Row label="Subscription revenue" value={rupees(r.business.subscriptionRevenue)} /> : null}
              <Row label="Orders" value={`${r.business.orders} (${r.business.individualOrders} single · ${r.business.subscriptionOrders} plan)`} />
              <Row label="Average order" value={r.business.averageOrder === null ? "—" : rupees(r.business.averageOrder)} />
              {busiest.map((d) => <Row key={d.day} label={`Busy day ${d.day}`} value={`${d.orders} orders · ${rupees(d.revenue)}`} />)}
            </View>
            {r.kitchens ? (
              <View className="card" style={{ gap: 6 }}>
                <Text className="card__title">Kitchens</Text>
                {r.kitchens.length === 0 ? <Text className="meta-text">No kitchens yet.</Text> : null}
                {r.kitchens.map((k) => (
                  <View key={k.id} style={{ gap: 2 }}>
                    <Text className="type-body text-forest-ink">{k.name}</Text>
                    <Text className="meta-text">{`${k.orders} orders · ${k.delivered} delivered · prep ${k.prepMinutes ?? "—"} min · used ${rupees(k.used)} · wasted ${rupees(k.waste)} · ${k.utilization}% of capacity`}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {r.delivery ? (
              <View className="card" style={{ gap: 6 }}>
                <Text className="card__title">Delivery</Text>
                <Row label="Deliveries" value={r.delivery.total} />
                <Row label="Delivered" value={r.delivery.delivered} />
                <Row label="Failed" value={r.delivery.failed} />
                <Row label="Pick-up to door" value={r.delivery.averageMinutes === null ? "—" : `${r.delivery.averageMinutes} min`} />
                {r.delivery.partners.map((p) => <Row key={p.name} label={p.name} value={`${p.delivered} delivered · ${p.failed} failed`} />)}
              </View>
            ) : null}
            {r.subscriptions ? (
              <View className="card" style={{ gap: 6 }}>
                <Text className="card__title">Subscriptions</Text>
                <Row label="Started" value={r.subscriptions.started} />
                <Row label="Active now" value={r.subscriptions.active} />
                <Row label="Paused now" value={r.subscriptions.paused} />
                <Row label="Cancelled" value={r.subscriptions.cancelled} />
                <Row label="Meals delivered" value={`${r.subscriptions.mealsDelivered} of ${r.subscriptions.mealsMade}${r.subscriptions.utilization === null ? "" : ` (${r.subscriptions.utilization}%)`}`} />
              </View>
            ) : null}
            <Text className="meta-text" style={{ color: colors.muted }}>{`${from} to ${to}, India time. Revenue counts paid orders by the day they were placed.`}</Text>
          </>
        )}
      </View>
    </AdminScreen>
  );
}
