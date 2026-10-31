import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { SymbolView } from "@/components/SymbolView";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { Chip } from "@/components/setup/Chip";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { pickScanPhoto, requestBodyScan, type PhotoSource, type ScanPhoto, type ScanView } from "@/lib/bodyScan";
import { scanInputs, scanSexFromGender, type ScanSex } from "@/lib/bodyScanRules";
import { SESSION_EXPIRED_MESSAGE, isSessionExpired, returnToSignIn, useSessionToken } from "@/lib/session";
import { useSetupStore } from "@/store/setup";
import { colors } from "@/theme";
import type { Icon } from "@/types/profile";

const views: { view: ScanView; label: string; hint: string }[] = [
  { view: "front", label: "Front photo", hint: "Face the camera, feet shoulder-width apart, arms out about 30°" },
  { view: "side", label: "Side photo", hint: "Turn so the camera sees your right side, feet together, arms down" },
];

const retakeIcon: Icon = { ios: "arrow.counterclockwise", android: "refresh", web: "refresh" };

const sources: { source: PhotoSource; label: string; icon: Icon }[] = [
  { source: "camera", label: "Take photo", icon: { ios: "camera", android: "photo_camera", web: "photo_camera" } },
  { source: "library", label: "Choose from gallery", icon: { ios: "photo", android: "image", web: "image" } },
];

type Photos = Partial<Record<ScanView, ScanPhoto>>;

// One view's tile: the picked photo with Retake, or the two ways to add one
function PhotoTile({ view, label, hint, photo, onPick, onClear }: { view: ScanView; label: string; hint: string; photo?: ScanPhoto; onPick: (view: ScanView, source: PhotoSource) => void; onClear: (view: ScanView) => void }) {
  return (
    <View className="setup__card gap-3">
      <View>
        <Text className="setup__card-title">{label}</Text>
        <Text className="setup__card-text">{hint}</Text>
      </View>
      {photo ? (
        <View className="gap-2">
          <Image source={{ uri: photo.previewUri }} contentFit="cover" style={{ width: "100%", height: 220, borderRadius: 16 }} accessibilityLabel={`${label} preview`} />
          <Pressable onPress={() => onClear(view)} className="btn-outline flex-row gap-2 self-start" accessibilityRole="button" accessibilityLabel={`Retake ${label.toLowerCase()}`}>
            <SymbolView name={retakeIcon} size={18} tintColor={colors.forestInk} />
            <Text className="btn-outline__label">Retake</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-row gap-2">
          {sources.map((option) => (
            <Pressable key={option.source} onPress={() => onPick(view, option.source)} className="upload__option" accessibilityRole="button" accessibilityLabel={`${option.label}: ${label.toLowerCase()}`}>
              <SymbolView name={option.icon} size={20} tintColor={colors.forestInk} />
              <Text className="upload__option-label">{option.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// Optional: two photos → a body composition report (setup/scan-report) for the Body composition
// step. The photos go to the justFit server, which asks the Forma scan server and never stores
// them. Nothing is used until the user taps "Use this result" on the report.
export default function BodyScan() {
  const { profile, setScanDraft } = useSetupStore();
  // ?from=profile: opened from Profile; the store then holds the saved height, weight and age
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromProfile = from === "profile";
  const getToken = useSessionToken();
  const [photos, setPhotos] = useState<Photos>({});
  // The scan reads male and female bodies differently; the profile gender decides when it can
  const [sex, setSex] = useState<ScanSex | null>(() => scanSexFromGender(profile.gender));
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const pick = async (view: ScanView, source: PhotoSource) => {
    setError(null);
    const picked = await pickScanPhoto(source);
    if (!picked.ok) {
      if ("error" in picked) setError(picked.error);
      return;
    }
    setPhotos({ ...photos, [view]: picked.photo });
  };

  const clear = (view: ScanView) => {
    const next = { ...photos };
    delete next[view];
    setPhotos(next);
  };

  const scan = async () => {
    setError(null);
    setSessionExpired(false);
    const inputs = scanInputs(profile, sex);
    if (!inputs.ok) return setError(inputs.error);
    if (!photos.front || !photos.side) return setError("Add both photos first.");
    setIsScanning(true);
    const result = await requestBodyScan({ front: photos.front, side: photos.side }, inputs.inputs, await getToken());
    setIsScanning(false);
    if (!result.ok) {
      if (isSessionExpired(result)) setSessionExpired(true);
      return setError(isSessionExpired(result) ? SESSION_EXPIRED_MESSAGE : result.error);
    }
    // The full report opens on its own screen, where the user accepts it
    setScanDraft(result.estimate);
    router.push(fromProfile ? "/setup/scan-report?from=profile" : "/setup/scan-report");
  };

  // Back to Body composition: the previous screen (the instructions replaced themselves with
  // this one), or after a direct link or a reload with no history, the step itself
  const leave = () => (router.canGoBack() ? router.back() : router.replace(fromProfile ? "/profile" : "/setup/body-composition"));

  const bothPhotos = photos.front !== undefined && photos.side !== undefined;

  return (
    <SetupScreen
      step="body-composition"
      title="Estimate from photos"
      subtitle="Two photos give you a body composition report. We never store them."
      onNext={scan}
      nextLabel="Scan"
      canContinue={bothPhotos && !isScanning}
      loading={isScanning}
      onBack={leave}
      showProgress={!fromProfile}
    >
      <View className="gap-3">
        {views.map((item) => (
          <PhotoTile key={item.view} {...item} photo={photos[item.view]} onPick={pick} onClear={clear} />
        ))}

        {scanSexFromGender(profile.gender) === null && (
          <View className="setup__card gap-2.5">
            <Text className="setup__card-title">Which body type is closer to yours?</Text>
            <Text className="setup__card-text">The scan reads male and female bodies differently. Pick the one closer to your body.</Text>
            <View className="flex-row gap-2">
              <Chip label="Male" selected={sex === "male"} onPress={() => setSex("male")} />
              <Chip label="Female" selected={sex === "female"} onPress={() => setSex("female")} />
            </View>
          </View>
        )}

        {error && <FormAlert message={error} />}
        {sessionExpired && (
          <Pressable onPress={() => returnToSignIn()} className="btn-outline">
            <Text className="btn-outline__label">Sign in again</Text>
          </Pressable>
        )}
      </View>

      <View className="setup__note mt-5">
        <SymbolView name={{ ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }} size={24} tintColor={colors.forest} />
        <View className="flex-1 gap-0.5">
          <Text className="setup__note-title">For a better estimate</Text>
          <Text className="setup__note-text">
            Plain background, good light, fitted clothes, whole body in the frame, phone at chest height. The result is an estimate, not a medical measurement.
          </Text>
        </View>
      </View>
    </SetupScreen>
  );
}
