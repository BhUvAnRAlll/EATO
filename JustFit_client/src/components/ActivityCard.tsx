import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { PressableScale } from "@/components/PressableScale";

import { IconButton } from "@/components/IconButton";
import { ProgressRing } from "@/components/ProgressRing";

type ActivityCardProps = {
  title: string;
  // Big number ("1,350") and the muted rest of the line ("/ 2,000 Kcal")
  metric: string;
  meta: string;
  // 0–1 for the ring on the right
  progress: number;
  // Narrow phones get a smaller ring
  compact?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  // ProgressStat rows under the dark hero, and any note
  children?: ReactNode;
};

// Peak Fitness ActivityCard: an outlined card with a dark hero (title, big number, open arrow,
// ring) and progress rows underneath. One per screen, at the top.
export function ActivityCard({ title, metric, meta, progress, compact = false, onPress, accessibilityLabel, children }: ActivityCardProps) {
  const ringSize = compact ? 72 : 84;
  return (
    <PressableScale scaleTo={0.98} onPress={onPress} className="activity-card" accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      <View className="activity-card__hero">
        <View className="flex-1">
          <Text className="activity-card__title" numberOfLines={1}>
            {title}
          </Text>
          <Text className="activity-card__metric" numberOfLines={1}>
            {metric}
            <Text className="activity-card__meta">{` ${meta}`}</Text>
          </Text>
          <View className="mt-3 self-start">
            <IconButton icon={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} label="Open" variant="dark" size={36} />
          </View>
        </View>
        <ProgressRing progress={progress} size={ringSize} stroke={8} trackColor="rgba(255,255,255,0.14)">
          {(shown) => <Text className="activity-card__percent">{`${Math.round(Math.min(progress, 9.99) * 100 * shown)}%`}</Text>}
        </ProgressRing>
      </View>
      {children ? <View className="gap-2 px-2 pt-3">{children}</View> : null}
    </PressableScale>
  );
}
