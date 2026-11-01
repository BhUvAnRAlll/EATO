import { ActivityIndicator, Text } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { useThemeColors } from "@/theme";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  // Dimmed and not pressable (e.g. required fields are empty)
  disabled?: boolean;
};

// Full-width red pill (54 pt) with a white label; eases down while held (with a light tap),
// shows a spinner while loading
export function PrimaryButton({ label, onPress, loading = false, disabled = false }: PrimaryButtonProps) {
  const colors = useThemeColors();
  return (
    <PressableScale
      onPress={onPress}
      disabled={loading || disabled}
      haptic="tap"
      className="btn-forest"
      style={{ opacity: disabled ? 0.4 : 1 }}
      accessibilityRole="button"
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
    >
      {loading ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{label}</Text>}
    </PressableScale>
  );
}
