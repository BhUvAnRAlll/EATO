import { ActivityIndicator, Text } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import type { GymIconName } from "@/constants/gymIcons";
import { GradientFill } from "@/components/gym/GradientFill";
import { useThemeColors } from "@/theme";

// A sheet's main action on the portal's gradient, with the design's ▸ (a spinner while it saves)
export function GymPrimaryButton({ label, ready, busy = false, onPress, icon = "pencil-line" }: { label: string; ready: boolean; busy?: boolean; onPress: () => void; icon?: GymIconName }) {
  const colors = useThemeColors();
  // Not ready yet: solid light grey with muted text (while saving it keeps the gradient)
  const off = !ready && !busy;
  return (
    <PressableScale onPress={onPress} disabled={!ready || busy} haptic="tap" className={off ? "gym-btn gym-btn--disabled" : "gym-btn"} style={{ opacity: busy ? 0.85 : 1, marginTop: 4 }} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !ready || busy, busy }}>
      {!off && <GradientFill radius={14} />}
      {busy ? <ActivityIndicator size="small" color={colors.white} /> : <GymIcon name={icon} size={icon === "pencil-line" ? 14 : 18} color={off ? colors.gymMuted : colors.white} />}
      <Text className={off ? "gym-btn__label gym-btn__label--disabled" : "gym-btn__label"}>{label}</Text>
    </PressableScale>
  );
}
