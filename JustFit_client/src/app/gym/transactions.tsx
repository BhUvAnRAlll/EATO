import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { DateSelect } from "@/components/gym/DateSelect";
import { FilterChip } from "@/components/gym/GymChip";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { PaymentRow } from "@/components/gym/PaymentRow";
import { KIND_LABEL, shortDate } from "@/data/gymDashboard";
import { indiaDay } from "@/lib/attendanceText";
import { gymApi, type GymPayment, type PaymentKind } from "@/lib/gymApi";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";

type KindFilter = PaymentKind | "all";
const KINDS: KindFilter[] = ["all", "admission", "renewal", "due", "pt", "service", "sale"];
const isKind = (value: unknown): value is KindFilter => typeof value === "string" && (KINDS as string[]).includes(value);

// Gym admin › Transactions (View All): one day's payments, newest first, by type, 50 at a time.
// The day is a date picker (today to start, a year back at most; 2026-11-07, the user's request:
// it replaced the Any day / Today chips). Home's count tiles open it on today's admissions,
// renewals or due payments.
export default function GymTransactions() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<KindFilter>(isKind(params.kind) ? params.kind : "all");
  const today = indiaDay();
  const [day, setDay] = useState(today);
  const [more, setMore] = useState<{ items: GymPayment[]; next: number | null; loading: boolean; error: string }>({ items: [], next: null, loading: false, error: "" });
  const getToken = useSessionToken();
  // Which list Show more belongs to: an answer for an earlier filter is dropped, never appended
  const listKey = useRef(0);

  const load = useCallback(
    async (token: string | null) => {
      const key = ++listKey.current;
      const answer = await gymApi.payments(token, { kind: kind === "all" ? null : kind, day });
      if (answer.ok && key === listKey.current) setMore({ items: [], next: answer.data.nextBefore, loading: false, error: "" });
      return answer;
    },
    [kind, day],
  );
  const { result, retry, refreshing, refresh } = useGymData(load);

  const loadMore = async () => {
    if (more.loading || !more.next) return;
    const key = listKey.current;
    setMore((m) => ({ ...m, loading: true, error: "" }));
    const answer = await gymApi.payments(await getToken().catch(() => null), { kind: kind === "all" ? null : kind, day, before: more.next });
    if (key !== listKey.current) return;
    setMore((m) => (answer.ok ? { items: [...m.items, ...answer.data.payments], next: answer.data.nextBefore, loading: false, error: "" } : { ...m, loading: false, error: answer.error }));
  };

  const rows = result.state === "ready" ? [...result.data.payments, ...more.items] : [];
  return (
    <GymScreen title="Transactions" refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refresh} />}>
      {/* One scrolling row of filter chips, edge to edge, so a cut chip reads as "scroll for more" */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 4 }} accessibilityRole="tablist">
        {KINDS.map((k) => (
          <FilterChip key={k} label={k === "all" ? "All" : KIND_LABEL[k]} selected={k === kind} onPress={() => { if (k !== kind) haptic.select(); setKind(k); }} />
        ))}
      </ScrollView>
      <DateSelect label="Date" value={day} onChange={setDay} min={indiaDay(-365)} max={today} />
      {result.state === "loading" && <GymLoading label="Loading transactions" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" &&
        (rows.length === 0 ? (
          <GymEmpty icon="indian-rupee" title="No transactions" text={day === today ? "Nothing of this type has been recorded today." : `Nothing of this type was recorded on ${shortDate(day)}.`} />
        ) : (
          <View style={{ gap: 10 }}>
            {rows.map((p) => (
              <PaymentRow key={p.id} payment={p} invoice onPress={p.memberId ? () => router.push({ pathname: "/gym/members/[id]", params: { id: String(p.memberId) } }) : undefined} />
            ))}
            {more.error ? <Text className="gym-tx__meta">{more.error}</Text> : null}
            {more.next ? (
              <PressableScale onPress={loadMore} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Show more transactions">
                {more.loading && <ActivityIndicator size="small" color={colors.gymPrimary} />}
                <Text className="gym-btn__label gym-btn__label--outline">Show more</Text>
              </PressableScale>
            ) : null}
          </View>
        ))}
    </GymScreen>
  );
}
