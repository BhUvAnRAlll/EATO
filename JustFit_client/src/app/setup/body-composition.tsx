import { Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { PrimaryButton } from "@/components/PrimaryButton";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { useSetupStore } from "@/store/setup";
import { useThemeColors } from "@/theme";

// Optional step: a body scan from two photos estimates body fat %, which lets the targets use
// fat-free mass. Skipped, the targets are calculated from height, weight, age and gender.
export default function BodyComposition() {
  const colors = useThemeColors();
  const { profile, scan, removeScan } = useSetupStore();
  const scanned = profile.bodyFatPercent !== "";

  return (
    <SetupScreen
      step="body-composition"
      title="Body composition"
      subtitle="Optional. A quick body scan estimates your body fat % for more accurate targets."
      onNext={() => router.push("/setup/goal")}
      nextLabel={scanned ? "Next" : "Skip"}
    >
      {scanned ? (
        <View className="setup__card setup__card--selected gap-3">
          <View className="flex-row items-center gap-3">
            <View className="setup__card-icon">
              <SymbolView name={{ ios: "figure.stand", android: "accessibility_new", web: "accessibility_new" }} size={20} tintColor={colors.forestInk} />
            </View>
            <View className="flex-1">
              <Text className="setup__card-text">Estimated body fat</Text>
              <Text className="setup__macro-value">{`${profile.bodyFatPercent}%`}</Text>
            </View>
          </View>
          <Text className="setup__card-text">From your body scan. Your targets will use it.</Text>
          <View className="flex-row flex-wrap gap-x-5 gap-y-2">
            {scan && (
              <Pressable onPress={() => router.push("/setup/scan-report?mode=view")} accessibilityRole="button" hitSlop={8}>
                <Text className="auth__link">View full report</Text>
              </Pressable>
            )}
            <Pressable onPress={() => router.push("/setup/scan-guide")} accessibilityRole="button" hitSlop={8}>
              <Text className="auth__link">Scan again</Text>
            </Pressable>
            <Pressable onPress={removeScan} accessibilityRole="button" hitSlop={8}>
              <Text className="auth__link">Remove</Text>
            </Pressable>
          </View>
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
            {"We'll show you how to stand and what to wear first. Your photos are never stored."}
          </Text>
          <PrimaryButton label="Scan Body" onPress={() => router.push("/setup/scan-guide")} />
        </View>
      )}
    </SetupScreen>
  );
}
