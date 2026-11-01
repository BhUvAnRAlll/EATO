import { Text, View } from "react-native";

import { useThemeColors } from "@/theme";

type ProgressStatProps = {
  label: string;
  // Pre-formatted amount ("1,350") and its unit ("Kcal"), shown bold and muted on the right
  value: string;
  unit?: string;
  // 0–1 of the bar to fill (clamped)
  progress: number;
  // Bar colour; the brand red unless a row needs its own (a macro colour)
  color?: string;
};

// Peak Fitness ProgressStat: a label, a pill bar and "value unit" on one row. Stack rows with gap-2.
export function ProgressStat({ label, value, unit, progress, color: colorProp }: ProgressStatProps) {
  const colors = useThemeColors();
  const color = colorProp ?? colors.leaf;
  const share = Math.min(1, Math.max(0, progress));
  return (
    <View className="progress-stat" accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ""}`}>
      <Text className="progress-stat__label" numberOfLines={1}>
        {label}
      </Text>
      <View className="progress-stat__track">
        <View className="progress-stat__fill" style={{ width: `${share * 100}%`, backgroundColor: color }} />
      </View>
      <Text className="progress-stat__value" numberOfLines={1}>
        {value}
        {unit ? <Text className="progress-stat__unit">{` ${unit}`}</Text> : null}
      </Text>
    </View>
  );
}
