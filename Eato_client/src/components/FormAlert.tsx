import { Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import { colors } from "@/theme";

// Red warning line for form errors (e.g. messages from Clerk)
export function FormAlert({ message }: { message: string }) {
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
