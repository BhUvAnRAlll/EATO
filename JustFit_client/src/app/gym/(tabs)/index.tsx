import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, type Href } from "expo-router";
import { useState } from "react";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { AddMemberSheet } from "@/components/gym/AddMemberSheet";
import { AddSheet } from "@/components/gym/AddSheet";
import { DueMembersSheet } from "@/components/gym/DueMembersSheet";
import { GymMenu } from "@/components/gym/GymMenu";
import { GradientFill } from "@/components/gym/GradientFill";
import { PaymentRow } from "@/components/gym/PaymentRow";
import { RevenueCard } from "@/components/gym/RevenueCard";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { initialsOf, type AddAction } from "@/data/gymDashboard";
import { comingSoon } from "@/lib/gymPortal";
import { gymApi } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";
import { useAuthStore } from "@/store/auth";
import { useThemeColors, type Palette } from "@/theme";
import type { Icon } from "@/types/profile";

type Tone = "primary" | "ink" | "success" | "warning" | "danger";
// A tone's text colour, icon colour, soft fill and outline
const toneColors = (colors: Palette, tone: Tone) =>
  ({
    primary: { text: colors.gymPrimaryText, icon: colors.gymPrimary, soft: colors.gymPrimarySoft, line: colors.gymPrimaryLine },
    ink: { text: colors.gymInk, icon: colors.gymInk, soft: colors.gymBar, line: colors.gymLine },
    success: { text: colors.gymSuccess, icon: colors.gymSuccess, soft: colors.gymSuccessSoft, line: colors.gymSuccessLine },
    warning: { text: colors.gymWarning, icon: colors.gymWarning, soft: colors.gymWarningSoft, line: colors.gymWarningSoft },
    danger: { text: colors.gymDanger, icon: colors.gymDanger, soft: colors.gymDangerSoft, line: colors.gymDangerSoft },
  })[tone];

