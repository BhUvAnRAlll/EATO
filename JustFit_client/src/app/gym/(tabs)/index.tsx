import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, type Href } from "expo-router";
import { useEffect, useState } from "react";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

import { PressableScale } from "@/components/PressableScale";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { GymIcon } from "@/components/gym/GymIcon";
import { AddMemberSheet } from "@/components/gym/AddMemberSheet";
import { AddSheet } from "@/components/gym/AddSheet";
import { BulkSmsSheet } from "@/components/gym/BulkSmsSheet";
import { DueMembersSheet } from "@/components/gym/DueMembersSheet";
import { EnquirySheet } from "@/components/gym/EnquirySheet";
import { GymMenu } from "@/components/gym/GymMenu";
import { GradientFill } from "@/components/gym/GradientFill";
import { PaymentRow } from "@/components/gym/PaymentRow";
import { RevenueCard } from "@/components/gym/RevenueCard";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { HOME_EXPIRING_DAYS, greetingFor, type AddAction } from "@/data/gymDashboard";
import { comingSoon } from "@/lib/gymPortal";
import { gymApi, type GymAccess, type StaffOption } from "@/lib/gymApi";
import { useGymData } from "@/lib/useGymData";
import { useCan, useGymAccess } from "@/store/gymAccess";
import { useThemeColors, type Palette } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";

