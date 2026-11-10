import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";

import { TileGrid } from "@/components/admin/TileGrid";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { PressableScale } from "@/components/PressableScale";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { rupees } from "@/data/gymDashboard";
import { adminPortal, ago, type AdminOverview } from "@/lib/adminPortal";
import { useResponsive } from "@/lib/responsive";
import { useSessionToken } from "@/lib/session";
import type { Icon } from "@/types/profile";
import { useThemeColors } from "@/theme";

// Super Admin › Overview, top to bottom: the dark Today card (money and today's orders), Needs
// attention as tiles (gyms to review, complaints, meal issues, late orders), quick actions, the
// platform's counts, and the log of recent admin actions.

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; data: AdminOverview; loadedAt: number };

const icons = {
  users: { ios: "person.2", android: "group", web: "group" },
  newUsers: { ios: "person.badge.plus", android: "person_add", web: "person_add" },
  workouts: { ios: "dumbbell", android: "fitness_center", web: "fitness_center" },
  meals: { ios: "fork.knife", android: "restaurant", web: "restaurant" },
  history: { ios: "clock.arrow.circlepath", android: "history", web: "history" },
  gyms: { ios: "building.2", android: "apartment", web: "apartment" },
  review: { ios: "checkmark.seal", android: "verified", web: "verified" },
  flag: { ios: "flag", android: "flag", web: "flag" },
  issue: { ios: "exclamationmark.bubble", android: "report", web: "report" },
  late: { ios: "clock.badge.exclamationmark", android: "schedule", web: "schedule" },
  add: { ios: "plus", android: "add", web: "add" },
  reports: { ios: "chart.line.uptrend.xyaxis", android: "insights", web: "insights" },
  kitchen: { ios: "frying.pan", android: "skillet", web: "skillet" },
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

  return (
    <AdminScreen title="Overview" hideBack onRefresh={refresh}>
      {load.state === "loading" ? (
        <ScreenSkeleton label="Loading the overview" />
      ) : load.state === "failed" ? (
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the overview" text={`${load.error.replace(/\.$/, "")}. Tap to try again.`} onPress={() => { setLoad({ state: "loading" }); refresh(); }} />
      ) : (
        <Ready data={load.data} now={load.loadedAt} />
      )}
    </AdminScreen>
  );
}

