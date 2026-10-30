import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { PostCard } from "@/components/community/PostCard";
import { GymAboutTab } from "@/components/gyms/GymAboutTab";
import { GymEventsTab } from "@/components/gyms/GymEventsTab";
import { GymHeader, type GymTab as Tab } from "@/components/gyms/GymHeader";
import { GymMembersTab } from "@/components/gyms/GymMembersTab";
import { FormAlert } from "@/components/FormAlert";
import { community, isOffline, timeAgo, type Post } from "@/lib/community";
import { membershipButton, roleLabels } from "@/lib/gymRules";
import { gyms, type Announcement, type Gym, type GymEvent, type GymMember } from "@/lib/gyms";
import { useMe } from "@/lib/me";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// One gym: the header (cover, logo, name, where you stand, actions, tabs), then Feed (share box,
// the pinned announcement, posts), Members, Events and About. Private and hidden gyms show
// their content to members only; the server enforces it.
export default function GymScreen() {
  const { id, tab: startTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const me = useMe();
  const [gym, setGym] = useState<Gym | null>(null);
  const [allNotes, setAllNotes] = useState(false);
  const [tab, setTab] = useState<Tab>(startTab === "members" || startTab === "events" || startTab === "about" ? startTab : "feed");
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [posts, setPosts] = useState<Post[] | null>(null); // null until the feed has loaded
  const [cursor, setCursor] = useState<string | null>(null);
  const [members, setMembers] = useState<GymMember[] | null>(null);
  const [events, setEvents] = useState<GymEvent[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [menuPost, setMenuPost] = useState<Post | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; label: string; run: () => Promise<void> } | null>(null);

  // What one tab shows (only when the viewer may read the gym's content). The About tab
  // needs nothing beyond the gym itself.
  const loadTab = useCallback(async (which: Tab, token: string | null) => {
    if (which === "feed") {
      const [feed, notes] = await Promise.all([gyms.posts(token, id), gyms.announcements(token, id)]);
      if (feed.ok) {
        setPosts(feed.data.posts);
        setCursor(feed.data.nextCursor);
      }
      if (notes.ok) setAnnouncements(notes.data.announcements);
      const failed = [feed, notes].find((r) => !r.ok);
      if (failed && !failed.ok) setNotice(failed.error);
    } else if (which === "members" || which === "about") {
      const people = await gyms.members(token, id);
      if (people.ok) setMembers(people.data.members);
      else setNotice(people.error);
    } else if (which === "events") {
      const list = await gyms.events(token, id);
      if (list.ok) setEvents(list.data.events);
      else setNotice(list.error);
    }
  }, [id]);

  // The gym, then the open tab's content: two requests, whichever tab is showing
  const load = useCallback(async (which: Tab) => {
    const token = await getToken();
    const result = await gyms.get(token, id);
    if (!result.ok) {
      setError(result.error);
      setStatus("error");
      return;
    }
    const loaded = result.data.gym;
    setGym(loaded);
    setStatus("ready");
    setError(null);
    if (loaded.can.viewContent) await loadTab(which, token);
  }, [id, getToken, loadTab]);

  // Each time the screen is shown, and each time the tab changes while it is shown
  useFocusEffect(
    useCallback(() => {
      load(tab);
    }, [load, tab]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load(tab);
    setRefreshing(false);
  };

  // One page at a time: scroll events keep firing while a page is on its way
  const loadingMore = useRef(false);
  const loadMore = async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await gyms.posts(await getToken(), id, cursor);
      if (page.ok) {
        setPosts((current) => [...(current ?? []), ...page.data.posts.filter((p) => !(current ?? []).some((item) => item.id === p.id))]);
        setCursor(page.data.nextCursor);
      }
    } finally {
      loadingMore.current = false;
    }
  };

  // Runs one change with a busy key, shows the server's refusal if any, then reloads
  const run = async (key: string, change: (token: string | null) => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    const result = await change(await getToken());
    if (!result.ok) setNotice(result.error ?? "Please try again.");
    await load(tab);
    setBusy(null);
  };

  const onMembership = () => {
    if (!gym) return;
    const action = membershipButton(gym.membership, gym.joinMode).action;
    if (action === "join" || action === "request") run("membership", (token) => gyms.join(token, gym.id));
    else if (action === "cancel") run("membership", (token) => gyms.leave(token, gym.id));
    else if (action === "leave") askLeave();
  };

  const askLeave = () => {
    if (!gym) return;
    setConfirm({
      title: `Leave ${gym.name}?`,
      text: gym.joinMode === "request" ? "You'll need to ask again to rejoin." : "You can join again at any time.",
      label: "Leave gym",
      run: async () => {
        await run("membership", (token) => gyms.leave(token, gym.id));
        setConfirm(null);
      },
    });
  };

  const like = async (post: Post) => {
    const liked = !post.liked;
    setPosts((current) => current?.map((item) => (item.id === post.id ? { ...item, liked, likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)) } : item)) ?? current);
    const result = await community.setLike(await getToken(), post.id, liked);
    setPosts((current) => current?.map((item) => (item.id === post.id ? { ...item, ...(result.ok ? result.data : { liked: post.liked, likeCount: post.likeCount }) } : item)) ?? current);
    if (!result.ok) setNotice(result.error);
  };

  const postActions = (post: Post): SheetAction[] => {
    if (!gym) return [];
    const actions: SheetAction[] = [];
    if (post.reviewStatus === "pending" && gym.can.moderate) actions.push({ label: "Approve post", onPress: () => run(`post-${post.id}`, (token) => gyms.approvePost(token, gym.id, post.id)) });
    if (post.isOwn) {
      actions.push({ label: "Edit post", onPress: () => router.push({ pathname: "/community/compose", params: { postId: post.id } }) });
      actions.push({ label: "Delete post", destructive: true, onPress: () => setConfirm({ title: "Delete this post?", text: "It will be removed for everyone.", label: "Delete", run: async () => { await run(`post-${post.id}`, (token) => community.deletePost(token, post.id)); setConfirm(null); } }) });
    } else {
      if (gym.can.manage) actions.push({ label: "Remove from gym", destructive: true, onPress: () => setConfirm({ title: "Remove this post?", text: "It will be taken down for everyone in the gym.", label: "Remove", run: async () => { await run(`post-${post.id}`, (token) => gyms.removePost(token, gym.id, post.id)); setConfirm(null); } }) });
      actions.push({
        label: "Report post",
        destructive: true,
        onPress: async () => {
          const result = await community.report(await getToken(), { postId: post.id }, "Reported from a gym feed");
          setNotice(result.ok ? "Thanks, we'll review this post." : result.error);
        },
      });
    }
    return actions;
  };

  // Message a member who is a friend (the server checks friendship again)
  const message = async (row: GymMember) => {
    const result = await community.openConversation(await getToken(), row.member.id);
    if (result.ok) router.push({ pathname: "/messages/[id]", params: { id: result.data.conversation.id } });
    else setNotice(result.error);
  };

  if (status === "error" || !gym) {
    return (
      <View className="flex-1 bg-cream">
        <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
          <View className="screen-bar">
            <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
              <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
            </Pressable>
            <Text className="screen-bar__title">Gym</Text>
            <View className="screen-bar__spacer" />
          </View>
          <View className="px-5 pt-4">
            {status === "loading" ? (
              <PostSkeleton />
            ) : (
              <EmptyState icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "dumbbell", android: "fitness_center", web: "fitness_center" }} title={isOffline(error) ? "You're offline" : "Can't open this gym"} text={error ?? "Please try again."} actionLabel="Retry" onAction={() => load(tab)} />
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const locked = (
    <EmptyState
      icon={{ ios: "lock", android: "lock", web: "lock" }}
      title={gym.membership?.status === "pending" ? "Waiting for approval" : gym.membership?.status === "suspended" ? "Membership suspended" : "Members only"}
      text={gym.membership?.status === "pending" ? "You'll see posts, members and events once an admin approves your request." : gym.membership?.status === "suspended" ? "A gym admin has suspended your membership." : `Join ${gym.name} to see what members share.`}
    />
  );
  const shownNotes = allNotes ? announcements : announcements.slice(0, 1);
  const staff = (members ?? []).filter((row) => row.role !== "member");

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
        showsVerticalScrollIndicator={false}
        onScroll={({ nativeEvent }) => {
          const nearEnd = nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >= nativeEvent.contentSize.height - 400;
          if (nearEnd && tab === "feed") loadMore();
        }}
        scrollEventThrottle={400}
      >
        <GymHeader gym={gym} tab={tab} busy={busy === "membership"} onTab={setTab} onMembership={onMembership} />

        {notice && (
          <Pressable onPress={() => setNotice(null)} className="mx-5 mt-3">
            <FormAlert message={notice} />
          </Pressable>
        )}

        <View className="mt-5 gap-3 px-5">
          {tab === "about" ? (
            <GymAboutTab gym={gym} staff={gym.can.viewContent ? staff : []} onLeave={gym.can.leave ? askLeave : null} />
          ) : !gym.can.viewContent ? (
            locked
          ) : tab === "feed" ? (
            <>
              {gym.can.post && (
                <View className="gym-share">
                  <Pressable onPress={() => router.push({ pathname: "/community/compose", params: { gymId: gym.id, gymName: gym.name } })} className="flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Share something with ${gym.name}`}>
                    <Avatar member={me} size={40} />
                    <View className="gym-share__prompt">
                      <Text className="gym-share__prompt-text" numberOfLines={1}>Share something with {gym.name}...</Text>
                    </View>
                  </Pressable>
                  <View className="mt-3 flex-row justify-around">
                    {([
                      ["photo", "Photo", { ios: "photo", android: "image", web: "image" }],
                      ["achievement", "Achievement", { ios: "trophy", android: "emoji_events", web: "emoji_events" }],
                      ["poll", "Poll", { ios: "chart.bar", android: "poll", web: "poll" }],
                    ] as const).map(([type, label, icon]) => (
                      <Pressable key={type} onPress={() => router.push({ pathname: "/community/compose", params: { gymId: gym.id, gymName: gym.name, type } })} className="flex-row items-center gap-1.5 px-2 py-1" accessibilityRole="button" accessibilityLabel={`Share a ${label.toLowerCase()} with ${gym.name}`}>
                        <SymbolView name={icon} size={18} tintColor={colors.inkSoft} />
                        <Text className="gym-share__shortcut">{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              {gym.settings.postModeration && gym.can.post && !gym.can.moderate && <Text className="home__note">Posts in this gym are reviewed by staff before others see them.</Text>}

              {shownNotes.map((note) => (
                <View key={note.id} className="gym-note">
                  <View className="flex-row items-center gap-2">
                    <SymbolView name={{ ios: "megaphone", android: "campaign", web: "campaign" }} size={15} tintColor={colors.inkSoft} />
                    <Text className="gym-note__kicker flex-1">Announcement</Text>
                    {note.pinned && (
                      <View className="gym-badge gym-badge--staff flex-row items-center gap-1" style={{ height: 22 }}>
                        <SymbolView name={{ ios: "pin", android: "push_pin", web: "push_pin" }} size={11} tintColor={colors.white} />
                        <Text className="gym-badge__label gym-badge__label--staff" style={{ fontSize: 12 }}>Pinned</Text>
                      </View>
                    )}
                  </View>
                  <Text className="join-card__title mt-2">{note.title}</Text>
                  <Text className="post__body mt-1">{note.body}</Text>
                  <Text className="gym-card__meta mt-2">{[note.author?.name, timeAgo(note.updatedAt)].filter(Boolean).join(" · ")}</Text>
                </View>
              ))}
              {(announcements.length > 1 || (gym.can.manage && announcements.length > 0)) && (
                <View className="flex-row items-center justify-between">
                  {announcements.length > 1 ? (
                    <Pressable onPress={() => setAllNotes((value) => !value)} hitSlop={8} accessibilityRole="button" accessibilityLabel={allNotes ? "Show fewer announcements" : `Show all announcements (${announcements.length})`}>
                      <Text className="gym-section__link">{allNotes ? "Show fewer" : `Show all announcements (${announcements.length})`}</Text>
                    </Pressable>
                  ) : <View />}
                  {gym.can.manage && (
                    <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/manage", params: { id: gym.id } })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Manage announcements">
                      <Text className="gym-section__link">Manage</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {posts === null ? (
                <PostSkeleton />
              ) : posts.length === 0 ? (
                <EmptyState icon={{ ios: "text.bubble", android: "forum", web: "forum" }} title="No posts yet" text={gym.can.post ? "Be the first to share something with the gym." : "Posts from the gym will show here."} />
              ) : (
                posts.map((post) => (
                  <View key={post.id}>
                    {post.reviewStatus === "pending" && (
                      <View className="gym-pending mb-1.5 self-start">
                        <Text className="gym-pending__label">Awaiting admin review</Text>
                      </View>
                    )}
                    <PostCard
                      post={post}
                      width={width - 32}
                      badge={post.authorRole && post.authorRole !== "member" ? roleLabels[post.authorRole] : null}
                      onLike={() => like(post)}
                      onOpenComments={() => router.push({ pathname: "/community/post/[id]", params: { id: post.id } })}
                      onMenu={() => setMenuPost(post)}
                      onAuthor={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: post.author.id } })}
                    />
                  </View>
                ))
              )}
              {cursor && <ActivityIndicator color={colors.forest} className="my-2" />}
            </>
          ) : tab === "members" ? (
            members === null ? <ActivityIndicator color={colors.forest} /> : <GymMembersTab members={members} onMessage={message} />
          ) : events === null ? (
            <ActivityIndicator color={colors.forest} />
          ) : (
            <GymEventsTab gym={gym} events={events} busyId={busy?.startsWith("event-") ? busy.slice(6) : null} onRsvp={(event: GymEvent) => run(`event-${event.id}`, (token) => gyms.setRsvp(token, gym.id, event.id, !event.going))} />
          )}
        </View>
      </ScrollView>
      <ActionSheet visible={menuPost !== null} actions={menuPost ? postActions(menuPost) : []} onClose={() => setMenuPost(null)} />
      <ConfirmSheet visible={confirm !== null} title={confirm?.title ?? ""} text={confirm?.text ?? ""} confirmLabel={confirm?.label ?? ""} busy={busy !== null} onConfirm={() => confirm?.run()} onCancel={() => setConfirm(null)} />
    </View>
  );
}
