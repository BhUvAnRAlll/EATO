import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Switch, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { DeletePostSheet } from "@/components/community/DeletePostSheet";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { PostCard } from "@/components/community/PostCard";
import { StoryAvatar } from "@/components/community/StoryAvatar";
import { FormAlert } from "@/components/FormAlert";
import { usePullToRefresh } from "@/components/PullToRefresh";
import { community, isOffline, type Post, type Profile } from "@/lib/community";
import { friendButton, friendConfirm, messageLockText } from "@/lib/friends";
import { useSessionToken } from "@/lib/session";
import { storyRingFor } from "@/lib/storyRing";
import { useCommunityStore } from "@/store/community";
import { colors, switchColors } from "@/theme";

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
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [deletingPost, setDeletingPost] = useState<Post | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [confirmingFriend, setConfirmingFriend] = useState<"cancel" | "remove" | null>(null);
  const [tab, setTab] = useState<"posts" | "tagged">("posts");
  const [tagged, setTagged] = useState<Post[] | null>(null); // loaded with the profile when posts are visible
  const [taggedCursor, setTaggedCursor] = useState<string | null>(null);

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
      const [page, tags] = await Promise.all([community.profilePosts(token, userId), community.taggedPosts(token, userId)]);
      if (page.ok) {
        setPosts(page.data.posts);
        setCursor(page.data.nextCursor);
      }
      if (tags.ok) {
        setTagged(tags.data.posts);
        setTaggedCursor(tags.data.nextCursor);
      }
    } else {
      setPosts([]);
      setCursor(null);
      setTagged([]);
      setTaggedCursor(null);
    }
    setError(null);
    setStatus("ready");
  }, [userId, getToken, loadStories]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // A pull reads the profile, its posts and tagged posts again
  const { refreshControl } = usePullToRefresh(load);

  const loadMore = async () => {
    if (tab === "tagged") {
      if (!taggedCursor) return;
      const page = await community.taggedPosts(await getToken(), userId, taggedCursor);
      if (page.ok) {
        setTagged((current) => [...(current ?? []), ...page.data.posts.filter((p) => !(current ?? []).some((item) => item.id === p.id))]);
        setTaggedCursor(page.data.nextCursor);
      }
      return;
    }
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

  // A like shows at once in whichever list the post is in (Posts or Tagged), then follows the server
  const like = async (post: Post) => {
    const liked = !post.liked;
    const update = (change: (item: Post) => Post) => {
      setPosts((current) => current.map((item) => (item.id === post.id ? change(item) : item)));
      setTagged((current) => current?.map((item) => (item.id === post.id ? change(item) : item)) ?? current);
    };
    update((item) => ({ ...item, liked, likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)) }));
    const result = await community.setLike(await getToken(), post.id, liked);
    update((item) => ({ ...item, ...(result.ok ? result.data : { liked: post.liked, likeCount: post.likeCount }) }));
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
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" numberOfLines={1}>{profile?.member.name ?? "Profile"}</Text>
          {profile && !profile.isOwn ? (
            <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Profile options">
              <SymbolView name={{ ios: "ellipsis", android: "more_horiz", web: "more_horiz" }} size={20} tintColor={colors.ink} />
            </Pressable>
          ) : (
            <View className="screen-bar__spacer" />
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
            data={tab === "posts" ? posts : tagged ?? []}
            keyExtractor={(post) => post.id}
            ListHeaderComponent={
              profile ? (
                <View className="px-5 pb-4 pt-5">
                  <View className="items-center">
                    {storyGroup ? (
                      <StoryAvatar member={profile.member} size={92} ring={storyRingFor(storyGroup)} onPress={() => router.push({ pathname: "/community/story/[memberId]", params: { memberId: storyGroup.member.id } })} accessibilityLabel={profile.isOwn ? "Open your story" : `Open ${profile.member.name}'s story`} />
                    ) : (
                      <Avatar member={profile.member} size={92} />
                    )}
                    <Text className="profile__name">{profile.member.name}</Text>
                    {profile.bio && <Text className="profile__bio">{profile.bio}</Text>}

                    <View className="profile__stats">
                      {([["Posts", profile.postCount], ["Followers", profile.followers], ["Following", profile.following]] as const).map(([label, count], index) => (
                        <View key={label} className={index === 0 ? "profile__stat" : "profile__stat profile__stat--divided"}>
                          <Text className="profile__stat-count">{count.toLocaleString("en-IN")}</Text>
                          <Text className="gym-card__meta">{label}</Text>
                        </View>
                      ))}
                    </View>

                    {profile.suspended ? (
                      <Text className="home__note mt-4">This account is suspended.</Text>
                    ) : profile.isOwn ? (
                      <View className="join-card mt-4 w-full gap-3">
                        <View className="flex-row items-center justify-between">
                          <View className="flex-1 pr-3">
                            <Text className="auth__label">Private account</Text>
                            <Text className="home__note">Only accepted followers see your posts and stories.</Text>
                          </View>
                          <Switch {...switchColors} value={profile.isPrivate} onValueChange={togglePrivate} accessibilityLabel="Private account" />
                        </View>
                        <Pressable onPress={() => router.push("/community/close-friends")} className="flex-row items-center justify-between" accessibilityRole="button" accessibilityLabel="Close Friends">
                          <View className="flex-1 pr-3">
                            <Text className="auth__label">Close Friends</Text>
                            <Text className="home__note">Choose who sees your Close Friends stories.</Text>
                          </View>
                          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.muted} />
                        </Pressable>
                      </View>
                    ) : (
                      <View className="mt-4 w-full flex-row items-center gap-2">
                        <Pressable onPress={onFriend} disabled={friendBusy || profile.blocked} className={friendButton(profile.friendState).tone === "primary" ? "profile__button profile__button--filled flex-1" : "profile__button flex-1"} style={{ opacity: friendBusy || profile.blocked ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={friendButton(profile.friendState).label}>
                          {profile.friendState === "friends" && <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} size={14} tintColor={colors.ink} />}
                          {profile.friendState === "none" && <SymbolView name={{ ios: "person.badge.plus", android: "person_add", web: "person_add" }} size={15} tintColor={colors.white} />}
                          <Text className={friendButton(profile.friendState).tone === "primary" ? "profile__button-label profile__button-label--filled" : "profile__button-label"}>{friendButton(profile.friendState).label}</Text>
                        </Pressable>
                        <Pressable onPress={toggleFollow} disabled={busy || profile.blocked} className="profile__button" style={{ opacity: busy || profile.blocked ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={followLabel}>
                          <Text className="profile__button-label">{followLabel}</Text>
                        </Pressable>
                        <Pressable onPress={message} disabled={profile.blocked || profile.friendState !== "friends"} className="profile__round" style={{ opacity: profile.blocked || profile.friendState !== "friends" ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={profile.friendState === "friends" ? "Message" : "Message, locked"}>
                          <SymbolView name={profile.friendState === "friends" ? { ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" } : { ios: "lock", android: "lock", web: "lock" }} size={18} tintColor={colors.ink} />
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
                  {profile.canViewPosts && (
                    <View className="section-tabs mt-6" accessibilityRole="tablist">
                      {(["posts", "tagged"] as const).map((key) => {
                        const count = key === "posts" ? profile.postCount : tagged?.length ?? 0;
                        const more = key === "tagged" && taggedCursor ? "+" : "";
                        return (
                          <Pressable key={key} onPress={() => setTab(key)} hitSlop={{ top: 6, bottom: 6 }} className={tab === key ? "section-tabs__item section-tabs__item--active" : "section-tabs__item"} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}>
                            <Text className={tab === key ? "section-tabs__label section-tabs__label--active" : "section-tabs__label"}>{key === "posts" ? "Posts" : "Tagged"} ({count}{more})</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : undefined
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
                  {tab === "tagged" ? (
                    <EmptyState icon={{ ios: "tag", android: "sell", web: "sell" }} title="No tagged posts" text={profile?.isOwn ? "Posts your friends tag you in show here." : "Posts that tag them show here."} />
                  ) : (
                    <EmptyState icon={{ ios: "text.bubble", android: "forum", web: "forum" }} title="No posts yet" text={profile?.isOwn ? "Share your first post from the feed." : "Nothing shared yet."} />
                  )}
                </View>
              )
            }
            ListFooterComponent={(tab === "posts" ? cursor : taggedCursor) ? <ActivityIndicator color={colors.forest} className="my-4" /> : <View className="h-4" />}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            renderItem={({ item }) => (
              <View className="px-5 pb-3">
                <PostCard post={item} width={width - 32} onLike={() => like(item)} onOpenComments={() => router.push({ pathname: "/community/post/[id]", params: { id: item.id } })} onMenu={() => setMenuPost(item)} />
              </View>
            )}
            refreshControl={refreshControl}
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
