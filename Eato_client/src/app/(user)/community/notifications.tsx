import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { community, isOffline, timeAgo, type Activity, type FollowRequest } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

type Row = { kind: "request"; request: FollowRequest } | { kind: "activity"; activity: Activity };

// The bell: follow requests to accept or decline, then recent likes and comments on your posts
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
      ...result.data.followRequests.map((request): Row => ({ kind: "request", request })),
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
            keyExtractor={(row) => (row.kind === "request" ? `request-${row.request.member.id}` : `${row.activity.type}-${row.activity.member.id}-${row.activity.postId}-${row.activity.at}`)}
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
                <EmptyState icon={{ ios: "bell", android: "notifications", web: "notifications" }} title="You're all caught up" text="Follow requests, likes and comments on your posts appear here." />
              )
            }
            renderItem={({ item }) =>
              item.kind === "request" ? (
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
                <Pressable onPress={() => router.push({ pathname: "/community/post/[id]", params: { id: item.activity.postId } })} className="post__card flex-row items-center gap-3" accessibilityRole="button">
                  <Avatar member={item.activity.member} />
                  <View className="flex-1">
                    <Text className="post__body" numberOfLines={2}>
                      <Text className="post__author" style={{ fontSize: 15 }}>{item.activity.member.name}</Text>
                      {item.activity.type === "like" ? " liked your post" : " commented on your post"}
                    </Text>
                    <Text className="post__time" numberOfLines={1}>{item.activity.preview} · {timeAgo(item.activity.at)}</Text>
                  </View>
                  <SymbolView name={item.activity.type === "like" ? { ios: "heart.fill", android: "favorite", web: "favorite" } : { ios: "bubble.right.fill", android: "chat_bubble", web: "chat_bubble" }} size={18} tintColor={item.activity.type === "like" ? colors.danger : colors.leaf} />
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
