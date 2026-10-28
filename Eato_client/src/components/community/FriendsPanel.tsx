import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SymbolView } from "@/components/SymbolView";
import { router } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { community, isOffline, timeAgo, type FriendState, type Member } from "@/lib/community";
import { friendButton, friendConfirm } from "@/lib/friends";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Filter = "suggested" | "friends" | "sent";
type Row = { member: Member; state: FriendState; note: string | null };
type Pending = { row: Row; action: "cancel" | "remove" };

// The line under a name: the member's bio, else where the friendship stands
const noteFor = (bio: string | null, fallback: string | null) => (bio && bio.trim() ? bio.trim() : fallback);

// The Friends tab: search by name, or browse Suggested / Friends / Requests sent. A friendship
// starts as a request and messaging stays locked (the lock icon) until the other member
// accepts. Requests you receive arrive in Notifications; a search shows Accept on that person
// too. `header` is the Community header (title, tabs), drawn above so the page scrolls as one.
// The chips, with counts once they've loaded
const filters = (counts: { friends: number; sent: number } | null): { key: Filter; label: string }[] => [
  { key: "suggested", label: "Suggested" },
  { key: "friends", label: counts ? `Friends (${counts.friends})` : "Friends" },
  { key: "sent", label: counts ? `Requests sent (${counts.sent})` : "Requests sent" },
];

