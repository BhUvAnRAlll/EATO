import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { FriendsPanel } from "@/components/community/FriendsPanel";
import { GymsPanel } from "@/components/community/GymsPanel";
import { PostCard } from "@/components/community/PostCard";
import { PostMenu } from "@/components/community/PostMenu";
import { QuickPostComposer } from "@/components/community/QuickPostComposer";
import { StoriesRow } from "@/components/community/StoriesRow";
import { TrainersPanel } from "@/components/community/TrainersPanel";
import { FormAlert } from "@/components/FormAlert";
import { community, isOffline, type Post } from "@/lib/community";
import { useMe } from "@/lib/me";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

type Tab = "feed" | "friends" | "trainers" | "gyms";
const tabs: { key: Tab; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "friends", label: "Friends" },
  { key: "trainers", label: "Trainers" },
  { key: "gyms", label: "Gyms" },
];
const PAGE_PADDING = 20;

// Community: Feed (stories, quick post, posts), Friends (search, requests), Trainers (my
// trainer, find trainers) and Gyms (my gyms, explore, join by code)
export default function Community() {
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const me = useMe();
  const store = useCommunityStore();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>("feed");

  // Another screen can open a section (Messages › Find friends, No trainer yet)
  useEffect(() => {
    const wanted = tabs.find((item) => item.key === params.tab)?.key;
    if (!wanted) return;
    const timer = setTimeout(() => setTab(wanted), 0);
    return () => clearTimeout(timer);
  }, [params.tab]);
  const [refreshing, setRefreshing] = useState(false);
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Load (or refresh after the freshness window) each time the tab is shown
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const token = await getToken();
        if (!cancelled) store.loadFeed(token);
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getToken]),
  );

  const refresh = async () => {
    setRefreshing(true);
    const token = await getToken();
    await store.loadFeed(token, { force: true });
    setRefreshing(false);
  };

  // A poll vote answers with the post and its new counts
  const vote = async (post: Post, optionId: string) => {
    const result = await community.vote(await getToken(), post.id, optionId);
    if (result.ok) store.upsertPost(result.data.post);
    else setNotice(result.error);
  };

  const like = async (post: Post) => {
    const error = await store.toggleLike(await getToken(), post.id);
    if (error) setNotice(error);
  };

  const openProfile = (userId: string) => router.push({ pathname: "/community/profile/[userId]", params: { userId } });

  const header = (
    <View>
      <View className="flex-row items-end justify-between px-5 pt-2">
        <Pressable onPress={() => openProfile(me.id)} accessibilityRole="button" accessibilityLabel="Your community profile">
          <Text className="community__kicker">Train together</Text>
          <Text className="community__title mt-1">Community</Text>
        </Pressable>
        <View className="flex-row gap-1">
        <Pressable onPress={() => router.push("/community/notifications")} className="community__icon-button" accessibilityRole="button" accessibilityLabel={store.requestCount > 0 ? `Notifications, ${store.requestCount} follow requests` : "Notifications"}>
          <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" }} size={24} tintColor={colors.forestInk} />
          {store.requestCount > 0 && (
            <View className="community__badge">
              <Text className="community__badge-label">{store.requestCount > 99 ? "99+" : store.requestCount}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={() => router.push("/messages")} className="community__icon-button" accessibilityRole="button" accessibilityLabel={store.unreadCount > 0 ? `Messages, ${store.unreadCount} unread` : "Messages"}>
          <SymbolView name={{ ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" }} size={24} tintColor={colors.forestInk} />
          {store.unreadCount > 0 && (
            <View className="community__badge">
              <Text className="community__badge-label">{store.unreadCount > 99 ? "99+" : store.unreadCount}</Text>
            </View>
          )}
        </Pressable>
        </View>
      </View>

      <View className="section-tabs mx-5 mt-5" accessibilityRole="tablist">
        {tabs.map((item) => (
          <Pressable key={item.key} onPress={() => setTab(item.key)} hitSlop={{ top: 6, bottom: 6 }} className={tab === item.key ? "section-tabs__item section-tabs__item--active" : "section-tabs__item"} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }}>
            <Text className={tab === item.key ? "section-tabs__label section-tabs__label--active" : "section-tabs__label"}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {notice && (
        <Pressable onPress={() => setNotice(null)} className="mx-5 mt-3">
          <FormAlert message={notice} />
        </Pressable>
      )}
      {tab === "feed" && store.feedStatus === "error" && store.feed.length > 0 && (
        <Pressable onPress={refresh} className="mx-5 mt-3 flex-row items-center gap-2" accessibilityRole="button" accessibilityLabel="Retry">
          <SymbolView name={isOffline(store.feedError) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "arrow.clockwise", android: "refresh", web: "refresh" }} size={14} tintColor={colors.muted} />
          <Text className="home__note">{isOffline(store.feedError) ? "You're offline. Showing what was loaded last." : "Couldn't refresh. Tap to retry."}</Text>
        </Pressable>
      )}

      {tab === "feed" ? (
        <View>
          <View className="mt-5">
            <StoriesRow
              me={me}
              groups={store.stories}
              onAddStory={() => router.push("/community/story-new")}
              onOpen={(memberId) => router.push({ pathname: "/community/story/[memberId]", params: { memberId } })}
            />
          </View>
          <View className="mx-5 mt-5">
            <QuickPostComposer me={me} getToken={getToken} onError={setNotice} />
          </View>
        </View>
      ) : null}
    </View>
  );

  const feedEmpty = () => {
    if (store.feedStatus === "loading" && store.feed.length === 0) {
      return (
        <View className="gap-3 px-5">
          <PostSkeleton />
          <PostSkeleton />
        </View>
      );
    }
    if (store.feedStatus === "error") {
      const offline = isOffline(store.feedError);
      return (
        <View className="px-5">
          <EmptyState icon={offline ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title={offline ? "You're offline" : "Couldn't load the feed"} text={store.feedError ?? "Please try again."} actionLabel="Retry" onAction={refresh} />
        </View>
      );
    }
    return (
      <View className="px-5">
        <EmptyState icon={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} title="Be the first to post" text="Share a meal, a workout or a win with the community." actionLabel="Share your progress" onAction={() => router.push("/community/compose")} />
      </View>
    );
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        {tab === "feed" ? (
          <FlatList
            data={store.feed}
            keyExtractor={(post) => post.id}
            ListHeaderComponent={header}
            ListHeaderComponentStyle={{ marginBottom: 16 }}
            ListEmptyComponent={feedEmpty}
            ListFooterComponent={store.loadingMore ? <ActivityIndicator color={colors.forest} className="my-4" /> : <View className="h-4" />}
            contentContainerStyle={{ paddingBottom: 16 }}
            renderItem={({ item }) => (
              <View className="px-5 pb-3">
                <PostCard
                  post={item}
                  width={width - PAGE_PADDING * 2}
                  onLike={() => like(item)}
                  onOpenComments={() => router.push({ pathname: "/community/post/[id]", params: { id: item.id } })}
                  onMenu={() => setMenuPost(item)}
                  onAuthor={() => openProfile(item.author.id)}
                  onVote={(optionId) => vote(item, optionId)}
                />
              </View>
            )}
            onEndReached={async () => store.loadMoreFeed(await getToken())}
            onEndReachedThreshold={0.4}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        ) : tab === "friends" ? (
          <FriendsPanel header={header} />
        ) : tab === "trainers" ? (
          <TrainersPanel header={header} />
        ) : (
          <GymsPanel header={header} />
        )}
      </SafeAreaView>

      <PostMenu post={menuPost} source="the feed" onClose={() => setMenuPost(null)} onDeleted={(post) => store.removePost(post.id)} onNotice={setNotice} />
    </View>
  );
}
