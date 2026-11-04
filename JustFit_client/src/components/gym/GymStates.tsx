import { Text, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { ScreenSkeleton } from "@/components/Skeleton";
import { GymIcon } from "@/components/gym/GymIcon";
import type { GymIconName } from "@/constants/gymIcons";
import { useThemeColors } from "@/theme";

// A first read that failed: what went wrong and Try again
export function GymError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const colors = useThemeColors();
  return (
    <View className="gym-card items-center p-6" style={{ gap: 10 }}>
      <GymIcon name="triangle-alert" size={24} color={colors.gymWarning} />
      <Text className="gym-tx__name text-center">{"Couldn't load this"}</Text>
      <Text className="gym-tx__meta text-center">{error}</Text>
      <PressableScale onPress={onRetry} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Try again">
        <Text className="gym-btn__label gym-btn__label--outline">Try again</Text>
      </PressableScale>
    </View>
  );
}

// Nothing here yet
export function GymEmpty({ icon, title, text }: { icon: GymIconName; title: string; text: string }) {
  const colors = useThemeColors();
  return (
    <View className="gym-card items-center p-6" style={{ gap: 8 }}>
      <View className="gym-sms__icon">
        <GymIcon name={icon} size={20} color={colors.gymPrimary} />
      </View>
      <Text className="gym-tx__name text-center">{title}</Text>
      <Text className="gym-tx__meta text-center">{text}</Text>
    </View>
  );
}

export function GymLoading({ label }: { label: string }) {
  return <ScreenSkeleton cards={3} label={label} />;
}
