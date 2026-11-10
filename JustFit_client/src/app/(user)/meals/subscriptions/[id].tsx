import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/macro/LoadError";
import { PressableScale } from "@/components/PressableScale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { hud } from "@/lib/hud";
import { SLOT_LABEL, STATUS_LABEL, addDays, dayLabel, type OrderStatus } from "@/lib/mealRules";
import { mealImage } from "@/lib/mealsApi";
import { todayIso } from "@/lib/macro";
import { confirmChoice } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { shortDate, subscriptionLine } from "@/lib/subscriptionRules";
import { subscriptionsApi, type Mine } from "@/lib/subscriptionsApi";
import { useAuthStore } from "@/store/auth";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; mine: Mine };
const SLOT_STATUS: Record<string, string> = { scheduled: "Scheduled", skipped: "Skipped", paused: "Paused", unfilled: "Not made", ordered: "Ordered" };
const PAUSES = [
  { label: "Tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "A week", days: 7 },
];

// Profile › My subscriptions › one (2026-11-10): the meal on a dark card (meal time and how many,
// the dates, meals delivered of all); pause from tomorrow (1 day, 3 days, a week) or resume; the
// next 7 days with Skip day / Undo skip; Cancel subscription. A paused or skipped day moves the end on.
export default function ManageSubscription() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const token = useAuthStore((state) => state.token);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayIso();

  const read = useCallback(async () => {
    const answer = await subscriptionsApi.mine(await getToken());
    setLoad(answer.ok ? { state: "ready", mine: answer.data } : { state: "failed", error: answer.error });
  }, [getToken]);
  useFocusEffect(useCallback(() => { read(); }, [read]));

  const act = async (key: string, call: (token: string | null) => Promise<{ ok: true; data: Mine } | { ok: false; error: string }>, success: string) => {
    if (busy) return;
    setBusy(key);
    const answer = await call(await getToken());
    setBusy(null);
    if (!answer.ok) return hud.error(answer.error);
    setLoad({ state: "ready", mine: answer.data });
    hud.success(success);
  };

  const sub = load.state === "ready" ? load.mine.active.find((s) => s.id === id) ?? null : null;
  const pausedNow = !!sub?.pausedFrom && !!sub.pausedUntil && sub.pausedUntil >= today;
  const share = sub && sub.mealsTotal > 0 ? Math.min(1, sub.mealsUsed / sub.mealsTotal) : 0;
  const cancel = async () => {
    if (!sub) return;
    const sure = await confirmChoice({
      title: `Cancel ${sub.planName}?`,
      message: "Deliveries stop from the next meal the kitchen hasn't started. Payments are in test mode, so nothing is refunded.",
      confirmLabel: "Cancel subscription",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (sure) {
      await act("cancel", (t) => subscriptionsApi.cancel(t, sub.id), "Subscription cancelled");
      router.back();
    }
  };

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title="Subscription" fallback="/meals/subscriptions" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 18 }} showsVerticalScrollIndicator={false}>
          {load.state === "loading" && <ScreenSkeleton label="Loading your subscription" />}
          {load.state === "failed" && <LoadError tone="meal" title="Your subscription couldn't load" message={load.error} onRetry={read} />}
          {load.state === "ready" && !sub && (
            <EmptyState tone="meal" icon={{ ios: "arrow.triangle.2.circlepath", android: "autorenew", web: "autorenew" }} title="This subscription isn't running" message="It may have ended or been cancelled. See My subscriptions." />
          )}
          {sub && (
            <>
              <View className="sub-active" style={{ padding: 16, gap: 14 }}>
                <View className="flex-row items-center" style={{ gap: 12 }}>
                  <View className="meal-row__photo" style={{ width: 64, height: 64 }}>
                    {sub.meal?.imageUrl ? <Image source={mealImage(sub.meal.imageUrl, token)} contentFit="cover" style={{ width: "100%", height: "100%" }} /> : null}
                  </View>
                  <View className="min-w-0 flex-1" style={{ gap: 3 }}>
                    <View className="sub-active__pill">
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: pausedNow ? colors.warning : colors.primaryBright }} />
                      <Text className="sub-active__pill-label">{pausedNow ? "Paused" : "Active"}</Text>
                    </View>
                    <Text className="sub-active__name" style={{ fontSize: 19, lineHeight: 25 }} numberOfLines={2}>{sub.planName}</Text>
                    <Text className="sub-active__line">{`${subscriptionLine(sub)} · ${shortDate(sub.startsOn)} – ${shortDate(sub.endsOn)}`}</Text>
                  </View>
                </View>
                <View style={{ gap: 8 }}>
                  <View className="flex-row justify-between">
                    <Text className="sub-active__line">{`${sub.mealsUsed} of ${sub.mealsTotal} delivered`}</Text>
                    <Text className="sub-active__line">{`${sub.mealsLeft} left`}</Text>
                  </View>
                  <View className="sub-active__track"><View className="sub-active__fill" style={{ width: `${Math.round(share * 100)}%` }} /></View>
                </View>
                {sub.address.line ? <Text className="sub-active__line" numberOfLines={2}>{`To ${sub.address.line}`}</Text> : null}
              </View>

              <View className="card" style={{ gap: 10 }}>
                <Text className="card__title">{pausedNow ? "Paused" : "Pause deliveries"}</Text>
                {pausedNow && sub.pausedFrom && sub.pausedUntil ? (
                  <>
                    <Text className="meta-text">{`From ${shortDate(sub.pausedFrom)} to ${shortDate(sub.pausedUntil)}. Your last delivery is now ${shortDate(sub.endsOn)}.`}</Text>
                    <PressableScale haptic="tap" onPress={() => act("resume", (t) => subscriptionsApi.resume(t, sub.id), "Subscription resumed")} className="shop-add self-start" accessibilityRole="button">
                      {busy === "resume" ? <ActivityIndicator size="small" color={colors.white} /> : <Text className="shop-add__label">Resume</Text>}
                    </PressableScale>
                  </>
                ) : (
                  <>
                    <Text className="meta-text">No deliveries while paused; your last delivery moves on by the same days.</Text>
                    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                      {PAUSES.map((p) => (
                        <PressableScale key={p.label} haptic="select" onPress={() => act(`pause${p.days}`, (t) => subscriptionsApi.pause(t, sub.id, addDays(today, 1), addDays(today, p.days)), "Subscription paused")} className="meal-chip" accessibilityRole="button" accessibilityLabel={`Pause ${p.label.toLowerCase()}`}>
                          {busy === `pause${p.days}` ? <ActivityIndicator size="small" color={colors.ink} /> : <Text className="admin-segment__label">{p.label}</Text>}
                        </PressableScale>
                      ))}
                    </View>
                  </>
                )}
              </View>

              <View style={{ gap: 10 }}>
                <Text className="meal-section__title">Next deliveries</Text>
                {(sub.upcoming ?? []).length === 0 ? <Text className="meta-text">No deliveries in the next 7 days.</Text> : null}
                {(sub.upcoming ?? []).map((d) => {
                  const skipped = d.slots.every((s) => s.status === "skipped");
                  const paused = d.slots.every((s) => s.status === "paused");
                  const canSkip = d.slots.every((s) => s.status === "scheduled" || s.status === "skipped");
                  return (
                    <View key={d.day} className="card flex-row items-center" style={{ gap: 12, paddingVertical: 12 }}>
                      <View className="meal-icon" style={{ width: 40, height: 40, backgroundColor: skipped || paused ? colors.creamDeep : colors.successSoft }}>
                        <SymbolView name={skipped || paused ? { ios: "pause.circle", android: "pause_circle", web: "pause_circle" } : { ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={17} tintColor={skipped || paused ? colors.muted : colors.success} />
                      </View>
                      <View className="min-w-0 flex-1" style={{ gap: 1 }}>
                        <Text className="card__title">{dayLabel(d.day, today)}</Text>
                        {d.slots.map((s) => (
                          <Text key={s.slot} className="meta-text" numberOfLines={1}>{`${SLOT_LABEL[s.slot]} · ${SLOT_STATUS[s.status] ?? STATUS_LABEL[s.status as OrderStatus] ?? s.status}`}</Text>
                        ))}
                      </View>
                      {!paused && canSkip ? (
                        <PressableScale haptic="select" onPress={() => act(`skip${d.day}`, (t) => subscriptionsApi.skip(t, sub.id, d.day, skipped), skipped ? "Back on" : "Day skipped")} className="meal-chip" accessibilityRole="button" accessibilityLabel={skipped ? `Undo skipping ${d.day}` : `Skip ${d.day}`}>
                          {busy === `skip${d.day}` ? <ActivityIndicator size="small" color={colors.ink} /> : <Text className="admin-segment__label">{skipped ? "Undo skip" : "Skip day"}</Text>}
                        </PressableScale>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              <PressableScale onPress={cancel} className="self-center" style={{ paddingVertical: 8 }} accessibilityRole="button" accessibilityLabel="Cancel subscription">
                {busy === "cancel" ? <ActivityIndicator color={colors.danger} /> : <Text className="meta-text" style={{ color: colors.danger }}>Cancel subscription</Text>}
              </PressableScale>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