function SectionTitle({ title, link }: { title: string; link?: { label: string; href: Href } }) {
  return (
    <View className="admin-section">
      <Text className="admin-section__title" accessibilityRole="header">{title}</Text>
      {link ? (
        <Pressable onPress={() => router.push(link.href)} hitSlop={8} accessibilityRole="button">
          <Text className="admin-section__link">{link.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// The dark card at the top: today's meal revenue (or gym takings, or the member count before
// either exists) with today's counts under it. Taps open the meal-operations dashboard.
function TodayCard({ data }: { data: AdminOverview }) {
  const colors = useThemeColors();
  const meals = data.attention?.meals ?? null;
  const gymTakings = data.gyms && data.gyms.gyms !== null ? data.gyms.gymRevenueToday ?? 0 : null;

  const headline = meals
    ? { overline: "Today · meal revenue", value: rupees(meals.revenue), caption: `${meals.orders} meal ${meals.orders === 1 ? "order" : "orders"} for today` }
    : gymTakings !== null
      ? { overline: "Today · gym takings", value: rupees(gymTakings), caption: "Collected at justFit gyms today" }
      : { overline: "justFit members", value: String(data.counts.users), caption: `${data.counts.newUsers} joined this week` };

  const stats: { label: string; value: string; alert?: boolean }[] = [];
  if (meals) {
    stats.push({ label: "To deliver", value: String(meals.open) }, { label: "Late", value: String(meals.delayed), alert: meals.delayed > 0 });
    if (gymTakings !== null) stats.push({ label: "Gym takings", value: rupees(gymTakings) });
  } else {
    stats.push({ label: "New this week", value: String(data.counts.newUsers) }, { label: "Workouts", value: String(data.counts.workouts) });
  }

  return (
    <PressableScale onPress={() => router.push(meals ? "/admin/meal-ops" : "/admin/users")} className="admin-hero" accessibilityRole="button" accessibilityLabel={`${headline.overline}: ${headline.value}. ${headline.caption}. Open the details`}>
      <View className="flex-row items-start">
        <View className="min-w-0 flex-1" style={{ gap: 2 }}>
          <Text className="admin-hero__overline">{headline.overline}</Text>
          <Text className="admin-hero__value" numberOfLines={1} adjustsFontSizeToFit>{headline.value}</Text>
          <Text className="admin-hero__caption">{headline.caption}</Text>
        </View>
        <SymbolView name={icons.chevron} size={16} tintColor={colors.onInverseMuted} />
      </View>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {stats.map((s) => (
          <View key={s.label} className="admin-hero__stat">
            <Text className="admin-hero__stat-label" numberOfLines={2}>{s.label}</Text>
            <Text className={s.alert ? "admin-hero__stat-value admin-hero__stat-value--alert" : "admin-hero__stat-value"} numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
          </View>
        ))}
      </View>
    </PressableScale>
  );
}

type Todo = { label: string; count: number; icon: Icon; href: Href; tone: "warning" | "danger" };

function Ready({ data, now }: { data: AdminOverview; now: number }) {
  const colors = useThemeColors();
  const { compact } = useResponsive();
  const quickTile = compact ? "admin-tile admin-tile--half" : "admin-tile admin-tile--quarter";
  const { counts, activity } = data;
  const meals = data.attention?.meals ?? null;
  const gymsReady = !!data.gyms && data.gyms.gyms !== null;

  // Needs attention: only the to-dos whose feature exists on this server (null = migration not run)
  const todo: Todo[] = [];
  if (data.gyms?.gymsToReview != null) todo.push({ label: "Gyms to review", count: data.gyms.gymsToReview, icon: icons.review, href: "/admin/gyms", tone: "warning" });
  if (data.attention?.openComplaints != null) todo.push({ label: "Open complaints", count: data.attention.openComplaints, icon: icons.flag, href: "/admin/complaints", tone: "warning" });
  if (data.attention?.openIssues != null) todo.push({ label: "Open meal issues", count: data.attention.openIssues, icon: icons.issue, href: "/admin/issues", tone: "warning" });
  if (meals) todo.push({ label: "Late orders today", count: meals.delayed, icon: icons.late, href: "/admin/orders", tone: "danger" });
  const waiting = todo.reduce((sum, t) => sum + t.count, 0);

  const quick: { label: string; icon: Icon; href: Href }[] = [
    { label: "Add meal", icon: icons.add, href: "/admin/meals/new" },
    { label: "New gym", icon: icons.gyms, href: "/admin/gyms/new" },
    { label: "Kitchens", icon: icons.kitchen, href: "/admin/kitchens" },
    { label: "Reports", icon: icons.reports, href: "/admin/reports" },
  ];

  const platform: { label: string; value: number; icon: Icon; href: Href }[] = [
    { label: "Users", value: counts.users, icon: icons.users, href: "/admin/users" },
    { label: "New this week", value: counts.newUsers, icon: icons.newUsers, href: "/admin/users" },
    { label: "Workouts this week", value: counts.workouts, icon: icons.workouts, href: "/admin/app-usage" },
    { label: "Meals logged this week", value: counts.meals, icon: icons.meals, href: "/admin/app-usage" },
  ];
  if (gymsReady) platform.push({ label: "Gyms", value: data.gyms?.gyms ?? 0, icon: icons.gyms, href: "/admin/gyms" });

  return (
    <View style={{ gap: 24 }}>
      <TodayCard data={data} />

      {todo.length > 0 ? (
        <View style={{ gap: 10 }}>
          <SectionTitle title={waiting > 0 ? `Needs attention · ${waiting}` : "Needs attention"} />
          <View className="flex-row flex-wrap" style={{ gap: 10 }}>
            {todo.map((t) => {
              const on = t.count > 0;
              return (
                <PressableScale key={t.label} onPress={() => router.push(t.href)} className={on ? `admin-alert admin-alert--${t.tone}` : "admin-alert"} accessibilityRole="button" accessibilityLabel={`${t.label}: ${t.count}`}>
                  <View className="flex-row items-center justify-between">
                    <SymbolView name={t.icon} size={18} tintColor={on ? (t.tone === "danger" ? colors.danger : colors.warning) : colors.muted} />
                    <SymbolView name={icons.chevron} size={12} tintColor={colors.faint} />
                  </View>
                  <Text className="admin-alert__value">{t.count}</Text>
                  <Text className="admin-alert__label" numberOfLines={1}>{t.label}</Text>
                </PressableScale>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionTitle title="Quick actions" link={{ label: "All tools", href: "/admin/more" }} />
        <TileGrid columns={compact ? 2 : 4} tileClass={quickTile}>
          {quick.map((q) => (
            <PressableScale key={q.label} onPress={() => router.push(q.href)} className={quickTile} accessibilityRole="button" accessibilityLabel={q.label}>
              <View className="admin-tile__icon"><SymbolView name={q.icon} size={18} tintColor={colors.primaryText} /></View>
              <Text className="admin-tile__label text-center" numberOfLines={2}>{q.label}</Text>
            </PressableScale>
          ))}
        </TileGrid>
      </View>

      <View style={{ gap: 10 }}>
        <SectionTitle title="Platform" link={{ label: "App Usage", href: "/admin/app-usage" }} />
        <View className="flex-row flex-wrap" style={{ gap: 10 }}>
          {platform.map((s) => (
            <Pressable key={s.label} onPress={() => router.push(s.href)} className={compact ? "admin-stat admin-stat--half" : "admin-stat"} accessibilityRole="button" accessibilityLabel={`${s.label}: ${s.value}`}>
              <SymbolView name={s.icon} size={18} tintColor={colors.forestInk} />
              <Text className="admin-stat__label" numberOfLines={2}>{s.label}</Text>
              <Text className="admin-stat__value" numberOfLines={1} adjustsFontSizeToFit>{s.value}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <SectionTitle title="Recent admin activity" />
        {activity.length === 0 ? (
          <DashedBlock icon={icons.history} title="No admin activity yet" text="Changes you and other admins make show up here." />
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
      </View>
    </View>
  );
}
