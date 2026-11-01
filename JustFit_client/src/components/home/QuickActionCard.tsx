import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";

import { quickActionIcons, type QuickAction, type QuickActionIconKey } from "@/data/home";
import { useThemeColors } from "@/theme";

type QuickActionCardProps = {
  action: QuickAction;
  width: number;
  onPress: () => void;
};

// Tinted icon, bold title and a one-line subtitle; the whole card is the button. An icon
// key the app doesn't know (an older build after an admin change) falls back to the meals icon.
export function QuickActionCard({ action, width, onPress }: QuickActionCardProps) {
  const colors = useThemeColors();
  const look = quickActionIcons(colors)[action.icon as QuickActionIconKey] ?? quickActionIcons(colors).meals;
  const compact = width < 80;
  // Icon circle from the home mockup: 56pt on a regular card, a little smaller on narrow ones
  const circle = width < 84 ? 48 : 56;

  return (
    <PressableScale scaleTo={0.98}
      onPress={onPress}
      className="quick__card"
      style={{ width, minHeight: width > 110 ? undefined : Math.round(width * 1.33) }}
      accessibilityRole="button"
      accessibilityLabel={`${action.title}. ${action.subtitle}`}
    >
      <View className="quick__icon" style={{ backgroundColor: look.background, width: circle, height: circle, borderRadius: circle / 2 }}>
        <SymbolView name={look.icon} size={Math.round(circle * 0.5)} tintColor={look.tint} />
      </View>
      <Text className="quick__title mt-2.5" numberOfLines={1} style={compact ? { fontSize: 11, lineHeight: 15 } : undefined}>
        {action.title}
      </Text>
      <Text className="quick__subtitle" numberOfLines={1} style={compact ? { fontSize: 10, lineHeight: 13 } : undefined}>
        {action.subtitle}
      </Text>
    </PressableScale>
  );
}
