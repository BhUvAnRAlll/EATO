import { Text, View } from "react-native";

import type { GymStatus } from "@/lib/adminPortal";
import { colors } from "@/theme";

// A gym's standing on the Super Admin screens: Active, Trial or Suspended
export function GymStatusPill({ status }: { status: GymStatus }) {
  const tone = status === "trial" ? { bg: colors.warningSoft, label: "Trial" } : status === "suspended" ? { bg: colors.dangerSoft, label: "Suspended" } : { bg: colors.successSoft, label: "Active" };
  return (
    <View className="workout__pill" style={{ backgroundColor: tone.bg }}>
      <Text className="workout__pill-label" style={{ color: colors.ink }}>{tone.label}</Text>
    </View>
  );
}
