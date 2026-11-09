import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/macro/LoadError";
import { PressableScale } from "@/components/PressableScale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenSkeleton } from "@/components/Skeleton";
import { hud } from "@/lib/hud";
import { SLOT_LABEL, STATUS_LABEL, addDays, dayLabel, type OrderStatus } from "@/lib/mealRules";
import { todayIso } from "@/lib/macro";
import { confirmChoice } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { subscriptionsApi, type Mine } from "@/lib/subscriptionsApi";
import { useThemeColors } from "@/theme";

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; mine: Mine };
const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const SLOT_STATUS: Record<string, string> = { scheduled: "Scheduled", skipped: "Skipped", paused: "Paused", unfilled: "Not made", ordered: "Ordered" };
const PAUSES = [
  { label: "Tomorrow", days: 1 },
  { label: "3 days", days: 3 },
  { label: "A week", days: 7 },
];

// Meals › Meal Subscription › Manage (Meal Operations phase 5; the tab's Pause, Change Plan, Delivery
// and Manage open it, `?section=` scrolls nothing but says which part was asked for): the plan, its
// days and meals; pause from tomorrow (1 day, 3 days, a week) or resume; how to change plans; the
// next 7 days with each meal time's state and Skip / Undo skip; Cancel plan.
export default function ManageSubscription() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { section } = useLocalSearchParams<{ section?: string }>();
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

  const sub = load.state === "ready" ? load.mine.current : null;
  const cancel = async () => {
    if (!sub) return;
    const sure = await confirmChoice({
      title: `Cancel ${sub.planName}?`,
      message: "Deliveries stop from the next meal the kitchen hasn't started. Payments are in test mode, so nothing is refunded.",
      confirmLabel: "Cancel plan",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (sure) act("cancel", (t) => subscriptionsApi.cancel(t, sub.id), "Plan cancelled");
  };

  return (
    <View className="flex-1 meal-page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <ScreenHeader title="My meal plan" fallback="/meals" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} showsVerticalScrollIndicator={false}>
          {load.state === "loading" && <ScreenSkeleton label="Loading your plan" />}
          {load.state === "failed" && <LoadError tone="meal" title="Your plan couldn't load" message={load.error} onRetry={read} />}
          {load.state === "ready" && !sub && (
            <EmptyState tone="meal" icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} title="No plan running" message="Pick a meal plan on the Meals tab's Meal Subscription side.">
              <PressableScale haptic="select" onPress={() => router.replace("/meals")} className="shop-add self-center" accessibilityRole="button">
                <Text className="shop-add__label">See plans</Text>
              </PressableScale>
            </EmptyState>
          )}
          {sub && (
            <>
              <View className="card" style={{ gap: 6 }}>
                <Text className="type-headline text-forest-ink">{sub.planName}</Text>
                <Text className="meta-text">{`${date(sub.startsOn)} – ${date(sub.endsOn)} · ${sub.mealsPerDay} meals a day`}</Text>
                <Text className="type-body text-forest-ink">{`${sub.mealsUsed} of ${sub.mealsTotal} meals delivered · ${sub.mealsLeft} left`}</Text>
                {sub.address.line ? <Text className="meta-text" numberOfLines={2}>{`To ${sub.address.line}`}</Text> : null}
              </View>

              <View className="card" style={{ gap: 10, borderWidth: section === "pause" ? 1.5 : 0, borderColor: colors.mealPrimary }}>
                <Text className="card__title">{sub.pausedFrom && sub.pausedUntil && sub.pausedUntil >= today ? "Paused" : "Pause"}</Text>
                {sub.pausedFrom && sub.pausedUntil && sub.pausedUntil >= today ? (
                  <>
                    <Text className="meta-text">{`From ${date(sub.pausedFrom)} to ${date(sub.pausedUntil)}. Your plan now ends ${date(sub.endsOn)}.`}</Text>
                    <PressableScale haptic="tap" onPress={() => act("resume", (t) => subscriptionsApi.resume(t, sub.id), "Plan resumed")} className="shop-add self-start" accessibilityRole="button">
                      {busy === "resume" ? <ActivityIndicator size="small" color={colors.white} /> : <Text className="shop-add__label">Resume</Text>}
                    </PressableScale>
                  </>
                ) : (
                  <>
                    <Text className="meta-text">No deliveries while paused; your end date moves on by the same days.</Text>
                    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                      {PAUSES.map((p) => (
                        <PressableScale key={p.label} haptic="select" onPress={() => act(`pause${p.days}`, (t) => subscriptionsApi.pause(t, sub.id, addDays(today, 1), addDays(today, p.days)), "Plan paused")} className="meal-chip" accessibilityRole="button" accessibilityLabel={`Pause ${p.label.toLowerCase()}`}>
                          {busy === `pause${p.days}` ? <ActivityIndicator size="small" color={colors.mealPrimary} /> : <Text className="admin-segment__label">{p.label}</Text>}
                        </PressableScale>
                      ))}
                    </View>
                  </>
                )}
              </View>

              <View className="card" style={{ gap: 6, borderWidth: section === "plan" ? 1.5 : 0, borderColor: colors.mealPrimary }}>
                <Text className="card__title">Change plan</Text>
                <Text className="meta-text">{`To switch, cancel this plan below and pick a new one; a new plan can start from tomorrow. Or start one after this ends on ${date(sub.endsOn)}.`}</Text>
              </View>

              <View style={{ gap: 10 }}>
                <Text className="type-headline text-forest-ink" style={section === "delivery" ? { color: colors.mealDark } : undefined}>Next deliveries</Text>
                {(sub.upcoming ?? []).length === 0 ? <Text className="meta-text">No deliveries in the next 7 days.</Text> : null}
                {(sub.upcoming ?? []).map((d) => {
                  const skipped = d.slots.every((s) => s.status === "skipped");
                  const paused = d.slots.every((s) => s.status === "paused");
                  const canSkip = d.slots.every((s) => s.status === "scheduled" || s.status === "skipped");
                  return (
                    <View key={d.day} className="card" style={{ gap: 6 }}>
                      <View className="flex-row items-center">
                        <Text className="card__title flex-1">{dayLabel(d.day, today)}</Text>
                        {!paused && canSkip ? (
                          <PressableScale haptic="select" onPress={() => act(`skip${d.day}`, (t) => subscriptionsApi.skip(t, sub.id, d.day, skipped), skipped ? "Back on" : "Day skipped")} className="meal-chip" accessibilityRole="button" accessibilityLabel={skipped ? `Undo skipping ${d.day}` : `Skip ${d.day}`}>
                            {busy === `skip${d.day}` ? <ActivityIndicator size="small" color={colors.mealPrimary} /> : <Text className="admin-segment__label">{skipped ? "Undo skip" : "Skip day"}</Text>}
                          </PressableScale>
                        ) : null}
                      </View>
                      {d.slots.map((s) => (
                        <Text key={s.slot} className="meta-text">{`${SLOT_LABEL[s.slot]} · ${SLOT_STATUS[s.status] ?? STATUS_LABEL[s.status as OrderStatus] ?? s.status}${s.meals ? ` · ${s.meals}` : ""}`}</Text>
                      ))}
                    </View>
                  );
                })}
              </View>

              <PressableScale onPress={cancel} className="self-center" accessibilityRole="button" accessibilityLabel="Cancel plan">
                {busy === "cancel" ? <ActivityIndicator color={colors.danger} /> : <Text className="meta-text" style={{ color: colors.danger }}>Cancel plan</Text>}
              </PressableScale>
            </>
          )}
          {load.state === "ready" && load.mine.past.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text className="type-headline text-forest-ink">Earlier plans</Text>
              {load.mine.past.map((p) => (
                <Text key={p.id} className="meta-text">{`${p.planName} · ${date(p.startsOn)} – ${date(p.endsOn)} · ${p.status === "cancelled" ? "Cancelled" : "Completed"} · ${p.mealsUsed} meals`}</Text>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
