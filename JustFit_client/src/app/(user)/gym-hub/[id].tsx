import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { PrimaryButton } from "@/components/PrimaryButton";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { durationText, monthGrid, monthLabel, pausedTimes, planProgress, timeText } from "@/lib/gymHubText";
import { hud } from "@/lib/hud";
import { membershipApi, type MembershipDetail } from "@/lib/membershipApi";
import { historyLine, membershipBadge, pauseLine, planText, prettyDate } from "@/lib/membershipText";
import { confirmChoice } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string; missing: boolean } | { state: "ready"; data: MembershipDetail };

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

// Gym Hub › a membership: the plan and its dates, renewal, attendance (stats, a month's calendar and
// its visits with their times), pauses (the open one, how many, the history, Pause Membership) and
// the payments the gym recorded. Everything comes from the server for this account's own number.
export default function MembershipPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const getToken = useSessionToken();
  const [result, setResult] = useState<Load>({ state: "loading" });
  // The month on the calendar (null: this month); a change keeps the page and reloads its visits
  const [month, setMonth] = useState<string | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const call = useRef(0);

  const load = useCallback(async (wanted: string | null) => {
    const turn = ++call.current;
    const answer = await membershipApi.detail(await getToken().catch(() => null), memberId, wanted ?? undefined);
    if (turn !== call.current) return;
    setMonthLoading(false);
    if (answer.ok) return setResult({ state: "ready", data: answer.data });
    setResult((current) => (current.state === "ready" && wanted ? current : { state: "failed", error: answer.error, missing: answer.status === 404 || answer.status === 400 }));
  }, [getToken, memberId]);
  useFocusEffect(useCallback(() => { load(month); }, [load, month]));
  const { refreshControl } = usePullToRefresh(() => load(month));

  const showMonth = (next: string | null) => {
    if (!next) return;
    setMonthLoading(true);
    setMonth(next);
  };

  const cancelPause = async (data: MembershipDetail) => {
    const pause = data.membership.pause;
    if (!pause || cancelling) return;
    const ok = await confirmChoice({ title: "Cancel your pause request?", message: "You can send a new one any time.", confirmLabel: "Cancel request", cancelLabel: "Keep it" });
    if (!ok) return;
    setCancelling(true);
    setCancelError(null);
    const answer = await membershipApi.cancelPause(await getToken().catch(() => null), data.membership.id, pause.id);
    setCancelling(false);
    if (!answer.ok) return setCancelError(answer.error);
    hud.success("Request cancelled");
    load(month);
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/gym-hub"));
  const title = result.state === "ready" ? result.data.membership.gym.name : "Membership";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScreenHeader title={title} subtitle={result.state === "ready" ? `${result.data.membership.gym.branch} branch` : undefined} onBack={back} />

        {result.state === "loading" ? (
          <View className="p-4"><ScreenSkeleton cards={3} label="Loading your membership" /></View>
        ) : result.state === "failed" ? (
          <View className="p-4">
            <View className="card" style={{ gap: 12 }}>
              <FormAlert message={result.error} />
              {result.missing ? (
                <PrimaryButton label="Back to Gym Hub" onPress={() => router.replace("/gym-hub")} />
              ) : (
                <PrimaryButton label="Try again" onPress={() => { setResult({ state: "loading" }); load(month); }} />
              )}
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
            <Overview data={result.data} />
            <Renewal data={result.data} />
            <Attendance data={result.data} loading={monthLoading} onMonth={showMonth} />
            <Pauses data={result.data} cancelling={cancelling} error={cancelError} onCancel={() => cancelPause(result.data)} />
            <Payments data={result.data} />
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );

}

// ─── Sections ───────────────────────────────────────────────────────────────────────────────

function Overview({ data }: { data: MembershipDetail }) {
  const colors = useThemeColors();
  const m = data.membership;
  const badge = membershipBadge(m);
  const gone = planProgress(m.joinedOn, m.expiresOn, data.today);
  return (
    <View className="card" style={{ gap: 12 }}>
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 8 }}>
        <View className={`badge badge--${badge.tone}`}>
          <Text className={`badge__label badge__label--${badge.tone}`}>{badge.label}</Text>
        </View>
        <Text className="type-caption text-muted">{`Member ID ${m.code}`}</Text>
      </View>
      <Text className="type-title text-ink">{`${planText(m.planLength)} plan`}</Text>
      <View style={{ gap: 6 }}>
        <View className="progress-stat__track" style={{ flex: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View className="progress-stat__fill" style={{ width: `${Math.round(gone * 100)}%`, backgroundColor: m.status === "expired" ? colors.faint : colors.leaf }} />
        </View>
        <View className="flex-row justify-between" style={{ gap: 8 }}>
          <View>
            <Text className="type-caption text-muted">Started</Text>
            <Text className="type-body text-ink">{prettyDate(m.joinedOn)}</Text>
          </View>
          <View className="items-end">
            <Text className="type-caption text-muted">{m.status === "expired" ? "Ended" : "Ends"}</Text>
            <Text className="type-body text-ink">{prettyDate(m.expiresOn)}</Text>
          </View>
        </View>
      </View>
      {m.due > 0 && <Text className="type-body" style={{ color: colors.danger }}>{`₹${m.due.toLocaleString("en-IN")} due${m.dueBy ? ` · pay by ${prettyDate(m.dueBy)}` : ""}`}</Text>}
      {m.pt && <Text className="type-caption text-muted">{`Personal training · ${m.pt.label} · ${prettyDate(m.pt.from)} to ${prettyDate(m.pt.until)}${m.pt.active ? "" : " (ended)"}`}</Text>}
    </View>
  );
}

function Renewal({ data }: { data: MembershipDetail }) {
  const colors = useThemeColors();
  const m = data.membership;
  const line =
    m.status === "expired"
      ? `Your plan ended on ${prettyDate(m.expiresOn)}. Renew at the ${m.gym.name} front desk to check in again.`
      : m.daysLeft <= 7
        ? `Your plan ends ${m.daysLeft === 0 ? "today" : `in ${m.daysLeft} ${m.daysLeft === 1 ? "day" : "days"}`}. Renew at the front desk to keep your visits going.`
        : `Renew at the ${m.gym.name} front desk before ${prettyDate(m.expiresOn)}. A renewal starts the day after your plan ends.`;
  return (
    <View className="card flex-row items-start" style={{ gap: 12 }}>
      <SymbolView name={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }} size={18} tintColor={m.status === "expired" || m.daysLeft <= 7 ? colors.leaf : colors.inkSoft} />
      <View className="min-w-0 flex-1" style={{ gap: 2 }}>
        <Text className="card__title">Renewal</Text>
        <Text className="type-caption text-muted">{line}</Text>
      </View>
    </View>
  );
}

