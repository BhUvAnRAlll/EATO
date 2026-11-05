import { Text, View } from "react-native";

import { ptLeftText, type TrainerClient } from "@/lib/trainerApi";
import { useThemeColors } from "@/theme";

// The status pill: green while running, amber in its last 3 days (dark text: amber text on it
// would be too faint), grey once ended
export function ClientTag({ client }: { client: TrainerClient }) {
  const colors = useThemeColors();
  const { daysLeft, active } = client.pt;
  const tone = !active ? { bg: colors.surfaceAlt, ink: colors.muted } : daysLeft <= 3 ? { bg: colors.warningSoft, ink: colors.ink } : { bg: colors.successSoft, ink: colors.success };
  return (
    <View className="client-tag" style={{ backgroundColor: tone.bg }}>
      <Text className="client-tag__label" style={{ color: tone.ink }}>{ptLeftText(daysLeft)}</Text>
    </View>
  );
}
