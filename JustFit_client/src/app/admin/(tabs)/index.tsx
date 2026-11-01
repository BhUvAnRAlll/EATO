import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, type Href } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPortal, ago, type AdminOverview } from "@/lib/adminPortal";
import { useSessionToken } from "@/lib/session";
import type { Icon } from "@/types/profile";
import { useThemeColors } from "@/theme";

// Super Admin › Overview: the platform's counts (members, and what they did in the last seven
// days) and the log of recent admin actions.

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: AdminOverview; loadedAt: number };

const icons = {
  users: { ios: "person.2", android: "group", web: "group" },
  newUsers: { ios: "person.badge.plus", android: "person_add", web: "person_add" },
  workouts: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" },
  meals: { ios: "fork.knife", android: "restaurant", web: "restaurant" },
  history: { ios: "clock.arrow.circlepath", android: "history", web: "history" },
} satisfies Record<string, Icon>;

export default function AdminOverviewScreen() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async () => {
    const result = await adminPortal.overview(await getToken().catch(() => null));
    setLoad(result.ok ? { state: "ready", data: result.data, loadedAt: Date.now() } : { state: "failed", error: result.error });
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  const { refreshControl } = usePullToRefresh(refresh);

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110, gap: 16 }} showsVerticalScrollIndicator={false} refreshControl={refreshControl}>
          <View className="flex-row items-start justify-between pt-2">
            <View>
              <Text className="type-overline text-muted">justFit admin</Text>
              <Text className="type-title text-forest-ink">Overview</Text>
            </View>
            <Pressable onPress={() => router.push("/admin/profile")} hitSlop={8} className="h-11 w-11 items-center justify-center rounded-full bg-surface" accessibilityRole="button" accessibilityLabel="Profile">
              <SymbolView name={{ ios: "person.crop.circle", android: "account_circle", web: "account_circle" }} size={22} tintColor={colors.forestInk} />
            </Pressable>
          </View>

          {load.state === "loading" ? (
            <View className="pt-2">
              <ScreenSkeleton label="Loading the overview" />
            </View>
          ) : load.state === "failed" ? (
            <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the overview" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
          ) : (
            <Ready data={load.data} now={load.loadedAt} />
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Ready({ data, now }: { data: AdminOverview; now: number }) {
  const colors = useThemeColors();
  const { counts, activity } = data;
  const stats: { label: string; value: number; icon: Icon; href?: Href }[] = [
    { label: "Users", value: counts.users, icon: icons.users, href: "/admin/users" },
    { label: "New this week", value: counts.newUsers, icon: icons.newUsers, href: "/admin/users" },
    { label: "Workouts this week", value: counts.workouts, icon: icons.workouts, href: "/admin/app-usage" },
    { label: "Meals this week", value: counts.meals, icon: icons.meals, href: "/admin/app-usage" },
  ];

  return (
    <>
      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        {stats.map((s) => (
          <Pressable
            key={s.label}
            onPress={s.href ? () => router.push(s.href as Href) : undefined}
            disabled={!s.href}
            className="admin-stat"
            accessibilityRole={s.href ? "button" : undefined}
            accessibilityLabel={`${s.label}: ${s.value}`}
          >
            <SymbolView name={s.icon} size={18} tintColor={colors.forestInk} />
            <Text className="admin-stat__label" numberOfLines={2}>{s.label}</Text>
            <Text className="admin-stat__value">{s.value}</Text>
          </Pressable>
        ))}
      </View>

      <Text className="setup__section">Recent admin activity</Text>
      {activity.length === 0 ? (
        <DashedBlock icon={icons.history} title="No admin activity yet" text="Publishing, editing and deleting promotions show up here." />
      ) : (
        <View className="admin-list">
          {activity.map((a, i) => (
            <View key={a.id} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityLabel={`${a.summary}, by ${a.by}, ${ago(a.at, now)}`}>
              <View className="admin-row__icon"><SymbolView name={icons.history} size={18} tintColor={colors.forestInk} /></View>
              <View className="min-w-0 flex-1">
                <Text className="type-body text-forest-ink">{a.summary}</Text>
                <Text className="meta-text">{`${a.by} · ${ago(a.at, now)}`}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );
}
