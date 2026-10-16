import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Switch, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { DeletePostSheet } from "@/components/community/DeletePostSheet";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { PostCard } from "@/components/community/PostCard";
import { StoryAvatar } from "@/components/community/StoryAvatar";
import { FormAlert } from "@/components/FormAlert";
import { community, isOffline, type Post, type Profile } from "@/lib/community";
import { friendButton, friendConfirm, messageLockText } from "@/lib/friends";
import { useSessionToken } from "@/lib/session";
import { storyRingFor } from "@/lib/storyRing";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

// A member's profile: counts, follow or request, add friend, message (friends only), block; and the posts the viewer
// may see. The server decides visibility; the empty states only explain its answer.
export default function ProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const store = useCommunityStore();
  const loadStories = useCommunityStore((state) => state.loadStories);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [deletingPost, setDeletingPost] = useState<Post | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [confirmingFriend, setConfirmingFriend] = useState<"cancel" | "remove" | null>(null);

  // The stories row is refreshed alongside, so the ring on the photo is never stale
  const load = useCallback(async () => {
    const token = await getToken();
    loadStories(token);
    const result = await community.profile(token, userId);
    if (!result.ok) {
      setError(result.error);
      setStatus("error");
      return;
    }
    setProfile(result.data.profile);
    if (result.data.profile.canViewPosts) {
      const page = await community.profilePosts(token, userId);
      if (page.ok) {
        setPosts(page.data.posts);
        setCursor(page.data.nextCursor);
      }
    } else {
      setPosts([]);
      setCursor(null);
    }
    setError(null);
    setStatus("ready");
  }, [userId, getToken, loadStories]);

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
    const page = await community.profilePosts(await getToken(), userId, cursor);
    if (page.ok) {
      setPosts((current) => [...current, ...page.data.posts.filter((p) => !current.some((item) => item.id === p.id))]);
      setCursor(page.data.nextCursor);
    }
  };

  const toggleFollow = async () => {
    if (!profile || busy) return;
    setBusy(true);
    const result = await community.setFollow(await getToken(), userId, profile.followState === "none");
    if (result.ok) {
      setProfile(result.data.profile);
      if (result.data.profile.canViewPosts !== profile.canViewPosts) await load();
    } else setError(result.error);
    setBusy(false);
  };

  const togglePrivate = async (isPrivate: boolean) => {
    if (!profile) return;
    setProfile({ ...profile, isPrivate });
    const result = await community.updateMe(await getToken(), { isPrivate });
    if (result.ok) setProfile(result.data.profile);
    else {
      setProfile(profile);
      setError(result.error);
    }
  };

  // Add, accept, cancel or remove; undoing asks first (ConfirmSheet). The server answers with the new state.
  const runFriend = async (action: "request" | "cancel" | "accept" | "remove") => {
    if (!profile) return;
    setFriendBusy(true);
    const token = await getToken();
    const result =
      action === "request" ? await community.sendFriendRequest(token, userId)
      : action === "cancel" ? await community.cancelFriendRequest(token, userId)
      : action === "accept" ? await community.answerFriendRequest(token, userId, true)
      : await community.removeFriend(token, userId);
    if (result.ok) setProfile({ ...profile, friendState: result.data.friendState });
    else setError(result.error);
    setFriendBusy(false);
    setConfirmingFriend(null);
  };

  const onFriend = () => {
    if (!profile) return;
    const button = friendButton(profile.friendState);
    if (button.action === "cancel" || button.action === "remove") setConfirmingFriend(button.action);
    else runFriend(button.action);
  };

  const message = async () => {
    const result = await community.openConversation(await getToken(), userId);
    if (result.ok) router.push({ pathname: "/messages/[id]", params: { id: result.data.conversation.id } });
    else setError(result.error);
  };

  const toggleBlock = async () => {
    if (!profile) return;
    const result = await community.setBlock(await getToken(), userId, !profile.blocked);
    if (!result.ok) return setError(result.error);
    await load();
    await store.loadFeed(await getToken(), { force: true });
  };

  const like = async (post: Post) => {
    const liked = !post.liked;
    setPosts((current) => current.map((item) => (item.id === post.id ? { ...item, liked, likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)) } : item)));
    const result = await community.setLike(await getToken(), post.id, liked);
    setPosts((current) => current.map((item) => (item.id === post.id ? { ...item, ...(result.ok ? result.data : { liked: post.liked, likeCount: post.likeCount }) } : item)));
    if (result.ok) store.patchPost(post.id, result.data);
    else setError(result.error);
  };

  // This member's active stories the viewer may see (the server leaves out any they can't)
  const storyGroup = store.stories.find((group) => group.member.id === userId) ?? null;
  const profileActions: SheetAction[] = profile && !profile.isOwn
    ? [
        { label: profile.blocked ? "Unblock" : "Block", destructive: !profile.blocked, onPress: toggleBlock },
      ]
    : [];
  const postActions = (post: Post): SheetAction[] =>
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
              const result = await community.report(await getToken(), { postId: post.id }, "Reported from a profile");
              setError(result.ok ? "Thanks, we'll review this post." : result.error);
            },
          },
        ];

  const followLabel = profile?.followState === "following" ? "Following" : profile?.followState === "requested" ? "Requested" : profile?.isPrivate ? "Request" : "Follow";

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink" numberOfLines={1}>
            {profile?.member.name ?? "Profile"}
          </Text>
          {profile && !profile.isOwn && (
            <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Profile options">
              <SymbolView name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }} size={20} tintColor={colors.forestInk} />
            </Pressable>
          )}
        </View>

        {status === "error" && !profile ? (
          <View className="px-5 pt-4">
            <EmptyState
              icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "person.slash", android: "person_off", web: "person_off" }}
              title={isOffline(error) ? "You're offline" : "Can't open this profile"}
              text={error ?? "Please try again."}
              actionLabel="Retry"
              onAction={load}
            />
          </View>
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(post) => post.id}
            ListHeaderComponent={
              profile ? (
                <View className="px-5 pb-4">
                  <View className="post__card items-center">
                    {storyGroup ? (
                      <StoryAvatar member={profile.member} size={72} ring={storyRingFor(storyGroup)} onPress={() => router.push({ pathname: "/community/story/[memberId]", params: { memberId: storyGroup.member.id } })} accessibilityLabel={profile.isOwn ? "Open your story" : `Open ${profile.member.name}'s story`} />
                    ) : (
                      <Avatar member={profile.member} size={72} />
                    )}
                    <Text className="post__author mt-3" style={{ fontSize: 20 }}>{profile.member.name}</Text>
                    {profile.bio && <Text className="post__time mt-1 text-center">{profile.bio}</Text>}
                    <View className="mt-4 flex-row gap-8">
                      {[["Posts", profile.postCount], ["Followers", profile.followers], ["Following", profile.following]].map(([label, count]) => (
                        <View key={String(label)} className="items-center">
                          <Text className="post__author">{count}</Text>
                          <Text className="post__time">{label}</Text>
                        </View>
                      ))}
                    </View>
                    {profile.suspended ? (
                      <Text className="home__note mt-4">This account is suspended.</Text>
                    ) : profile.isOwn ? (
                      <View className="mt-4 w-full flex-row items-center justify-between">
                        <View className="flex-1 pr-3">
                          <Text className="auth__label">Private account</Text>
                          <Text className="home__note">Only accepted followers see your posts and stories.</Text>
                        </View>
                        <Switch value={profile.isPrivate} onValueChange={togglePrivate} trackColor={{ true: colors.forest }} accessibilityLabel="Private account" />
                      </View>
                    ) : null}
                    {profile.suspended ? null : profile.isOwn ? (
                      <Pressable onPress={() => router.push("/community/close-friends")} className="mt-3 w-full flex-row items-center justify-between" accessibilityRole="button" accessibilityLabel="Close Friends">
                        <View className="flex-1 pr-3">
                          <Text className="auth__label">Close Friends</Text>
                          <Text className="home__note">Choose who sees your Close Friends stories.</Text>
                        </View>
                        <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.muted} />
                      </Pressable>
                    ) : (
                      <View className="mt-4 flex-row gap-2">
                        <Pressable onPress={toggleFollow} disabled={busy || profile.blocked} className={profile.followState === "none" ? "group__join" : "group__join group__join--joined"} style={{ opacity: busy || profile.blocked ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={followLabel}>
                          <Text className={profile.followState === "none" ? "group__join-label" : "group__join-label group__join-label--joined"}>{followLabel}</Text>
                        </Pressable>
                        <Pressable onPress={onFriend} disabled={friendBusy || profile.blocked} className={friendButton(profile.friendState).tone === "primary" ? "group__join" : "group__join group__join--joined"} style={{ opacity: friendBusy || profile.blocked ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={friendButton(profile.friendState).label}>
                          <Text className={friendButton(profile.friendState).tone === "primary" ? "group__join-label" : "group__join-label group__join-label--joined"}>{friendButton(profile.friendState).label}</Text>
                        </Pressable>
                        <Pressable onPress={message} disabled={profile.blocked || profile.friendState !== "friends"} className="admin__action flex-row items-center gap-1.5" style={{ opacity: profile.blocked || profile.friendState !== "friends" ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={profile.friendState === "friends" ? "Message" : "Message, locked"}>
                          {profile.friendState !== "friends" && <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={12} tintColor={colors.muted} />}
                          <Text className="admin__action-label">Message</Text>
                        </Pressable>
                      </View>
                    )}
                    {!profile.isOwn && !profile.suspended && !profile.blocked && messageLockText(profile.friendState, profile.member.name) && (
                      <Text className="home__note mt-2 text-center">{messageLockText(profile.friendState, profile.member.name)}</Text>
                    )}
                    {profile.isPrivate && !profile.isOwn && (
                      <View className="mt-3 flex-row items-center gap-1.5">
                        <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={12} tintColor={colors.muted} />
                        <Text className="home__note">Private account</Text>
                      </View>
                    )}
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
                <View className="px-5">
                  <PostSkeleton />
                </View>
              ) : profile && !profile.canViewPosts ? (
                <View className="px-5">
                  <EmptyState icon={{ ios: "lock", android: "lock", web: "lock" }} title={profile.blocked ? "You've blocked this member" : "This account is private"} text={profile.blocked ? "Unblock them to see their posts." : profile.followState === "requested" ? "Your follow request is waiting for approval." : "Follow to see their posts."} />
                </View>
              ) : (
                <View className="px-5">
                  <EmptyState icon={{ ios: "text.bubble", android: "forum", web: "forum" }} title="No posts yet" text={profile?.isOwn ? "Share your first post from the feed." : "Nothing shared yet."} />
                </View>
              )
            }
            ListFooterComponent={cursor ? <ActivityIndicator color={colors.forest} className="my-4" /> : <View className="h-4" />}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            renderItem={({ item }) => (
              <View className="px-5 pb-3">
                <PostCard post={item} width={width - 40} onLike={() => like(item)} onOpenComments={() => router.push({ pathname: "/community/post/[id]", params: { id: item.id } })} onMenu={() => setMenuPost(item)} />
              </View>
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
      <ActionSheet visible={menuOpen} actions={profileActions} onClose={() => setMenuOpen(false)} />
      {profile && confirmingFriend && (
        <ConfirmSheet
          visible
          {...friendConfirm(confirmingFriend, profile.member.name)}
          busy={friendBusy}
          onConfirm={() => runFriend(confirmingFriend)}
          onCancel={() => setConfirmingFriend(null)}
        />
      )}
      <ActionSheet visible={menuPost !== null} actions={menuPost ? postActions(menuPost) : []} onClose={() => setMenuPost(null)} />
      <DeletePostSheet
        post={deletingPost}
        onClose={() => setDeletingPost(null)}
        onDeleted={(post) => {
          setPosts((current) => current.filter((item) => item.id !== post.id));
          store.removePost(post.id);
        }}
        onError={setError}
      />
    </View>
  );
}
