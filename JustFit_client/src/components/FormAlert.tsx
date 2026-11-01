import { useEffect } from "react";
import { Text, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";

import { useThemeColors } from "@/theme";
import { haptic } from "@/lib/haptics";

// Red warning line for form errors (e.g. messages from the server)
// (with one error buzz each time a new message appears)
export function FormAlert({ message }: { message: string }) {
  const colors = useThemeColors();
  useEffect(() => {
    haptic.error();
  }, [message]);
  return (
    <View className="alert" accessibilityRole="alert">
      <SymbolView
        name={{ ios: "exclamationmark.triangle.fill", android: "warning", web: "warning" }}
        size={16}
        tintColor={colors.danger}
        style={{ marginTop: 1 }}
      />
      <Text className="alert__text">{message}</Text>
    </View>
  );
}
