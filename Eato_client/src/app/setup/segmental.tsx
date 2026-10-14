import { Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { Redirect, router } from "expo-router";

import { SegmentalChart } from "@/components/setup/SegmentalChart";
import { SetupScreen } from "@/components/setup/SetupScreen";
import { hasSegmentalData } from "@/lib/nutrition";
import { useSetupStore } from "@/store/setup";
import { colors } from "@/theme";

// "Segmental analysis": the confirmed report's lean mass and fat per body region. Shown
// after the review step only when the sheet printed a segmental analysis; it is
// information for the user and never changes the targets.
export default function SegmentalAnalysis() {
  const report = useSetupStore((state) => state.report);

  if (!report?.segmental || !hasSegmentalData(report)) return <Redirect href="/setup/body-composition" />;

  return (
    <SetupScreen
      step="segmental"
      title="Segmental analysis"
      subtitle="See how lean mass and fat are distributed across your body."
      onNext={() => router.push("/setup/personal")}
      nextLabel="Continue"
      onBack={() => router.back()}
    >
      <SegmentalChart
        title="Segmental lean mass analysis"
        icon={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }}
        tint={colors.leaf}
        background={colors.leafSoft}
        readings={report.segmental.leanMass}
      />
      <View className="mt-4">
        <SegmentalChart
          title="Segmental fat analysis"
          icon={{ ios: "percent", android: "percent", web: "percent" }}
          tint={colors.danger}
          background={colors.dangerSoft}
          readings={report.segmental.fatMass}
        />
      </View>

      <View className="setup__info mt-4 items-center">
        <View className="h-7 w-7 items-center justify-center rounded-pill bg-forest">
          <SymbolView name={{ ios: "info", android: "info", web: "info" }} size={14} tintColor={colors.white} />
        </View>
        <Text className="setup__card-text flex-1">Segmental results help identify muscle and fat distribution across body regions.</Text>
      </View>
    </SetupScreen>
  );
}
