import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { OwnerHeader } from "@/components/owner/OwnerHeader";
import { isOffline, timeAgo } from "@/lib/community";
import { owner, type CommunitySummary } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type Action = { label: string; to: Href | null; note?: string };
type Card = { key: string; icon: Icon; title: string; badge: string | null; warn?: boolean; text: string; who: string; primary: Action; secondary?: Action };

const postRule: Record<string, string> = { everyone: "Everyone can post", trainers: "Staff post", admins: "Only admins post" };
const commentRule: Record<string, string> = { members: "members comment", trainers: "staff comment", off: "comments off" };

function cards(s: CommunitySummary, memberApp: boolean): Card[] {
  const id = s.gym.id;
  const c = s.counts;
  // Screens under the member app open for the gym's own staff; an EATO admin helping out gets the portal's own
  const app = (to: Href): Href | null => (memberApp ? to : null);
  const code = s.inviteCode.replace(/(.{4})(?=.)/, "$1-");
  return [
    {
      key: "feed", icon: { ios: "newspaper", android: "feed", web: "feed" }, title: "Gym feed",
      badge: c.postsToReview > 0 ? `${c.postsToReview} to review` : `${c.posts} ${c.posts === 1 ? "post" : "posts"}`, warn: c.postsToReview > 0,
      text: "Posts, photos, polls and progress from members and staff.",
      who: s.rules.visibility === "public" ? "Anyone can read it; only members can post." : "Only members can read and post.",
      primary: { label: "Open feed", to: app({ pathname: "/community/gyms/[id]", params: { id } }) },
      secondary: { label: "Write a post", to: app({ pathname: "/community/compose", params: { gymId: id, gymName: s.gym.name } }) },
    },
    {
      key: "announcements", icon: { ios: "megaphone", android: "campaign", web: "campaign" }, title: "Announcements",
      badge: `${c.announcements} live`, text: "Official notices pinned above the feed, like holiday hours or closures.", who: "Every member sees these first.",
      primary: { label: "Announce", to: app({ pathname: "/community/gyms/[id]/manage/announcements", params: { id } }) },
      secondary: { label: "Manage", to: app({ pathname: "/community/gyms/[id]/manage/announcements", params: { id } }) },
    },
    {
      key: "events", icon: { ios: "calendar", android: "event", web: "event" }, title: "Events",
      badge: `${c.upcomingEvents} upcoming · ${c.upcomingRsvps} RSVPs`, text: "Classes, workshops and meetups members RSVP to.", who: "Shown in the gym's Events tab.",
      primary: { label: "Create event", to: app({ pathname: "/community/gyms/[id]/event-new", params: { id } }) },
      secondary: { label: "All events", to: "/owner/events" },
    },
    {
      key: "assistant", icon: { ios: "bubble.left.and.text.bubble.right", android: "smart_toy", web: "smart_toy" }, title: "Gym assistant",
      badge: c.questionsToAnswer > 0 ? `${c.questionsToAnswer} to answer` : `${c.customAnswers} custom ${c.customAnswers === 1 ? "answer" : "answers"}`, warn: c.questionsToAnswer > 0,
      text: "Answers questions about hours, prices, trainers and joining, any time. Questions it can't answer come to you.", who: "Anyone who can see your gym page can ask.",
      primary: { label: "Answer questions", to: "/owner/assistant" },
      secondary: { label: "Try it", to: app({ pathname: "/community/gyms/[id]/ask", params: { id } }) },
    },
    {
      key: "notify", icon: { ios: "bell", android: "notifications", web: "notifications" }, title: "Member notifications",
      badge: `${c.noticesSent} sent`, text: "Send updates and reminders straight to members' phones, to everyone or a chosen group.", who: "Only the people you pick get it.",
      primary: { label: "Notify members", to: "/owner/notify" },
    },
    {
      key: "invites", icon: { ios: "person.badge.plus", android: "person_add", web: "person_add" }, title: "Invites",
      badge: c.invitationsPending > 0 ? `${c.invitationsPending} pending` : null,
      text: `Bring people in with your code ${code}, a link, a QR code, email or phone.`, who: "Invited people skip the approval queue.",
      primary: { label: "Invite members", to: app({ pathname: "/community/gyms/[id]/invite", params: { id } }) },
      secondary: { label: "Sent invitations", to: app({ pathname: "/community/gyms/[id]/invite", params: { id } }) },
    },
    {
      key: "rules", icon: { ios: "slider.horizontal.3", android: "tune", web: "tune" }, title: "Rules & permissions", badge: null,
      text: `${postRule[s.rules.whoCanPost] ?? s.rules.whoCanPost} · ${commentRule[s.rules.whoCanComment] ?? s.rules.whoCanComment}${s.rules.memberApproval ? " · you approve new members" : ""}${s.rules.postModeration ? " · posts are reviewed" : ""}.`,
      who: "Change who can post, comment and create events.",
      primary: { label: "Community settings", to: app({ pathname: "/community/gyms/[id]/manage/settings", params: { id } }) },
    },
  ];
}

