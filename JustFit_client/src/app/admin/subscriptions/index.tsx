import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { hud } from "@/lib/hud";
import { addDays } from "@/lib/mealRules";
import { todayIso } from "@/lib/macro";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { subscriptionsApi } from "@/lib/subscriptionsApi";
import { useThemeColors } from "@/theme";

const FILTERS = [
  { value: null, label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "expiring", label: "Ending in 3 days" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;
const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

// Super Admin › Meals › Subscriptions (Meal Operations phase 5): every member's meal plan, filtered
// and searched by member, number or plan; Plans edits what's offered; "Make tomorrow's orders" runs
// the generator now (it also runs every hour). A row opens the subscription and its actions.
export default function AdminSubscriptions() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [status, setStatus] = useState<(typeof FILTERS)[number]["value"]>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [making, setMaking] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const load = useCallback((t: string | null) => subscriptionsApi.adminList(t, status, query), [status, query]);
  const { result, retry, refresh } = useGymData(load);

  const make = async () => {
    if (making) return;
    setMaking(true);
    const answer = await subscriptionsApi.generate(await getToken(), addDays(todayIso(), 1));
    setMaking(false);
    if (!answer.ok) return hud.error(answer.error);
    hud.success(`${answer.data.made} orders made${answer.data.unfilled ? ` · ${answer.data.unfilled} not made` : ""}`);
  };

  return (
    <AdminScreen
      title="Subscriptions"
      onRefresh={refresh}
      headerRight={
        <Pressable onPress={() => router.push("/admin/subscriptions/prices")} hitSlop={8} className="admin-chip admin-chip--on" accessibilityRole="button">
          <Text className="admin-segment__label admin-segment__label--on">Prices</Text>
        </Pressable>
      }
    >
      <View style={{ gap: 14 }}>
        <Pressable onPress={make} disabled={making} className="admin-chip flex-row self-start" style={{ gap: 6 }} accessibilityRole="button">
          {making ? <ActivityIndicator size="small" color={colors.leaf} /> : <SymbolView name={{ ios: "calendar.badge.plus", android: "event_available", web: "event_available" }} size={14} tintColor={colors.primaryText} />}
          <Text className="admin-segment__label admin-segment__label--on">{"Make tomorrow's orders"}</Text>
        </Pressable>
        <View className="search search--pill search--on-page">
          <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
          <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Member, number or plan" placeholderTextColor={colors.faint} autoCorrect={false} maxLength={40} accessibilityLabel="Search subscriptions" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {FILTERS.map((f) => {
            const on = status === f.value;
            return (
              <Pressable key={f.label} onPress={() => setStatus(f.value)} className={on ? "filter-chip filter-chip--selected" : "filter-chip"} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text className={on ? "filter-chip__label filter-chip__label--selected" : "filter-chip__label"}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {result.state === "loading" && <ScreenSkeleton label="Loading subscriptions" />}
        {result.state === "failed" && (
          <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load subscriptions" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
        )}
        {result.state === "ready" && result.data.subscriptions.length === 0 && (
          <DashedBlock icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} title="No subscriptions here" text="Members subscribe from the Meals tab's Meal Subscription side." />
        )}
        {result.state === "ready" && result.data.subscriptions.length > 0 && (
          <View className="admin-list">
            {result.data.subscriptions.map((s, i) => (
              <Pressable key={s.id} onPress={() => router.push({ pathname: "/admin/subscriptions/[id]", params: { id: s.id } })} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="button">
                <View className="min-w-0 flex-1">
                  <Text className="card__title" numberOfLines={1}>{`${s.member?.name ?? "Member"} · ${s.planName}`}</Text>
                  <Text className="meta-text" numberOfLines={1}>{`${date(s.startsOn)} – ${date(s.endsOn)} · ${s.mealsUsed}/${s.mealsTotal} meals · ${s.pausedNow ? "Paused" : s.status[0].toUpperCase() + s.status.slice(1)}`}</Text>
                </View>
                <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={14} tintColor={colors.faint} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </AdminScreen>
  );
}
