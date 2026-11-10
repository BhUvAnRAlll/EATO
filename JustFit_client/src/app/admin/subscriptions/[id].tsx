import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { DashedBlock } from "@/components/macro/DashedBlock";
import { ScreenSkeleton } from "@/components/Skeleton";
import { hud } from "@/lib/hud";
import { SLOT_LABEL, STATUS_LABEL, addDays, dayLabel, type OrderStatus } from "@/lib/mealRules";
import { todayIso } from "@/lib/macro";
import { showActions } from "@/lib/nativeSheets";
import { useGymData } from "@/lib/useGymData";
import { useSessionToken } from "@/lib/session";
import { subscriptionsApi, type Subscription } from "@/lib/subscriptionsApi";
import { useThemeColors } from "@/theme";

const date = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const CANCEL_REASONS = ["The member asked to cancel", "Can't deliver to this address", "Payment problem"];

// Super Admin › Subscriptions › one (Meal Operations phase 5): the member and plan, days and meals,
// the next 7 days, and Activate (paid in person), Pause 3 days / Resume, Extend 7 days
// and Cancel (with a reason). Every action is in the admin log.
export default function AdminSubscription() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback((t: string | null) => subscriptionsApi.adminOne(t, String(id)), [id]);
  const { result, retry, refresh, update } = useGymData(load);
  const [busy, setBusy] = useState(false);
  const today = todayIso();
  const sub = result.state === "ready" ? result.data.subscription : null;

  const act = async (action: Parameters<typeof subscriptionsApi.adminAction>[2], body: Record<string, unknown>, success: string) => {
    if (busy || !sub) return;
    setBusy(true);
    const answer = await subscriptionsApi.adminAction(await getToken(), sub.id, action, body);
    setBusy(false);
    if (!answer.ok) return hud.error(answer.error);
    update(() => ({ subscription: answer.data.subscription as Subscription }));
    hud.success(success);
  };
  const paused = !!sub?.pausedFrom && !!sub.pausedUntil && sub.pausedUntil >= today;

  return (
    <AdminScreen title={sub?.planName ?? "Subscription"} subtitle={sub ? `#${sub.code}` : undefined} onRefresh={refresh}>
      {result.state === "loading" && <ScreenSkeleton label="Loading the subscription" />}
      {result.state === "failed" && (
        <DashedBlock icon={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }} title="Could not load the subscription" text={`${result.error.replace(/\.$/, "")}. Tap to try again.`} onPress={retry} />
      )}
      {sub && (
        <View style={{ gap: 14 }}>
          <View className="card" style={{ gap: 6 }}>
            <Text className="card__title">{sub.member?.name ?? "Member"}</Text>
            {sub.member?.phone ? (
              <Pressable onPress={() => Linking.openURL(`tel:${sub.member?.phone}`).catch(() => hud.error("Couldn't open the phone app"))} accessibilityRole="button">
                <Text className="meal-link">{`Call +91 ${sub.member.phone}`}</Text>
              </Pressable>
            ) : null}
            <Text className="meta-text">{`${sub.status === "active" ? (paused ? `Paused ${date(sub.pausedFrom!)} – ${date(sub.pausedUntil!)}` : "Active") : sub.status} · ${date(sub.startsOn)} – ${date(sub.endsOn)}`}</Text>
            <Text className="meta-text">{`${sub.mealsUsed} of ${sub.mealsTotal} meals delivered · ${sub.mealsLeft} left · ₹${sub.price.toLocaleString("en-IN")} (${sub.payment?.method ?? "unpaid"})`}</Text>
            {sub.address.line ? <Text className="meta-text" numberOfLines={2}>{sub.address.line}</Text> : null}
            {sub.cancelReason ? <Text className="meta-text">{`Cancelled: ${sub.cancelReason}`}</Text> : null}
          </View>
          {busy ? <ActivityIndicator color={colors.leaf} /> : null}
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {sub.status === "awaiting_payment" ? (
              <Pressable onPress={() => act("activate", {}, "Activated")} className="admin-chip admin-chip--on" accessibilityRole="button"><Text className="admin-segment__label admin-segment__label--on">Activate (paid in person)</Text></Pressable>
            ) : null}
            {sub.status === "active" ? (
              <>
                {paused ? (
                  <Pressable onPress={() => act("resume", {}, "Resumed")} className="admin-chip" accessibilityRole="button"><Text className="admin-segment__label admin-segment__label--on">Resume</Text></Pressable>
                ) : (
                  <Pressable onPress={() => act("pause", { from: addDays(today, 1), until: addDays(today, 3) }, "Paused 3 days")} className="admin-chip" accessibilityRole="button"><Text className="admin-segment__label admin-segment__label--on">Pause 3 days</Text></Pressable>
                )}
                <Pressable onPress={() => act("extend", { days: 7 }, "Extended 7 days")} className="admin-chip" accessibilityRole="button"><Text className="admin-segment__label admin-segment__label--on">Extend 7 days</Text></Pressable>
                <Pressable
                  onPress={() => showActions({ title: "Cancel this subscription?", actions: CANCEL_REASONS.map((reason) => ({ label: reason, destructive: true, onPress: () => void act("cancel", { reason }, "Cancelled") })) })}
                  className="admin-chip"
                  accessibilityRole="button"
                >
                  <Text className="admin-segment__label" style={{ color: colors.danger }}>Cancel</Text>
                </Pressable>
              </>
            ) : null}
          </View>
          <Text className="setup__section">Next 7 days</Text>
          {(sub.upcoming ?? []).length === 0 ? <Text className="meta-text">No deliveries coming up.</Text> : null}
          {(sub.upcoming ?? []).map((d) => (
            <View key={d.day} className="card" style={{ gap: 4 }}>
              <Text className="card__title">{dayLabel(d.day, today)}</Text>
              {d.slots.map((s) => (
                <Text key={s.slot} className="meta-text">{`${SLOT_LABEL[s.slot]} · ${STATUS_LABEL[s.status as OrderStatus] ?? s.status}${s.meals ? ` · ${s.meals}` : ""}`}</Text>
              ))}
            </View>
          ))}
        </View>
      )}
    </AdminScreen>
  );
}
