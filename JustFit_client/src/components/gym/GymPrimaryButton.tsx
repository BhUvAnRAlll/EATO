import { ActivityIndicator, Text } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { GradientFill } from "@/components/gym/GradientFill";
import { useThemeColors } from "@/theme";

// A sheet's main action on the portal's gradient, with the design's ▸ (a spinner while it saves)
export function GymPrimaryButton({ label, ready, busy = false, onPress }: { label: string; ready: boolean; busy?: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <PressableScale onPress={onPress} disabled={!ready || busy} haptic="tap" className="gym-btn" style={{ opacity: ready && !busy ? 1 : 0.5, marginTop: 4 }} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !ready || busy, busy }}>
      <GradientFill radius={14} />
      {busy ? <ActivityIndicator size="small" color={colors.white} /> : <SymbolView name={{ ios: "arrowtriangle.right.fill", android: "arrow_right", web: "arrow_right" }} size={14} tintColor={colors.white} />}
      <Text className="gym-btn__label">{label}</Text>
    </PressableScale>
  );
}
