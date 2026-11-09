import { useCallback, useState } from "react";
import { RefreshControl, Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymScreen } from "@/components/gym/GymScreen";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { gymApi, type AttendanceCorrection, type AttendanceCorrections } from "@/lib/gymApi";
import { clockTime } from "@/lib/attendanceText";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

const span = (s: { in: string | null; out: string | null } | null) => (s && s.in ? `${clockTime(s.in)} → ${s.out ? clockTime(s.out) : "no check-out"}` : "—");
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Attendance › Corrections: every visit added or corrected at this branch, newest first, with the
// member, the times before and after, the reason and who made it. Read only; 30 a page.
export default function GymAttendanceCorrections() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const load = useCallback((token: string | null) => gymApi.attendanceCorrections(token, 1), []);
  const { result, retry, refreshing, refresh, update } = useGymData(load);
  const [loadingMore, setLoadingMore] = useState(false);

  const more = async (data: AttendanceCorrections) => {
    if (!data.nextPage || loadingMore) return;
    setLoadingMore(true);
    const answer = await gymApi.attendanceCorrections(await getToken().catch(() => null), data.nextPage);
    setLoadingMore(false);
    if (answer.ok) update((current) => ({ ...answer.data, corrections: [...current.corrections, ...answer.data.corrections] }));
  };

  return (
    <GymScreen title="Corrections" refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refresh} />}>
      {result.state === "loading" && <GymLoading label="Loading corrections" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && (
        result.data.corrections.length === 0 ? (
          <GymEmpty icon="history" title="No corrections yet" text="Visits added or corrected by your team show here with the reason." />
        ) : (
          <View style={{ gap: 10 }}>
            {result.data.corrections.map((c: AttendanceCorrection) => (
              <View key={c.id} className="gym-card" style={{ gap: 4, padding: 12 }} accessible accessibilityLabel={`${c.member.name}, ${c.kind === "add" ? "visit added" : "visit corrected"}. ${c.reason}. By ${c.by}`}>
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <Text className="gym-tx__name flex-1" numberOfLines={1}>{`${c.member.name} · ${c.member.code}`}</Text>
                  <Text className="gym-tag__label" style={{ color: c.kind === "add" ? colors.gymSuccess : colors.gymPrimaryText }}>{c.kind === "add" ? "Added" : "Corrected"}</Text>
                </View>
                {c.before ? <Text className="gym-tx__meta">{`Before: ${span(c.before)}`}</Text> : null}
                <Text className="gym-tx__meta">{`${c.before ? "After" : "Visit"}: ${c.after.in ? `${c.after.in.slice(0, 10)} · ` : ""}${span(c.after)}`}</Text>
                <Text className="gym-tx__meta">{`“${c.reason}”`}</Text>
                <Text className="gym-tx__meta">{`${c.by} · ${when(c.at)}`}</Text>
              </View>
            ))}
            {result.data.nextPage ? (
              <PressableScale onPress={() => more(result.data)} className="gym-btn gym-btn--outline" accessibilityRole="button">
                <Text className="gym-btn__label gym-btn__label--outline">{loadingMore ? "Loading…" : "Show more"}</Text>
              </PressableScale>
            ) : null}
          </View>
        )
      )}
    </GymScreen>
  );
}
