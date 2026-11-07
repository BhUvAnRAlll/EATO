import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { IconButton } from "@/components/IconButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenSkeleton } from "@/components/Skeleton";
import { DatePickerSheet } from "@/components/setup/DatePickerSheet";
import { SetupField } from "@/components/setup/SetupField";
import { haptic } from "@/lib/haptics";
import { membershipApi, type Membership } from "@/lib/membershipApi";
import { addDays, daysBetween, prettyDate } from "@/lib/membershipText";
import { useSessionToken } from "@/lib/session";

const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

type Load = { state: "loading" } | { state: "failed"; error: string } | { state: "ready"; membership: Membership; today: string };

// Profile › Gym membership › Pause Membership: pick the first and last paused day and say why,
// then send the request. The gym's staff approve or reject it; until then it shows as waiting.
// The server checks the dates (today to 60 days ahead, 1 to 90 days) and the reason again.
export default function PauseMembership() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const getToken = useSessionToken();
  const [result, setResult] = useState<Load>({ state: "loading" });
  const [from, setFrom] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState<"from" | "until" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The membership comes from the server again (never from the link alone), so the limits and
  // the plan's end are today's
  const load = useCallback(async () => {
    const answer = await membershipApi.mine(await getToken().catch(() => null));
    if (!answer.ok) return setResult({ state: "failed", error: answer.error });
    const membership = answer.data.memberships.find((m) => String(m.id) === id);
    if (!membership) return setResult({ state: "failed", error: "That membership isn't on your number." });
    setResult({ state: "ready", membership, today: answer.data.today });
  }, [getToken, id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ready = result.state === "ready" ? result : null;
  const maxDays = ready?.membership.limits.maxDays ?? 90;
  const earliest = ready?.today ?? toIso(new Date());
  const latestStart = addDays(earliest, ready?.membership.limits.maxStartAheadDays ?? 60);
  const days = from && until && until >= from ? daysBetween(from, until) : 0;
  const trimmed = reason.trim();
  const valid = Boolean(from && until && days >= 1 && days <= maxDays && trimmed.length >= 3);
  const wouldEnd = ready && days > 0 ? addDays(ready.membership.expiresOn, days) : null;

  const pickFrom = (date: Date) => {
    const iso = toIso(date);
    setFrom(iso);
    // The end follows the start when it would fall before it, or run past the limit
    if (!until || until < iso || daysBetween(iso, until) > maxDays) setUntil(iso);
  };

  const submit = async () => {
    if (!ready || !from || !until || !valid || busy) return;
    setBusy(true);
    setError(null);
    const answer = await membershipApi.requestPause(await getToken().catch(() => null), ready.membership.id, { from, until, reason: trimmed });
    setBusy(false);
    if (!answer.ok) return setError(answer.error);
    haptic.success();
    if (router.canGoBack()) router.back();
    else router.replace("/membership");
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="flex-row items-center px-4 py-2" style={{ gap: 12 }}>
          <IconButton icon={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/membership"))} />
          <Text className="type-title flex-1" accessibilityRole="header">Pause Membership</Text>
        </View>

        {result.state === "loading" ? (
          <ScreenSkeleton cards={2} label="Loading your membership" />
        ) : result.state === "failed" ? (
          <View className="p-4">
            <View className="card" style={{ gap: 12 }}>
              <FormAlert message={result.error} />
              <PrimaryButton label="Try again" onPress={() => { setResult({ state: "loading" }); load(); }} />
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false}>
            <View className="card" style={{ gap: 4 }}>
              <Text className="card__title">{`${result.membership.gym.name} · ${result.membership.gym.branch}`}</Text>
              <Text className="card__subtitle">{`Your plan ends on ${prettyDate(result.membership.expiresOn)}. A pause of up to ${maxDays} days adds those days to it once the gym approves.`}</Text>
            </View>

            <View style={{ gap: 12 }}>
              <SetupField
                label="Pause from"
                icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
                trailingIcon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
                value={from ? prettyDate(from) : ""}
                placeholder="First paused day"
                onPress={() => setPicking("from")}
              />
              <SetupField
                label="Pause until"
                icon={{ ios: "calendar.badge.checkmark", android: "event_available", web: "event_available" }}
                trailingIcon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
                value={until ? prettyDate(until) : ""}
                placeholder={from ? "Last paused day" : "Pick the start first"}
                onPress={from ? () => setPicking("until") : undefined}
                readOnly={!from}
              />
              <SetupField
                label="Reason"
                icon={{ ios: "doc.text", android: "description", web: "description" }}
                value={reason}
                onChangeText={(text) => setReason(text.slice(0, 200))}
                placeholder="Travelling, unwell, exams…"
                multiline
                maxLength={200}
                invalid={reason.length > 0 && trimmed.length < 3}
              />
              <Text className="type-caption text-muted">
                {days > 0 && wouldEnd
                  ? days > maxDays
                    ? `That's ${days} days. A pause is at most ${maxDays} days.`
                    : `${days} ${days === 1 ? "day" : "days"} paused. Your plan would then end on ${prettyDate(wouldEnd)}.`
                  : "Pick the first and last paused day. The gym will see your reason."}
              </Text>
            </View>

            {error && <FormAlert message={error} />}
            <PrimaryButton label="Send pause request" onPress={submit} disabled={!valid} loading={busy} />
            <Text className="type-caption text-muted text-center">{"Nothing changes until the gym approves. You can cancel the request while it's waiting."}</Text>
          </ScrollView>
        )}

        {ready && (
          <>
            <DatePickerSheet
              visible={picking === "from"}
              title="Pause from"
              value={toDate(from ?? earliest)}
              minimumDate={toDate(earliest)}
              maximumDate={toDate(latestStart)}
              onSelect={pickFrom}
              onClose={() => setPicking(null)}
            />
            <DatePickerSheet
              visible={picking === "until"}
              title="Pause until"
              value={toDate(until ?? from ?? earliest)}
              minimumDate={toDate(from ?? earliest)}
              maximumDate={toDate(addDays(from ?? earliest, maxDays - 1))}
              onSelect={(date) => setUntil(toIso(date))}
              onClose={() => setPicking(null)}
            />
          </>
        )}
      </SafeAreaView>
    </View>
  );
}
