import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView } from "@/components/SymbolView";
import QRCode from "react-native-qrcode-svg";

import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { owner, type CheckoutQr } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors, switchColors } from "@/theme";

// The gym's check-out QR: members scan it at the exit to end their visit. Switch it on or off,
// regenerate it (the old one stops working), or open the full-screen front-desk display.
export default function OwnerCheckoutQr() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const [qr, setQr] = useState<CheckoutQr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const load = useCallback(async () => {
    if (!gymId) return;
    const result = await owner.checkoutQr(await getToken(), gymId);
    if (result.ok) {
      setQr(result.data);
      setError(null);
    } else setError(result.error);
  }, [gymId, getToken]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const { refreshControl } = usePullToRefresh(load);

  const toggle = async (enabled: boolean) => {
    if (!gymId || busy) return;
    setBusy(true);
    const result = await owner.setCheckoutQr(await getToken(), gymId, enabled);
    setBusy(false);
    if (result.ok) setQr(result.data);
    else setError(result.error);
  };

  const rotate = async () => {
    if (!gymId) return;
    setBusy(true);
    const result = await owner.rotateCheckoutQr(await getToken(), gymId);
    setBusy(false);
    setConfirmRotate(false);
    if (result.ok) setQr(result.data);
    else setError(result.error);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }}>
      <View className="screen-bar">
        <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
        </Pressable>
        <Text className="screen-bar__title">Check-out QR</Text>
        <View className="screen-bar__spacer" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} refreshControl={refreshControl}>
        {error && qr && <FormAlert message={error} />}
        {!qr ? (
          error ? (
            <EmptyState icon={{ ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title="Couldn't load" text={error} actionLabel="Retry" onAction={load} />
          ) : (
            <ActivityIndicator color={colors.forest} />
          )
        ) : (
          <>
            <Pressable onPress={() => router.push("/owner/display")} className="btn-forest" style={{ height: 50 }} accessibilityRole="button" accessibilityLabel="Open front-desk display">
              <SymbolView name={{ ios: "arrow.up.left.and.arrow.down.right", android: "open_in_full", web: "open_in_full" }} size={16} tintColor={colors.white} />
              <Text className="btn-forest__label">Open front-desk display</Text>
            </Pressable>
            <Text className="friend-row__note">Put a tablet at the exit in display mode so members can scan the code as they leave.</Text>

            <View className="owner-card items-center">
              <View className="w-full flex-row items-center justify-between">
                <Text className="friend-row__name">{qr.gym.name}</Text>
                <View className={qr.enabled ? "owner-badge owner-badge--accent" : "owner-badge"}>
                  <Text className="owner-badge__label">{qr.enabled ? "Active" : "Off"}</Text>
                </View>
              </View>
              <View className="owner-qr" style={{ opacity: qr.enabled ? 1 : 0.35 }} accessibilityLabel={`Check-out QR code ${qr.code}`}>
                <QRCode value={qr.qrText} size={180} color={colors.ink} backgroundColor={colors.white} />
              </View>
              <Text className="owner-code">{qr.code.replace(/(.{4})(?=.)/g, "$1-")}</Text>
              <Text className="friend-row__note text-center">Members scan this at the exit to check out. {qr.checkoutsToday} checked out this way today.</Text>
            </View>

            <View className="owner-card flex-row items-center gap-3">
              <View className="min-w-0 flex-1">
                <Text className="friend-row__name">Check-out QR {qr.enabled ? "active" : "off"}</Text>
                <Text className="friend-row__note">{qr.enabled ? "Members can check out by scanning it." : "Members ask the front desk to check them out."}</Text>
              </View>
              <Switch {...switchColors} value={qr.enabled} onValueChange={toggle} disabled={busy} accessibilityLabel="Check-out QR active" />
            </View>

            <Pressable onPress={() => setConfirmRotate(true)} className="flex-row items-center justify-center gap-2 py-2" accessibilityRole="button" accessibilityLabel="Regenerate code">
              <SymbolView name={{ ios: "arrow.clockwise", android: "refresh", web: "refresh" }} size={16} tintColor={colors.muted} />
              <Text className="owner-stat__label">Regenerate code</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
      <ConfirmSheet
        visible={confirmRotate}
        title="Regenerate the check-out code?"
        text="The current QR stops working at once. Replace any printed copy with the new one."
        confirmLabel="Regenerate"
        busy={busy}
        onConfirm={rotate}
        onCancel={() => setConfirmRotate(false)}
      />
    </SafeAreaView>
  );
}
