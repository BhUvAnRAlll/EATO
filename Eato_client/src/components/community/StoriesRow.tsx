import { Pressable, ScrollView, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import { StoryAvatar } from "@/components/community/StoryAvatar";
import type { Member, StoryGroup } from "@/lib/community";
import { storyRingFor } from "@/lib/storyRing";
import { colors } from "@/theme";

type StoriesRowProps = {
  me: Member;
  groups: StoryGroup[];
  onAddStory: () => void;
  onOpen: (memberId: string) => void;
};

// "Your story" with an add control, then one circle per member with active stories.
// A blue ring means unseen stories (green when one is for Close Friends); a plain circle
// means every story has been seen. Your own photo is ringed while you have a story up,
// and the add control stays, so another story can be added at any time.
export function StoriesRow({ me, groups, onAddStory, onOpen }: StoriesRowProps) {
  const mine = groups.find((group) => group.isOwn);
  const others = groups.filter((group) => !group.isOwn);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 18 }}>
      <View className="items-center gap-2">
        <View>
          <StoryAvatar member={me} size={56} ring={storyRingFor(mine)} onPress={mine ? () => onOpen(me.id) : onAddStory} accessibilityLabel={mine ? "Your story" : "Add a story"} />
          <Pressable onPress={onAddStory} className="story__add" hitSlop={6} accessibilityRole="button" accessibilityLabel="Add a story">
            <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={13} tintColor={colors.white} />
          </Pressable>
        </View>
        <Text className="story__name">Your story</Text>
      </View>

      {others.map((group) => (
        <Pressable key={group.member.id} onPress={() => onOpen(group.member.id)} className="items-center gap-2" accessibilityRole="button" accessibilityLabel={`${group.member.name}'s story`}>
          <StoryAvatar member={group.member} size={56} ring={storyRingFor(group)} />
          <Text className="story__name" numberOfLines={1}>
            {group.member.name.split(" ")[0]}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
