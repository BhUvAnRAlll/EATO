import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SymbolView } from "@/components/SymbolView";
import { IntakeFrame } from "@/components/coach/IntakeFrame";
import { fetchProfile, type SavedProfile } from "@/lib/profile";
import { scanFieldsFromSaved } from "@/lib/profileScan";
import { useSessionToken } from "@/lib/session";
import { useSetupStore } from "@/store/setup";
import { useThemeColors } from "@/theme";

// Intake 8/10: an optional body scan (two photos → body fat %), moved here from setup on
// 2026-11-10. The scan runs the same screens as Profile's (?from=coach) and saves to the profile
// with the targets recalculated; the report returns here. Skip goes on without one.
export default function IntakeBody() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const [saved, setSaved] = useState<SavedProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read again each time the step shows, so a scan saved a moment ago appears at once
  useFocusEffect(
    useCallback(() => {
      let live = true;
      getToken()
        .then(fetchProfile)
        .then((result) => {
          if (!live) return;
          if (result.ok) {
            setSaved(result.data.profile);
            setError(null);
          } else setError(result.error);
        })
        .catch(() => live && setError("Couldn't load your profile. You can skip this step."));
      return () => {
        live = false;
      };
    }, [getToken]),
  );

  // The scan screens read height, weight, age and gender from the setup store: fill it from the saved profile
  const startScan = () => {
    if (!saved) return;
    useSetupStore.getState().update(scanFieldsFromSaved(saved));
    useSetupStore.getState().setScanDraft(null);
    router.push({ pathname: "/setup/scan-guide", params: { from: "coach" } });
  };

  const bodyFat = saved?.bodyFatPercent ?? null;

  return (
    <IntakeFrame
      step="body"
      title="Scan your body"
      subtitle="Optional. Your body fat % makes your calorie and protein targets more accurate."
      onNext={() => router.push("/coach/intake/food")}
      nextLabel={bodyFat != null ? "Continue" : "Skip"}
    >
      {error && <FormAlert message={error} />}
      {bodyFat != null ? (
        <View className="setup__card setup__card--selected gap-3">
          <View className="flex-row items-center gap-3">
            <View className="setup__card-icon">
              <SymbolView name={{ ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }} size={20} tintColor={colors.forestInk} />
            </View>
            <View className="flex-1">
              <Text className="setup__card-text">Estimated body fat</Text>
              <Text className="setup__macro-value">{`${bodyFat}%`}</Text>
            </View>
          </View>
          <Text className="setup__card-text">Saved on your profile. Your coach and targets use it.</Text>
          <Pressable onPress={startScan} accessibilityRole="button" hitSlop={8} className="self-start">
            <Text className="auth__link">Scan again</Text>
          </Pressable>
        </View>
      ) : (
        <View className="setup__card gap-3">
          <View className="flex-row items-center gap-3">
            <View className="setup__card-icon">
              <SymbolView name={{ ios: "camera.viewfinder", android: "photo_camera", web: "photo_camera" }} size={20} tintColor={colors.forestInk} />
            </View>
            <View className="flex-1">
              <Text className="setup__card-title">Body scan</Text>
              <Text className="setup__card-text">Two photos, front and side. About a minute.</Text>
            </View>
          </View>
          <Text className="setup__card-text">
            {"We'll show you how to stand and what to wear first. Your photos are kept privately: only you and the justFit team can see them."}
          </Text>
          <PrimaryButton label="Scan Body" onPress={startScan} disabled={!saved} />
        </View>
      )}
    </IntakeFrame>
  );
}
