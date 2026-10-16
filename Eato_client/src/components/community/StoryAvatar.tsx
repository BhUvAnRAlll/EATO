import { Pressable, View } from "react-native";

import { Avatar } from "@/components/community/Avatar";
import type { Member } from "@/lib/community";
import { storyRingClass, type StoryRing } from "@/lib/storyRing";

type StoryAvatarProps = {
  member: Member;
  size: number;
  ring: StoryRing;
  // With onPress the photo is a button (opens the stories or adds one)
  onPress?: () => void;
  accessibilityLabel?: string;
};

// A member's photo inside their story ring (see storyRingFor): the stories row and the
// profile header use the same rings, so seen, unseen and Close Friends look the same.
export function StoryAvatar({ member, size, ring, onPress, accessibilityLabel }: StoryAvatarProps) {
  const ringView = (
    <View className={storyRingClass[ring]} style={{ width: size + 10, height: size + 10 }} testID={`story-ring-${ring}`}>
      <Avatar member={member} size={size} />
    </View>
  );
  if (!onPress) return ringView;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {ringView}
    </Pressable>
  );
}
