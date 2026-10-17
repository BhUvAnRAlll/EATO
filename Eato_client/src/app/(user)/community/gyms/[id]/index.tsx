import { useCallback, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { AuthImage } from "@/components/community/AuthImage";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState, PostSkeleton } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { PostCard } from "@/components/community/PostCard";
import { FormAlert } from "@/components/FormAlert";
import { community, isOffline, type Post } from "@/lib/community";
import { attendance, eventWhen, membershipButton, roleLabels, splitEvents, visibilityLabels } from "@/lib/gymRules";
import { gyms, type Announcement, type Gym, type GymEvent, type GymMember } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type Tab = "feed" | "members" | "events" | "about";
const tabs: { key: Tab; label: string }[] = [
  { key: "feed", label: "Feed" },
  { key: "members", label: "Members" },
  { key: "events", label: "Events" },
  { key: "about", label: "About" },
];

// One gym: header (cover, logo, name, membership), then Feed (announcements, pinned first, and
// posts), Members, Events (RSVP, capacity) and About (hours, facilities, tiers, contact, rules,
// leave). Private and hidden gyms show their content to members only; the server enforces it.
export default function GymScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const getToken = useSessionToken();
  const [gym, setGym] = useState<Gym | null>(null);
  const [tab, setTab] = useState<Tab>("feed");
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
    } else if (which === "members") {
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

  if (status === "error" || !gym) {
    return (
      <View className="flex-1 bg-cream">
        <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
          <BackBar title="Gym" />
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

  const button = membershipButton(gym.membership, gym.joinMode);
  const { upcoming, past } = splitEvents(events ?? [], new Date());
  const locked = (
    <EmptyState
      icon={{ ios: "lock", android: "lock", web: "lock" }}
      title={gym.membership?.status === "pending" ? "Waiting for approval" : gym.membership?.status === "suspended" ? "Membership suspended" : "Members only"}
      text={gym.membership?.status === "pending" ? "You'll see posts, members and events once an admin approves your request." : gym.membership?.status === "suspended" ? "A gym admin has suspended your membership." : `Join ${gym.name} to see what members share.`}
    />
  );

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <BackBar title={gym.name} />
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
          showsVerticalScrollIndicator={false}
          onScroll={({ nativeEvent }) => {
            const nearEnd = nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >= nativeEvent.contentSize.height - 400;
            if (nearEnd && tab === "feed") loadMore();
          }}
          scrollEventThrottle={400}
        >
          {/* Header */}
          <View className="gym__header mx-5">
            {gym.coverUrl ? <AuthImage path={gym.coverUrl} style={{ width: "100%", height: 140 }} /> : <View className="h-24 bg-forest-soft" />}
            <View className="p-4">
              <View className="flex-row items-center gap-3">
                {gym.logoUrl ? (
                  <AuthImage path={gym.logoUrl} style={{ width: 56, height: 56, borderRadius: 16 }} />
                ) : (
                  <View className="group__tile h-14 w-14">
                    <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={24} tintColor={colors.leaf} />
                  </View>
                )}
                <View className="flex-1">
                  <Text className="type-headline text-forest-ink" numberOfLines={2}>{gym.name}</Text>
                  <Text className="post__time" numberOfLines={1}>{[gym.location, `${gym.memberCount.toLocaleString("en-IN")} ${gym.memberCount === 1 ? "member" : "members"}`].filter(Boolean).join(" · ")}</Text>
                </View>
              </View>
              {gym.tagline && <Text className="post__body mt-3">{gym.tagline}</Text>}
              <View className="mt-2 flex-row items-center gap-1.5">
                <SymbolView name={gym.visibility === "public" ? { ios: "globe", android: "public", web: "public" } : { ios: "lock", android: "lock", web: "lock" }} size={12} tintColor={colors.muted} />
                <Text className="home__note">{visibilityLabels[gym.visibility].label} gym</Text>
              </View>
              <View className="mt-4 flex-row flex-wrap gap-2">
                <Pressable
                  onPress={onMembership}
                  disabled={busy === "membership" || button.action === null}
                  className={button.tone === "primary" ? "group__join" : "group__join group__join--joined"}
                  style={{ opacity: busy === "membership" ? 0.5 : 1 }}
                  accessibilityRole="button"
                  accessibilityLabel={button.action === "leave" ? `${button.label}. Tap to leave ${gym.name}` : button.action === "cancel" ? "Pending approval. Tap to cancel your request" : button.label}
                >
                  {busy === "membership" ? <ActivityIndicator color={button.tone === "primary" ? colors.white : colors.forest} /> : <Text className={button.tone === "primary" ? "group__join-label" : "group__join-label group__join-label--joined"}>{button.label}</Text>}
                </Pressable>
                {gym.can.invite && (
                  <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/invite", params: { id: gym.id } })} className="admin__action flex-row items-center gap-1.5" accessibilityRole="button" accessibilityLabel="Invite members">
                    <SymbolView name={{ ios: "person.badge.plus", android: "person_add", web: "person_add" }} size={14} tintColor={colors.forestInk} />
                    <Text className="admin__action-label">Invite</Text>
                  </Pressable>
                )}
                {gym.can.manage && (
                  <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/manage", params: { id: gym.id } })} className="admin__action flex-row items-center gap-1.5" accessibilityRole="button" accessibilityLabel="Manage gym">
                    <SymbolView name={{ ios: "gearshape", android: "settings", web: "settings" }} size={14} tintColor={colors.forestInk} />
                    <Text className="admin__action-label">Manage</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>

          <View className="segment mx-5 mt-4" accessibilityRole="tablist">
            {tabs.map((item) => (
              <Pressable key={item.key} onPress={() => setTab(item.key)} className={tab === item.key ? "segment__item segment__item--active" : "segment__item"} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }}>
                <Text className={tab === item.key ? "segment__label segment__label--active" : "segment__label"}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          {notice && (
            <Pressable onPress={() => setNotice(null)} className="mx-5 mt-3">
              <FormAlert message={notice} />
            </Pressable>
          )}

          <View className="mt-4 gap-3 px-5">
            {tab === "about" ? (
              <About gym={gym} onLeave={gym.can.leave ? askLeave : null} />
            ) : !gym.can.viewContent ? (
              locked
            ) : tab === "feed" ? (
              <>
                {announcements.map((note) => (
                  <View key={note.id} className="post__card">
                    <View className="flex-row items-center gap-2">
                      <SymbolView name={{ ios: note.pinned ? "pin.fill" : "megaphone", android: note.pinned ? "push_pin" : "campaign", web: note.pinned ? "push_pin" : "campaign" }} size={14} tintColor={colors.leaf} />
                      <Text className="post__time">{note.pinned ? "Pinned announcement" : "Announcement"}</Text>
                    </View>
                    <Text className="post__author mt-2">{note.title}</Text>
                    <Text className="post__body mt-1">{note.body}</Text>
                  </View>
                ))}
                {gym.can.post && (
                  <Pressable onPress={() => router.push({ pathname: "/community/compose", params: { gymId: gym.id, gymName: gym.name } })} className="composer" accessibilityRole="button" accessibilityLabel={`Share with ${gym.name}`}>
                    <Text className="composer__prompt">Share with the gym...</Text>
                    <SymbolView name={{ ios: "square.and.pencil", android: "edit", web: "edit" }} size={18} tintColor={colors.forest} />
                  </Pressable>
                )}
                {gym.settings.postModeration && gym.can.post && !gym.can.moderate && <Text className="home__note">Posts in this gym are reviewed by staff before others see them.</Text>}
                {posts === null ? (
                  <PostSkeleton />
                ) : posts.length === 0 ? (
                  <EmptyState icon={{ ios: "text.bubble", android: "forum", web: "forum" }} title="No posts yet" text={gym.can.post ? "Be the first to share something with the gym." : "Posts from the gym will show here."} />
                ) : (
                  posts.map((post) => (
                    <View key={post.id}>
                      {post.reviewStatus === "pending" && (
                        <View className="mb-1 flex-row items-center gap-1.5">
                          <SymbolView name={{ ios: "clock", android: "schedule", web: "schedule" }} size={12} tintColor={colors.warning} />
                          <Text className="home__note">Awaiting review by gym staff</Text>
                        </View>
                      )}
                      <PostCard post={post} width={width - 40} onLike={() => like(post)} onOpenComments={() => router.push({ pathname: "/community/post/[id]", params: { id: post.id } })} onMenu={() => setMenuPost(post)} onAuthor={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: post.author.id } })} />
                    </View>
                  ))
                )}
                {cursor && <ActivityIndicator color={colors.forest} className="my-2" />}
              </>
            ) : tab === "members" ? (
              members === null ? (
                <ActivityIndicator color={colors.forest} />
              ) : (
                members.map((row) => (
                  <Pressable key={row.member.id} onPress={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: row.member.id } })} className="flex-row items-center gap-3 py-1.5" accessibilityRole="button" accessibilityLabel={`${row.member.name}, ${roleLabels[row.role]}`}>
                    <Avatar member={row.member} size={44} />
                    <Text className="post__author flex-1" numberOfLines={1}>{row.member.name}{row.isMe ? " (you)" : ""}</Text>
                    {row.role !== "member" && (
                      <View className="rounded-pill bg-forest-soft px-3 py-1">
                        <Text className="post__time" style={{ color: colors.forestInk }}>{roleLabels[row.role]}</Text>
                      </View>
                    )}
                  </Pressable>
                ))
              )
            ) : (
              <>
                {gym.can.createEvents && (
                  <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/event-new", params: { id: gym.id } })} className="btn-forest" accessibilityRole="button" accessibilityLabel="Create event">
                    <Text className="btn-forest__label">Create Event</Text>
                  </Pressable>
                )}
                {events === null ? (
                  <ActivityIndicator color={colors.forest} />
                ) : upcoming.length === 0 && past.length === 0 ? (
                  <EmptyState icon={{ ios: "calendar", android: "event", web: "event" }} title="No events yet" text="Classes, clinics and meet-ups will show here." />
                ) : (
                  <>
                    {upcoming.length > 0 && <Text className="setup__section">Upcoming</Text>}
                    {upcoming.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        busy={busy === `event-${event.id}`}
                        canRsvp={gym.membership?.status === "active"}
                        canCancel={event.isHost || gym.can.manage}
                        onRsvp={() => run(`event-${event.id}`, (token) => gyms.setRsvp(token, gym.id, event.id, !event.going))}
                        onCancel={() => setConfirm({ title: `Cancel ${event.title}?`, text: "Everyone who said they're going will see it's gone.", label: "Cancel event", run: async () => { await run(`event-${event.id}`, (token) => gyms.deleteEvent(token, gym.id, event.id)); setConfirm(null); } })}
                      />
                    ))}
                    {past.length > 0 && <Text className="setup__section mt-2">Past</Text>}
                    {past.map((event) => <EventCard key={event.id} event={event} past />)}
                  </>
                )}
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      <ActionSheet visible={menuPost !== null} actions={menuPost ? postActions(menuPost) : []} onClose={() => setMenuPost(null)} />
      <ConfirmSheet visible={confirm !== null} title={confirm?.title ?? ""} text={confirm?.text ?? ""} confirmLabel={confirm?.label ?? ""} busy={busy !== null} onConfirm={() => confirm?.run()} onCancel={() => setConfirm(null)} />
    </View>
  );
}

