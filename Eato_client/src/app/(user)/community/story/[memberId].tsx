import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useLocalSearchParams } from "expo-router";

import { ActionSheet } from "@/components/community/ActionSheet";
import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { community, timeAgo } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

// Each story stays this long before the next one (ms)
const STORY_MS = 5000;

// Full-screen viewer for one member's active stories: tap the right half for the next
// story, the left half for the previous, and each view is recorded on the server.
export default function StoryViewer() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { width, height } = useWindowDimensions();
  const getToken = useSessionToken();
  const store = useCommunityStore();
  const group = useMemo(() => store.stories.find((entry) => entry.member.id === memberId) ?? null, [store.stories, memberId]);
  const [index, setIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const viewed = useRef(new Set<string>());

  const story = group?.stories[index] ?? null;

  const close = () => {
    if (memberId) store.markStoriesViewed(memberId);
    router.back();
  };
  const next = () => {
    if (!group) return close();
    if (index + 1 < group.stories.length) setIndex(index + 1);
    else close();
  };
  const previous = () => setIndex((current) => Math.max(0, current - 1));

  // Record the view once per story, and advance on a timer
  useEffect(() => {
    if (!story) return;
    if (!viewed.current.has(story.id)) {
      viewed.current.add(story.id);
      getToken().then((token) => community.viewStory(token, story.id));
    }
    if (paused) return;
    const timer = setTimeout(() => next(), STORY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id, paused]);

  const remove = async () => {
    if (!story) return;
    const result = await community.deleteStory(await getToken(), story.id);
    if (result.ok) {
      const token = await getToken();
      store.loadFeed(token, { force: true });
      close();
    }
  };

  if (!group || !story) {
    return (
      <View className="flex-1 items-center justify-center bg-ink">
        <Text className="story__caption">This story has ended.</Text>
        <Pressable onPress={() => router.back()} className="btn-outline mt-4 px-6" accessibilityRole="button">
          <Text className="btn-outline__label">Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-ink">
      <StatusBar style="light" />
      <AuthImage path={story.imageUrl} style={{ position: "absolute", top: 0, left: 0, width, height }} contentFit="contain" accessibilityLabel={story.caption ?? `${group.member.name}'s story`} />

      {/* Tap zones */}
      <Pressable onPress={previous} onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} style={{ position: "absolute", left: 0, top: 0, width: width * 0.35, height }} accessibilityLabel="Previous story" />
      <Pressable onPress={next} onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} style={{ position: "absolute", right: 0, top: 0, width: width * 0.65, height }} accessibilityLabel="Next story" />

      <SafeAreaView style={{ flex: 1 }} pointerEvents="box-none">
        <View className="flex-row gap-1 px-3 pt-2" pointerEvents="none">
          {group.stories.map((item, itemIndex) => (
            <View key={item.id} className="story__progress">
              <View className="story__progress-fill" style={{ width: itemIndex < index ? "100%" : itemIndex === index ? "60%" : "0%" }} />
            </View>
          ))}
        </View>
        <View className="mt-3 flex-row items-center gap-3 px-4">
          <Avatar member={group.member} size={36} />
          <View className="flex-1">
            <Text className="post__author" style={{ color: colors.white }}>{group.member.name}</Text>
            <Text className="post__time" style={{ color: "rgba(255,255,255,0.8)" }}>{timeAgo(story.createdAt)}</Text>
          </View>
          {story.isOwn && (
            <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Story options">
              <SymbolView name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }} size={22} tintColor={colors.white} />
            </Pressable>
          )}
          <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={22} tintColor={colors.white} />
          </Pressable>
        </View>
        <View className="flex-1" pointerEvents="none" />
        {story.caption && (
          <View className="px-6 pb-6" pointerEvents="none">
            <Text className="story__caption">{story.caption}</Text>
          </View>
        )}
      </SafeAreaView>

      <ActionSheet visible={menuOpen} actions={[{ label: "Delete story", destructive: true, onPress: remove }]} onClose={() => setMenuOpen(false)} />
    </View>
  );
}
