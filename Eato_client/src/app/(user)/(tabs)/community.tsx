import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect } from "expo-router";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { DeletePostSheet } from "@/components/community/DeletePostSheet";
import { GroupCard } from "@/components/community/GroupCard";
import { PostCard } from "@/components/community/PostCard";
import { StoriesRow } from "@/components/community/StoriesRow";
import { FormAlert } from "@/components/FormAlert";
import { community, isOffline, type Post } from "@/lib/community";
import { useMe } from "@/lib/me";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

type Tab = "feed" | "groups";
const PAGE_PADDING = 20;

// Community: Feed (stories, composer, posts) and Groups (search, join, open)
export default function Community() {
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const me = useMe();
  const store = useCommunityStore();
  const [tab, setTab] = useState<Tab>("feed");
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [deletingPost, setDeletingPost] = useState<Post | null>(null);
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

  // Groups load when their tab is first opened, and again as the search changes (debounced)
  useEffect(() => {
    if (tab !== "groups") return;
    const timer = setTimeout(async () => store.loadGroups(await getToken(), search.trim() || null), search ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, getToken]);

  const refresh = async () => {
    setRefreshing(true);
    const token = await getToken();
    await (tab === "feed" ? store.loadFeed(token, { force: true }) : store.loadGroups(token, search.trim() || null));
    setRefreshing(false);
  };

  const like = async (post: Post) => {
    const error = await store.toggleLike(await getToken(), post.id);
    if (error) setNotice(error);
  };

  const toggleJoin = async (groupId: string, joined: boolean) => {
    setBusyGroup(groupId);
    const result = await community.setMembership(await getToken(), groupId, !joined);
    if (result.ok) store.setGroup(result.data.group);
    else setNotice(result.error);
    setBusyGroup(null);
  };

  const menuActions = (post: Post): SheetAction[] => {
    const actions: SheetAction[] = [];
    if (post.isOwn) {
      actions.push({ label: "Edit post", onPress: () => router.push({ pathname: "/community/compose", params: { postId: post.id } }) });
      actions.push({ label: "Delete post", destructive: true, onPress: () => setDeletingPost(post) });
    } else {
      actions.push({ label: `View ${post.author.name.split(" ")[0]}'s profile`, onPress: () => openProfile(post.author.id) });
      actions.push({ label: `Message ${post.author.name.split(" ")[0]}`, onPress: () => openConversation(post.author.id) });
      actions.push({
        label: "Report post",
        destructive: true,
        onPress: async () => {
          const result = await community.report(await getToken(), { postId: post.id }, "Reported from the feed");
          setNotice(result.ok ? "Thanks, we'll review this post." : result.error);
        },
      });
    }
    return actions;
  };

  const openProfile = (userId: string) => router.push({ pathname: "/community/profile/[userId]", params: { userId } });

  const openConversation = async (userId: string) => {
    const result = await community.openConversation(await getToken(), userId);
    if (result.ok) router.push({ pathname: "/messages/[id]", params: { id: result.data.conversation.id } });
    else setNotice(result.error);
  };

  const header = (
    <View>
      <View className="flex-row items-end justify-between px-5 pt-2">
        <Pressable onPress={() => openProfile(me.id)} accessibilityRole="button" accessibilityLabel="Your community profile">
          <Text className="community__kicker">Train together</Text>
          <Text className="community__title mt-1">Community</Text>
        </Pressable>
        <View className="flex-row gap-2">
        <Pressable onPress={() => router.push("/community/notifications")} className="home__icon-button" accessibilityRole="button" accessibilityLabel={store.requestCount > 0 ? `Notifications, ${store.requestCount} follow requests` : "Notifications"}>
          <SymbolView name={{ ios: "bell", android: "notifications", web: "notifications" }} size={20} tintColor={colors.forestInk} />
          {store.requestCount > 0 && (
            <View className="community__badge">
              <Text className="community__badge-label">{store.requestCount > 99 ? "99+" : store.requestCount}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={() => router.push("/messages")} className="home__icon-button" accessibilityRole="button" accessibilityLabel={store.unreadCount > 0 ? `Messages, ${store.unreadCount} unread` : "Messages"}>
          <SymbolView name={{ ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" }} size={20} tintColor={colors.forestInk} />
          {store.unreadCount > 0 && (
            <View className="community__badge">
              <Text className="community__badge-label">{store.unreadCount > 99 ? "99+" : store.unreadCount}</Text>
            </View>
          )}
        </Pressable>
        </View>
      </View>

      <View className="segment mx-5 mt-4" accessibilityRole="tablist">
        {(["feed", "groups"] as Tab[]).map((item) => (
          <Pressable key={item} onPress={() => setTab(item)} className={tab === item ? "segment__item segment__item--active" : "segment__item"} accessibilityRole="tab" accessibilityState={{ selected: tab === item }}>
            <Text className={tab === item ? "segment__label segment__label--active" : "segment__label"}>{item === "feed" ? "Feed" : "Groups"}</Text>
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
          <Pressable onPress={() => router.push("/community/compose")} className="composer mx-5 mt-5" accessibilityRole="button" accessibilityLabel="Share your progress">
            <Avatar member={me} size={40} />
            <Text className="composer__prompt">Share your progress...</Text>
            <View className="composer__image">
              <SymbolView name={{ ios: "photo.badge.plus", android: "add_photo_alternate", web: "add_photo_alternate" }} size={20} tintColor="#2B4C7E" />
            </View>
          </Pressable>
        </View>
      ) : (
        <View className="search mx-5 mt-5">
          <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
          <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search groups by name or topic" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search groups" />
        </View>
      )}
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

  const groupsEmpty = () => {
    if (store.groupsStatus === "loading") return <ActivityIndicator color={colors.forest} className="mt-6" />;
    if (store.groupsStatus === "error") {
      return (
        <View className="px-5">
          <EmptyState icon={{ ios: "wifi.exclamationmark", android: "wifi_off", web: "wifi_off" }} title="Couldn't load groups" text={store.groupsError ?? "Please try again."} actionLabel="Retry" onAction={refresh} />
        </View>
      );
    }
    return (
      <View className="px-5">
        <EmptyState icon={{ ios: "person.3", android: "groups", web: "groups" }} title="No groups found" text={search ? "Try another name or topic." : "Groups will appear here."} />
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
                />
              </View>
            )}
            onEndReached={async () => store.loadMoreFeed(await getToken())}
            onEndReachedThreshold={0.4}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <FlatList
            data={store.groups}
            keyExtractor={(group) => group.id}
            ListHeaderComponent={header}
            ListHeaderComponentStyle={{ marginBottom: 16 }}
            ListEmptyComponent={groupsEmpty}
            contentContainerStyle={{ paddingBottom: 16 }}
            renderItem={({ item }) => (
              <View className="px-5 pb-3">
                <GroupCard group={item} busy={busyGroup === item.id} onOpen={() => router.push({ pathname: "/community/group/[id]", params: { id: item.id } })} onToggleJoin={() => toggleJoin(item.id, item.joined)} />
              </View>
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>

      <ActionSheet visible={menuPost !== null} title={menuPost ? `${menuPost.author.name}'s post` : undefined} actions={menuPost ? menuActions(menuPost) : []} onClose={() => setMenuPost(null)} />
      <DeletePostSheet post={deletingPost} onClose={() => setDeletingPost(null)} onDeleted={(post) => store.removePost(post.id)} onError={setNotice} />
    </View>
  );
}