function BackBar({ title }: { title: string }) {
  return (
    <View className="h-12 flex-row items-center px-5">
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
        <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
      </Pressable>
      <Text className="type-subhead ml-3 flex-1 text-forest-ink" numberOfLines={1}>{title}</Text>
    </View>
  );
}

type EventCardProps = { event: GymEvent; past?: boolean; busy?: boolean; canRsvp?: boolean; canCancel?: boolean; onRsvp?: () => void; onCancel?: () => void };

function EventCard({ event, past = false, busy = false, canRsvp = false, canCancel = false, onRsvp, onCancel }: EventCardProps) {
  return (
    <View className="post__card" style={{ opacity: past ? 0.7 : 1 }}>
      <Text className="post__time">{eventWhen(event)}</Text>
      <Text className="post__author mt-1">{event.title}</Text>
      <Text className="post__body mt-1">{event.description}</Text>
      <View className="mt-2 flex-row items-center gap-1.5">
        <SymbolView name={{ ios: "mappin", android: "place", web: "place" }} size={12} tintColor={colors.muted} />
        <Text className="home__note flex-1" numberOfLines={1}>{event.location}</Text>
      </View>
      <View className="mt-3 flex-row items-center justify-between gap-2">
        <Text className="home__note">{attendance(event)}{event.host ? ` · hosted by ${event.host.name.split(" ")[0]}` : ""}</Text>
        {!past && canRsvp && (
          <Pressable
            onPress={onRsvp}
            disabled={busy || (event.full && !event.going)}
            className={event.going ? "group__join group__join--joined" : "group__join"}
            style={{ opacity: busy || (event.full && !event.going) ? 0.5 : 1 }}
            accessibilityRole="button"
            accessibilityLabel={event.going ? `Cancel your RSVP for ${event.title}` : event.full ? `${event.title} is full` : `RSVP to ${event.title}`}
          >
            <Text className={event.going ? "group__join-label group__join-label--joined" : "group__join-label"}>{event.going ? "Going ✓" : event.full ? "Full" : "RSVP"}</Text>
          </Pressable>
        )}
      </View>
      {!past && canCancel && (
        <Pressable onPress={onCancel} className="mt-2 self-start" accessibilityRole="button" accessibilityLabel={`Cancel ${event.title}`}>
          <Text className="home__note" style={{ color: colors.danger }}>Cancel event</Text>
        </Pressable>
      )}
    </View>
  );
}

