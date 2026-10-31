import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, type Href } from "expo-router";

import { usePullToRefresh } from "@/components/PullToRefresh";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPortal, ago, type AdminOverview } from "@/lib/adminPortal";
import { longDate } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

// Super Admin › Overview: the platform's counts, what needs an admin (each row opens the screen
// that resolves it) and the log of recent admin actions.

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: AdminOverview; loadedAt: number };

const icons = {
  users: { ios: "person.2", android: "group", web: "group" },
  gyms: { ios: "building.2", android: "apartment", web: "apartment" },
  flag: { ios: "flag", android: "flag", web: "flag" },
  blocked: { ios: "nosign", android: "block", web: "block" },
  history: { ios: "clock.arrow.circlepath", android: "history", web: "history" },
  chevron: { ios: "chevron.right", android: "chevron_right", web: "chevron_right" },
} satisfies Record<string, Icon>;

export default function AdminOverviewScreen() {
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
      <StatusBar style="dark" />
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
            <View className="items-center gap-3 py-16">
              <ActivityIndicator color={colors.forest} />
              <Text className="home__note">Loading</Text>
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
  const { counts, todo, activity } = data;
  const stats: { label: string; value: number; icon: Icon; tone?: "danger" | "warning"; href?: Href }[] = [
    { label: "Users", value: counts.users, icon: icons.users, href: "/admin/users" },
    { label: "Gyms", value: counts.gyms, icon: icons.gyms, href: "/admin/gyms" },
    { label: "Gym members", value: counts.gymMembers, icon: icons.users },
    { label: "Open reports", value: counts.openReports, icon: icons.flag, tone: counts.openReports > 0 ? "danger" : undefined, href: "/admin/reports" },
    { label: "Suspended", value: counts.suspended, icon: icons.blocked, href: "/admin/users" },
  ];
  const rows: { key: string; icon: Icon; title: string; text: string; href: Href }[] = [
    ...(todo.reportedPosts > 0 ? [{ key: "reports", icon: icons.flag, title: `${todo.reportedPosts} reported ${todo.reportedPosts === 1 ? "post" : "posts"}`, text: "Review and remove or dismiss", href: "/admin/reports" as Href }] : []),
    ...todo.gymsOnTrial.map((g) => ({ key: `trial-${g.id}`, icon: icons.gyms, title: `${g.name} is on a trial`, text: g.trialEndsOn ? `Ends ${longDate(g.trialEndsOn)}` : "No end date", href: "/admin/gyms" as Href })),
  ];

  return (
    <>
      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        {stats.map((s) => (
          <Pressable
            key={s.label}
            onPress={s.href ? () => router.push(s.href as Href) : undefined}
            disabled={!s.href}
            className={s.tone === "danger" ? "admin-stat admin-stat--danger" : s.tone === "warning" ? "admin-stat admin-stat--warning" : "admin-stat"}
            accessibilityRole={s.href ? "button" : undefined}
            accessibilityLabel={`${s.label}: ${s.value}`}
          >
            <SymbolView name={s.icon} size={18} tintColor={colors.forestInk} />
            <Text className="admin-stat__label" numberOfLines={2}>{s.label}</Text>
            <Text className="admin-stat__value">{s.value}</Text>
          </Pressable>
        ))}
      </View>

      <Text className="setup__section">To do</Text>
      {rows.length === 0 ? (
        <DashedBlock icon={{ ios: "checkmark.circle", android: "check_circle", web: "check_circle" }} title="Nothing to do" text="No reports or trials need you right now." />
      ) : (
        <View className="admin-list">
          {rows.map((row, i) => (
            <Pressable key={row.key} onPress={() => router.push(row.href)} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityRole="button" accessibilityLabel={`${row.title}. ${row.text}`}>
              <View className="admin-row__icon"><SymbolView name={row.icon} size={18} tintColor={colors.forestInk} /></View>
              <View className="min-w-0 flex-1">
                <Text className="card__title" numberOfLines={1}>{row.title}</Text>
                <Text className="post__time" numberOfLines={1}>{row.text}</Text>
              </View>
              <SymbolView name={icons.chevron} size={14} tintColor={colors.faint} />
            </Pressable>
          ))}
        </View>
      )}

      <Text className="setup__section">Recent admin activity</Text>
      {activity.length === 0 ? (
        <DashedBlock icon={icons.history} title="No admin activity yet" text="Verifying, suspending, resolving reports and publishing promotions show up here." />
      ) : (
        <View className="admin-list">
          {activity.map((a, i) => (
            <View key={a.id} className={i === 0 ? "admin-row" : "admin-row admin-row--divided"} accessibilityLabel={`${a.summary}, by ${a.by}, ${ago(a.at, now)}`}>
              <View className="admin-row__icon"><SymbolView name={icons.history} size={18} tintColor={colors.forestInk} /></View>
              <View className="min-w-0 flex-1">
                <Text className="type-body text-forest-ink">{a.summary}</Text>
                <Text className="post__time">{`${a.by} · ${ago(a.at, now)}`}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );
}
