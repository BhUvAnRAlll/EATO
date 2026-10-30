import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { SymbolView } from "@/components/SymbolView";
import { colors } from "@/theme";

type CoachButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  // Dimmed and not pressable (e.g. nothing picked yet)
  disabled?: boolean;
};

// The AI Coach's main button: a red gradient pill (60 pt) with the label centred and a white
// arrow in a lighter circle at the right. Dims while pressed, shows a spinner while loading.
export function CoachButton({ label, onPress, loading = false, disabled = false }: CoachButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      className="coach__cta"
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.9 : 1, transform: [{ scale: pressed && !disabled ? 0.985 : 1 }] })}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <>
          <Text className="coach__cta-label">{label}</Text>
          <View className="coach__cta-arrow">
            <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={20} tintColor={colors.white} />
          </View>
        </>
      )}
    </Pressable>
  );
}
