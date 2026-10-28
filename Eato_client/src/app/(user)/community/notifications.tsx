import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { community, isOffline, timeAgo, type Activity, type FollowRequest, type FriendRequest, type GymRequestSummary } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import type { Icon } from "@/types/profile";
import { colors } from "@/theme";

type Row =
  | { kind: "request"; request: FollowRequest }
  | { kind: "friend"; request: FriendRequest }
  | { kind: "gym"; gym: GymRequestSummary }
  | { kind: "activity"; activity: Activity };

// What each kind of entry shows and where tapping it goes
const ICONS: Record<Activity["type"], { icon: Icon; tint: string }> = {
  like: { icon: { ios: "heart.fill", android: "favorite", web: "favorite" }, tint: colors.danger },
  comment: { icon: { ios: "bubble.right.fill", android: "chat_bubble", web: "chat_bubble" }, tint: colors.leaf },
  friend_accepted: { icon: { ios: "person.2.fill", android: "group", web: "group" }, tint: colors.leaf },
  trainer_accepted: { icon: { ios: "figure.strengthtraining.traditional", android: "fitness_center", web: "fitness_center" }, tint: colors.leaf },
  plan_updated: { icon: { ios: "fork.knife", android: "restaurant", web: "restaurant" }, tint: colors.leaf },
  workout_updated: { icon: { ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }, tint: colors.leaf },
  recommendation: { icon: { ios: "target", android: "track_changes", web: "track_changes" }, tint: colors.leaf },
  gym_approved: { icon: { ios: "checkmark.seal.fill", android: "verified", web: "verified" }, tint: colors.leaf },
  rsvp: { icon: { ios: "calendar.badge.checkmark", android: "event_available", web: "event_available" }, tint: colors.leaf },
  gym_reply: { icon: { ios: "bubble.left.and.text.bubble.right", android: "smart_toy", web: "smart_toy" }, tint: colors.leaf },
  gym_notice: { icon: { ios: "megaphone", android: "campaign", web: "campaign" }, tint: colors.leaf },
};

function openActivity(activity: Activity) {
  switch (activity.type) {
    case "like":
    case "comment":
      return router.push({ pathname: "/community/post/[id]", params: { id: activity.postId } });
    case "friend_accepted":
      return router.push({ pathname: "/community/profile/[userId]", params: { userId: activity.member.id } });
    case "trainer_accepted":
      return router.push("/community/trainers/mine");
    case "plan_updated":
      return router.push("/community/trainers/plan");
    case "workout_updated":
      return router.push("/workout");
    case "recommendation":
      return router.push("/community/trainers/targets");
    case "gym_approved":
    case "rsvp":
      return router.push({ pathname: "/community/gyms/[id]", params: { id: activity.gymId } });
    case "gym_reply":
      return router.push({ pathname: "/community/gyms/[id]/ask", params: { id: activity.gymId } });
    case "gym_notice":
      // Where the gym's notice points
      if (activity.target === "events") return router.push({ pathname: "/community/gyms/[id]", params: { id: activity.gymId, tab: "events" } });
      if (activity.target === "my_qr") return router.push("/my-qr");
      if (activity.target === "session") return router.push("/home");
      if (activity.target === "gym") return router.push({ pathname: "/community/gyms/[id]", params: { id: activity.gymId } });
      return;
  }
}

// What a screen reader says for an entry: "Tara Trainer shared your diet plan: Lean phase"
function activityLabel(a: Activity): string {
  if (a.type === "like") return `${a.member.name} liked your post: ${a.preview}`;
  if (a.type === "comment") return `${a.member.name} commented on your post: ${a.preview}`;
  if (a.type === "gym_notice") return `${a.gymName}: ${a.title}. ${a.preview}`;
  if (a.type === "gym_reply") return `${a.gymName} team replied to “${a.title}”: ${a.preview}`;
  return "member" in a ? `${a.member.name} ${a.preview}` : a.preview;
}

