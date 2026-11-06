import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { BusyHoursCard } from "@/components/gym/BusyHoursCard";
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
import { useThemeColors } from "@/theme";

type Period = "today" | "week" | "month";
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Gym admin › QR Attendance: who is inside now (with Check out for the front desk), today's
// check-ins and completed visits, daily / weekly / monthly numbers, the last 7 days, tomorrow's
// busy hours (the prediction, `BusyHoursCard`), then the history with its filters and CSV export.
// Settings (location, radius) and the QR code are in the header. Every number is the server's
// (GET /api/gym/attendance and /api/gym/predictions/busy-hours), read whenever the screen opens.
export default function GymAttendance() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { result, reload, retry } = useGymData(gymApi.attendance);
  const busy = useGymData(gymApi.busyHours);
  const [period, setPeriod] = useState<Period>("today");
  const [checkingOut, setCheckingOut] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const checkOut = async (memberId: number) => {
    if (checkingOut) return;
    setCheckingOut(memberId);
    setError("");
    const answer = await gymApi.checkOut(await getToken().catch(() => null), memberId);
    setCheckingOut(null);
    if (!answer.ok) return setError(answer.error);
    haptic.success();
    await reload();
    setRefreshKey((k) => k + 1);
  };

  const header = (
    <View className="flex-row" style={{ gap: 8 }}>
      <PressableScale onPress={() => router.push("/gym/attendance/qr")} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Attendance QR code">
        <GymIcon name="qr-code" size={18} color={colors.gymInk} />
      </PressableScale>
      <PressableScale onPress={() => router.push("/gym/attendance/settings")} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel="Gym location and attendance settings">
        <GymIcon name="settings" size={18} color={colors.gymInk} />
      </PressableScale>
    </View>
  );

  if (result.state !== "ready") {
    return (
      <GymScreen title="QR Attendance" right={header}>
        {result.state === "loading" ? <GymLoading label="Loading attendance" /> : <GymError error={result.error} onRetry={retry} />}
      </GymScreen>
    );
  }
  const data: AttendanceSummary = result.data;
  const stats = data.stats[period];
  const peak = Math.max(1, ...data.lastSevenDays.map((d) => d.visits));
  const tiles = [
    { label: "Inside now", value: data.insideNow, icon: "user-check" as const, color: colors.gymSuccess, bg: colors.gymSuccessSoft },
    { label: "Check-ins today", value: data.stats.today.visits, icon: "log-in" as const, color: colors.gymPrimary, bg: colors.gymPrimarySoft },
    { label: "Completed today", value: data.stats.today.completed, icon: "circle-check" as const, color: colors.gymPrimary, bg: colors.gymPrimarySoft },
  ];

  return (
    <GymScreen title="QR Attendance" right={header}>
      {!data.setup.location || !data.setup.qr ? (
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
            <VisitRow key={visit.id} visit={visit} busy={checkingOut === visit.memberId} onCheckOut={() => checkOut(visit.memberId)} onPress={() => router.push({ pathname: "/gym/members/[id]", params: { id: String(visit.memberId) } })} />
          ))}
        </View>
      )}

      <Text className="gym-section-title" accessibilityRole="header">Statistics</Text>
      <View className="gym-dash-card" style={{ padding: 14, gap: 14 }}>
        <GymChips options={[{ value: "today", label: "Daily" }, { value: "week", label: "Weekly" }, { value: "month", label: "Monthly" }]} value={period} onChange={setPeriod} />
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
        <Text className="gym-tx__meta">Visits, last 7 days</Text>
        <View className="gym-bars" accessible accessibilityLabel={`Visits in the last 7 days: ${data.lastSevenDays.map((d) => d.visits).join(", ")}`}>
          {data.lastSevenDays.map((d) => (
            <View key={d.day} className="gym-bars__col">
              <Text className="gym-stat__label">{d.visits}</Text>
              <View className="gym-bars__bar" style={{ height: `${Math.max(4, (d.visits / peak) * 60)}%`, opacity: d.day === data.today ? 1 : 0.45 }} />
              <Text className="gym-stat__label">{WEEKDAY[new Date(`${d.day}T00:00:00Z`).getUTCDay()]}</Text>
            </View>
          ))}
        </View>
      </View>

      <Text className="gym-section-title" accessibilityRole="header">{"Tomorrow's busy hours"}</Text>
      <BusyHoursCard result={busy.result} onRetry={busy.retry} />

      <Text className="gym-section-title" accessibilityRole="header">Attendance history</Text>
      <VisitHistory refreshKey={refreshKey} />
    </GymScreen>
  );
}