// The pill beside the gym's name: the account's role as the server gave it
// The pill under the name: the gym admin or Staff at this branch
const roleLabel = (access: GymAccess | undefined) => (access === "staff" ? "STAFF" : "ADMIN");

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
  const { result, reload, retry } = useGymData(gymApi.dashboard);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The + sheet, or Add New Member opened from it
  const [sheet, setSheet] = useState<"add" | "member" | "due" | "sms" | "enquiry" | null>(null);
  const pick = (action: AddAction) => {
    setSheet(null);
    // The next sheet opens once the + sheet has gone: iOS can drop a Modal shown while another closes
    if (action === "member") return void setTimeout(() => setSheet("member"), 250);
    if (action === "sms") return void setTimeout(() => setSheet("sms"), 250);
    if (action === "enquiry") return void setTimeout(() => setSheet("enquiry"), 250);
    const go: Partial<Record<AddAction, () => void>> = {
      plan: () => router.push("/gym/catalog"),
      outlet: () => router.push("/gym/branches?add=1"),
      staff: () => router.push("/gym/staff?add=1"),
      attendance: () => router.push("/gym/attendance"),
      expense: () => router.push("/gym/expenses?add=1"),
    };
    if (go[action]) go[action]!();
    else setTimeout(() => comingSoon("This"), 250);
  };
  // Six counts in one row on a tablet or the web, otherwise two rows of three
  const columns = useWindowDimensions().width >= 700 ? 6 : 3;
  const now = new Date();
  const data = result.state === "ready" ? result.data : null;
  // Role & Permission: what this login may open (the dashboard says); the rest of the portal hides it
  const can = useCan();
  const setAreas = useGymAccess((state) => state.setAreas);
  const areasKey = data?.gym.areas.join(",");
  useEffect(() => {
    if (data) setAreas(data.gym.areas, data.gym.options);
  }, [areasKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the joined list is the value that matters

  // Each count tile has its own soft colour and icon (the user's design)
  const tile = (k: "Violet" | "Orange" | "Blue" | "Green" | "Pink" | "Purple") => ({
    bg: colors[`gymTile${k}`],
    line: colors[`gymTile${k}Line`],
    box: colors[`gymTile${k}Box`],
    icon: colors[`gymTile${k}Icon`],
  });
  // need: the option what the tile opens needs (a Staff login without it sees the count, but it
  // isn't a button). No counts at all without Home › Today's counts (the server sends none).
  const stats: { id: string; value: number; label: string; color: ReturnType<typeof tile>; icon: GymIconName; href: Href; need: StaffOption }[] = data?.stats
    ? [
        { id: "admission", value: data.stats.admission, label: "Admission", color: tile("Violet"), icon: "users", href: "/gym/transactions?kind=admission&today=1", need: "payments.transactions" },
        { id: "renewal", value: data.stats.renewal, label: "Renewal", color: tile("Orange"), icon: "refresh-ccw", href: "/gym/transactions?kind=renewal&today=1", need: "payments.transactions" },
        { id: "enquiry", value: data.stats.enquiry, label: "Enquiry", color: tile("Blue"), icon: "message-circle-question", href: "/gym/enquiries?view=today", need: "enquiries.view" },
        { id: "due-paid", value: data.stats.duePaid, label: "Due Paid", color: tile("Green"), icon: "indian-rupee", href: "/gym/transactions?kind=due&today=1", need: "payments.transactions" },
        { id: "pt", value: data.stats.pt, label: "PT", color: tile("Pink"), icon: "dumbbell", href: "/gym/transactions?kind=pt&today=1", need: "payments.transactions" },
        { id: "product", value: data.stats.product, label: "Product", color: tile("Purple"), icon: "package", href: "/gym/transactions?kind=sale&today=1", need: "payments.transactions" },
      ]
    : [];
  // need: the option(s) the row opens (any one will do); a count the server left out (null) isn't shown
  const alerts: { id: string; value: number; label: string; tag: string; hint: string; tone: Tone; icon: GymIconName; href: Href; need: StaffOption[] }[] = (data
    ? [
        { id: "due", value: data.alerts.dueMembers, label: "Due Members", tag: "Action", hint: "Payments to collect", tone: "danger", icon: "triangle-alert", href: "/gym/members?filter=due", need: ["predictions.payments", "members.view"] },
        { id: "risk", value: data.alerts.renewalRisk, label: "Likely to leave", tag: "Risk", hint: "High renewal risk, worth a call", tone: "danger", icon: "user-x", href: "/gym/predictions/renewals", need: ["predictions.renewals"] },
        { id: "pauses", value: data.alerts.pauseRequests, label: "Pause requests", tag: "Review", hint: "Members asking to pause their plan", tone: "ink", icon: "circle-pause", href: "/gym/pauses", need: ["members.pause"] },
        { id: "expiring", value: data.alerts.expiringToday, label: "Expiring Today", tag: "Urgent", hint: "Plans ending today", tone: "warning", icon: "clock", href: "/gym/members?filter=expiring", need: ["members.view"] },
        { id: "attendance", value: data.alerts.attendance, label: "Attendance", tag: "Live", hint: "Checked in today", tone: "primary", icon: "scan-qr-code", href: "/gym/attendance", need: ["attendance.view"] },
        { id: "expiring-soon", value: data.alerts.expiringSoon, label: "Expiring soon", tag: "Soon", hint: "Renewals coming up", tone: "warning", icon: "calendar-clock", href: `/gym/members?filter=expiring_soon&days=${HOME_EXPIRING_DAYS}`, need: ["members.view"] },
        { id: "birthdays", value: data.alerts.birthdays, label: "Birthdays Today", tag: "Wish", hint: "Send them a wish", tone: "success", icon: "cake", href: "/gym/members?filter=birthday", need: ["members.view"] },
      ] as const
    : [])
    .filter((alert) => alert.value !== null && alert.need.some(can))
    .map((alert) => ({ ...alert, value: alert.value ?? 0, need: [...alert.need] }));

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
          {can("members.view") && (
            <PressableScale onPress={() => router.push("/gym/members?focus=search")} className="gym-dash-icon-btn" accessibilityRole="button" accessibilityLabel="Search members">
            <GymIcon name="search" size={18} color={colors.gymInk} />
          </PressableScale>
          )}
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
                      <Text className="gym-role-pill__label">{roleLabel(data?.gym.access)}</Text>
                    </View>
                  </View>
                </Animated.View>

                {data.revenue && (
                <Animated.View entering={enter(1)}>
                  <RevenueCard online={data.revenue.online} cash={data.revenue.cash} action={can("payments.wallet") ? { label: "Wallet", onPress: () => router.push("/gym/wallet") } : undefined} />
                </Animated.View>
                )}

                {stats.length > 0 && (
                <Animated.View entering={enter(2)} className="gym-dash-section">
                  <View className="flex-row items-center">
                    <Text className="gym-dash-section__title" accessibilityRole="header">Today</Text>
                    <Text className="gym-dash-section__note">{can("payments.transactions") ? "Tap a count for its payments" : "Today's counts"}</Text>
                  </View>
                  <View className="gym-dash-card flex-row flex-wrap">
                    {stats.map((stat, index) => (
                      <PressableScale
                        key={stat.id}
                        onPress={can(stat.need) ? () => router.push(stat.href) : undefined}
                        disabled={!can(stat.need)}
                        className="gym-dash-stat"
                        style={{ width: `${100 / columns}%`, borderRightWidth: index % columns === columns - 1 ? 0 : 1, borderTopWidth: index >= columns ? 1 : 0 }}
                        accessibilityRole={can(stat.need) ? "button" : "text"}
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
                )}

                {alerts.length > 0 && (
                <Animated.View entering={enter(3)} className="gym-dash-section">
                  <Text className="gym-dash-section__title" accessibilityRole="header">Needs attention</Text>
                  <View className="gym-dash-card">
                    {alerts.map((alert, index) => {
                      const tone = toneColors(colors, alert.tone);
                      const active = alert.value > 0;
                      return (
                        <PressableScale key={alert.id} onPress={() => (alert.id === "due" && can("predictions.payments") ? setSheet("due") : router.push(alert.href))} className="gym-dash-row" style={{ borderTopWidth: index === 0 ? 0 : 1 }} accessibilityRole="button" accessibilityLabel={`${alert.value} ${alert.label}, ${alert.tag}`}>
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
                )}

                {can("sms.view") && (
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
                )}

                {can("payments.transactions") && (
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
                )}
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
      {sheet === "add" && <AddSheet onClose={() => setSheet(null)} onPick={pick} canManageTeam={data?.gym.access === "owner"} />}
      {sheet === "sms" && <BulkSmsSheet onClose={() => setSheet(null)} />}
      {sheet === "enquiry" && (
        <EnquirySheet
          enquiry={null}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            reload();
            router.push("/gym/enquiries");
          }}
        />
      )}
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
      <GymMenu open={menuOpen} onClose={() => setMenuOpen(false)} onBulkSms={() => setTimeout(() => setSheet("sms"), 250)} gymLine={data ? `${data.gym.name} · ${data.gym.branch} branch` : null} canManageTeam={data?.gym.access === "owner"} isStaff={data?.gym.access === "staff"} />
    </View>
  );
}
