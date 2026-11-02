import { Pressable, Text, View } from "react-native";

// Where a Macro screen's numbers would be when they couldn't be loaded: what went wrong and a
// way to ask again (a pull to refresh does the same)
export function LoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <View className="coach__card items-center" accessibilityRole="alert">
      <Text className="coach__option-title text-center">{title}</Text>
      <Text className="coach__lead text-center">{message}</Text>
      <Pressable onPress={onRetry} className="coach__ghost self-stretch" accessibilityRole="button">
        <Text className="coach__ghost-label">Try again</Text>
      </Pressable>
    </View>
  );
}
