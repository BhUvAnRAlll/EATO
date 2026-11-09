import { ActivityIndicator, Text } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GradientFill } from "@/components/gym/GradientFill";
import { useThemeColors } from "@/theme";

// A form's one action: disabled until the form is ready, a spinner while it saves
export function SaveButton({ label, ready, busy, onPress }: { label: string; ready: boolean; busy: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  // Not ready yet: solid light grey with muted text (while saving it keeps the gradient)
  const off = !ready && !busy;
  return (
    <PressableScale onPress={onPress} disabled={!ready || busy} haptic="tap" className={off ? "gym-btn gym-btn--disabled" : "gym-btn"} style={{ opacity: busy ? 0.85 : 1 }} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !ready || busy, busy }}>
      {!off && <GradientFill radius={14} />}
      {busy && <ActivityIndicator size="small" color={colors.white} />}
      <Text className={off ? "gym-btn__label gym-btn__label--disabled" : "gym-btn__label"}>{label}</Text>
    </PressableScale>
  );
}
