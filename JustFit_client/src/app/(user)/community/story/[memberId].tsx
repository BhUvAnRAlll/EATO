import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useLocalSearchParams } from "expo-router";

import { ActionSheet } from "@/components/community/ActionSheet";
import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { community, storyAudienceLabels, timeAgo } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

// Each story stays this long before the next one (ms), and the bar updates this often
const STORY_MS = 5000;
const TICK_MS = 100;

// Full-screen viewer. Tap the right side for the next story, the left for the previous;
// hold to pause. After a member's last story it moves on to the next member in the row,
// and after the last member it closes. Each view is recorded once on the server. The
// owner sees who-can-see and the view count, and can delete; others can report.
export default function StoryViewer() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { width, height } = useWindowDimensions();
  const getToken = useSessionToken();
  const store = useCommunityStore();
  const [currentMember, setCurrentMember] = useState(memberId);
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const viewed = useRef(new Set<string>());
  const elapsedRef = useRef(0);

  const groups = store.stories;
  const groupIndex = useMemo(() => groups.findIndex((entry) => entry.member.id === currentMember), [groups, currentMember]);
  const group = groupIndex >= 0 ? groups[groupIndex] : null;
  const story = group ? group.stories[Math.min(index, group.stories.length - 1)] ?? null : null;
  const paused = held || menuOpen || confirmDelete || notice !== null;

  // Opened from a link with nothing loaded yet: load the row once
  useEffect(() => {
    if (store.feedStatus === "idle") getToken().then((token) => store.loadFeed(token));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (group) store.markStoriesViewed(group.member.id);
    router.back();
  };

  const resetClock = () => {
    elapsedRef.current = 0;
    setElapsed(0);
  };

  const goTo = (memberIndex: number, storyIndex: number) => {
    if (group) store.markStoriesViewed(group.member.id);
    const target = groups[memberIndex];
    if (!target) return close();
    setCurrentMember(target.member.id);
    setIndex(storyIndex < 0 ? target.stories.length - 1 : storyIndex);
    resetClock();
  };

  const next = () => {
    if (!group) return close();
    if (index + 1 < group.stories.length) {
      setIndex(index + 1);
      resetClock();
    } else goTo(groupIndex + 1, 0);
  };

  const previous = () => {
    if (index > 0) {
      setIndex(index - 1);
      resetClock();
    } else if (groupIndex > 0) goTo(groupIndex - 1, -1);
    else resetClock();
  };

  // Record the view once per story; a story that ended or is no longer visible is dropped
  useEffect(() => {
    if (!story || viewed.current.has(story.id)) return;
    viewed.current.add(story.id);
    getToken().then(async (token) => {
      const result = await community.viewStory(token, story.id);
      if (!result.ok && result.status === 404) store.removeStory(story.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // The progress clock: runs while not paused (resuming where it stopped), then moves on
  useEffect(() => {
    if (!story || paused) return;
    const started = Date.now() - elapsedRef.current;
    const timer = setInterval(() => {
      const value = Date.now() - started;
      elapsedRef.current = value;
      if (value >= STORY_MS) {
        clearInterval(timer);
        next();
      } else setElapsed(value);
    }, TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, paused]);

  const remove = async () => {
    if (!story || deleting) return;
    setDeleting(true);
    const result = await community.deleteStory(await getToken(), story.id);
    setDeleting(false);
    setConfirmDelete(false);
    if (!result.ok) return setNotice(result.error);
    const remaining = (group?.stories.length ?? 1) - 1;
    store.removeStory(story.id);
    if (remaining === 0) return close();
    setIndex((value) => Math.min(value, remaining - 1));
    resetClock();
  };

  const report = async () => {
    if (!story) return;
    const result = await community.reportStory(await getToken(), story.id, "Reported from stories");
    setNotice(result.ok ? "Thanks, we'll review this story." : result.error);
  };

  if (!group || !story) {
    const loading = store.feedStatus === "loading" || store.feedStatus === "idle";
    return (
      <View className="flex-1 items-center justify-center bg-ink px-8">
        <StatusBar style="light" />
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <>
            <Text className="story__caption text-center">{store.feedStatus === "error" ? "Couldn't load stories. Check your connection." : "This story has ended."}</Text>
            <Pressable onPress={() => router.back()} className="btn-outline mt-4 px-6" accessibilityRole="button" accessibilityLabel="Close">
              <Text className="btn-outline__label">Close</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const storyPosition = group.stories.indexOf(story);

  return (
    <View className="flex-1 bg-ink">
      <StatusBar style="light" />
      <AuthImage path={story.imageUrl} style={{ position: "absolute", top: 0, left: 0, width, height }} contentFit="contain" accessibilityLabel={story.caption ?? `${group.member.name}'s story`} />

      {/* Tap zones: left = previous, right = next; hold either to pause */}
      <Pressable onPress={previous} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} style={{ position: "absolute", left: 0, top: 0, width: width * 0.35, height }} accessibilityRole="button" accessibilityLabel="Previous story" />
      <Pressable onPress={next} onLongPress={() => setHeld(true)} onPressOut={() => setHeld(false)} style={{ position: "absolute", right: 0, top: 0, width: width * 0.65, height }} accessibilityRole="button" accessibilityLabel="Next story" />

      <SafeAreaView style={{ flex: 1 }} pointerEvents="box-none">
        <View className="flex-row gap-1 px-3 pt-2" pointerEvents="none" accessibilityLabel={`Story ${storyPosition + 1} of ${group.stories.length}`}>
          {group.stories.map((item, itemIndex) => (
            <View key={item.id} className="story__progress">
              <View className="story__progress-fill" style={{ width: itemIndex < storyPosition ? "100%" : itemIndex === storyPosition ? `${Math.min(100, (elapsed / STORY_MS) * 100)}%` : "0%" }} />
            </View>
          ))}
        </View>
        <View className="mt-3 flex-row items-center gap-3 px-4" pointerEvents="box-none">
          <Avatar member={group.member} size={36} />
          <View className="flex-1" pointerEvents="none">
            <Text className="post__author" style={{ color: colors.white }} numberOfLines={1}>
              {group.isOwn ? "Your story" : group.member.name}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <Text className="post__time" style={{ color: "rgba(255,255,255,0.8)" }}>{timeAgo(story.createdAt)}</Text>
              {story.audience !== "public" && (
                <View className={story.audience === "close_friends" ? "story__badge story__badge--close" : "story__badge"}>
                  <Text className="story__badge-label">{storyAudienceLabels[story.audience].label}</Text>
                </View>
              )}
            </View>
          </View>
          <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Story options">
            <SymbolView name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }} size={22} tintColor={colors.white} />
          </Pressable>
          <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={22} tintColor={colors.white} />
          </Pressable>
        </View>
        <View className="flex-1" pointerEvents="none" />
        <View className="gap-3 px-6 pb-6" pointerEvents="box-none">
          {story.caption && (
            <Text className="story__caption" pointerEvents="none">
              {story.caption}
            </Text>
          )}
          {story.isOwn && story.viewCount !== null && (
            <View className="flex-row items-center gap-1.5" pointerEvents="none">
              <SymbolView name={{ ios: "eye", android: "visibility", web: "visibility" }} size={16} tintColor={colors.white} />
              <Text className="story__caption" style={{ fontSize: 14 }}>{story.viewCount === 1 ? "Seen by 1 person" : `Seen by ${story.viewCount} people`}</Text>
            </View>
          )}
          {notice && (
            <Pressable onPress={() => setNotice(null)} className="story__notice" accessibilityRole="button" accessibilityLabel="Dismiss">
              <Text className="story__notice-label">{notice}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>

      <ActionSheet
        visible={menuOpen}
        actions={story.isOwn ? [{ label: "Delete story", destructive: true, onPress: () => setConfirmDelete(true) }] : [{ label: "Report story", destructive: true, onPress: report }]}
        onClose={() => setMenuOpen(false)}
      />
      <ConfirmSheet visible={confirmDelete} title="Delete this story?" text="It disappears for everyone straight away." confirmLabel="Delete" busy={deleting} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </View>
  );
}
