import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, type Href } from "expo-router";
import { useState } from "react";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

import { PressableScale } from "@/components/PressableScale";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
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
import { greetingFor, initialsOf, type AddAction } from "@/data/gymDashboard";
import { comingSoon } from "@/lib/gymPortal";
import { gymApi } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";
import { useAuthStore } from "@/store/auth";
import { useThemeColors, type Palette } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";
import type { Role } from "@/lib/roles";

// The pill beside the gym's name: the account's role as the server gave it
const roleLabel = (role: Role | undefined) => (role === "gym_admin" ? "ADMIN" : role === "admin" ? "SUPER ADMIN" : "STAFF");

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

// Gym admin › Home: the gym and the signed-in role, today's revenue, today's counts, Send Bulk
// SMS, what needs attention and the latest payments, with + to record something. Every number is
// the server's (GET /api/gym/dashboard), read again whenever Home comes into view.
export default function GymHome() {
  const colors = useThemeColors();
  const user = useAuthStore((state) => state.user);
  const name = user?.fullName?.trim() || "Gym admin";
  const { result, reload, retry } = useGymData(gymApi.dashboard);
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
  // Six counts in one row on a tablet or the web, otherwise two rows of three
  const columns = useWindowDimensions().width >= 700 ? 6 : 3;
  const now = new Date();
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
  const alerts: { id: string; value: number; label: string; tag: string; hint: string; tone: Tone; icon: GymIconName; href: Href }[] = data
    ? [
        { id: "due", value: data.alerts.dueMembers, label: "Due Members", tag: "Action", hint: "Payments to collect", tone: "danger", icon: "triangle-alert", href: "/gym/members?filter=due" },
        { id: "expiring", value: data.alerts.expiringToday, label: "Expiring Today", tag: "Urgent", hint: "Plans ending today", tone: "warning", icon: "clock", href: "/gym/members?filter=expiring" },
        { id: "attendance", value: data.alerts.attendance, label: "Attendance", tag: "Live", hint: "Checked in today", tone: "primary", icon: "fingerprint", href: "/gym/members?filter=in_today" },
        { id: "expiring-soon", value: data.alerts.expiringSoon, label: "Expiring in 1-3 days", tag: "Soon", hint: "Renewals coming up", tone: "warning", icon: "calendar-clock", href: "/gym/members?filter=expiring_soon" },
        { id: "birthdays", value: data.alerts.birthdays, label: "Birthdays Today", tag: "Wish", hint: "Send them a wish", tone: "success", icon: "cake", href: "/gym/members?filter=birthday" },
      ]
    : [];

  // Each section rises in once, a beat after the one above, when the numbers first arrive
  const enter = (step: number) => FadeInDown.duration(380).delay(step * 60).reduceMotion(ReduceMotion.System);

  return (
    <View className="flex-1 bg-gym-canvas">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="gym-dash-header">
          <PressableScale onPress={() => setMenuOpen(true)} className="gym-dash-icon-btn" accessibilityRole="button" accessibilityLabel="Menu">
            <GymIcon name="menu" size={18} color={colors.gymInk} />
          </PressableScale>
          <View className="min-w-0 flex-1">
            <Text className="gym-dash-header__eyebrow" numberOfLines={1}>{data ? data.gym.name.toUpperCase() : " "}</Text>
            {data && (
              <PressableScale onPress={() => router.push("/gym/branches")} className="flex-row items-center self-start" style={{ gap: 6, maxWidth: "100%" }} accessibilityRole="button" accessibilityLabel={`${data.gym.branch} branch, ${data.gym.area}, ${data.gym.city}. Switch or edit branch`}>
                <Text className="gym-dash-header__branch" numberOfLines={1}>{`${data.gym.branch} branch`}</Text>
                <GymIcon name="chevron-down" size={14} color={colors.gymMuted} />
              </PressableScale>
            )}
          </View>
          <PressableScale onPress={() => router.push("/gym/members?focus=search")} className="gym-dash-icon-btn" accessibilityRole="button" accessibilityLabel="Search members">
            <GymIcon name="search" size={18} color={colors.gymInk} />
          </PressableScale>
          <PressableScale onPress={() => setMenuOpen(true)} className="gym-brand-badge" style={{ width: 40, height: 40, borderRadius: 12 }} accessibilityRole="button" accessibilityLabel="Your account">
            <GradientFill radius={12} />
            <Text className="gym-brand-badge__label">{initialsOf(name)}</Text>
          </PressableScale>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
        >
          <View className="gym-dash">
            {result.state === "loading" && <GymLoading label="Loading your gym" />}
            {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
            {data && (
              <>
                <Animated.View entering={enter(0)} style={{ gap: 2 }}>
                  <Text className="gym-dash-greeting">{`${greetingFor(now)},`}</Text>
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <Text className="gym-dash-name" numberOfLines={1}>{data.gym.name}</Text>
                    <View className="gym-role-pill">
                      <GradientFill radius={6} />
                      <Text className="gym-role-pill__label">{roleLabel(user?.role)}</Text>
                    </View>
                  </View>
                </Animated.View>

                <Animated.View entering={enter(1)}>
                  <RevenueCard online={data.revenue.online} cash={data.revenue.cash} action={{ label: "Wallet", onPress: () => router.push("/gym/wallet") }} />
                </Animated.View>

                <Animated.View entering={enter(2)} className="gym-dash-section">
                  <View className="flex-row items-center">
                    <Text className="gym-dash-section__title" accessibilityRole="header">Today</Text>
                    <Text className="gym-dash-section__note">Tap a count for its payments</Text>
                  </View>
                  <View className="gym-dash-card flex-row flex-wrap">
                    {stats.map((stat, index) => (
                      <PressableScale
                        key={stat.id}
                        onPress={() => router.push(stat.href)}
                        className="gym-dash-stat"
                        style={{ width: `${100 / columns}%`, borderRightWidth: index % columns === columns - 1 ? 0 : 1, borderTopWidth: index >= columns ? 1 : 0 }}
                        accessibilityRole="button"
                        accessibilityLabel={`${stat.value} ${stat.label}`}
                      >
                        <View className="gym-dash-stat__icon" style={{ backgroundColor: stat.color.box }}>
                          <GymIcon name={stat.icon} size={16} color={stat.color.icon} />
                        </View>
                        <View>
                          <AnimatedNumber className="gym-dash-stat__value">{String(stat.value)}</AnimatedNumber>
                          <Text className="gym-dash-stat__label" numberOfLines={1}>{stat.label}</Text>
                        </View>
                      </PressableScale>
                    ))}
                  </View>
                </Animated.View>

                <Animated.View entering={enter(3)} className="gym-dash-section">
                  <Text className="gym-dash-section__title" accessibilityRole="header">Needs attention</Text>
                  <View className="gym-dash-card">
                    {alerts.map((alert, index) => {
                      const tone = toneColors(colors, alert.tone);
                      const active = alert.value > 0;
                      return (
                        <PressableScale key={alert.id} onPress={() => (alert.id === "due" ? setSheet("due") : router.push(alert.href))} className="gym-dash-row" style={{ borderTopWidth: index === 0 ? 0 : 1 }} accessibilityRole="button" accessibilityLabel={`${alert.value} ${alert.label}, ${alert.tag}`}>
                          <View className="gym-dash-row__icon" style={{ backgroundColor: tone.soft }}>
                            <GymIcon name={alert.icon} size={18} color={tone.icon} />
                          </View>
                          <View className="min-w-0 flex-1">
                            <Text className="gym-dash-row__title" numberOfLines={1}>{alert.label}</Text>
                            <Text className="gym-dash-row__text" numberOfLines={1}>{alert.hint}</Text>
                          </View>
                          <View className="gym-dash-count" style={{ backgroundColor: active ? tone.soft : colors.gymBar }}>
                            <AnimatedNumber className="gym-dash-count__label" style={{ color: active ? tone.text : colors.gymFaint }}>{String(alert.value)}</AnimatedNumber>
                          </View>
                          <GymIcon name="chevron-right" size={16} color={colors.gymFaint} />
                        </PressableScale>
                      );
                    })}
                  </View>
                </Animated.View>

                <Animated.View entering={enter(4)}>
                  <PressableScale onPress={() => setSheet("sms")} className="gym-dash-card gym-dash-row" accessibilityRole="button" accessibilityLabel="Send Bulk SMS. Auto reminders, alerts and wishes">
                    <View className="gym-dash-row__icon" style={{ backgroundColor: colors.gymPrimarySoft }}>
                      <GymIcon name="message-square-text" size={18} color={colors.gymPrimary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="gym-dash-row__title" numberOfLines={1}>Send Bulk SMS</Text>
                      <Text className="gym-dash-row__text" numberOfLines={1}>{"Auto Reminders, Alerts & Wishes"}</Text>
                    </View>
                    <GymIcon name="chevron-right" size={16} color={colors.gymFaint} />
                  </PressableScale>
                </Animated.View>

                <Animated.View entering={enter(5)} className="gym-dash-section">
                  <View className="flex-row items-center">
                    <Text className="gym-dash-section__title" accessibilityRole="header">Recent Transactions</Text>
                    <PressableScale onPress={() => router.push("/gym/transactions")} hitSlop={10} accessibilityRole="button" accessibilityLabel="View all transactions">
                      <Text className="gym-link">View All</Text>
                    </PressableScale>
                  </View>
                  {data.recent.length === 0 ? (
                    <GymEmpty icon="indian-rupee" title="No payments yet" text="Tap + to record an admission, a renewal, a due payment or a shop sale." />
                  ) : (
                    <View style={{ gap: 8 }}>
                      {data.recent.map((payment) => (
                        <PaymentRow key={payment.id} payment={payment} onPress={payment.memberId ? () => router.push({ pathname: "/gym/members/[id]", params: { id: String(payment.memberId) } }) : undefined} />
                      ))}
                    </View>
                  )}
                </Animated.View>
              </>
            )}
          </View>
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
