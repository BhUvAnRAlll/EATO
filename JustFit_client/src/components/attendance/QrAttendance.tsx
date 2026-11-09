import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";

import { FormAlert } from "@/components/FormAlert";
import { IconButton } from "@/components/IconButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { SkeletonCard } from "@/components/Skeleton";
import { SymbolView } from "@/components/SymbolView";
import { attendanceApi, looksLikeGymQr, type MyVisit, type ScanDone, type ScanPreview } from "@/lib/attendanceApi";
import { STATUS_TEXT, clockTime, dayOf, durationText } from "@/lib/attendanceText";
import { readGps } from "@/lib/gpsReading";
import { haptic } from "@/lib/haptics";
import { hud } from "@/lib/hud";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

type Step =
  | { kind: "home" }
  | { kind: "scanning" }
  | { kind: "working"; label: string; preview?: ScanPreview }
  | { kind: "done"; result: ScanDone }
  | { kind: "failed"; error: string; qr: string | null; openSettings?: boolean };

// The gym's printed code, opened from the phone's own camera app as a link (justfit://attendance?…)
const QR_PARAMS = /^[1-9]\d{0,8}$/;
const linkedQr = (b?: string, v?: string, k?: string) =>
  b && v && k && QR_PARAMS.test(b) && QR_PARAMS.test(v) && /^[A-Za-z0-9_-]{22}$/.test(k) ? `justfit://attendance?b=${b}&v=${v}&k=${k}` : null;

