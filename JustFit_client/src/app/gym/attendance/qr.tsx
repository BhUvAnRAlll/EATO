import { useRef, useState } from "react";
import { ActivityIndicator, Platform, Text, View } from "react-native";
import { router } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import QRCode from "react-native-qrcode-svg";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { shortDate } from "@/data/gymDashboard";
import { indiaDay } from "@/lib/attendanceText";
import { gymApi } from "@/lib/gymApi";
import { confirmAction } from "@/lib/gymPortal";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// The part of react-native-qrcode-svg's ref used here: the code as a base64 PNG
type QrRef = { toDataURL: (done: (base64: string) => void) => void };

// Gym admin › Attendance QR Code: the branch's code for the front desk (show it on a screen,
// or share it to print). It carries the branch and the server's signature only, never member
// data. Regenerate makes a new code and voids the old one at once (a lost or copied printout).
export default function GymAttendanceQr() {
  const colors = useThemeColors();
  const { result, retry, set } = useGymData(gymApi.attendanceSettings);
  const make = useGymSave(set);
  const qrRef = useRef<QrRef | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState("");

  if (result.state !== "ready") {
    return (
      <GymScreen title="Attendance QR Code">
        {result.state === "loading" ? <GymLoading label="Loading the QR code" /> : <GymError error={result.error} onRetry={retry} />}
      </GymScreen>
    );
  }
  const { gym, qr, location } = result.data;

  const regenerate = async () => {
    const sure = await confirmAction("Make a new QR code?", "The current code stops working right away. Replace every printed copy with the new one.", "Make new code");
    if (sure) make.save((token) => gymApi.regenerateQr(token));
  };

  const shareOrPrint = () => {
    setShareError("");
    if (Platform.OS === "web") return void globalThis.print?.();
    if (!qrRef.current || sharing) return;
    setSharing(true);
    qrRef.current.toDataURL(async (base64) => {
      try {
        const file = new File(Paths.cache, `attendance-qr-${gym.branch.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.png`);
        if (file.exists) file.delete();
        file.create();
        await file.write(base64, { encoding: "base64" });
        await Sharing.shareAsync(file.uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: "Attendance QR code" });
      } catch {
        setShareError("We couldn't share the QR code. Please try again.");
      }
      setSharing(false);
    });
  };

  return (
    <GymScreen title="Attendance QR Code">
      {!location ? (
        <PressableScale onPress={() => router.push("/gym/attendance/settings")} className="gym-warning" accessibilityRole="button" accessibilityLabel="Set the gym's location first">
          <GymIcon name="triangle-alert" size={18} color={colors.gymWarning} />
          <Text className="gym-warning__text flex-1">{"Set your gym's location first: scans are refused until it's saved."}</Text>
        </PressableScale>
      ) : null}

      {qr ? (
        <>
          <View className="gym-qr" accessible accessibilityLabel={`Attendance QR code for ${gym.name} ${gym.branch}`}>
            <Text className="gym-qr__title">{`${gym.name} · ${gym.branch}`}</Text>
            <QRCode value={qr.payload} size={240} color={colors.black} backgroundColor={colors.white} quietZone={12} ecl="M" getRef={Platform.OS === "web" ? undefined : (c: QrRef | null) => { qrRef.current = c; }} />
            <Text className="gym-tx__name text-center">Scan with the justFit app to check in and check out</Text>
            <Text className="gym-tx__meta text-center">{`Code ${qr.version} · made ${shortDate(indiaDay(0, Date.parse(qr.madeAt)))}`}</Text>
          </View>
          {shareError ? <FormAlert message={shareError} /> : null}
          {make.error ? <FormAlert message={make.error} /> : null}
          <PressableScale onPress={shareOrPrint} disabled={sharing} haptic="tap" className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel={Platform.OS === "web" ? "Print the QR code" : "Share or print the QR code"}>
            {sharing ? <ActivityIndicator size="small" color={colors.gymPrimary} /> : <GymIcon name={Platform.OS === "web" ? "printer" : "share-2"} size={16} color={colors.gymPrimary} />}
            <Text className="gym-btn__label gym-btn__label--outline">{Platform.OS === "web" ? "Print" : "Share / Print"}</Text>
          </PressableScale>
          <PressableScale onPress={regenerate} disabled={make.busy} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Regenerate QR code" accessibilityState={{ busy: make.busy }}>
            {make.busy ? <ActivityIndicator size="small" color={colors.gymDanger} /> : <GymIcon name="refresh-ccw" size={16} color={colors.gymDanger} />}
            <Text className="gym-btn__label gym-btn__label--outline" style={{ color: colors.gymDanger }}>Regenerate QR code</Text>
          </PressableScale>
          <Text className="gym-tx__meta">{"Members scan this code from Profile › Gym attendance in the justFit app. Their phone's location must be within your attendance radius, and their membership must be active."}</Text>
        </>
      ) : (
        <>
          <View className="gym-qr">
            <View className="gym-sms__icon">
              <GymIcon name="qr-code" size={22} color={colors.gymPrimary} />
            </View>
            <Text className="gym-qr__title">No QR code yet</Text>
            <Text className="gym-tx__meta text-center">{"Create your branch's attendance QR code, then show it on a screen or print it for the front desk."}</Text>
          </View>
          {make.error ? <FormAlert message={make.error} /> : null}
          <GymPrimaryButton label="Create QR code" ready busy={make.busy} onPress={() => make.save((token) => gymApi.regenerateQr(token))} />
        </>
      )}
    </GymScreen>
  );
}
