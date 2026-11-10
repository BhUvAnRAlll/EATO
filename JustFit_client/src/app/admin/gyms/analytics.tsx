import { useCallback, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { AdminStackHeader } from "@/components/admin/AdminStackHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { BarChart } from "@/components/admin/BarChart";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { adminPlatform, dayLabel, exportGymReport, type GymAnalytics, type GymReportKind, type Point } from "@/lib/adminPlatform";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const PERIODS = [7, 30, 90] as const;
const count = (n: number) => n.toLocaleString("en-IN");

// Super Admin › Gyms › Analytics (the brief's section 7): gyms by approval state, members, staff,
// memberships, attendance and who is inside now, then registrations, new memberships and visits a
// day for the period, and the cities with the most gyms. Every gym's own records, read live.
export default function GymAnalyticsScreen() {
  const colors = useThemeColors();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const load = useCallback((token: string | null) => adminPlatform.analytics(token, days), [days]);
  const { result, retry, refreshing, refresh } = useGymData(load);
  const getToken = useSessionToken();
  const [exporting, setExporting] = useState<GymReportKind | null>(null);
  const running = useRef(false);
  const exportReport = async (kind: GymReportKind) => {
    if (running.current) return;
    running.current = true;
    setExporting(kind);
    const done = await exportGymReport(await getToken(), kind);
    running.current = false;
    setExporting(null);
    if (!done.ok) hud.error(done.error);
  };

  const chart = (title: string, points: Point[], color: string) => (
    <View className="card" style={{ gap: 8 }}>
      <Text className="card__title">{title}</Text>
      <Text className="meta-text">{`${count(points.reduce((a, p) => a + p.value, 0))} in ${days} days`}</Text>
      <BarChart points={points.map((p) => ({ key: p.date, value: p.value }))} format={(v) => count(v)} label={(key, i) => dayLabel(key, i, points.length)} color={color} />
    </View>
  );
  const tiles = (a: GymAnalytics): [string, string, string][] => [
    ["Gyms live", count(a.gyms.approved), `${count(a.gyms.branches)} branches of ${count(a.gyms.brands)} gyms`],
    ["Waiting for review", count(a.gyms.pendingApproval), `${count(a.gyms.draft)} drafts`],
    ["Rejected · Suspended", `${count(a.gyms.rejected)} · ${count(a.gyms.suspended)}`, "branches"],
    ["Members", count(a.members), `${count(a.staff)} gym staff`],
    ["Memberships", count(a.memberships.total), `${count(a.memberships.active)} active · ${count(a.memberships.expired)} expired`],
    ["Visits", count(a.attendance.total), `${count(a.attendance.today)} today · ${count(a.attendance.insideNow)} inside now`],
  ];

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <AdminStackHeader title="Gym analytics" fallback="/admin/gyms" />
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 14 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.leaf} colors={[colors.leaf]} />}
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-row" style={{ gap: 8 }}>
            {PERIODS.map((p) => (
              <Pressable key={p} onPress={() => { haptic.select(); setDays(p); }} className={days === p ? "admin-chip admin-chip--on" : "admin-chip"} accessibilityRole="button" accessibilityState={{ selected: days === p }}>
                <Text className="type-caption text-ink">{`${p} days`}</Text>
              </Pressable>
            ))}
          </View>
          {result.state === "loading" ? <ScreenSkeleton cards={3} label="Loading the numbers" /> : null}
          {result.state === "failed" ? <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the numbers" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} /> : null}
          {result.state === "ready" ? (
            <>
              <View className="flex-row flex-wrap" style={{ gap: 10 }}>
                {tiles(result.data).map(([label, value, note]) => (
                  <View key={label} className="admin-stat admin-stat--half" accessible accessibilityLabel={`${label}: ${value}, ${note}`}>
                    <Text className="admin-stat__label" numberOfLines={1}>{label}</Text>
                    <Text className="admin-stat__value" numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
                    <Text className="meta-text" numberOfLines={2}>{note}</Text>
                  </View>
                ))}
              </View>
              {chart("New gym branches", result.data.series.newGyms, colors.primary)}
              {chart("New memberships", result.data.series.newMemberships, colors.accentBlue)}
              {chart("Visits", result.data.series.visits, colors.iconPeach)}
              <View className="card" style={{ gap: 8 }}>
                <Text className="card__title">Cities</Text>
                {result.data.cities.length === 0 ? <Text className="meta-text">No gyms yet.</Text> : null}
                {result.data.cities.map((c) => (
                  <View key={c.city} className="flex-row" style={{ gap: 8 }}>
                    <Text className="type-body text-ink flex-1">{c.city}</Text>
                    <Text className="meta-text">{`${c.gyms} ${c.gyms === 1 ? "branch" : "branches"} · ${count(c.memberships)} memberships`}</Text>
                  </View>
                ))}
              </View>
              <View className="card" style={{ gap: 8 }}>
                <Text className="card__title">Reports</Text>
                <Text className="meta-text">Excel files of every branch (status, members, visits in the last 30 days, team) or every gym team with its role. Phone numbers stay masked.</Text>
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {([["gyms", "Export gyms"], ["staff", "Export staff"]] as const).map(([kind, label]) => (
                    <Pressable key={kind} onPress={() => exportReport(kind)} disabled={exporting !== null} className="admin-chip" style={{ opacity: exporting !== null && exporting !== kind ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel={`${label} as Excel`}>
                      <Text className="type-caption text-ink">{exporting === kind ? "Exporting…" : label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
