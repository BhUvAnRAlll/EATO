import { ActivityIndicator, Text } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { GradientFill } from "@/components/gym/GradientFill";
import { useThemeColors } from "@/theme";

// A form's one action: disabled until the form is ready, a spinner while it saves
export function SaveButton({ label, ready, busy, onPress }: { label: string; ready: boolean; busy: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <PressableScale onPress={onPress} disabled={!ready || busy} haptic="tap" className="gym-btn" style={{ opacity: ready && !busy ? 1 : 0.5 }} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !ready || busy, busy }}>
      <GradientFill radius={14} />
      {busy && <ActivityIndicator size="small" color={colors.white} />}
      <Text className="gym-btn__label">{label}</Text>
    </PressableScale>
  );
}
