import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { KITCHEN_STATUSES, KITCHEN_STATUS_LABEL } from "@/data/kitchens";
import { hud } from "@/lib/hud";
import { loadText } from "@/lib/kitchenRules";
import { exportOrdersReport, kitchensApi } from "@/lib/kitchensApi";
import { todayIso } from "@/lib/macro";
import { MEAL_SLOTS, SLOT_LABEL, addDays, dayLabel, rupees } from "@/lib/mealRules";
import { useResponsive } from "@/lib/responsive";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";
import type { Icon } from "@/types/profile";

type Stat = { label: string; value: string | number; icon: Icon; tone?: "danger" | "warning"; href?: Href };

// Super Admin › Meal operations (Meal Operations phase 1, 2026-11-10): one India day at a time (a
// year back to a week ahead): the day's orders by step and meal time, delayed ones, revenue from
// orders paid that day, how full the active kitchens are, kitchens by status and the next six days'
// scheduled orders; Export saves the day's orders as an Excel file. Delivery partners, subscriptions
// and stock join it with their phases (MEAL-OPERATIONS-PLAN.md).
export default function MealOps() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { compact } = useResponsive();
  const today = todayIso();
  const [day, setDay] = useState(today);
  const [exporting, setExporting] = useState(false);
  const running = useRef(false);
  const load = useCallback((token: string | null) => kitchensApi.dashboard(token, day), [day]);
  const { result, retry, refresh } = useGymData(load);
  const data = result.state === "ready" ? result.data : null;

  const exportDay = async () => {
    if (running.current) return;
    running.current = true;
    setExporting(true);
    const done = await exportOrdersReport(await getToken(), day);
    running.current = false;
    setExporting(false);
    if (!done.ok) hud.error(done.error);
  };

  const stats: Stat[] = data
    ? [
        { label: `Orders ${dayLabel(day, today).toLowerCase()}`, value: data.orders.total, icon: { ios: "bag", android: "shopping_bag", web: "shopping_bag" }, href: "/admin/orders" },
        { label: "Revenue (paid that day)", value: rupees(data.revenue.amount), icon: { ios: "indianrupeesign.circle", android: "currency_rupee", web: "currency_rupee" } },
        { label: "New", value: data.orders.steps.placed, icon: { ios: "tray.and.arrow.down", android: "move_to_inbox", web: "move_to_inbox" }, href: "/admin/orders" },
        { label: "Preparing", value: data.orders.steps.preparing, icon: { ios: "flame", android: "local_fire_department", web: "local_fire_department" }, href: "/admin/orders" },
        { label: "Out for delivery", value: data.orders.steps.out_for_delivery, icon: { ios: "bicycle", android: "pedal_bike", web: "pedal_bike" }, href: "/admin/orders" },
        { label: "Delivered", value: data.orders.steps.delivered, icon: { ios: "checkmark.circle", android: "check_circle", web: "check_circle" } },
        { label: "Cancelled", value: data.orders.steps.cancelled, icon: { ios: "xmark.circle", android: "cancel", web: "cancel" } },
        { label: "Delayed", value: data.orders.delayed, icon: { ios: "clock.badge.exclamationmark", android: "running_with_errors", web: "running_with_errors" }, tone: data.orders.delayed > 0 ? "danger" : undefined, href: "/admin/orders" },
        { label: "Active kitchens", value: data.kitchens.counts.active, icon: { ios: "frying.pan", android: "skillet", web: "skillet" }, href: "/admin/kitchens" },
      ]
    : [];

  return (
    <AdminScreen
      title="Meal operations"
      subtitle={new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
      onRefresh={refresh}
      headerRight={
        <Pressable onPress={exportDay} disabled={exporting || !data} hitSlop={8} className="admin-chip flex-row" style={{ gap: 4, opacity: exporting || !data ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Export the day's orders as Excel">
          <SymbolView name={{ ios: "square.and.arrow.up", android: "ios_share", web: "ios_share" }} size={14} tintColor={colors.primaryText} />
          <Text className="admin-segment__label admin-segment__label--on">{exporting ? "Exporting…" : "Export"}</Text>
        </Pressable>
      }
    >
      <View style={{ gap: 14 }}>
        <View className="flex-row items-center card" style={{ paddingVertical: 8, paddingHorizontal: 8 }}>
          <Pressable onPress={() => setDay(addDays(day, -1))} disabled={day <= addDays(today, -365)} hitSlop={8} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Previous day">
            <SymbolView name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} size={18} tintColor={colors.ink} />
          </Pressable>
          <Pressable onPress={() => setDay(today)} className="flex-1 items-center" accessibilityRole="button" accessibilityLabel="Go to today">
            <Text className="card__title">{dayLabel(day, today)}</Text>
            {day !== today ? <Text className="meta-text">Tap for today</Text> : null}
          </Pressable>
          <Pressable onPress={() => setDay(addDays(day, 1))} disabled={day >= addDays(today, 6)} hitSlop={8} className="screen-bar__back" style={{ opacity: day >= addDays(today, 6) ? 0.3 : 1 }} accessibilityRole="button" accessibilityLabel="Next day">
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={18} tintColor={colors.ink} />
          </Pressable>
        </View>

        {result.state === "loading" && <ScreenSkeleton label="Loading the day" />}
        {result.state === "failed" && (
          <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the dashboard" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
        )}
        {data && (
          <>
            <View className="flex-row flex-wrap" style={{ gap: 10 }}>
              {stats.map((s) => (
                <Pressable
                  key={s.label}
                  onPress={s.href ? () => router.push(s.href as Href) : undefined}
                  disabled={!s.href}
                  className={[compact ? "admin-stat admin-stat--half" : "admin-stat", s.tone === "danger" ? "admin-stat--danger" : ""].join(" ").trim()}
                  accessibilityRole={s.href ? "button" : undefined}
                  accessibilityLabel={`${s.label}: ${s.value}`}
                >
                  <SymbolView name={s.icon} size={18} tintColor={s.tone === "danger" ? colors.danger : colors.forestInk} />
                  <Text className="admin-stat__label" numberOfLines={2}>{s.label}</Text>
                  <Text className="admin-stat__value" numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
                </Pressable>
              ))}
            </View>

            <View className="card" style={{ gap: 8 }}>
              <Text className="card__title">By meal time</Text>
              {MEAL_SLOTS.map((slot) => (
                <View key={slot} className="flex-row justify-between">
                  <Text className="type-body text-muted">{SLOT_LABEL[slot]}</Text>
                  <Text className="type-body text-forest-ink">{`${data.orders.bySlot[slot]} ${data.orders.bySlot[slot] === 1 ? "order" : "orders"}`}</Text>
                </View>
              ))}
            </View>

            <Pressable onPress={() => router.push("/admin/kitchens")} className="card" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel="Kitchens">
              <View className="flex-row items-center">
                <Text className="card__title flex-1">Kitchens</Text>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.muted} />
              </View>
              {data.kitchens.counts.all === 0 ? (
                <Text className="meta-text">No kitchens yet. Add one to start.</Text>
              ) : (
                <>
                  {KITCHEN_STATUSES.map((s) => (
                    <View key={s} className="flex-row justify-between">
                      <Text className="type-body text-muted">{KITCHEN_STATUS_LABEL[s]}</Text>
                      <Text className="type-body text-forest-ink">{data.kitchens.counts[s]}</Text>
                    </View>
                  ))}
                  <Text className="meta-text">
                    {data.kitchens.activeCapacity > 0
                      ? `Active kitchens can take ${data.kitchens.activeCapacity} orders a day${loadText(data.kitchens.load) ? ` · ${loadText(data.kitchens.load)}` : ""}`
                      : "No active kitchen right now."}
                  </Text>
                </>
              )}
            </Pressable>

            <View className="card" style={{ gap: 8 }}>
              <Text className="card__title">Coming up</Text>
              {data.upcoming.length === 0 ? (
                <Text className="meta-text">No orders scheduled for the next six days.</Text>
              ) : (
                data.upcoming.map((u) => (
                  <View key={u.date} className="flex-row justify-between">
                    <Text className="type-body text-muted">{dayLabel(u.date, today)}</Text>
                    <Text className="type-body text-forest-ink">{`${u.orders} ${u.orders === 1 ? "order" : "orders"}`}</Text>
                  </View>
                ))
              )}
            </View>
            <Text className="meta-text">Delivery partners, meal subscriptions and stock join this dashboard as they are built.</Text>
          </>
        )}
      </View>
    </AdminScreen>
  );
}
