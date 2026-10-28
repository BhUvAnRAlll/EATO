import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "@/components/SymbolView";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { durationLabel, owner, timeLabel, type Visit } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

const checkoutLabel = (visit: Visit) =>
  visit.checkoutMethod === "qr" ? "Scanned the check-out QR" : visit.checkoutMethod === "staff" ? `Checked out by ${visit.checkedOutBy ?? "staff"}` : "Still in the gym";

// One visit: who, when they came and left, for how long, and how they checked out. Staff can
// end a visit that's still open (someone left without scanning out).
export default function OwnerVisit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const loadSummary = useOwnerStore((state) => state.loadSummary);
  const [visit, setVisit] = useState<Visit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!gymId || !id) return;
    const result = await owner.visit(await getToken(), gymId, id);
    if (result.ok) setVisit(result.data.visit);
    else setError(result.error);
  }, [gymId, id, getToken]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const end = async () => {
    if (!gymId || !id) return;
    setBusy(true);
    const token = await getToken();
    const result = await owner.endVisit(token, gymId, id);
    setBusy(false);
    setConfirming(false);
    if (result.ok) {
      setVisit(result.data.visit);
      loadSummary(token);
    } else setError(result.error);
  };

  const rows = visit
    ? [
        { label: "Checked in", value: `${visit.checkedInAt.slice(0, 10)} · ${timeLabel(visit.checkedInAt)}` },
        { label: "Checked out", value: visit.checkedOutAt ? timeLabel(visit.checkedOutAt) : "Not yet" },
        { label: visit.checkedOutAt ? "Duration" : "So far", value: durationLabel(visit.minutes) },
        { label: "Checked out how", value: checkoutLabel(visit) },
        { label: "Scanned in by", value: visit.checkedInBy ?? "—" },
      ]
    : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }}>
      <View className="screen-bar">
        <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
        </Pressable>
        <Text className="screen-bar__title">Visit</Text>
        <View className="screen-bar__spacer" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {error && visit && <FormAlert message={error} />}
        {!visit ? (
          error ? (
            <EmptyState icon={{ ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title="Couldn't load" text={error} actionLabel="Retry" onAction={load} />
          ) : (
            <ActivityIndicator color={colors.forest} />
          )
        ) : (
          <>
            <View className="owner-card flex-row items-center gap-3">
              <Avatar member={visit.member} size={52} />
              <View className="min-w-0 flex-1">
                <Text className="friend-row__name">{visit.member.name}</Text>
                <View className="mt-1 flex-row">
                  <View className={visit.checkedOutAt ? "owner-badge" : "owner-badge owner-badge--accent"}>
                    <Text className="owner-badge__label">{visit.checkedOutAt ? "Checked out" : "Checked in"}</Text>
                  </View>
                </View>
              </View>
            </View>
            <View className="owner-card" style={{ padding: 0, gap: 0 }}>
              {rows.map((row, i) => (
                <View key={row.label} className="flex-row items-center justify-between gap-3 px-4 py-3" style={i > 0 ? { borderTopWidth: 1, borderColor: colors.creamLine } : undefined}>
                  <Text className="owner-stat__label">{row.label}</Text>
                  <Text className="friend-row__name" style={{ fontSize: 15, flexShrink: 1, textAlign: "right" }}>{row.value}</Text>
                </View>
              ))}
            </View>
            {!visit.checkedOutAt && (
              <Pressable onPress={() => setConfirming(true)} className="btn-outline" accessibilityRole="button" accessibilityLabel="Check out now">
                <Text className="btn-outline__label">Check out now</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
      <ConfirmSheet
        visible={confirming}
        title={`Check out ${visit?.member.name ?? ""}?`}
        text="Use this when a member left without scanning the check-out QR."
        confirmLabel="Check out"
        busy={busy}
        onConfirm={end}
        onCancel={() => setConfirming(false)}
      />
    </SafeAreaView>
  );
}