function About({ gym, onLeave }: { gym: Gym; onLeave: (() => void) | null }) {
  const contact: { label: string; url: string; icon: Icon }[] = [];
  if (gym.contact.phone) contact.push({ label: gym.contact.phone, url: `tel:${gym.contact.phone.replace(/\s/g, "")}`, icon: { ios: "phone", android: "call", web: "call" } });
  if (gym.contact.email) contact.push({ label: gym.contact.email, url: `mailto:${gym.contact.email}`, icon: { ios: "envelope", android: "mail", web: "mail" } });
  if (gym.contact.website) contact.push({ label: gym.contact.website, url: gym.contact.website, icon: { ios: "globe", android: "public", web: "public" } });
  const empty = !gym.description && !gym.address && gym.hours.length === 0 && gym.facilities.length === 0 && gym.membershipTiers.length === 0 && contact.length === 0 && gym.guidelines.length === 0;
  return (
    <>
      {empty && <EmptyState icon={{ ios: "info.circle", android: "info", web: "info" }} title="Nothing here yet" text="The gym hasn't added its details." />}
      {gym.description && <Section title="About"><Text className="post__body">{gym.description}</Text></Section>}
      {gym.address && (
        <Section title="Address">
          <Pressable onPress={() => Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(gym.address ?? "")}`)} accessibilityRole="link" accessibilityLabel={`Open ${gym.address} in maps`}>
            <Text className="post__body" style={{ color: colors.leaf }}>{gym.address}</Text>
          </Pressable>
        </Section>
      )}
      {gym.hours.length > 0 && (
        <Section title="Opening hours">
          {gym.hours.map((row) => (
            <View key={row.label} className="flex-row justify-between py-0.5">
              <Text className="post__body">{row.label}</Text>
              <Text className="post__body">{row.value}</Text>
            </View>
          ))}
        </Section>
      )}
      {gym.facilities.length > 0 && (
        <Section title="Facilities">
          <View className="flex-row flex-wrap gap-2">
            {gym.facilities.map((item) => (
              <View key={item} className="rounded-pill bg-forest-soft px-3 py-1">
                <Text className="post__time" style={{ color: colors.forestInk }}>{item}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}
      {gym.membershipTiers.length > 0 && (
        <Section title="Membership">
          {gym.membershipTiers.map((tier) => (
            <View key={tier.name} className="py-1">
              <View className="flex-row justify-between"><Text className="post__author">{tier.name}</Text><Text className="post__author">{tier.price}</Text></View>
              {tier.perks ? <Text className="post__time">{tier.perks}</Text> : null}
            </View>
          ))}
        </Section>
      )}
      {contact.length > 0 && (
        <Section title="Contact">
          {contact.map((item) => (
            <Pressable key={item.url} onPress={() => Linking.openURL(item.url)} className="flex-row items-center gap-2 py-1" accessibilityRole="link" accessibilityLabel={item.label}>
              <SymbolView name={item.icon} size={14} tintColor={colors.leaf} />
              <Text className="post__body" style={{ color: colors.leaf }}>{item.label}</Text>
            </Pressable>
          ))}
        </Section>
      )}
      {gym.guidelines.length > 0 && (
        <Section title="Guidelines">
          {gym.guidelines.map((rule, index) => <Text key={index} className="post__body py-0.5">{`${index + 1}. ${rule}`}</Text>)}
        </Section>
      )}
      {onLeave && (
        <Pressable onPress={onLeave} className="btn-outline" accessibilityRole="button" accessibilityLabel={`Leave ${gym.name}`}>
          <Text className="btn-outline__label" style={{ color: colors.danger }}>Leave gym</Text>
        </Pressable>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="post__card">
      <Text className="setup__section mb-2">{title}</Text>
      {children}
    </View>
  );
}
