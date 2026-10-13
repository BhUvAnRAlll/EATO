import { ActivityIndicator, Pressable, Text } from "react-native";
import { SymbolView } from "expo-symbols";

import { colors } from "@/theme";

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  // Dimmed and not pressable (e.g. required fields are empty)
  disabled?: boolean;
};

// Forest-green pill with a trailing arrow; shows a spinner while loading
export function PrimaryButton({ label, onPress, loading = false, disabled = false }: PrimaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      className="btn-forest"
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <>
          <Text className="btn-forest__label">{label}</Text>
          <SymbolView
            name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }}
            size={17}
            tintColor={colors.white}
          />
        </>
      )}
    </Pressable>
  );
}
