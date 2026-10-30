import { Text, View } from "react-native";
import { Image } from "expo-image";

import { coachFaces } from "@/constants/images";
import { coaches, type CoachId } from "@/data/coach";

type Props = {
  coach: CoachId;
  // Width and height in points (default 44)
  size?: number;
};

// A coach's round avatar: their face photo, or their initial on soft pink until there is one.
// Used wherever a coach appears (Coach tab, chat, intake).
export function CoachAvatar({ coach, size = 44 }: Props) {
  const face = coachFaces[coach];
  const initial = coaches.find((c) => c.id === coach)?.name.replace("Coach ", "").charAt(0) ?? "";
  return (
    <View className="coach__avatar overflow-hidden" style={{ width: size, height: size }}>
      {face ? (
        <Image source={face} contentFit="cover" style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
      ) : (
        <Text className="coach__avatar-label" style={{ fontSize: Math.round(size * 0.38), lineHeight: Math.round(size * 0.48) }}>{initial}</Text>
      )}
    </View>
  );
}
