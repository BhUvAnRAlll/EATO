import { useCallback, useRef, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { BusyHoursCard, hourTick } from "@/components/gym/BusyHoursCard";
import { GymChips } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { VisitHistory } from "@/components/gym/VisitHistory";
import { VisitRow } from "@/components/gym/VisitRow";
import { durationText } from "@/lib/attendanceText";
import { gymApi, type AttendanceSummary } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

type Period = "today" | "week" | "month";
const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT_MONTH[Number(iso.slice(5, 7)) - 1]}`;

// Gym admin › Attendance: who is inside now (with Check out for the front desk), today's
// check-ins and completed visits, the Statistics for Today / Last 7 days / Last 30 days with the
// chart following the period (today by hour, the others a bar a day; 2026-11-07, the user's
// request), tomorrow's busy hours (the prediction, `BusyHoursCard`), then the history with its
// filters and CSV export.
// Settings (location, radius) and the QR code are in the header. Every number is the server's
// (GET /api/gym/attendance and /api/gym/predictions/busy-hours), read whenever the screen opens.
export default function GymAttendance() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { result, reload, retry, refreshing, refresh } = useGymData(gymApi.attendance);
  // Role & Permission: busy hours are Predictions; a login without it isn't shown a card the server
  // would refuse (QA 2026-11-07). A stable `load` per answer, as useGymData expects.
  const can = useCan();
  const canPredict = can("predictions.busy");
  // Location and the QR code are Attendance › Location and QR code; Check out is Check members in and out
  const canSetUp = can("attendance.settings");
  const canCheckOut = can("attendance.checkin");
  const loadBusy = useCallback((token: string | null) => (canPredict ? gymApi.busyHours(token) : Promise.resolve({ ok: false as const, error: "Your login doesn't include Predictions.", status: 403 })), [canPredict]);
  const busy = useGymData(loadBusy);
  const [period, setPeriod] = useState<Period>("today");
  const [checkingOut, setCheckingOut] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  // A pull re-reads the history list too, not only the summary (QA 2026-11-07)
  const refreshAll = async () => {
    setRefreshKey((k) => k + 1);
    await Promise.all([refresh(), canPredict ? busy.reload() : Promise.resolve()]);
  };

  // A ref, not state, so two taps in one frame can't send two check-outs
  const checkingOutRef = useRef(false);
  const checkOut = async (memberId: number) => {
    if (checkingOutRef.current) return;
    checkingOutRef.current = true;
    setCheckingOut(memberId);
    setError("");
    const answer = await gymApi.checkOut(await getToken().catch(() => null), memberId);
    checkingOutRef.current = false;
    setCheckingOut(null);
    if (!answer.ok) return setError(answer.error);
    haptic.success();
    await reload();
    setRefreshKey((k) => k + 1);
  };

  const header = canSetUp ? (
    <View className="flex-row" style={{ gap: 8 }}>
      <PressableScale onPress={() => router.push("/gym/attendance/qr")} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Attendance QR code">
        <GymIcon name="qr-code" size={18} color={colors.gymInk} />
      </PressableScale>
      <PressableScale onPress={() => router.push("/gym/attendance/settings")} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Gym location and attendance settings">
        <GymIcon name="settings" size={18} color={colors.gymInk} />
      </PressableScale>
    </View>
  ) : undefined;

  if (result.state !== "ready") {
    return (
      <GymScreen title="Attendance" right={header}>
        {result.state === "loading" ? <GymLoading label="Loading attendance" /> : <GymError error={result.error} onRetry={retry} />}
      </GymScreen>
    );
  }
  const data: AttendanceSummary = result.data;
  const stats = data.stats[period];
  // The chart for the period: today's check-ins by hour (the busiest hour full strength), else
  // one bar a day with today's full strength. Wide charts drop the per-bar number and label
  // every third hour or fifth day, as the busy hours card does.
  const chart = period === "today"
    ? data.charts.today.map((h) => ({ key: String(h.hour), visits: h.visits, tick: hourTick(h.hour), strong: h.visits > 0 && h.visits === Math.max(...data.charts.today.map((x) => x.visits)) }))
    : data.charts[period].map((d) => ({ key: d.day, visits: d.visits, tick: period === "week" ? WEEKDAY[new Date(`${d.day}T00:00:00Z`).getUTCDay()] : shortDate(d.day), strong: d.day === data.today }));
  const peak = Math.max(1, ...chart.map((c) => c.visits));
  const chartTitle = period === "today" ? "Check-ins by hour, today" : period === "week" ? "Visits, last 7 days" : "Visits, last 30 days";
  const every = period === "today" ? 3 : period === "month" ? 5 : 1;
  const ticks = chart.filter((_, i) => i % every === 0).map((c, i, list) => ({ key: c.key, tick: c.tick, span: i === list.length - 1 ? chart.length - i * every : every }));
  const tiles = [
    { label: "Inside now", value: data.insideNow, icon: "user-check" as const, color: colors.gymSuccess, bg: colors.gymSuccessSoft },
    { label: "Check-ins today", value: data.stats.today.visits, icon: "log-in" as const, color: colors.gymPrimary, bg: colors.gymPrimarySoft },
    { label: "Completed today", value: data.stats.today.completed, icon: "circle-check" as const, color: colors.gymPrimary, bg: colors.gymPrimarySoft },
  ];

  return (
    <GymScreen title="Attendance" right={header} refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refreshAll} />}>
      {canSetUp && (!data.setup.location || !data.setup.qr) ? (
        <PressableScale onPress={() => router.push(data.setup.location ? "/gym/attendance/qr" : "/gym/attendance/settings")} className="gym-warning" accessibilityRole="button" accessibilityLabel={data.setup.location ? "Create the attendance QR code" : "Set the gym's location"}>
          <GymIcon name="triangle-alert" size={18} color={colors.gymWarning} />
          <Text className="gym-warning__text flex-1">
            {data.setup.location
              ? "Create your attendance QR code and put it at the front desk so members can check in."
              : "Set your gym's location and attendance radius first: members' scans are refused until then."}
          </Text>
        </PressableScale>
      ) : null}

      <View className="flex-row" style={{ gap: 10 }}>
        {tiles.map((t) => (
          <View key={t.label} className="gym-dash-card gym-dash-stat flex-1" accessible accessibilityLabel={`${t.value} ${t.label}`}>
            <View className="gym-dash-stat__icon" style={{ backgroundColor: t.bg }}>
              <GymIcon name={t.icon} size={16} color={t.color} />
            </View>
            <Text className="gym-dash-stat__value">{t.value}</Text>
            <Text className="gym-dash-stat__label" numberOfLines={2}>{t.label}</Text>
          </View>
        ))}
      </View>

      <Text className="gym-section-title" accessibilityRole="header">{`Inside now (${data.insideNow})`}</Text>
      {error ? <FormAlert message={error} /> : null}
      {data.inside.length === 0 ? (
        <Text className="gym-tx__meta">Nobody is checked in right now.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {data.inside.map((visit) => (
            <VisitRow key={visit.id} visit={visit} busy={checkingOut === visit.memberId} onCheckOut={canCheckOut ? () => checkOut(visit.memberId) : undefined} onPress={() => router.push({ pathname: "/gym/members/[id]", params: { id: String(visit.memberId) } })} />
          ))}
        </View>
      )}

      <Text className="gym-section-title" accessibilityRole="header">Statistics</Text>
      <View className="gym-dash-card" style={{ padding: 14, gap: 14 }}>
        <GymChips options={PERIODS} value={period} onChange={setPeriod} />
        <View className="flex-row">
          {[
            ["Visits", String(stats.visits)],
            ["Members", String(stats.members)],
            ["Completed", String(stats.completed)],
            ["Avg. visit", stats.avgMinutes === null ? "—" : durationText(stats.avgMinutes)],
          ].map(([label, value]) => (
            <View key={label} className="gym-stat" accessible accessibilityLabel={`${label}: ${value}`}>
              <Text className="gym-tx__name">{value}</Text>
              <Text className="gym-stat__label" numberOfLines={1}>{label}</Text>
            </View>
          ))}
        </View>
        <Text className="gym-tx__meta">{chartTitle}</Text>
        <View accessible accessibilityLabel={`${chartTitle}, from ${chart[0]?.tick ?? ""}: ${chart.map((c) => c.visits).join(", ")}`}>
          <View className="gym-bars" style={every > 1 ? { gap: 2 } : undefined}>
            {chart.map((c) => (
              <View key={c.key} className="gym-bars__col" style={every > 1 ? { gap: 2 } : undefined}>
                <Text className="gym-stat__label" style={every > 1 ? { fontSize: 9, lineHeight: 11 } : undefined} numberOfLines={1}>{every === 1 || c.visits > 0 ? String(c.visits) : " "}</Text>
                <View className="gym-bars__bar" style={{ height: `${Math.max(4, (c.visits / peak) * 60)}%`, opacity: c.strong ? 1 : 0.45 }} />
              </View>
            ))}
          </View>
          <View className="flex-row" style={every > 1 ? { gap: 2, marginTop: 4 } : { gap: 6, marginTop: 4 }}>
            {ticks.map((t) => (
              <Text key={t.key} className="gym-stat__label" style={{ flex: t.span, fontSize: every > 1 ? 10 : 12, lineHeight: every > 1 ? 12 : 16, textAlign: every > 1 ? "left" : "center" }} numberOfLines={1}>{t.tick}</Text>
            ))}
          </View>
        </View>
      </View>

      {canPredict && (
        <>
          <Text className="gym-section-title" accessibilityRole="header">{"Tomorrow's busy hours"}</Text>
          <BusyHoursCard result={busy.result} onRetry={busy.retry} />
        </>
      )}

      <Text className="gym-section-title" accessibilityRole="header">Attendance history</Text>
      <VisitHistory refreshKey={refreshKey} />
    </GymScreen>
  );
}
