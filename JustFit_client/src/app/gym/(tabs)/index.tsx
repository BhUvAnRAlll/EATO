import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, type Href } from "expo-router";
import { useState } from "react";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { AddMemberSheet } from "@/components/gym/AddMemberSheet";
import { AddSheet } from "@/components/gym/AddSheet";
import { BulkSmsSheet } from "@/components/gym/BulkSmsSheet";
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
import type { GymIconName } from "@/constants/gymIcons";

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
  const [sheet, setSheet] = useState<"add" | "member" | "due" | "sms" | null>(null);
  const pick = (action: AddAction) => {
    setSheet(action === "member" ? "member" : null);
    if (action === "member") return;
    // Send Bulk SMS opens once the + sheet has gone
    if (action === "sms") return void setTimeout(() => setSheet("sms"), 250);
    const go: Partial<Record<AddAction, () => void>> = {
      plan: () => router.push("/gym/manage?tab=catalog"),
      enquiry: () => router.push("/gym/enquiry"),
      outlet: () => router.push("/gym/branches"),
    };
    const label = { expense: "Add Expense", staff: "Add Staff / Admin Login", biometric: "Biometric Attendance" } as Partial<Record<AddAction, string>>;
    if (go[action]) go[action]!();
    else setTimeout(() => comingSoon(label[action] ?? "This"), 250);
  };
  // Narrow phones: the tiles' labels a size smaller, so "Admission" fits
  const narrow = useWindowDimensions().width < 360;
  const tileLabel = narrow ? { fontSize: 11 } : undefined;
  const data = result.state === "ready" ? result.data : null;

  // Each count tile has its own soft colour and icon (the user's design)
  const tile = (k: "Violet" | "Orange" | "Blue" | "Green" | "Pink" | "Purple") => ({
    bg: colors[`gymTile${k}`],
    line: colors[`gymTile${k}Line`],
    box: colors[`gymTile${k}Box`],
    icon: colors[`gymTile${k}Icon`],
  });
  const stats: { id: string; value: number; label: string; color: ReturnType<typeof tile>; icon: GymIconName; href: Href }[] = data
    ? [
        { id: "admission", value: data.stats.admission, label: "Admission", color: tile("Violet"), icon: "users", href: "/gym/transactions?kind=admission&today=1" },
        { id: "renewal", value: data.stats.renewal, label: "Renewal", color: tile("Orange"), icon: "refresh-ccw", href: "/gym/transactions?kind=renewal&today=1" },
        { id: "enquiry", value: data.stats.enquiry, label: "Enquiry", color: tile("Blue"), icon: "message-circle-question", href: "/gym/enquiries" },
        { id: "due-paid", value: data.stats.duePaid, label: "Due Paid", color: tile("Green"), icon: "indian-rupee", href: "/gym/transactions?kind=due&today=1" },
        { id: "pt", value: data.stats.pt, label: "PT", color: tile("Pink"), icon: "dumbbell", href: "/gym/transactions?kind=pt&today=1" },
        { id: "product", value: data.stats.product, label: "Product", color: tile("Purple"), icon: "package", href: "/gym/transactions?kind=sale&today=1" },
      ]
    : [];
  const alerts: { id: string; value: number; label: string; tag: string; tone: Tone; icon: GymIconName; href: Href }[] = data
    ? [
        { id: "due", value: data.alerts.dueMembers, label: "Due Members", tag: "Action", tone: "danger", icon: "triangle-alert", href: "/gym/members?filter=due" },
        { id: "expiring", value: data.alerts.expiringToday, label: "Expiring Today", tag: "Urgent", tone: "warning", icon: "clock", href: "/gym/members?filter=expiring" },
        { id: "attendance", value: data.alerts.attendance, label: "Attendance", tag: "Live", tone: "primary", icon: "fingerprint", href: "/gym/members?filter=in_today" },
        { id: "expiring-soon", value: data.alerts.expiringSoon, label: "Expiring in 1-3 days", tag: "Soon", tone: "warning", icon: "calendar-clock", href: "/gym/members?filter=expiring_soon" },
        { id: "birthdays", value: data.alerts.birthdays, label: "Birthdays Today", tag: "Wish", tone: "success", icon: "cake", href: "/gym/members?filter=birthday" },
      ]
    : [];

  return (
    <View className="flex-1 bg-gym-page">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="gym-header">
          <PressableScale onPress={() => setMenuOpen(true)} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Menu">
            <GymIcon name="menu" size={18} color={colors.gymInk} />
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
                <GymIcon name="map-pin" size={14} color={colors.gymPrimary} />
                <Text className="gym-header__place" numberOfLines={1}>{`${data.gym.branch} branch`}</Text>
                <GymIcon name="arrow-left-right" size={11} color={colors.gymFaint} />
              </PressableScale>
            )}
          </View>
          <PressableScale onPress={() => router.push("/gym/members?focus=search")} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Search members">
            <GymIcon name="search" size={17} color={colors.gymInk} />
          </PressableScale>
          <PressableScale onPress={() => setMenuOpen(true)} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Your account">
            <GymIcon name="user" size={17} color={colors.gymInk} />
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
                  <PressableScale key={stat.id} onPress={() => router.push(stat.href)} className="gym-tile" style={[{ flexBasis: "30%", flexGrow: 1, backgroundColor: stat.color.bg, borderColor: stat.color.line }, narrow ? { flexDirection: "column", alignItems: "flex-start", gap: 6 } : null]} accessibilityRole="button" accessibilityLabel={`${stat.value} ${stat.label}`}>
                    <View className="gym-tile__icon" style={{ backgroundColor: stat.color.box }}>
                      <GymIcon name={stat.icon} size={17} color={stat.color.icon} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="gym-stat__value" style={{ color: colors.gymInk }}>{stat.value}</Text>
                      <Text className="gym-tile__label" numberOfLines={1} adjustsFontSizeToFit>{stat.label}</Text>
                    </View>
                  </PressableScale>
                ))}
              </View>

              <PressableScale onPress={() => setSheet("sms")} className="gym-sms" accessibilityRole="button" accessibilityLabel="Send Bulk SMS. Auto reminders, alerts and wishes">
                <View className="gym-sms__icon">
                  <GymIcon name="message-square-text" size={18} color={colors.gymPrimary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="gym-sms__title" numberOfLines={1}>Send Bulk SMS</Text>
                  <Text className="gym-sms__text" numberOfLines={1}>{"Auto Reminders, Alerts & Wishes"}</Text>
                </View>
                <View className="gym-chevron-btn">
                  <GymIcon name="chevron-right" size={13} color={colors.gymInk} />
                </View>
              </PressableScale>

              <View className="flex-row flex-wrap" style={{ gap: 10 }}>
                {alerts.map((alert) => {
                  const tone = toneColors(colors, alert.tone);
                  return (
                    <PressableScale key={alert.id} onPress={() => (alert.id === "due" ? setSheet("due") : router.push(alert.href))} className="gym-card gym-alert" style={{ flexBasis: "30%", flexGrow: 1 }} accessibilityRole="button" accessibilityLabel={`${alert.value} ${alert.label}, ${alert.tag}`}>
                      <View className="flex-row items-center justify-between" style={{ gap: 4 }}>
                        <View className="gym-alert__icon" style={{ backgroundColor: tone.soft, borderColor: tone.line }}>
                          <GymIcon name={alert.icon} size={15} color={tone.icon} />
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
                <GymEmpty icon="indian-rupee" title="No payments yet" text="Tap + to record an admission, a renewal, a due payment or a shop sale." />
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
            <GymIcon name="plus" size={24} color={colors.white} />
          </PressableScale>
        </View>
      </SafeAreaView>
      {sheet === "add" && <AddSheet onClose={() => setSheet(null)} onPick={pick} />}
      {sheet === "sms" && <BulkSmsSheet onClose={() => setSheet(null)} />}
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
      <GymMenu open={menuOpen} onClose={() => setMenuOpen(false)} onBulkSms={() => setTimeout(() => setSheet("sms"), 250)} gymLine={data ? `${data.gym.name} · ${data.gym.branch} branch` : null} />
    </View>
  );
}
