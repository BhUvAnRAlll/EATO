import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymChips } from "@/components/gym/GymField";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { PaymentRow } from "@/components/gym/PaymentRow";
import { KIND_LABEL } from "@/data/gymDashboard";
import { gymApi, type GymPayment, type PaymentKind } from "@/lib/gymApi";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

type KindFilter = PaymentKind | "all";
const KINDS: KindFilter[] = ["all", "admission", "renewal", "due", "pt", "service", "sale"];
const isKind = (value: unknown): value is KindFilter => typeof value === "string" && (KINDS as string[]).includes(value);

// Gym admin › Transactions (View All): every payment, newest first, by type, 50 at a time.
// Home's count tiles open it on today's admissions, renewals or due payments.
export default function GymTransactions() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ kind?: string; today?: string }>();
  const [kind, setKind] = useState<KindFilter>(isKind(params.kind) ? params.kind : "all");
  const [todayOnly, setTodayOnly] = useState(params.today === "1");
  const [more, setMore] = useState<{ items: GymPayment[]; next: number | null; loading: boolean; error: string }>({ items: [], next: null, loading: false, error: "" });
  const getToken = useSessionToken();

  const load = useCallback(
    async (token: string | null) => {
      const answer = await gymApi.payments(token, { kind: kind === "all" ? null : kind, today: todayOnly });
      if (answer.ok) setMore({ items: [], next: answer.data.nextBefore, loading: false, error: "" });
      return answer;
    },
    [kind, todayOnly],
  );
  const { result, retry } = useGymData(load);

  const loadMore = async () => {
    if (more.loading || !more.next) return;
    setMore((m) => ({ ...m, loading: true, error: "" }));
    const answer = await gymApi.payments(await getToken().catch(() => null), { kind: kind === "all" ? null : kind, today: todayOnly, before: more.next });
    setMore((m) => (answer.ok ? { items: [...m.items, ...answer.data.payments], next: answer.data.nextBefore, loading: false, error: "" } : { ...m, loading: false, error: answer.error }));
  };

  const rows = result.state === "ready" ? [...result.data.payments, ...more.items] : [];
  return (
    <GymScreen title="Transactions">
      <GymChips options={KINDS.map((k) => ({ value: k, label: k === "all" ? "All" : KIND_LABEL[k] }))} value={kind} onChange={setKind} />
      <GymChips options={[{ value: "any", label: "Any day" }, { value: "today", label: "Today" }]} value={todayOnly ? "today" : "any"} onChange={(v) => setTodayOnly(v === "today")} />
      {result.state === "loading" && <GymLoading label="Loading transactions" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" &&
        (rows.length === 0 ? (
          <GymEmpty icon="indian-rupee" title="No transactions" text={todayOnly ? "Nothing of this type has been recorded today." : "Nothing of this type has been recorded yet."} />
        ) : (
          <View style={{ gap: 10 }}>
            {rows.map((p) => (
              <PaymentRow key={p.id} payment={p} onPress={p.memberId ? () => router.push({ pathname: "/gym/members/[id]", params: { id: String(p.memberId) } }) : undefined} />
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