// Gym admin › Home: who is signed in and at which gym, today's revenue, today's counts, Send Bulk
// SMS, what needs attention and the latest payments, with + to record something. Every number is
// the server's (GET /api/gym/dashboard), read again whenever Home comes into view.
export default function GymHome() {
  const colors = useThemeColors();
  const user = useAuthStore((state) => state.user);
  const name = user?.fullName?.trim() || "Gym admin";
  const { result, reload, retry, stale } = useGymData(gymApi.dashboard);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The + sheet, or Add New Member opened from it
  const [sheet, setSheet] = useState<"add" | "member" | "due" | null>(null);
  const pick = (action: AddAction) => {
    setSheet(action === "member" ? "member" : null);
    if (action === "member") return;
    const go: Partial<Record<AddAction, () => void>> = {
      plan: () => router.push("/gym/manage?tab=catalog"),
      enquiry: () => router.push("/gym/enquiry"),
      outlet: () => router.push("/gym/branches"),
    };
    const label = { expense: "Add Expense", staff: "Add Staff / Admin Login", sms: "Send Bulk SMS", biometric: "Biometric Attendance" } as Partial<Record<AddAction, string>>;
    if (go[action]) go[action]!();
    else setTimeout(() => comingSoon(label[action] ?? "This"), 250);
  };
  // Narrow phones: the tiles' labels a size smaller, so "Admission" fits
  const narrow = useWindowDimensions().width < 360;
  const tileLabel = narrow ? { fontSize: 11 } : undefined;
  const data = result.state === "ready" ? result.data : null;

  const stats: { id: string; value: number; label: string; tone: Tone; href: Href }[] = data
    ? [
        { id: "admission", value: data.stats.admission, label: "Admission", tone: "primary", href: "/gym/transactions?kind=admission&today=1" },
        { id: "renewal", value: data.stats.renewal, label: "Renewal", tone: "ink", href: "/gym/transactions?kind=renewal&today=1" },
        { id: "enquiry", value: data.stats.enquiry, label: "Enquiry", tone: "primary", href: "/gym/enquiries" },
        { id: "due-paid", value: data.stats.duePaid, label: "Due Paid", tone: "success", href: "/gym/transactions?kind=due&today=1" },
        { id: "pt", value: data.stats.pt, label: "PT", tone: "primary", href: "/gym/transactions?kind=pt&today=1" },
        { id: "product", value: data.stats.product, label: "Product", tone: "ink", href: "/gym/transactions?kind=sale&today=1" },
      ]
    : [];
  const alerts: { id: string; value: number; label: string; tag: string; tone: Tone; icon: Icon; href: Href }[] = data
    ? [
        { id: "due", value: data.alerts.dueMembers, label: "Due Members", tag: "Action", tone: "danger", icon: { ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }, href: "/gym/members?filter=due" },
        { id: "expiring", value: data.alerts.expiringToday, label: "Expiring Today", tag: "Urgent", tone: "warning", icon: { ios: "clock.fill", android: "schedule", web: "schedule" }, href: "/gym/members?filter=expiring" },
        { id: "attendance", value: data.alerts.attendance, label: "Attendance", tag: "Live", tone: "primary", icon: { ios: "touchid", android: "fingerprint", web: "fingerprint" }, href: "/gym/members?filter=in_today" },
        { id: "expiring-soon", value: data.alerts.expiringSoon, label: "Expiring in 1-3 days", tag: "Soon", tone: "warning", icon: { ios: "calendar.badge.clock", android: "event_upcoming", web: "event_upcoming" }, href: "/gym/members?filter=expiring_soon" },
        { id: "birthdays", value: data.alerts.birthdays, label: "Birthdays Today", tag: "Wish", tone: "success", icon: { ios: "gift.fill", android: "cake", web: "cake" }, href: "/gym/members?filter=birthday" },
      ]
    : [];

  return (
    <View className="flex-1 bg-gym-page">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="gym-header">
          <PressableScale onPress={() => setMenuOpen(true)} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Menu">
            <SymbolView name={{ ios: "line.3.horizontal", android: "menu", web: "menu" }} size={18} tintColor={colors.gymInk} />
          </PressableScale>
          <View className="min-w-0 flex-1" style={{ gap: 2 }}>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Text className="gym-header__name" numberOfLines={1}>{name}</Text>
              <View className="gym-role-pill">
                <GradientFill radius={6} />
                <Text className="gym-role-pill__label">ADMIN</Text>
              </View>
            </View>
            {data && (
              <PressableScale onPress={() => router.push("/gym/branches")} className="flex-row items-center self-start" style={{ gap: 4, maxWidth: "100%" }} accessibilityRole="button" accessibilityLabel={`${data.gym.branch} branch, ${data.gym.area}, ${data.gym.city}. Switch or edit branch`}>
                <SymbolView name={{ ios: "mappin", android: "location_on", web: "location_on" }} size={14} tintColor={colors.gymPrimary} />
                <Text className="gym-header__place" numberOfLines={1}>{`${data.gym.branch} branch`}</Text>
                <SymbolView name={{ ios: "arrow.left.arrow.right", android: "swap_horiz", web: "swap_horiz" }} size={11} tintColor={colors.gymFaint} />
              </PressableScale>
            )}
          </View>
          <PressableScale onPress={() => router.push("/gym/members?focus=search")} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Search members">
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={17} tintColor={colors.gymInk} />
          </PressableScale>
          <PressableScale onPress={() => setMenuOpen(true)} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Your account">
            <SymbolView name={{ ios: "person.fill", android: "person", web: "person" }} size={17} tintColor={colors.gymInk} />
            <View className="gym-online-dot" />
          </PressableScale>
        </View>

        <View className="gym-subbar">
          <View className="gym-brand-badge">
            <GradientFill radius={8} />
            <Text className="gym-brand-badge__label">{data ? initialsOf(data.gym.name).toLowerCase() : ""}</Text>
          </View>
          <Text className="gym-subbar__title flex-1" numberOfLines={1}>
            {data ? `${data.gym.name.toUpperCase()} ` : ""}
            <Text className="gym-subbar__title-light">DASHBOARD</Text>
          </Text>
          {/* Live while the latest read worked; Offline when a refresh failed and older numbers show */}
          {data && (
            <View className={stale ? "gym-live gym-live--off" : "gym-live"} accessibilityLabel={stale ? "Offline: showing the last numbers" : "Live: up to date"}>
              <View className={stale ? "gym-live__dot gym-live__dot--off" : "gym-live__dot"} />
              <Text className={stale ? "gym-live__label gym-live__label--off" : "gym-live__label"}>{stale ? "Offline" : "Live Sync"}</Text>
            </View>
          )}
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
        >
          {result.state === "loading" && <GymLoading label="Loading your gym" />}
          {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
          {data && (
            <>
              <RevenueCard online={data.revenue.online} cash={data.revenue.cash} onMenu={() => router.push("/gym/wallet")} />

              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {stats.map((stat) => (
                  <PressableScale key={stat.id} onPress={() => router.push(stat.href)} className="gym-card gym-stat" style={{ flexBasis: "30%", flexGrow: 1 }} accessibilityRole="button" accessibilityLabel={`${stat.value} ${stat.label}`}>
                    <Text className="gym-stat__value" style={{ color: toneColors(colors, stat.tone).text }}>{stat.value}</Text>
                    <Text className="gym-stat__label" style={tileLabel} numberOfLines={1} adjustsFontSizeToFit>{stat.label}</Text>
                  </PressableScale>
                ))}
              </View>

              <PressableScale onPress={() => comingSoon("Send Bulk SMS")} className="gym-sms" accessibilityRole="button" accessibilityLabel="Send Bulk SMS. Auto reminders, alerts and wishes">
                <View className="gym-sms__icon">
                  <SymbolView name={{ ios: "message.fill", android: "sms", web: "sms" }} size={18} tintColor={colors.gymPrimary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="gym-sms__title" numberOfLines={1}>Send Bulk SMS</Text>
                  <Text className="gym-sms__text" numberOfLines={1}>{"Auto Reminders, Alerts & Wishes"}</Text>
                </View>
                <View className="gym-chevron-btn">
                  <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={13} tintColor={colors.gymInk} />
                </View>
              </PressableScale>

              <View className="flex-row flex-wrap" style={{ gap: 10 }}>
                {alerts.map((alert) => {
                  const tone = toneColors(colors, alert.tone);
                  return (
                    <PressableScale key={alert.id} onPress={() => (alert.id === "due" ? setSheet("due") : router.push(alert.href))} className="gym-card gym-alert" style={{ flexBasis: "30%", flexGrow: 1 }} accessibilityRole="button" accessibilityLabel={`${alert.value} ${alert.label}, ${alert.tag}`}>
                      <View className="flex-row items-center justify-between" style={{ gap: 4 }}>
                        <View className="gym-alert__icon" style={{ backgroundColor: tone.soft, borderColor: tone.line }}>
                          <SymbolView name={alert.icon} size={15} tintColor={tone.icon} />
                        </View>
                        <View className="gym-tag" style={{ backgroundColor: tone.soft }}>
                          <Text className="gym-tag__label" style={{ color: tone.text }} numberOfLines={1}>{alert.tag}</Text>
                        </View>
                      </View>
                      <View>
                        <Text className="gym-alert__value">{alert.value}</Text>
                        <Text className="gym-alert__label" style={tileLabel} numberOfLines={1} adjustsFontSizeToFit>{alert.label}</Text>
                      </View>
                    </PressableScale>
                  );
                })}
              </View>

              <View className="flex-row items-center" style={{ marginTop: 4 }}>
                <Text className="gym-section-title" accessibilityRole="header">Recent Transactions</Text>
                <PressableScale onPress={() => router.push("/gym/transactions")} hitSlop={10} accessibilityRole="button" accessibilityLabel="View all transactions">
                  <Text className="gym-link">View All</Text>
                </PressableScale>
              </View>

              {data.recent.length === 0 ? (
                <GymEmpty icon={{ ios: "indianrupeesign.circle", android: "currency_rupee", web: "currency_rupee" }} title="No payments yet" text="Tap + to record an admission, a renewal, a due payment or a shop sale." />
              ) : (
                <View style={{ gap: 10 }}>
                  {data.recent.map((payment) => (
                    <PaymentRow key={payment.id} payment={payment} onPress={payment.memberId ? () => router.push({ pathname: "/gym/members/[id]", params: { id: String(payment.memberId) } }) : undefined} />
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>

        <View className="absolute" style={{ right: 16, bottom: 16 }}>
          <PressableScale onPress={() => setSheet("add")} haptic="tap" className="gym-fab" accessibilityRole="button" accessibilityLabel="Add a member, plan, enquiry or payment">
            <GradientFill radius={18} />
            <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={24} tintColor={colors.white} />
          </PressableScale>
        </View>
      </SafeAreaView>
      {sheet === "add" && <AddSheet onClose={() => setSheet(null)} onPick={pick} />}
      {sheet === "due" && data && <DueMembersSheet gym={data.gym} onClose={() => setSheet(null)} onChanged={reload} />}
      {sheet === "member" && (
        <AddMemberSheet
          onClose={() => setSheet(null)}
          onSaved={(detail) => {
            setSheet(null);
            reload();
            router.push({ pathname: "/gym/members/[id]", params: { id: String(detail.member.id) } });
          }}
        />
      )}
      <GymMenu open={menuOpen} onClose={() => setMenuOpen(false)} gymLine={data ? `${data.gym.name} · ${data.gym.branch} branch` : null} />
    </View>
  );
}
