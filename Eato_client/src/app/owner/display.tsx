import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import QRCode from "react-native-qrcode-svg";

import { owner, type CheckoutQr } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

// The front-desk display: a full-screen view for a tablet at the exit. A clock, "Leaving? Scan
// to check out", the gym's check-out QR and today's count, refreshed every 30 seconds. When the
// code is switched off it says so instead of showing a code that won't work.
export default function OwnerDisplay() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const [qr, setQr] = useState<CheckoutQr | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    if (!gymId) return;
    const result = await owner.checkoutQr(await getToken(), gymId);
    if (result.ok) setQr(result.data);
  }, [gymId, getToken]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      setNow(new Date());
      load();
    }, 30000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }}>
      <View className="h-12 flex-row items-center px-4">
        <Pressable onPress={() => router.back()} hitSlop={10} className="owner__header-button" accessibilityRole="button" accessibilityLabel="Close the display">
          <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={20} tintColor={colors.ink} />
        </Pressable>
        <Text className="screen-bar__title">{now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</Text>
        <View className="owner__header-button" />
      </View>
      <View className="flex-1 items-center justify-center gap-4 px-6">
        {!qr ? (
          <ActivityIndicator color={colors.forest} />
        ) : (
          <>
            <View className="gym-logo" style={{ width: 64, height: 64, borderRadius: 18 }}>
              <Text className="gym-logo__initials">{initials(qr.gym.name)}</Text>
            </View>
            <Text className="friend-row__name">{qr.gym.name}</Text>
            {qr.enabled ? (
              <>
                <Text className="owner-display__title">Leaving? Scan to check out</Text>
                <View className="owner-qr owner-qr--large" accessibilityLabel="Check-out QR code">
                  <QRCode value={qr.qrText} size={240} color={colors.ink} backgroundColor={colors.white} />
                </View>
                <Text className="owner__subtitle text-center">Open EATO → Home → Check out, then point your camera here.</Text>
                <Text className="owner-stat__label">{qr.checkoutsToday} checked out today</Text>
              </>
            ) : (
              <>
                <Text className="owner-display__title">Check-out by QR is off</Text>
                <Text className="owner__subtitle text-center">Please ask the front desk to check you out.</Text>
              </>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
