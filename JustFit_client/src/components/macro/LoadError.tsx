import { Pressable, Text, View } from "react-native";

import { useThemeColors } from "@/theme";

// Where a Macro screen's numbers would be when they couldn't be loaded: what went wrong and a
// way to ask again (a pull to refresh does the same). tone "meal": Try again in the Meals green
export function LoadError({ title, message, onRetry, tone }: { title: string; message: string; onRetry: () => void; tone?: "meal" }) {
  const colors = useThemeColors();
  return (
    <View className="coach__card items-center" accessibilityRole="alert">
      <Text className="coach__option-title text-center">{title}</Text>
      <Text className="coach__lead text-center">{message}</Text>
      <Pressable onPress={onRetry} className="coach__ghost self-stretch" accessibilityRole="button">
        <Text className="coach__ghost-label" style={tone === "meal" ? { color: colors.mealDark } : undefined}>Try again</Text>
      </Pressable>
    </View>
  );
}
