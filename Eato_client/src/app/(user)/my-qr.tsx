import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import QRCode from "react-native-qrcode-svg";

import { EmptyState } from "@/components/community/CommunityStates";
import { owner } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// My QR code: the member's pass for the front desk. It changes every minute (each one lasts two),
// so a screenshot stops working; the gym's staff scan it to check the member in.
export default function MyQr() {
  const getToken = useSessionToken();
  const [pass, setPass] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await owner.myPass(await getToken());
    if (result.ok) {
      setPass(result.data.pass);
      setError(null);
    } else setError(result.error);
  }, [getToken]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }}>
      <View className="screen-bar">
        <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
        </Pressable>
        <Text className="screen-bar__title">My QR code</Text>
        <View className="screen-bar__back" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, alignItems: "center", flexGrow: 1, justifyContent: "center" }}>
        {pass ? (
          <>
            <Text className="owner-display__title">Show this at the front desk</Text>
            <View className="owner-qr owner-qr--large" accessibilityLabel="Your check-in QR code">
              <QRCode value={pass} size={230} color={colors.ink} backgroundColor={colors.white} />
            </View>
            <Text className="owner__subtitle text-center">The gym scans it to check you in. It refreshes every minute, so a screenshot won&apos;t work.</Text>
            <Text className="owner-stat__label text-center">Leaving? On Home, tap Check out and scan the gym&apos;s check-out QR.</Text>
          </>
        ) : error ? (
          <EmptyState icon={{ ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title="Couldn't load your code" text={error} actionLabel="Retry" onAction={load} />
        ) : (
          <ActivityIndicator color={colors.forest} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
