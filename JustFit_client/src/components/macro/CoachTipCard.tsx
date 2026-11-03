import { Text, View } from "react-native";

import { CoachAvatar } from "@/components/coach/CoachAvatar";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { coaches, type CoachId } from "@/data/coach";
import type { CoachTip } from "@/lib/coachTipRules";
import { useThemeColors } from "@/theme";

type Props = {
  tip: CoachTip;
  coach: CoachId;
  // Opens the chat with the tip's question in the ask box (not sent, so no AI call until the
  // member sends it)
  onAsk: () => void;
};

// The coach's word on today, under the calories card on the Macro tab: worked out on the phone
// from what's logged, the targets and the plan (lib/coachTipRules), so it costs no AI call.
export function CoachTipCard({ tip, coach, onAsk }: Props) {
  const colors = useThemeColors();
  const name = coaches.find((c) => c.id === coach)?.name ?? "Your coach";
  const first = name.replace("Coach ", "");
  return (
    <PressableScale scaleTo={0.98} onPress={onAsk} className="home__card" style={{ gap: 10 }} accessibilityRole="button" accessibilityLabel={`${name}: ${tip.message} Ask ${first} in the chat`}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <CoachAvatar coach={coach} size={32} />
        <Text className="card__title" numberOfLines={1}>{first}</Text>
        <View className="home__pill-soft">
          <Text className="home__pill-soft-label">AI Coach</Text>
        </View>
      </View>
      <Text className="coach__bubble-text">{tip.message}</Text>
      <View className="flex-row items-center" style={{ gap: 2 }}>
        <Text className="home__link">{`Ask ${first}`}</Text>
        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={12} tintColor={colors.leaf} />
      </View>
    </PressableScale>
  );
}
