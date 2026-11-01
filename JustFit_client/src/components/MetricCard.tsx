import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";

import { SymbolView, type SymbolViewProps } from "@/components/SymbolView";
import { useThemeColors, Palette } from "@/theme";

type Tone = "blue" | "green" | "peach" | "lavender";

type MetricCardProps = {
  tone: Tone;
  label: string;
  icon: SymbolViewProps["name"];
  // Pre-formatted number ("1,350") and its unit ("Kcal")
  value: string;
  unit: string;
  // One friendly word under the number ("Perfect", "Rest")
  status: string;
  onPress?: () => void;
  accessibilityLabel?: string;
};

const look = (colors: Palette): Record<Tone, { ground: string; icon: string }> => ({
  blue: { ground: colors.tintBlue, icon: colors.iconBlue },
  green: { ground: colors.tintGreen, icon: colors.iconGreen },
  peach: { ground: colors.tintPeach, icon: colors.iconPeach },
  lavender: { ground: colors.tintLavender, icon: colors.iconLavender },
});

const arrow = { ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" } as const;

// Peak Fitness MetricCard: a pastel tile with a label and icon, a big number, a status pill and
// an arrow. Lay out two per row with gap-3; each metric keeps its own tone.
export function MetricCard({ tone, label, icon, value, unit, status, onPress, accessibilityLabel }: MetricCardProps) {
  const colors = useThemeColors();
  const { ground, icon: iconColor } = look(colors)[tone];
  return (
    <PressableScale scaleTo={0.98}
      onPress={onPress}
      disabled={!onPress}
      className="metric-card"
      style={{ backgroundColor: ground }}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value} ${unit}, ${status}`}
    >
      <View className="flex-row items-center justify-between">
        <Text className="metric-card__label" numberOfLines={1}>
          {label}
        </Text>
        <SymbolView name={icon} size={20} tintColor={iconColor} />
      </View>
      <Text className="metric-card__value" numberOfLines={1}>
        {value}
        <Text className="metric-card__unit">{` / ${unit}`}</Text>
      </Text>
      <View className="flex-row items-center justify-between gap-2">
        <View className="metric-card__status">
          <Text className="metric-card__status-label" numberOfLines={1}>
            {status}
          </Text>
        </View>
        {onPress ? (
          <View className="metric-card__arrow">
            <SymbolView name={arrow} size={14} tintColor={colors.forestInk} />
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}
