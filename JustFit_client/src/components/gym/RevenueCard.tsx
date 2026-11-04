import { Text, useWindowDimensions, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Pattern, Rect, Stop } from "react-native-svg";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { rupees } from "@/data/gymDashboard";
import { useThemeColors } from "@/theme";

type RevenueCardProps = { online: number; cash: number; onMenu: () => void };

// Home's dark indigo card: today's revenue, then the online and cash parts in two white chips.
// The ground is a diagonal indigo gradient under a faint grid of dots.
export function RevenueCard({ online, cash, onMenu }: RevenueCardProps) {
  const colors = useThemeColors();
  // Narrow phones: each chip puts its amount under its label, so neither is cut short
  const narrow = useWindowDimensions().width < 360;
  const total = online + cash;
  const chips = [
    { label: "Online", value: online, dot: colors.gymPrimary, text: colors.gymPrimaryText },
    { label: "Cash", value: cash, dot: colors.gymSuccess, text: colors.gymSuccess },
  ];
  return (
    <View className="gym-hero" accessible accessibilityLabel={`Today's revenue ${rupees(total)}: online ${rupees(online)}, cash ${rupees(cash)}`}>
      <View className="absolute inset-0" pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="gym-revenue" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors.gymHeroFrom} />
              <Stop offset="1" stopColor={colors.gymHeroTo} />
            </LinearGradient>
            <Pattern id="gym-revenue-dots" x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
              <Circle cx="8" cy="8" r="1" fill={colors.white} fillOpacity={0.14} />
            </Pattern>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#gym-revenue)" />
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#gym-revenue-dots)" />
        </Svg>
      </View>

      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View className="gym-hero__icon">
          <SymbolView name={{ ios: "wallet.pass.fill", android: "account_balance_wallet", web: "account_balance_wallet" }} size={16} tintColor={colors.white} />
        </View>
        <Text className="gym-hero__label flex-1" numberOfLines={1}>{"Today's Revenue"}</Text>
        <PressableScale onPress={onMenu} hitSlop={12} className="items-center justify-center" style={{ width: 24, height: 24, gap: 3 }} accessibilityRole="button" accessibilityLabel="Revenue options">
          {[0, 1, 2].map((dot) => (
            <View key={dot} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.gymPrimaryLine }} />
          ))}
        </PressableScale>
      </View>

      <Text className="gym-hero__amount" numberOfLines={1} adjustsFontSizeToFit>{rupees(total)}</Text>

      <View className="flex-row" style={{ gap: 10 }}>
        {chips.map((chip) => (
          <View key={chip.label} className="gym-hero__chip" style={narrow ? { flexDirection: "column", alignItems: "flex-start", gap: 2 } : undefined}>
            <View className="flex-row items-center" style={{ gap: 8, flex: narrow ? undefined : 1 }}>
              <View className="gym-dot" style={{ backgroundColor: chip.dot }} />
              <Text className="gym-hero__chip-label" numberOfLines={1}>{chip.label}</Text>
            </View>
            <Text className="gym-hero__chip-value" style={{ color: chip.text }} numberOfLines={1}>{rupees(chip.value)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
