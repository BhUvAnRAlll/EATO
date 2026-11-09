import { Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

import { PressableScale } from "@/components/PressableScale";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { GymIcon } from "@/components/gym/GymIcon";
import { rupees } from "@/data/gymDashboard";
import { useTween } from "@/lib/useTween";
import { useThemeColors } from "@/theme";

// action: the link at the top right (left out for a Staff login without Payments)
type RevenueCardProps = { online: number; cash: number; action?: { label: string; onPress: () => void } };

// Today's revenue on the portal's gradient: the total, a bar splitting it into online (white) and
// cash (amber, so the two can be told apart), and both parts with their share and a dot in its colour. Home's link opens the Wallet, the Wallet's today's payments.
export function RevenueCard({ online, cash, action }: RevenueCardProps) {
  const colors = useThemeColors();
  const total = online + cash;
  const onlineShare = total > 0 ? Math.round((online / total) * 100) : 0;
  // The bar eases to a new split when a payment comes in
  const fill = useTween(total > 0 ? online / total : 0);
  const parts = [
    { label: "Online", value: online, share: onlineShare, color: colors.white },
    { label: "Cash", value: cash, share: total > 0 ? 100 - onlineShare : 0, color: colors.gymWarningLine },
  ];
  return (
    <View className="gym-hero" style={{ gap: 18 }} accessible accessibilityLabel={`Today's revenue ${rupees(total)}: online ${rupees(online)}, cash ${rupees(cash)}`}>
      <View className="absolute inset-0" pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="gym-revenue" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors.gymGradFrom} />
              <Stop offset="1" stopColor={colors.gymGradTo} />
            </LinearGradient>
            <RadialGradient id="gym-revenue-glow" cx="88%" cy="0%" r="70%">
              <Stop offset="0" stopColor={colors.white} stopOpacity={0.22} />
              <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#gym-revenue)" />
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#gym-revenue-glow)" />
          <Circle cx="100%" cy="100%" r="90" fill={colors.white} fillOpacity={0.06} />
        </Svg>
      </View>

      <View style={{ gap: 4 }}>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Text className="gym-hero__label flex-1" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{"Today's Revenue"}</Text>
          {action ? (
            <PressableScale onPress={action.onPress} hitSlop={8} className="gym-dash-hero__link" accessibilityRole="button" accessibilityLabel={action.label}>
              <Text className="gym-dash-hero__link-label">{action.label}</Text>
              <GymIcon name="chevron-right" size={14} color={colors.white} />
            </PressableScale>
          ) : null}
        </View>
        <AnimatedNumber className="gym-dash-hero__amount" numberOfLines={1} adjustsFontSizeToFit>{rupees(total)}</AnimatedNumber>
      </View>

      <View style={{ gap: 12 }}>
        <View className="gym-dash-split">
          <View className="gym-dash-split__fill" style={{ width: `${fill * 100}%` }} />
          {total > 0 && <View className="gym-dash-split__cash" />}
        </View>
        <View className="flex-row" style={{ gap: 12 }}>
          {parts.map((part) => (
            <View key={part.label} className="min-w-0 flex-1" style={{ gap: 2 }}>
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <View className="gym-dot" style={{ backgroundColor: part.color }} />
                <Text className="gym-dash-legend__label" numberOfLines={1}>{total > 0 ? `${part.label} · ${part.share}%` : part.label}</Text>
              </View>
              <AnimatedNumber className="gym-dash-legend__value" numberOfLines={1}>{rupees(part.value)}</AnimatedNumber>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
