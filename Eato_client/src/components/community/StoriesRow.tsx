import { Pressable, ScrollView, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import { Avatar } from "@/components/community/Avatar";
import type { Member, StoryGroup } from "@/lib/community";
import { colors } from "@/theme";

type StoriesRowProps = {
  me: Member;
  groups: StoryGroup[];
  onAddStory: () => void;
  onOpen: (memberId: string) => void;
};

// "Your story" with an add control, then one circle per member with active stories.
// A ring means unviewed; a plain circle means every story has been seen.
export function StoriesRow({ me, groups, onAddStory, onOpen }: StoriesRowProps) {
  const mine = groups.find((group) => group.isOwn);
  const others = groups.filter((group) => !group.isOwn);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 18 }}>
      <View className="items-center gap-2">
        <View>
          <Pressable onPress={mine ? () => onOpen(me.id) : onAddStory} className={mine && !mine.allViewed ? "story__ring story__ring--new" : "story__ring"} accessibilityRole="button" accessibilityLabel={mine ? "Your story" : "Add a story"}>
            <Avatar member={me} size={56} />
          </Pressable>
          <Pressable onPress={onAddStory} className="story__add" hitSlop={6} accessibilityRole="button" accessibilityLabel="Add a story">
            <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={14} tintColor={colors.forestInk} />
          </Pressable>
        </View>
        <Text className="story__name">Your story</Text>
      </View>

      {others.map((group) => (
        <Pressable key={group.member.id} onPress={() => onOpen(group.member.id)} className="items-center gap-2" accessibilityRole="button" accessibilityLabel={`${group.member.name}'s story`}>
          <View className={group.allViewed ? "story__ring" : "story__ring story__ring--new"}>
            <Avatar member={group.member} size={56} />
          </View>
          <Text className="story__name" numberOfLines={1}>
            {group.member.name.split(" ")[0]}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