function Attendance({ data, loading, onMonth }: { data: MembershipDetail; loading: boolean; onMonth: (month: string | null) => void }) {
  const colors = useThemeColors();
  const a = data.attendance;
  const visited = new Map(a.days.map((d) => [d.date, d]));
  const stats: [string, string][] = [
    ["This month", String(a.stats.thisMonth)],
    ["Last 7 days", String(a.stats.last7Days)],
    ["All visits", String(a.stats.totalDays)],
    ["Average stay", a.stats.averageMin === null ? "—" : durationText(a.stats.averageMin)],
  ];
  return (
    <View style={{ gap: 12 }}>
      <View className="flex-row items-center justify-between">
        <Text className="type-headline text-ink" accessibilityRole="header">Attendance</Text>
        <PressableScale onPress={() => router.push("/attendance")} className="address-action" accessibilityRole="button" accessibilityLabel="Check in or out">
          <SymbolView name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }} size={14} tintColor={colors.leaf} />
          <Text className="address-action__label" style={{ color: colors.primaryText }}>Check in / out</Text>
        </PressableScale>
      </View>

      {/* Visit days (two check-ins on one day count once) */}
      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        {stats.map(([label, value]) => (
          <View key={label} className="card" style={{ flexGrow: 1, flexBasis: "45%", gap: 2, paddingVertical: 12 }} accessible accessibilityLabel={`${label}: ${value}`}>
            <Text className="type-caption text-muted">{label}</Text>
            <Text className="type-title text-ink">{value}</Text>
          </View>
        ))}
      </View>
      {a.stats.lastVisit && <Text className="type-caption text-muted">{`Last visit ${prettyDate(a.stats.lastVisit)}`}</Text>}

      {/* The month's calendar: a red day had a visit */}
      <View className="card" style={{ gap: 10 }}>
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => onMonth(a.previousMonth)} disabled={!a.previousMonth || loading} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month" accessibilityState={{ disabled: !a.previousMonth }} style={{ opacity: a.previousMonth ? 1 : 0.3, padding: 4 }}>
            <SymbolView name={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} size={16} tintColor={colors.ink} />
          </Pressable>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Text className="card__title" accessibilityRole="header">{monthLabel(a.month)}</Text>
            {loading && <ActivityIndicator size="small" color={colors.leaf} />}
          </View>
          <Pressable onPress={() => onMonth(a.nextMonth)} disabled={!a.nextMonth || loading} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next month" accessibilityState={{ disabled: !a.nextMonth }} style={{ opacity: a.nextMonth ? 1 : 0.3, padding: 4 }}>
            <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.ink} />
          </Pressable>
        </View>
        <View className="flex-row">
          {WEEKDAYS.map((d, i) => <Text key={i} className="type-caption text-muted flex-1 text-center">{d}</Text>)}
        </View>
        {monthGrid(a.month).map((week, w) => (
          <View key={w} className="flex-row">
            {week.map((day, i) => {
              const visit = day ? visited.get(day) : undefined;
              const isToday = day === data.today;
              return (
                <View key={i} className="flex-1 items-center" accessible={!!day} accessibilityLabel={day ? `${prettyDate(day)}${visit ? `, ${visit.visits === 1 ? "visited" : `${visit.visits} visits`}` : ""}${isToday ? ", today" : ""}` : undefined}>
                  {day ? (
                    <View className={visit ? "hub-day hub-day--visited" : isToday ? "hub-day hub-day--today" : "hub-day"}>
                      <Text className={visit ? "hub-day__label hub-day__label--visited" : "hub-day__label"}>{Number(day.slice(8))}</Text>
                    </View>
                  ) : (
                    <View className="hub-day" />
                  )}
                </View>
              );
            })}
          </View>
        ))}
        <Text className="type-caption text-muted text-center">{a.days.length === 0 ? "No visits this month" : `${a.days.length} ${a.days.length === 1 ? "day" : "days"} at the gym`}</Text>
      </View>

      {/* The month's visits with their times */}
      {a.visits.length > 0 && (
        <View className="card" style={{ gap: 0, paddingVertical: 4 }}>
          {a.visits.map((v, i) => (
            <View key={v.id} className="flex-row items-center justify-between" style={{ gap: 8, paddingVertical: 10, borderBottomWidth: i === a.visits.length - 1 ? 0 : 1, borderColor: colors.line }}>
              <View className="min-w-0 flex-1">
                <Text className="type-body text-ink">{prettyDate(v.date)}</Text>
                <Text className="type-caption text-muted">{`${timeText(v.checkedInAt)} – ${v.checkedOutAt ? timeText(v.checkedOutAt) : v.status === "inside" ? "inside now" : "no check-out"}`}</Text>
              </View>
              <Text className="type-caption" style={{ color: v.status === "inside" ? colors.success : colors.muted }}>
                {v.status === "inside" ? "Inside" : v.durationMin !== null ? durationText(v.durationMin) : "—"}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Pauses({ data, cancelling: busy, error, onCancel }: { data: MembershipDetail; cancelling: boolean; error: string | null; onCancel: () => void }) {
  const colors = useThemeColors();
  const m = data.membership;
  const earlier = m.history.filter((p) => p.id !== m.pause?.id);
  const counts = data.pauseCounts;
  return (
    <View style={{ gap: 12 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Pauses</Text>
      <View className="card" style={{ gap: 12 }}>
        <Text className="type-body text-ink">{`${pausedTimes(counts.approved)}${counts.daysPaused > 0 ? ` · ${counts.daysPaused} ${counts.daysPaused === 1 ? "day" : "days"} added to your plan` : ""}`}</Text>
        {m.pause ? (
          <View className="rounded-md bg-cream-deep p-3" style={{ gap: 8 }}>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <SymbolView name={{ ios: "pause.circle", android: "pause_circle", web: "pause_circle" }} size={18} tintColor={colors.leaf} />
              <Text className="type-body text-ink flex-1">{pauseLine(m.pause, m.gym.name, data.today)}</Text>
            </View>
            <Text className="type-caption text-muted">{`Reason: ${m.pause.reason}`}</Text>
            {m.pause.status === "pending" && (
              <Pressable onPress={onCancel} disabled={busy} accessibilityRole="button" hitSlop={8} className="self-start">
                <Text className="auth__note-link">{busy ? "Cancelling…" : "Cancel request"}</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <PrimaryButton label="Pause Membership" onPress={() => router.push({ pathname: "/membership/pause", params: { id: String(m.id) } })} disabled={!m.canPause} />
            <Text className="type-caption text-muted text-center">
              {m.pauseProblem ?? `Going away? Pause for up to ${m.limits.maxDays} days. The gym approves it, and the days are added to your plan.`}
            </Text>
          </View>
        )}
        {error && <FormAlert message={error} />}
        {earlier.length > 0 && (
          <View style={{ gap: 6 }}>
            <Text className="type-caption text-muted">History</Text>
            {earlier.map((p) => <Text key={p.id} className="type-caption text-ink">{historyLine(p)}</Text>)}
          </View>
        )}
      </View>
    </View>
  );
}

function Payments({ data }: { data: MembershipDetail }) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: 12 }}>
      <Text className="type-headline text-ink" accessibilityRole="header">Payments</Text>
      <View className="card" style={{ paddingVertical: 4 }}>
        {data.payments.length === 0 ? (
          <Text className="type-caption text-muted" style={{ paddingVertical: 12 }}>No payments recorded by the gym yet.</Text>
        ) : (
          data.payments.map((p, i) => (
            <View key={p.id} className="flex-row items-center justify-between" style={{ gap: 8, paddingVertical: 10, borderBottomWidth: i === data.payments.length - 1 ? 0 : 1, borderColor: colors.line }} accessible accessibilityLabel={`${p.label}, ${p.detail}, ₹${p.amount} by ${p.method}, ${prettyDate(p.paidOn)}`}>
              <View className="min-w-0 flex-1">
                <Text className="type-body text-ink" numberOfLines={1}>{p.label}</Text>
                <Text className="type-caption text-muted" numberOfLines={1}>{`${p.detail} · ${prettyDate(p.paidOn)}`}</Text>
              </View>
              <View className="items-end">
                <Text className="type-body text-ink">{`₹${p.amount.toLocaleString("en-IN")}`}</Text>
                <Text className="type-caption text-muted">{p.method === "cash" ? "Cash" : "Online"}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