// Scan the QR code at the gym's front desk to check in, and the same code to check out. After the
// scan the server says which gym it is, whether this is a check-in or a check-out, and who is
// scanning: a member (their membership must be active) or, since 2026-11-09, the branch's Staff
// or Trainer checking in for work. The phone then reads its GPS and the server records the visit
// only if the code is current and the reading is within the gym's radius.
// Used by Profile › Gym attendance in the member app (members and trainers) and by the gym
// portal's ☰ › My check-in (Staff, `forWork`); `fallback` is where Back goes with no history.
export function QrAttendance({ fallback, forWork = false }: { fallback: Href; forWork?: boolean }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const params = useLocalSearchParams<{ b?: string; v?: string; k?: string }>();
  const [step, setStep] = useState<Step>({ kind: "home" });
  const [visits, setVisits] = useState<{ state: "loading" } | { state: "ready"; visits: MyVisit[] } | { state: "failed"; error: string }>({ state: "loading" });
  const [permission, requestPermission] = useCameraPermissions();
  const busy = useRef(false);

  const loadVisits = useCallback(async () => {
    const answer = await attendanceApi.mine(await getToken().catch(() => null));
    setVisits(answer.ok ? { state: "ready", visits: answer.data.visits } : { state: "failed", error: answer.error });
  }, [getToken]);
  useFocusEffect(useCallback(() => { loadVisits(); }, [loadVisits]));
  const { refreshControl } = usePullToRefresh(loadVisits);

  // The whole check: the code → which gym and in or out → GPS → recorded
  const run = useCallback(async (qr: string) => {
    if (busy.current) return;
    // A refusal shows its own card; the error buzz says so without looking
    const fail = (failed: Extract<Step, { kind: "failed" }>) => {
      haptic.error();
      setStep(failed);
    };
    busy.current = true;
    try {
      setStep({ kind: "working", label: "Checking the QR code…" });
      const token = await getToken().catch(() => null);
      const preview = await attendanceApi.scan(token, qr);
      if (!preview.ok) return fail({ kind: "failed", error: preview.error, qr: null });
      // Refusals the preview already shows: no need to ask for the location first
      if (!preview.data.hasLocation) return fail({ kind: "failed", error: "This gym hasn't set its location for QR attendance yet. Please check in at the front desk.", qr: null });
      if (preview.data.nextAction === "check_in" && !preview.data.member.active) {
        return fail({ kind: "failed", error: "Your membership isn't active today. Renew it or check in at the front desk.", qr: null });
      }
      setStep({ kind: "working", label: "Finding your location…", preview: preview.data });
      const gps = await readGps();
      if (!gps.ok) return fail({ kind: "failed", error: gps.message, qr, openSettings: gps.reason === "denied" && !gps.canAskAgain });
      setStep({ kind: "working", label: preview.data.nextAction === "check_in" ? "Checking you in…" : "Checking you out…", preview: preview.data });
      const done = await attendanceApi.record(token, preview.data.nextAction, qr, gps.reading);
      if (!done.ok) return fail({ kind: "failed", error: done.error, qr });
      hud.success(done.data.action === "check_in" ? "Checked in" : "Checked out");
      setStep({ kind: "done", result: done.data });
      loadVisits();
    } finally {
      busy.current = false;
    }
  }, [getToken, loadVisits]);

  // Opened from the gym's code as a link: run it once, then clear the link, so scanning the same
  // code again (to check out) while this screen is open runs again
  const fromLink = linkedQr(params.b, params.v, params.k);
  const ranLink = useRef(false);
  useEffect(() => {
    if (!fromLink) {
      ranLink.current = false;
      return;
    }
    if (!ranLink.current) {
      ranLink.current = true;
      router.setParams({ b: undefined, v: undefined, k: undefined });
      run(fromLink);
    }
  }, [fromLink, run]);

  const scanned = ({ data }: BarcodeScanningResult) => {
    if (busy.current || step.kind !== "scanning") return;
    if (!looksLikeGymQr(data)) {
      haptic.error();
      return setStep({ kind: "failed", error: "That isn't a justFit gym QR code. Scan the attendance QR code at your gym's front desk.", qr: null });
    }
    haptic.select();
    run(data);
  };

  const startScan = async () => {
    if (!permission?.granted) {
      const asked = await requestPermission();
      if (!asked.granted) {
        return setStep({ kind: "failed", qr: null, openSettings: !asked.canAskAgain, error: asked.canAskAgain ? "justFit needs the camera to scan your gym's QR code. Allow it when asked." : "The camera is turned off for justFit. Open Settings and allow the camera." });
      }
    }
    setStep({ kind: "scanning" });
  };

  const back = () => (step.kind === "home" ? (router.canGoBack() ? router.back() : router.replace(fallback)) : setStep({ kind: "home" }));

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View className="flex-row items-center px-4 py-2" style={{ gap: 12 }}>
          <IconButton icon={{ ios: "chevron.left", android: "chevron_left", web: "chevron_left" }} label="Back" onPress={back} />
          <Text className="type-title flex-1" accessibilityRole="header">{forWork ? "My check-in" : "Gym attendance"}</Text>
        </View>

        {step.kind === "scanning" ? (
          <View className="flex-1 px-4 pb-6" style={{ gap: 16 }}>
            <View className="attendance-scanner">
              <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanned} />
              <View pointerEvents="none" className="attendance-scanner__frame" />
            </View>
            <Text className="card__subtitle text-center">{"Point the camera at the QR code at your gym's front desk."}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }} refreshControl={refreshControl}>
            {step.kind === "home" && (
              <View className="card items-center" style={{ gap: 12 }}>
                <View className="card__icon">
                  <SymbolView name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }} size={26} tintColor={colors.leaf} />
                </View>
                <Text className="card__title text-center">{forWork ? "Check in for work" : "Check in or out at your gym"}</Text>
                <Text className="card__subtitle text-center">
                  {forWork
                    ? "Scan your branch's attendance QR code when you arrive, and the same code when you leave. Your location is checked once, when you scan, to confirm you're at the gym."
                    : "Scan the QR code at the front desk when you arrive, and the same code when you leave. Your location is checked once, when you scan, to confirm you're at the gym."}
                </Text>
                <View className="self-stretch">
                  <PrimaryButton label="Scan QR code" onPress={startScan} />
                </View>
              </View>
            )}

            {step.kind === "working" && (
              <View className="card items-center" style={{ gap: 12 }} accessibilityLiveRegion="polite">
                <ActivityIndicator color={colors.leaf} />
                <Text className="card__title text-center">{step.label}</Text>
                {step.preview ? <Text className="card__subtitle text-center">{`${step.preview.gym.name} ${step.preview.gym.branch} · ${step.preview.member.name}`}</Text> : null}
              </View>
            )}

            {step.kind === "done" && <DoneCard result={step.result} onDone={() => setStep({ kind: "home" })} />}

            {step.kind === "failed" && (
              <View className="card" style={{ gap: 12 }}>
                <FormAlert message={step.error} />
                {step.openSettings && Platform.OS !== "web" ? (
                  <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button" className="self-start">
                    <Text className="auth__link">Open Settings</Text>
                  </Pressable>
                ) : null}
                <PrimaryButton label={step.qr ? "Try again" : "Scan again"} onPress={() => (step.qr ? run(step.qr) : startScan())} />
              </View>
            )}

            <Text className="card__title" accessibilityRole="header">Your recent visits</Text>
            {visits.state === "loading" && <SkeletonCard lines={3} />}
            {visits.state === "failed" && (
              <View style={{ gap: 12 }}>
                <FormAlert message={visits.error} />
                <PrimaryButton label="Try again" onPress={() => { setVisits({ state: "loading" }); loadVisits(); }} />
              </View>
            )}
            {visits.state === "ready" &&
              (visits.visits.length === 0 ? (
                <Text className="card__subtitle">No visits yet. Your check-ins will show here.</Text>
              ) : (
                <View className="card py-1">
                  {visits.visits.map((v, i) => (
                    <View key={v.id} className="list-row" style={i === visits.visits.length - 1 ? { borderBottomWidth: 0 } : undefined} accessible>
                      <SymbolView name={{ ios: "clock", android: "schedule", web: "schedule" }} size={18} tintColor={v.status === "inside" ? colors.success : colors.faint} />
                      <View className="flex-1">
                        <Text className="list-row__label">{`${dayOf(v.checkedInAt)} · ${clockTime(v.checkedInAt)} → ${v.checkedOutAt ? clockTime(v.checkedOutAt) : v.status === "inside" ? "now" : "—"}`}</Text>
                        <Text className="card__subtitle" numberOfLines={1}>{`${v.as === "staff" ? "Work · " : ""}${v.gym} · ${v.status === "completed" ? durationText(v.durationMin) : STATUS_TEXT[v.status]}`}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function DoneCard({ result, onDone }: { result: ScanDone; onDone: () => void }) {
  const colors = useThemeColors();
  const checkingIn = result.action === "check_in";
  // A Staff or Trainer's day at work, not a workout
  const work = result.as === "staff";
  return (
    <View className="card items-center" style={{ gap: 10 }} accessibilityLiveRegion="polite">
      <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }} size={48} tintColor={colors.success} />
      <Text className="type-title text-center">{checkingIn ? "You're checked in" : "You're checked out"}</Text>
      <Text className="card__subtitle text-center">{`${result.gym.name} ${result.gym.branch}`}</Text>
      <View className="self-stretch" style={{ gap: 6 }}>
        <Row label="Checked in" value={clockTime(result.checkedInAt)} />
        {result.checkedOutAt ? <Row label="Checked out" value={clockTime(result.checkedOutAt)} /> : null}
        {result.durationMin !== undefined && result.durationMin !== null ? <Row label={work ? "Time at work" : "Workout duration"} value={durationText(result.durationMin)} /> : null}
      </View>
      <Text className="card__subtitle text-center">
        {work
          ? checkingIn ? "Have a good shift! Scan the same code when you leave." : "Thanks for today. See you next time!"
          : checkingIn ? "Have a great workout! Scan the same code when you leave." : "Great work today. See you next time!"}
      </Text>
      <View className="self-stretch">
        <PrimaryButton label="Done" onPress={onDone} />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text className="card__subtitle">{label}</Text>
      <Text className="list-row__label">{value}</Text>
    </View>
  );
}
