import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";

import { IconButton } from "@/components/IconButton";
import { SymbolView, type SymbolViewProps } from "@/components/SymbolView";
import { useThemeColors } from "@/theme";

type Meta = { icon: SymbolViewProps["name"]; text: string };

type ProgramCardProps = {
  title: string;
  // Drawn in the grey thumbnail (the PDF's photo slot)
  icon: SymbolViewProps["name"];
  meta: Meta[];
  // Optional status pill under the meta lines ("Done", "Missed")
  badge?: { label: string; background: string; color: string };
  onPress: () => void;
  accessibilityLabel: string;
};

// Peak Fitness ProgramCard: thumbnail, title, icon meta lines and the red round arrow. The whole
// card is the button; the arrow is drawn, not a second button.
export function ProgramCard({ title, icon, meta, badge, onPress, accessibilityLabel }: ProgramCardProps) {
  const colors = useThemeColors();
  return (
    <PressableScale scaleTo={0.98} onPress={onPress} className="program-card" accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      <View className="program-card__thumb">
        <SymbolView name={icon} size={26} tintColor={colors.muted} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="program-card__title" numberOfLines={1}>
          {title}
        </Text>
        {meta.map((line) => (
          <View key={line.text} className="flex-row items-center gap-1">
            <SymbolView name={line.icon} size={12} tintColor={colors.muted} />
            <Text className="program-card__meta" numberOfLines={1}>
              {line.text}
            </Text>
          </View>
        ))}
        {badge ? (
          <View className="program-card__badge" style={{ backgroundColor: badge.background }}>
            <Text className="program-card__badge-label" style={{ color: badge.color }}>
              {badge.label}
            </Text>
          </View>
        ) : null}
      </View>
      <IconButton icon={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} label="Open" variant="primary" size={44} />
    </PressableScale>
  );
}
