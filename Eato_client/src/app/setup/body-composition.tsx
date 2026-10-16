import { Text, useWindowDimensions, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";

import { ReportUploadCard } from "@/components/setup/ReportUploadCard";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { images } from "@/constants/images";
import { useSetupStore } from "@/store/setup";
import { colors } from "@/theme";

// First setup step (optional): a body composition report fills in gender, height and
// weight and lets targets use measured fat-free mass. Skipping is the main action.
export default function BodyComposition() {
  const report = useSetupStore((state) => state.report);
  const { width } = useWindowDimensions();
  // The Next pill is 5/9 of the footer: under 400pt the long skip label would wrap onto two
  // lines, so narrow phones get a shorter one that says the same thing
  const skipLabel = width < 400 ? "Skip for now" : "Skip, I'll enter manually";

  return (
    <SetupScreen
      step="body-composition"
      title="Body composition"
      subtitle="Upload your body composition report to get more accurate diet and nutrition recommendations."
      headerArt={images.setupBcaReport}
      onNext={() => router.push("/setup/personal")}
      nextLabel={report ? "Continue" : skipLabel}
    >
      <ReportUploadCard />

      <View className="setup__note mt-5">
        <SymbolView
          name={{ ios: "checkmark.shield.fill", android: "verified_user", web: "verified_user" }}
          size={24}
          tintColor={colors.forest}
        />
        <View className="flex-1 gap-0.5">
          <Text className="setup__note-title">Optional</Text>
          <Text className="setup__note-text">
            {"We read the values from your report, you can check them and we never store the photo or PDF. Without a report you'll just enter your details on the next screens."}
          </Text>
        </View>
      </View>
    </SetupScreen>
  );
}
