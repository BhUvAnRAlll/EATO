import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { community, timeAgo, type Conversation } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

// The member's direct-message conversations, most recent first, with unread counts
export default function Conversations() {
  const getToken = useSessionToken();
  const loadUnread = useCommunityStore((state) => state.loadUnread);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    const result = await community.conversations(token);
    if (result.ok) {
      setConversations(result.data.conversations);
      setError(null);
    } else setError(result.error);
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

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="h-12 flex-row items-center px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          <Text className="type-subhead ml-3 flex-1 text-forest-ink">Messages</Text>
        </View>

        {conversations === null && !error ? (
          <ActivityIndicator color={colors.forest} className="mt-6" />
        ) : (
          <FlatList
            data={conversations ?? []}
            keyExtractor={(conversation) => conversation.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 10 }}
            ListEmptyComponent={
              error ? (
                <EmptyState icon={{ ios: "wifi.exclamationmark", android: "wifi_off", web: "wifi_off" }} title="Couldn't load messages" text={error} actionLabel="Retry" onAction={load} />
              ) : (
                <EmptyState icon={{ ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" }} title="No messages yet" text="Open a member's post and choose Message to start a conversation." />
              )
            }
            renderItem={({ item }) => (
              <Pressable onPress={() => router.push({ pathname: "/messages/[id]", params: { id: item.id } })} className="post__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Conversation with ${item.other.name}${item.unreadCount ? `, ${item.unreadCount} unread` : ""}`}>
                <Avatar member={item.other} />
                <View className="flex-1">
                  <View className="flex-row items-center justify-between">
                    <Text className="post__author" numberOfLines={1}>{item.other.name}</Text>
                    {item.lastMessageAt && <Text className="post__time">{timeAgo(item.lastMessageAt)}</Text>}
                  </View>
                  <Text className="post__time mt-0.5" numberOfLines={1} style={item.unreadCount > 0 ? { color: colors.ink, fontWeight: "600" } : undefined}>
                    {item.lastMessage ?? "Say hello"}
                  </Text>
                </View>
                {item.unreadCount > 0 && (
                  <View className="h-6 min-w-6 items-center justify-center rounded-pill bg-forest px-1.5">
                    <Text className="community__badge-label">{item.unreadCount}</Text>
                  </View>
                )}
              </Pressable>
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </View>
  );
}
