import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { AdminScreen } from "@/components/admin/AdminScreen";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { community, timeAgo, type Conversation } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

// The trainer's inbox: their conversations (with clients, and anyone they messaged before).
// The chat itself is the members' chat screen; the server lets a trainer write only to a
// client they coach (or a friend).
export default function TrainerMessages() {
  const getToken = useSessionToken();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await community.conversations(await getToken());
    if (result.ok) setConversations(result.data.conversations);
    else setError(result.error);
  }, [getToken]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  return (
    <AdminScreen title="Messages">
      <View className="gap-3">
        {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
        {conversations === null ? (
          <ActivityIndicator color={colors.forest} />
        ) : conversations.length === 0 ? (
          <EmptyState icon={{ ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" }} title="No messages yet" text="Open a client and tap the chat button to start a conversation." />
        ) : (
          conversations.map((c) => (
            <Pressable key={c.id} onPress={() => router.push({ pathname: "/trainer/messages/[id]", params: { id: c.id } })} className="post__card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Conversation with ${c.other.name}${c.unreadCount ? `, ${c.unreadCount} unread` : ""}`}>
              <Avatar member={c.other} size={44} />
              <View className="flex-1">
                <Text className="post__author" numberOfLines={1}>{c.other.name}</Text>
                <Text className="post__time" numberOfLines={1}>{c.lastMessage ?? "No messages yet"}</Text>
              </View>
              <View className="items-end gap-1">
                {c.lastMessageAt && <Text className="post__time">{timeAgo(c.lastMessageAt)}</Text>}
                {c.unreadCount > 0 && (
                  <View className="community__badge" style={{ position: "relative", top: 0, right: 0 }}>
                    <Text className="community__badge-label">{c.unreadCount}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          ))
        )}
      </View>
    </AdminScreen>
  );
}
