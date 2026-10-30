import { Text, View } from "react-native";

type MacroBarProps = { label: string; value: number; target: number; color: string };

// "Protein 42/150g" with a thin progress track in the macro's own colour
export function MacroBar({ label, value, target, color }: MacroBarProps) {
  const progress = target > 0 ? Math.min(1, value / target) : 0;
  return (
    <View className="flex-1 gap-1.5" accessibilityLabel={`${label} ${Math.round(value)} of ${Math.round(target)} grams`}>
      <View className="flex-row items-center gap-1.5">
        <View className="h-2 w-2 rounded-pill" style={{ backgroundColor: color }} />
        <Text className="macro__bar-label" numberOfLines={1}>{label}</Text>
      </View>
      <View className="macro__track">
        <View className="h-full rounded-pill" style={{ width: `${progress * 100}%`, backgroundColor: color }} />
      </View>
      <Text className="macro__bar-value" numberOfLines={1}>
        {Math.round(value)}/{Math.round(target)}g
      </Text>
    </View>
  );
}
