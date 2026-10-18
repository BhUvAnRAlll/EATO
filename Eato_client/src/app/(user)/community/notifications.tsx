import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
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
      return router.push("/fitness");
    case "recommendation":
      return router.push("/community/trainers/targets");
    case "gym_approved":
    case "rsvp":
      return router.push({ pathname: "/community/gyms/[id]", params: { id: activity.gymId } });
  }
}

// What a screen reader says for an entry: "Tara Trainer shared your diet plan: Lean phase"
function activityLabel(a: Activity): string {
  if (a.type === "like") return `${a.member.name} liked your post: ${a.preview}`;
  if (a.type === "comment") return `${a.member.name} commented on your post: ${a.preview}`;
  return "member" in a ? `${a.member.name} ${a.preview}` : a.preview;
}

const activityKey = (a: Activity) => `${a.type}-${"member" in a ? a.member.id : ""}-${"postId" in a ? a.postId : ""}-${"gymId" in a ? a.gymId : ""}-${a.at}`;

// The bell: requests to act on (follows, friends, gym joins), then recent activity: likes and
// comments on your posts, friends accepting, your trainer's updates, gym approvals and RSVPs
export default function CommunityNotifications() {
  const getToken = useSessionToken();
  const loadUnread = useCommunityStore((state) => state.loadUnread);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink">Notifications</Text>
        </View>
        {rows === null && !error ? (
          <ActivityIndicator color={colors.forest} className="mt-6" />
        ) : (
          <FlatList
            data={rows ?? []}
            keyExtractor={(row) => (row.kind === "request" ? `request-${row.request.member.id}` : row.kind === "friend" ? `friend-${row.request.member.id}` : row.kind === "gym" ? `gym-${row.gym.gymId}` : activityKey(row.activity))}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 10 }}
            ListHeaderComponent={error ? (
              <Pressable onPress={() => setError(null)}>
                <FormAlert message={error} />
              </Pressable>
            ) : null}
            ListEmptyComponent={
              error ? (
                <EmptyState icon={isOffline(error) ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "bell.slash", android: "notifications_off", web: "notifications_off" }} title={isOffline(error) ? "You're offline" : "Couldn't load notifications"} text={error} actionLabel="Retry" onAction={load} />
              ) : (
                <EmptyState icon={{ ios: "bell", android: "notifications", web: "notifications" }} title="You're all caught up" text="Requests, likes, comments, your trainer's updates and gym news appear here." />
              )
            }
            renderItem={({ item }) =>
              item.kind === "friend" ? (
                <View className="post__card flex-row items-center gap-3">
                  <Pressable onPress={() => openMember(item.request.member.id)} accessibilityRole="button" accessibilityLabel={item.request.member.name}>
                    <Avatar member={item.request.member} />
                  </Pressable>
                  <View className="flex-1">
                    <Text className="post__author" numberOfLines={1}>{item.request.member.name}</Text>
                    <Text className="post__time">wants to be friends · {timeAgo(item.request.requestedAt)}</Text>
                  </View>
                  <Pressable onPress={() => answerFriend(item.request.member.id, true)} className="group__join" accessibilityRole="button" accessibilityLabel={`Accept ${item.request.member.name}'s friend request`}>
                    <Text className="group__join-label">Accept</Text>
                  </Pressable>
                  <Pressable onPress={() => answerFriend(item.request.member.id, false)} hitSlop={8} className="h-9 w-9 items-center justify-center" accessibilityRole="button" accessibilityLabel={`Decline ${item.request.member.name}'s friend request`}>
                    <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={18} tintColor={colors.muted} />
                  </Pressable>
                </View>
              ) : item.kind === "gym" ? (
                <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/manage", params: { id: item.gym.gymId } })} className="post__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`${item.gym.waiting} join requests for ${item.gym.gymName}`}>
                  <View className="group__tile">
                    <SymbolView name={{ ios: "dumbbell.fill", android: "fitness_center", web: "fitness_center" }} size={20} tintColor={colors.leaf} />
                  </View>
                  <View className="flex-1">
                    <Text className="post__author" numberOfLines={1}>{item.gym.gymName}</Text>
                    <Text className="post__time">{`${item.gym.waiting} ${item.gym.waiting === 1 ? "person wants" : "people want"} to join · ${timeAgo(item.gym.latestAt)}`}</Text>
                  </View>
                  <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={16} tintColor={colors.muted} />
                </Pressable>
              ) : item.kind === "request" ? (
                <View className="post__card flex-row items-center gap-3">
                  <Pressable onPress={() => openMember(item.request.member.id)} accessibilityRole="button" accessibilityLabel={item.request.member.name}>
                    <Avatar member={item.request.member} />
                  </Pressable>
                  <View className="flex-1">
                    <Text className="post__author" numberOfLines={1}>{item.request.member.name}</Text>
                    <Text className="post__time">wants to follow you · {timeAgo(item.request.requestedAt)}</Text>
                  </View>
                  <Pressable onPress={() => answer(item.request.member.id, true)} className="group__join" accessibilityRole="button" accessibilityLabel={`Accept ${item.request.member.name}`}>
                    <Text className="group__join-label">Accept</Text>
                  </Pressable>
                  <Pressable onPress={() => answer(item.request.member.id, false)} hitSlop={8} className="h-9 w-9 items-center justify-center" accessibilityRole="button" accessibilityLabel={`Decline ${item.request.member.name}`}>
                    <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={18} tintColor={colors.muted} />
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => openActivity(item.activity)} className="post__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={activityLabel(item.activity)}>
                  {"member" in item.activity ? (
                    <Avatar member={item.activity.member} />
                  ) : (
                    <View className="group__tile">
                      <SymbolView name={ICONS[item.activity.type].icon} size={20} tintColor={colors.leaf} />
                    </View>
                  )}
                  <View className="flex-1">
                    {item.activity.type === "like" || item.activity.type === "comment" ? (
                      <>
                        <Text className="post__body" numberOfLines={2}>
                          <Text className="post__author" style={{ fontSize: 15 }}>{item.activity.member.name}</Text>
                          {item.activity.type === "like" ? " liked your post" : " commented on your post"}
                        </Text>
                        <Text className="post__time" numberOfLines={1}>{item.activity.preview} · {timeAgo(item.activity.at)}</Text>
                      </>
                    ) : (
                      <>
                        <Text className="post__body" numberOfLines={2}>
                          {"member" in item.activity && <Text className="post__author" style={{ fontSize: 15 }}>{`${item.activity.member.name} `}</Text>}
                          {item.activity.preview}
                        </Text>
                        <Text className="post__time">{timeAgo(item.activity.at)}</Text>
                      </>
                    )}
                  </View>
                  <SymbolView name={ICONS[item.activity.type].icon} size={18} tintColor={ICONS[item.activity.type].tint} />
                </Pressable>
              )
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </View>
  );
}
