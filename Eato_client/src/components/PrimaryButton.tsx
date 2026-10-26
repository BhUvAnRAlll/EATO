import { ActivityIndicator, Pressable, Text } from "react-native";

import { colors } from "@/theme";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  // Dimmed and not pressable (e.g. required fields are empty)
  disabled?: boolean;
};

// Full-width dark pill (54 pt) with a white label; dims while pressed, shows a spinner while loading
export function PrimaryButton({ label, onPress, loading = false, disabled = false }: PrimaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      className="btn-forest"
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.85 : 1, transform: [{ scale: pressed && !disabled ? 0.985 : 1 }] })}
      accessibilityRole="button"
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
    >
      {loading ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">{label}</Text>}
    </Pressable>
  );
}