const activityKey = (a: Activity) => a.type === "gym_notice" ? `gym_notice-${a.noticeId}` : a.type === "gym_reply" ? `gym_reply-${a.questionId}` : `${a.type}-${"member" in a ? a.member.id : ""}-${"postId" in a ? a.postId : ""}-${"gymId" in a ? a.gymId : ""}-${a.at}`;

// The bell: requests to act on (follows, friends, gym joins), then recent activity: likes and
// comments on your posts, friends accepting, your trainer's updates, gym approvals and RSVPs
export default function CommunityNotifications() {
  const getToken = useSessionToken();
  const loadUnread = useCommunityStore((state) => state.loadUnread);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0); // when the list was loaded: "New" is the day before it

  const load = useCallback(async () => {
    const token = await getToken();
    const result = await community.notifications(token);
    if (!result.ok) return setError(result.error);
    setRows([
      ...result.data.friendRequests.map((request): Row => ({ kind: "friend", request })),
      ...result.data.followRequests.map((request): Row => ({ kind: "request", request })),
      ...result.data.gymRequests.map((gym): Row => ({ kind: "gym", gym })),
      ...result.data.activity.map((activity): Row => ({ kind: "activity", activity })),
    ]);
    setLoadedAt(Date.now());
    setError(null);
    loadUnread(token);
  }, [getToken, loadUnread]);

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

  const answer = async (userId: string, accept: boolean) => {
    const result = await community.answerFollowRequest(await getToken(), userId, accept);
    if (!result.ok) return setError(result.error);
    await load();
  };

  const answerFriend = async (userId: string, accept: boolean) => {
    const result = await community.answerFriendRequest(await getToken(), userId, accept);
    if (!result.ok) return setError(result.error);
    await load();
  };

  const openMember = (userId: string) => router.push({ pathname: "/community/profile/[userId]", params: { userId } });

  // New: requests waiting on you and the last day's activity; Earlier: everything older
  const DAY = 24 * 60 * 60 * 1000;
  const isNew = (row: Row) => row.kind !== "activity" || loadedAt - new Date(row.activity.at).getTime() < DAY;
  const keyOf = (row: Row) => (row.kind === "request" ? `request-${row.request.member.id}` : row.kind === "friend" ? `friend-${row.request.member.id}` : row.kind === "gym" ? `gym-${row.gym.gymId}` : activityKey(row.activity));
  const fresh = (rows ?? []).filter(isNew);
  const earlier = (rows ?? []).filter((row) => !isNew(row));

  const renderRow = (item: Row, index: number, list: Row[], unread: boolean) => {
    const edge = ["notification", unread ? "notification--new" : "", index === 0 ? "friend-row--first" : "", index === list.length - 1 ? "friend-row--last" : ""].join(" ");
    const dot = unread ? <View className="notification__dot" /> : null;
    if (item.kind === "friend" || item.kind === "request") {
      const friend = item.kind === "friend";
      return (
        <View key={keyOf(item)} className={edge}>
          <Pressable onPress={() => openMember(item.request.member.id)} accessibilityRole="button" accessibilityLabel={item.request.member.name}>
            <Avatar member={item.request.member} size={44} />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="notification__title" numberOfLines={2}>{item.request.member.name} {friend ? "wants to be friends" : "wants to follow you"}</Text>
            <Text className="notification__time">{timeAgo(item.request.requestedAt)}</Text>
            <View className="mt-2 flex-row items-center gap-2">
              <Pressable onPress={() => (friend ? answerFriend(item.request.member.id, true) : answer(item.request.member.id, true))} className="gym-join gym-join--filled" accessibilityRole="button" accessibilityLabel={friend ? `Accept ${item.request.member.name}'s friend request` : `Accept ${item.request.member.name}`}>
                <Text className="gym-join__label gym-join__label--filled">Accept</Text>
              </Pressable>
              <Pressable onPress={() => (friend ? answerFriend(item.request.member.id, false) : answer(item.request.member.id, false))} className="gym-join" accessibilityRole="button" accessibilityLabel={friend ? `Decline ${item.request.member.name}'s friend request` : `Decline ${item.request.member.name}`}>
                <Text className="gym-join__label">Decline</Text>
              </Pressable>
            </View>
          </View>
          {dot}
        </View>
      );
    }
    if (item.kind === "gym") {
      return (
        <Pressable key={keyOf(item)} onPress={() => router.push({ pathname: "/community/gyms/[id]/manage/members", params: { id: item.gym.gymId, list: "pending" } })} className={edge} accessibilityRole="button" accessibilityLabel={`${item.gym.waiting} join requests for ${item.gym.gymName}`}>
          <View className="notification__icon">
            <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={20} tintColor={colors.ink} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="notification__title" numberOfLines={1}>{item.gym.gymName}</Text>
            <Text className="notification__text">{`${item.gym.waiting} ${item.gym.waiting === 1 ? "person wants" : "people want"} to join`}</Text>
            <Text className="notification__time">{timeAgo(item.gym.latestAt)}</Text>
          </View>
          {dot}
        </Pressable>
      );
    }
    const activity = item.activity;
    const icon = ICONS[activity.type];
    const title =
      activity.type === "like" ? `${activity.member.name} liked your post`
      : activity.type === "comment" ? `${activity.member.name} commented on your post`
      : activity.type === "gym_notice" ? `${activity.gymName}: ${activity.title}`
      : activity.type === "gym_reply" ? `${activity.gymName} team replied`
      : "member" in activity ? `${activity.member.name} ${activity.preview}`
      : activity.preview;
    const detail = activity.type === "like" || activity.type === "comment" ? `“${activity.preview}”` : activity.type === "gym_notice" || activity.type === "gym_reply" ? activity.preview : null;
    return (
      <Pressable key={keyOf(item)} onPress={() => openActivity(activity)} className={edge} accessibilityRole="button" accessibilityLabel={activityLabel(activity)}>
        {"member" in activity ? (
          <View>
            <Avatar member={activity.member} size={44} />
            <View className="notification__badge">
              <SymbolView name={icon.icon} size={10} tintColor={colors.white} />
            </View>
          </View>
        ) : (
          <View className="notification__icon">
            <SymbolView name={icon.icon} size={20} tintColor={colors.ink} />
          </View>
        )}
        <View className="min-w-0 flex-1">
          <Text className="notification__title" numberOfLines={2}>{title}</Text>
          {detail && <Text className="notification__text" numberOfLines={2}>{detail}</Text>}
          <Text className="notification__time">{timeAgo(activity.at)}</Text>
        </View>
        {dot}
      </Pressable>
    );
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title">Notifications</Text>
          <View className="screen-bar__spacer" />
        </View>
        {rows === null && !error ? (
          <ActivityIndicator color={colors.forest} className="mt-6" />
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />} showsVerticalScrollIndicator={false}>
            {error && (
              <Pressable onPress={() => setError(null)}>
                <FormAlert message={error} />
              </Pressable>
            )}
            {(rows ?? []).length === 0 ? (
              error ? (
                <EmptyState icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "bell.slash", android: "notifications_off", web: "notifications_off" }} title={isOffline(error) ? "You're offline" : "Couldn't load notifications"} text={error} actionLabel="Retry" onAction={load} />
              ) : (
                <EmptyState icon={{ ios: "bell", android: "notifications", web: "notifications" }} title="You're all caught up" text="Requests, likes, comments, your trainer's updates and gym news appear here." />
              )
            ) : (
              <>
                {fresh.length > 0 && (
                  <View className="gap-2">
                    <Text className="gym-group__title">New · {fresh.length}</Text>
                    <View>{fresh.map((row, index) => renderRow(row, index, fresh, true))}</View>
                  </View>
                )}
                {earlier.length > 0 && (
                  <View className="mt-2 gap-2">
                    <Text className="gym-group__title">Earlier</Text>
                    <View>{earlier.map((row, index) => renderRow(row, index, earlier, false))}</View>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