export function FriendsPanel({ header }: { header: ReactElement }) {
  const getToken = useSessionToken();
  const [filter, setFilter] = useState<Filter>("suggested");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<{ friends: number; sent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const term = search.trim();
    // The chip counts show whichever list is open
    const [friends, requests] = await Promise.all([community.friends(token), community.friendRequests(token)]);
    if (friends.ok && requests.ok) setCounts({ friends: friends.data.friends.length, sent: requests.data.outgoing.length });
    let next: Row[] | null = null;
    let failure: string | null = null;
    if (term || filter === "suggested") {
      const result = await community.findFriends(token, term || null);
      if (result.ok) next = result.data.members.map((m) => ({ member: m.member, state: m.friendState, note: noteFor(m.bio, null) }));
      else failure = result.error;
    } else if (filter === "friends") {
      if (friends.ok) next = friends.data.friends.map((f) => ({ member: f.member, state: "friends", note: noteFor(f.bio, `Friends since ${timeAgo(f.since)}`) }));
      else failure = friends.error;
    } else if (requests.ok) {
      next = requests.data.outgoing.map((r): Row => ({ member: r.member, state: "outgoing", note: `Request sent ${timeAgo(r.requestedAt)}` }));
    } else failure = requests.error;
    if (next) setRows(next);
    setError(failure);
  }, [filter, search, getToken]);

  // Load when the filter changes, and as the search is typed (debounced)
  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Runs one friendship change. Suggestions and search results keep the row and show the
  // server's new state on it (Add Friend → Requested), since a reload would drop anyone with an
  // open request; the Friends and Requests lists reload so rows come and go as they should.
  const act = async (row: Row, action: "request" | "cancel" | "accept" | "decline" | "remove") => {
    setBusyId(row.member.id);
    const token = await getToken();
    const id = row.member.id;
    const result =
      action === "request" ? await community.sendFriendRequest(token, id)
      : action === "cancel" ? await community.cancelFriendRequest(token, id)
      : action === "remove" ? await community.removeFriend(token, id)
      : await community.answerFriendRequest(token, id, action === "accept");
    if (!result.ok) setError(result.error);
    else if (search.trim() || filter === "suggested") {
      const state = result.data.friendState;
      setRows((current) => current?.map((item) => (item.member.id === id ? { ...item, state } : item)) ?? current);
      const [friends, requests] = await Promise.all([community.friends(token), community.friendRequests(token)]);
      if (friends.ok && requests.ok) setCounts({ friends: friends.data.friends.length, sent: requests.data.outgoing.length });
    } else await load();
    setBusyId(null);
    setPending(null);
  };

  const onButton = (row: Row) => {
    const button = friendButton(row.state);
    if (button.action === "cancel" || button.action === "remove") setPending({ row, action: button.action });
    else act(row, button.action);
  };

  const message = async (member: Member) => {
    const result = await community.openConversation(await getToken(), member.id);
    if (result.ok) router.push({ pathname: "/messages/[id]", params: { id: result.data.conversation.id } });
    else setError(result.error);
  };

  const searching = search.trim() !== "";
  const empty = () => {
    if (rows === null) return <ActivityIndicator color={colors.forest} className="mt-6" />;
    if (error) {
      const offline = isOffline(error);
      return <EmptyState icon={offline ? { ios: "wifi.slash", android: "wifi_off", web: "wifi_off" } : { ios: "exclamationmark.triangle", android: "error_outline", web: "error_outline" }} title={offline ? "You're offline" : "Couldn't load"} text={error} actionLabel="Retry" onAction={load} />;
    }
    if (searching) return <EmptyState icon={{ ios: "magnifyingglass", android: "search", web: "search" }} title="No members found" text="Try another name." />;
    if (filter === "friends") return <EmptyState icon={{ ios: "person.2", android: "group", web: "group" }} title="No friends yet" text="Add friends to message them and see who's training." actionLabel="Find friends" onAction={() => setFilter("suggested")} />;
    if (filter === "sent") return <EmptyState icon={{ ios: "paperplane", android: "send", web: "send" }} title="No requests sent" text="Requests you send show here until they're answered. Requests you receive arrive in Notifications." />;
    return <EmptyState icon={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} title="No suggestions right now" text="Search by name to find someone." />;
  };

  const confirm = pending ? friendConfirm(pending.action, pending.row.member.name) : null;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={rows ?? []}
        keyExtractor={(row) => row.member.id}
        ListHeaderComponent={
          <View>
            {header}
            <View className="search search--pill mx-5 mt-5">
              <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
              <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search friends by name" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search members" />
            </View>
            {!searching && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }} accessibilityRole="tablist">
                {filters(counts).map((item) => {
                  const selected = filter === item.key;
                  return (
                    <Pressable key={item.key} onPress={() => setFilter(item.key)} className={selected ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.label}>
                      <Text className={selected ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            {error && rows !== null && (
              <Pressable onPress={() => setError(null)} className="mx-5 mt-3">
                <FormAlert message={error} />
              </Pressable>
            )}
          </View>
        }
        ListHeaderComponentStyle={{ marginBottom: 8 }}
        ListEmptyComponent={<View className="px-5 pt-2">{empty()}</View>}
        contentContainerStyle={{ paddingBottom: 16 }}
        renderItem={({ item, index }) => {
          const button = friendButton(item.state);
          const busy = busyId === item.member.id;
          const first = item.member.name.split(" ")[0];
          const edge = [index === 0 ? "friend-row--first" : "", index === (rows?.length ?? 0) - 1 ? "friend-row--last" : ""].join(" ");
          return (
            <View className={`friend-row mx-5 ${edge}`}>
              <Pressable onPress={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: item.member.id } })} className="min-w-0 flex-1 flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Open ${item.member.name}'s profile`}>
                <Avatar member={item.member} size={44} />
                <View className="min-w-0 flex-1">
                  <Text className="friend-row__name" numberOfLines={1}>{item.member.name}</Text>
                  {/* "Wants to be friends" follows the live state, so it goes once the request is accepted */}
                  {(item.note ?? (item.state === "incoming" ? "Wants to be friends" : null)) && (
                    <Text className="friend-row__note" numberOfLines={1}>{item.note ?? "Wants to be friends"}</Text>
                  )}
                </View>
              </Pressable>
              {item.state === "friends" ? (
                <Pressable onPress={() => message(item.member)} hitSlop={8} className="friend-row__icon" accessibilityRole="button" accessibilityLabel={`Message ${item.member.name}`}>
                  <SymbolView name={{ ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" }} size={20} tintColor={colors.ink} />
                </Pressable>
              ) : (
                <View className="friend-row__icon" accessibilityLabel={item.state === "outgoing" ? `Messaging ${item.member.name} unlocks when they accept` : `Messaging ${first} is locked until you're friends`}>
                  <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={18} tintColor={colors.ink} />
                </View>
              )}
              <Pressable
                onPress={() => onButton(item)}
                disabled={busy}
                className={button.tone === "primary" ? "friend-button" : "friend-button friend-button--soft"}
                style={{ opacity: busy ? 0.5 : 1 }}
                accessibilityRole="button"
                accessibilityLabel={button.action === "request" ? `Add ${item.member.name} as a friend` : button.action === "accept" ? `Accept ${item.member.name}'s request` : button.action === "cancel" ? `Cancel your request to ${item.member.name}` : `Remove ${item.member.name} as a friend`}
              >
                {busy ? (
                  <ActivityIndicator color={button.tone === "primary" ? colors.white : colors.ink} />
                ) : (
                  <>
                    {button.action === "request" && <SymbolView name={{ ios: "person.badge.plus", android: "person_add", web: "person_add" }} size={16} tintColor={colors.white} />}
                    <Text className={button.tone === "primary" ? "friend-button__label" : "friend-button__label friend-button__label--soft"}>{button.label}</Text>
                  </>
                )}
              </Pressable>
            </View>
          );
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.forest} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
      <ConfirmSheet
        visible={pending !== null}
        title={confirm?.title ?? ""}
        text={confirm?.text ?? ""}
        confirmLabel={confirm?.confirmLabel ?? ""}
        busy={pending !== null && busyId === pending.row.member.id}
        onConfirm={() => pending && act(pending.row, pending.action)}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}
