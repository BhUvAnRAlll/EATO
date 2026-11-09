import { ActivityIndicator, Text } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { useThemeColors } from "@/theme";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  // Dimmed and not pressable (e.g. required fields are empty)
  disabled?: boolean;
  // "meal": the Meals module's green (default: the app's red)
  tone?: "meal";
};

// Full-width red pill (54 pt) with a white label (grey with faint text while disabled); eases down while held (with a light tap),
// shows a spinner while loading
export function PrimaryButton({ label, onPress, loading = false, disabled = false, tone }: PrimaryButtonProps) {
  const colors = useThemeColors();
  return (
    <PressableScale
      onPress={onPress}
      disabled={loading || disabled}
      haptic="tap"
      className={disabled ? "btn-forest btn--disabled" : tone === "meal" ? "meal-btn" : "btn-forest"}
      accessibilityRole="button"
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
    >
      {loading ? <ActivityIndicator color={colors.white} /> : <Text className={disabled ? "btn-forest__label btn--disabled-label" : "btn-forest__label"}>{label}</Text>}
    </PressableScale>
  );
}