// Community: a map of everything members see in the gym. Each card says what it is, who sees
// it and a live count, with its main action and where to manage it; then the latest posts.
export default function OwnerCommunity() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const [data, setData] = useState<CommunitySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!gymId) return;
    const result = await owner.community(await getToken(), gymId);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else setError(result.error);
  }, [gymId, getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const memberApp = data?.gym.as !== "platform";
  const button = (action: Action, primary: boolean) => {
    const enabled = action.to !== null;
    return (
      <Pressable
        key={action.label}
        onPress={() => action.to && router.push(action.to)}
        disabled={!enabled}
        className={primary ? "owner-quick owner-quick--primary flex-1" : "owner-quick flex-1"}
        style={{ height: 44, opacity: enabled ? 1 : 0.45 }}
        accessibilityRole="button"
        accessibilityLabel={enabled ? action.label : `${action.label}, ${action.note ?? "managed by the gym"}`}
      >
        <Text className={primary ? "owner-quick__label owner-quick__label--primary" : "owner-quick__label"} numberOfLines={1}>{enabled ? action.label : (action.note ?? action.label)}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.forest} />}
      >
        <OwnerHeader title="Community" subtitle="Everything members see in your gym, and where to manage each part." />
        {!data ? (
          <View className="mt-8 px-5">
            {error ? (
              <EmptyState icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title={isOffline(error) ? "You're offline" : "Couldn't load"} text={error} actionLabel="Retry" onAction={load} />
            ) : (
              <ActivityIndicator color={colors.forest} />
            )}
          </View>
        ) : (
          <>
            <View className="mx-5 mt-4 gap-3">
              {cards(data, memberApp).map((card) => (
                <View key={card.key} className="owner-card" accessibilityLabel={`${card.title}${card.badge ? `, ${card.badge}` : ""}`}>
                  <View className="flex-row items-start gap-3">
                    <View className="owner-icon owner-icon--neutral">
                      <SymbolView name={card.icon} size={18} tintColor={colors.ink} />
                    </View>
                    <View className="min-w-0 flex-1 gap-1">
                      <View className="flex-row items-center justify-between gap-2">
                        <Text className="friend-row__name" numberOfLines={1}>{card.title}</Text>
                        {card.badge && (
                          <View className={card.warn ? "owner-badge owner-badge--warning" : "owner-badge"}>
                            <Text className="owner-badge__label">{card.badge}</Text>
                          </View>
                        )}
                      </View>
                      <Text className="friend-row__note" style={{ color: colors.ink }}>{card.text}</Text>
                      <Text className="friend-row__note">{card.who}</Text>
                    </View>
                  </View>
                  <View className="flex-row gap-2">
                    {button(card.primary, true)}
                    {card.secondary && button(card.secondary, false)}
                  </View>
                </View>
              ))}
            </View>

            <View className="mx-5 mt-6 flex-row items-center justify-between">
              <Text className="gym-section__title">Latest in your feed</Text>
              {memberApp && (
                <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]", params: { id: data.gym.id } })} hitSlop={8} accessibilityRole="button" accessibilityLabel="See all posts">
                  <Text className="gym-section__link">See all</Text>
                </Pressable>
              )}
            </View>
            <View className="mx-5 mt-3">
              {data.latestPosts.length === 0 ? (
                <View className="owner-card"><Text className="friend-row__note">No posts yet. Members&apos; posts in the gym feed show here.</Text></View>
              ) : (
                data.latestPosts.map((post, i) => (
                  <Pressable
                    key={post.id}
                    onPress={() => memberApp && router.push({ pathname: "/community/post/[id]", params: { id: post.id } })}
                    disabled={!memberApp}
                    className={`friend-row ${i === 0 ? "friend-row--first" : ""} ${i === data.latestPosts.length - 1 ? "friend-row--last" : ""}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${post.author.name}: ${post.preview}`}
                  >
                    <Avatar member={post.author} size={40} />
                    <View className="min-w-0 flex-1">
                      <Text className="friend-row__name" numberOfLines={1}>{post.author.name}</Text>
                      <Text className="friend-row__note" numberOfLines={2}>{post.preview}</Text>
                    </View>
                    <Text className="friend-row__note">{timeAgo(post.at)}</Text>
                  </Pressable>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
