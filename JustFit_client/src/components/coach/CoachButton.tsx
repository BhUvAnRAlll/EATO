import { ActivityIndicator, Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

type CoachButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  // Dimmed and not pressable (e.g. nothing picked yet)
  disabled?: boolean;
};

// The AI Coach's main button: a red gradient pill (60 pt) with the label centred and a white
// arrow in a lighter circle at the right. Eases down while held (with a light tap), shows a
// spinner while loading.
export function CoachButton({ label, onPress, loading = false, disabled = false }: CoachButtonProps) {
  const colors = useThemeColors();
  return (
    <PressableScale
      onPress={onPress}
      disabled={loading || disabled}
      haptic="tap"
      className={disabled ? "coach__cta btn--disabled" : "coach__cta"}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <>
          <Text className={disabled ? "coach__cta-label btn--disabled-label" : "coach__cta-label"}>{label}</Text>
          <View className="coach__cta-arrow" style={disabled ? { backgroundColor: "transparent" } : undefined}>
            <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={20} tintColor={disabled ? colors.faint : colors.white} />
          </View>
        </>
      )}
    </PressableScale>
  );
}
