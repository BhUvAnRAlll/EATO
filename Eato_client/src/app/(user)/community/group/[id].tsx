import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { DeletePostSheet } from "@/components/community/DeletePostSheet";
import { AuthImage } from "@/components/community/AuthImage";
import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { PostCard } from "@/components/community/PostCard";
import { FormAlert } from "@/components/FormAlert";
import { community, type Group, type Post } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

// A group: description, member count, join/leave, and its posts (members can post)
export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const setGroupInStore = useCommunityStore((state) => state.setGroup);
  const [group, setGroup] = useState<Group | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [deletingPost, setDeletingPost] = useState<Post | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const groupResult = await community.getGroup(token, id);
    if (!groupResult.ok) {
      setError(groupResult.error);
      setStatus("error");
      return;
    }
    setGroup(groupResult.data.group);
    const postsResult = await community.groupPosts(token, id);
    if (postsResult.ok) {
      setPosts(postsResult.data.posts);
      setCursor(postsResult.data.nextCursor);
      setError(null);
    } else setError(postsResult.error);
    setStatus("ready");
  }, [id, getToken]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (!cursor) return;
    const result = await community.groupPosts(await getToken(), id, cursor);
    if (result.ok) {
      setPosts((current) => [...current, ...result.data.posts.filter((p) => !current.some((item) => item.id === p.id))]);
      setCursor(result.data.nextCursor);
    }
  };

  const toggleJoin = async () => {
    if (!group || busy) return;
    setBusy(true);
    const result = await community.setMembership(await getToken(), group.id, !group.joined);
    if (result.ok) {
      setGroup(result.data.group);
      setGroupInStore(result.data.group);
    } else setError(result.error);
    setBusy(false);
  };

  const like = async (post: Post) => {
    const liked = !post.liked;
    setPosts((current) => current.map((item) => (item.id === post.id ? { ...item, liked, likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)) } : item)));
    const result = await community.setLike(await getToken(), post.id, liked);
    setPosts((current) => current.map((item) => (item.id === post.id ? { ...item, ...(result.ok ? result.data : { liked: post.liked, likeCount: post.likeCount }) } : item)));
    if (!result.ok) setError(result.error);
  };

  const menuActions = (post: Post): SheetAction[] =>
    post.isOwn
      ? [
          { label: "Edit post", onPress: () => router.push({ pathname: "/community/compose", params: { postId: post.id } }) },
          { label: "Delete post", destructive: true, onPress: () => setDeletingPost(post) },
        ]
      : [
          {
            label: "Report post",
            destructive: true,
            onPress: async () => {
              const result = await community.report(await getToken(), { postId: post.id }, "Reported from a group");
              setError(result.ok ? "Thanks, we'll review this post." : result.error);
            },
          },
        ];

  const members = group ? `${group.memberCount.toLocaleString("en-IN")} ${group.memberCount === 1 ? "member" : "members"}` : "";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink" numberOfLines={1}>
            {group?.name ?? "Group"}
          </Text>
          {group?.joined && (
            <Pressable onPress={() => router.push({ pathname: "/community/compose", params: { groupId: group.id, groupName: group.name } })} className="admin__action admin__action--primary" accessibilityRole="button">
              <Text className="admin__action-label admin__action-label--primary">Post</Text>
            </Pressable>
          )}
        </View>

        {status === "error" && !group ? (
          <View className="px-5 pt-4">
            <EmptyState icon={{ ios: "lock", android: "lock", web: "lock" }} title="Can't open this group" text={error ?? "Please try again."} actionLabel="Retry" onAction={load} />
          </View>
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(post) => post.id}
            ListHeaderComponent={
              group ? (
                <View className="px-5 pb-4">
                  <View className="post__card">
                    {group.coverUrl && <AuthImage path={group.coverUrl} style={{ width: width - 72, height: Math.round((width - 72) * 0.5), borderRadius: 14, marginBottom: 12 }} />}
                    <Text className="community__kicker">{group.topic}</Text>
                    <Text className="post__body mt-2">{group.description}</Text>
                    <View className="mt-3 flex-row items-center justify-between">
                      <Text className="post__time">{members}{group.isPrivate ? " · Private" : ""}</Text>
                      <Pressable onPress={toggleJoin} disabled={busy} className={group.joined ? "group__join group__join--joined" : "group__join"} style={{ opacity: busy ? 0.5 : 1 }} accessibilityRole="button">
                        <Text className={group.joined ? "group__join-label group__join-label--joined" : "group__join-label"}>{group.joined ? "Joined" : "Join"}</Text>
                      </Pressable>
                    </View>
                  </View>
                  {error && (
                    <Pressable onPress={() => setError(null)} className="mt-3">
                      <FormAlert message={error} />
                    </Pressable>
                  )}
                </View>
              ) : null
            }
            ListEmptyComponent={
              status === "loading" ? (
                <View className="gap-3 px-5">
                  <PostSkeleton />
                </View>
              ) : (
                <View className="px-5">
                  <EmptyState icon={{ ios: "text.bubble", android: "forum", web: "forum" }} title="No posts yet" text={group?.joined ? "Start the conversation." : "Join the group to post."} />
                </View>
              )
            }
            ListFooterComponent={cursor ? <ActivityIndicator color={colors.forest} className="my-4" /> : <View className="h-4" />}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            renderItem={({ item }) => (
              <View className="px-5 pb-3">
                <PostCard post={item} width={width - 40} onLike={() => like(item)} onOpenComments={() => router.push({ pathname: "/community/post/[id]", params: { id: item.id } })} onMenu={() => setMenuPost(item)} onAuthor={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: item.author.id } })} />
              </View>
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
      <ActionSheet visible={menuPost !== null} actions={menuPost ? menuActions(menuPost) : []} onClose={() => setMenuPost(null)} />
      <DeletePostSheet post={deletingPost} onClose={() => setDeletingPost(null)} onDeleted={(post) => setPosts((current) => current.filter((item) => item.id !== post.id))} onError={setError} />
    </View>
  );
}
