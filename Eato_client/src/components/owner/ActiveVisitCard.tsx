import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";

import { QrScanner } from "@/components/owner/QrScanner";
import { durationLabel, owner, timeLabel, type MyVisit } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// The member's active gym session on Home: where they checked in and for how long, and Check out
// (scan the gym's check-out QR at the exit). Shows nothing when they aren't checked in anywhere,
// and a short confirmation after checking out.
export function ActiveVisitCard() {
  const getToken = useSessionToken();
  const [visit, setVisit] = useState<MyVisit | null>(null);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await owner.myVisit(await getToken());
    if (result.ok) setVisit(result.data.visit);
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const scanned = async (code: string) => {
    setScanning(false);
    const result = await owner.checkOut(await getToken(), code);
    if (result.ok) {
      setVisit(null);
      setMessage(`Checked out of ${result.data.gym.name} · ${durationLabel(result.data.minutes)}. See you next time!`);
    } else setMessage(result.error);
  };

  if (!visit && !message) return null;
  return (
    <View className="mx-5 mt-3">
      {visit ? (
        <View className="visit-card" accessibilityLabel={`Checked in at ${visit.gym.name} since ${timeLabel(visit.checkedInAt)}`}>
          <View className="flex-row items-center gap-3">
            <SymbolView name={{ ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" }} size={22} tintColor={colors.white} />
            <View className="min-w-0 flex-1">
              <Text className="visit-card__title" numberOfLines={1}>In the gym at {visit.gym.name}</Text>
              <Text className="visit-card__note">Since {timeLabel(visit.checkedInAt)} · {durationLabel(visit.minutes)}</Text>
            </View>
          </View>
          <View className="flex-row gap-2">
            <Pressable onPress={() => setScanning(true)} className="owner-quick flex-1" accessibilityRole="button" accessibilityLabel="Check out">
              <SymbolView name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }} size={16} tintColor={colors.ink} />
              <Text className="owner-quick__label">Check out</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/my-qr")} className="owner-quick flex-1" accessibilityRole="button" accessibilityLabel="My QR code">
              <Text className="owner-quick__label">My QR code</Text>
            </Pressable>
          </View>
          {message && <Text className="visit-card__note">{message}</Text>}
        </View>
      ) : (
        <Pressable onPress={() => setMessage(null)} className="owner-card" accessibilityRole="button" accessibilityLabel={`${message}. Dismiss`}>
          <Text className="friend-row__note" style={{ color: colors.ink }}>{message}</Text>
        </Pressable>
      )}
      <QrScanner visible={scanning} title="Check out" hint="Point the camera at the gym's check-out QR" onCode={scanned} onClose={() => setScanning(false)} />
    </View>
  );
}
