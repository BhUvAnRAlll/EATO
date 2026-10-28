import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import { router, useFocusEffect } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { community, timeAgo, type Conversation, type Member } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { trainers, type MyConnection } from "@/lib/trainers";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

type Filter = "all" | "friends" | "trainer";
const relationTags: Record<Conversation["relation"], string | null> = { trainer: "Trainer", client: "Client", friend: "Friend", none: null };

// Messages: your trainer (or how to find one), your friends as a row of faces, then every
// conversation with search and All / Friends / Trainer filters. You can message accepted friends
// and your connected trainer; anyone else's chat stays readable but locked. ✎ starts a new one
// with someone you may message. The server checks who may message whom on every send.
export default function Conversations() {
  const getToken = useSessionToken();
  const loadUnread = useCommunityStore((state) => state.loadUnread);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [friends, setFriends] = useState<Member[]>([]);
  const [coach, setCoach] = useState<MyConnection | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    const [list, friendList, connection] = await Promise.all([community.conversations(token), community.friends(token), trainers.myConnection(token)]);
    if (list.ok) {
      setConversations(list.data.conversations);
      setError(null);
    } else setError(list.error);
    if (friendList.ok) setFriends(friendList.data.friends.map((f) => f.member));
    if (connection.ok) setCoach(connection.data);
    loadUnread(token);
  }, [getToken, loadUnread]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(load, 0);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const open = async (member: Member) => {
    setPicking(false);
    const result = await community.openConversation(await getToken(), member.id);
    if (result.ok) router.push({ pathname: "/messages/[id]", params: { id: result.data.conversation.id } });
    else setError(result.error);
  };

  const term = search.trim().toLowerCase();
  const shown = (conversations ?? []).filter((c) => {
    if (term && !c.other.name.toLowerCase().includes(term) && !(c.lastMessage ?? "").toLowerCase().includes(term)) return false;
    if (filter === "friends") return c.relation === "friend";
    if (filter === "trainer") return c.relation === "trainer" || c.relation === "client";
    return true;
  });
  const trainer = coach?.state === "connected" ? coach.trainer : null;
  const reachable: Member[] = [...(trainer ? [trainer.member] : []), ...friends.filter((f) => f.id !== trainer?.member.id)];

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title">Messages</Text>
          <Pressable onPress={() => setPicking(true)} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="New message">
            <SymbolView name={{ ios: "square.and.pencil", android: "edit_square", web: "edit_square" }} size={20} tintColor={colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}

          <Text className="gym-group__title">Your trainer</Text>
          {coach === null ? (
            <ActivityIndicator color={colors.forest} />
          ) : coach.state === "connected" ? (
            <Pressable onPress={() => open(coach.trainer.member)} className="join-card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Message your trainer ${coach.trainer.member.name}`}>
              <Avatar member={coach.trainer.member} size={44} />
              <View className="min-w-0 flex-1">
                <Text className="join-card__title" numberOfLines={1}>{coach.trainer.member.name}</Text>
                <Text className="join-card__hint" numberOfLines={1}>{coach.trainer.title}</Text>
              </View>
              <SymbolView name={{ ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" }} size={20} tintColor={colors.ink} />
            </Pressable>
          ) : coach.state === "requested" ? (
            <View className="join-card flex-row items-center gap-3" accessibilityLabel={coach.messageLockReason}>
              <Avatar member={coach.trainer.member} size={44} />
              <View className="min-w-0 flex-1">
                <Text className="join-card__title" numberOfLines={1}>{coach.trainer.member.name}</Text>
                <Text className="join-card__hint" numberOfLines={2}>{coach.messageLockReason}</Text>
              </View>
              <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={18} tintColor={colors.ink} />
            </View>
          ) : (
            <Pressable onPress={() => router.push({ pathname: "/community", params: { tab: "trainers" } })} className="join-card flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel="No trainer yet. Find trainers">
              <View className="compose__option-icon">
                <SymbolView name={{ ios: "person.crop.circle.badge.questionmark", android: "person_search", web: "person_search" }} size={18} tintColor={colors.ink} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="join-card__title">No trainer yet</Text>
                <Text className="join-card__hint">Connect with a trainer to message them here</Text>
              </View>
              <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={15} tintColor={colors.inkSoft} />
            </Pressable>
          )}

          <View className="mt-1 flex-row items-center justify-between">
            <Text className="gym-group__title">Friends ({friends.length})</Text>
            <Pressable onPress={() => router.push({ pathname: "/community", params: { tab: "friends" } })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Find friends">
              <Text className="gym-section__link">Find friends</Text>
            </Pressable>
          </View>
          {friends.length === 0 ? (
            <Text className="home__note">Add friends to message them. Messages are for friends and your trainer.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 18 }}>
              {friends.map((friend) => (
                <Pressable key={friend.id} onPress={() => open(friend)} className="items-center gap-1.5" accessibilityRole="button" accessibilityLabel={`Message ${friend.name}`}>
                  <Avatar member={friend} size={56} />
                  <Text className="story__name" numberOfLines={1}>{friend.name.split(" ")[0]}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View className="search search--pill">
            <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
            <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search conversations" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search conversations" />
          </View>
          <View className="flex-row gap-2" accessibilityRole="tablist">
            {(["all", "friends", "trainer"] as const).map((key) => (
              <Pressable key={key} onPress={() => setFilter(key)} className={filter === key ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="tab" accessibilityState={{ selected: filter === key }}>
                <Text className={filter === key ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{key === "all" ? "All" : key === "friends" ? "Friends" : "Trainer"}</Text>
              </Pressable>
            ))}
          </View>

          {conversations === null && !error ? (
            <ActivityIndicator color={colors.forest} />
          ) : shown.length === 0 ? (
            <EmptyState icon={{ ios: "bubble.left.and.bubble.right", android: "forum", web: "forum" }} title={term || filter !== "all" ? "No conversations match" : "No messages yet"} text={term || filter !== "all" ? "Try another name or filter." : "Tap a friend above, or ✎, to start a conversation."} />
          ) : (
            <View>
              {shown.map((item, index) => {
                const tag = relationTags[item.relation];
                const edge = [index === 0 ? "friend-row--first" : "", index === shown.length - 1 ? "friend-row--last" : ""].join(" ");
                return (
                  <Pressable key={item.id} onPress={() => router.push({ pathname: "/messages/[id]", params: { id: item.id } })} className={`friend-row ${edge}`} accessibilityRole="button" accessibilityLabel={`Conversation with ${item.other.name}${item.unreadCount ? `, ${item.unreadCount} unread` : ""}`}>
                    <Avatar member={item.other} size={48} />
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="friend-row__name flex-shrink" numberOfLines={1}>{item.other.name}</Text>
                        {tag && (
                          <View className={item.relation === "friend" ? "gym-badge" : "gym-badge gym-badge--member"} style={{ height: 22 }}>
                            <Text className="gym-badge__label" style={{ fontSize: 12 }}>{tag}</Text>
                          </View>
                        )}
                        <View className="flex-1" />
                        {item.lastMessageAt && <Text className="gym-card__meta shrink-0">{timeAgo(item.lastMessageAt)}</Text>}
                      </View>
                      <View className="mt-0.5 flex-row items-center gap-1">
                        {item.relation === "none" && <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={12} tintColor={colors.inkSoft} />}
                        <Text className={item.unreadCount > 0 ? "messages__preview messages__preview--unread flex-1" : "messages__preview flex-1"} numberOfLines={1}>
                          {item.lastMessage ? `${item.lastFromMe ? "You: " : ""}${item.lastMessage}` : "Say hello"}
                        </Text>
                      </View>
                    </View>
                    {item.unreadCount > 0 && (
                      <View className="messages__unread">
                        <Text className="community__badge-label">{item.unreadCount}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <Pressable className="verify__backdrop" onPress={() => setPicking(false)} accessibilityLabel="Close">
          <Pressable className="verify__sheet gap-2" onPress={() => {}} accessibilityViewIsModal>
            <Text className="setup__section text-center">New message</Text>
            {reachable.length === 0 ? (
              <Text className="home__note text-center">You can message accepted friends and your connected trainer. Add friends first.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {reachable.map((member) => (
                  <Pressable key={member.id} onPress={() => open(member)} className="flex-row items-center gap-3 py-2" accessibilityRole="button" accessibilityLabel={`New message to ${member.name}`}>
                    <Avatar member={member} size={36} />
                    <Text className="friend-row__name flex-1" numberOfLines={1}>{member.name}</Text>
                    {trainer?.member.id === member.id && <View className="gym-badge gym-badge--member" style={{ height: 22 }}><Text className="gym-badge__label" style={{ fontSize: 12 }}>Trainer</Text></View>}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
