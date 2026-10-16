import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { community, isOffline, timeAgo, type FriendState, type Member } from "@/lib/community";
import { friendButton, friendConfirm } from "@/lib/friends";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Filter = "friends" | "suggested" | "requests";
type Row = { member: Member; state: FriendState; note: string | null };
type Pending = { row: Row; action: "cancel" | "remove" };

const filters: { key: Filter; label: string }[] = [
  { key: "friends", label: "Friends" },
  { key: "suggested", label: "Suggested" },
  { key: "requests", label: "Requests" },
];

// The Friends tab: search by name, or browse Friends / Suggested / Requests. A friendship
// starts as a request and messaging stays locked until the other member accepts. `header`
// is the Community header (title, tabs), drawn above the list so the page scrolls as one.
export function FriendsPanel({ header }: { header: ReactElement }) {
  const getToken = useSessionToken();
  const [filter, setFilter] = useState<Filter>("friends");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [incomingCount, setIncomingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(async () => {
    const token = await getToken();
    const term = search.trim();
    // The Requests count shows on its chip whichever list is open
    const requests = await community.friendRequests(token);
    if (requests.ok) setIncomingCount(requests.data.incoming.length);
    let next: Row[] | null = null;
    let failure: string | null = null;
    if (term || filter === "suggested") {
      const result = await community.findFriends(token, term || null);
      if (result.ok) next = result.data.members.map((m) => ({ member: m.member, state: m.friendState, note: null }));
      else failure = result.error;
    } else if (filter === "friends") {
      const result = await community.friends(token);
      if (result.ok) next = result.data.friends.map((f) => ({ member: f.member, state: "friends", note: `Became friends ${timeAgo(f.since)}` }));
      else failure = result.error;
    } else if (requests.ok) {
      next = [
        ...requests.data.incoming.map((r): Row => ({ member: r.member, state: "incoming", note: `Wants to be friends · ${timeAgo(r.requestedAt)}` })),
        ...requests.data.outgoing.map((r): Row => ({ member: r.member, state: "outgoing", note: `Request sent · ${timeAgo(r.requestedAt)}` })),
      ];
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
      const requests = await community.friendRequests(token);
      if (requests.ok) setIncomingCount(requests.data.incoming.length);
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
    if (filter === "requests") return <EmptyState icon={{ ios: "tray", android: "inbox", web: "inbox" }} title="No requests" text="Requests you send and receive show here." />;
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
            <View className="search mx-5 mt-5">
              <SymbolView name={{ ios: "magnifyingglass", android: "search", web: "search" }} size={18} tintColor={colors.muted} />
              <TextInput className="search__input" value={search} onChangeText={setSearch} placeholder="Search members by name" placeholderTextColor={colors.faint} autoCorrect={false} accessibilityLabel="Search members" />
            </View>
            {!searching && (
              <View className="mx-5 mt-3 flex-row gap-2" accessibilityRole="tablist">
                {filters.map((item) => {
                  const selected = filter === item.key;
                  const label = item.key === "requests" && incomingCount > 0 ? `${item.label} · ${incomingCount}` : item.label;
                  return (
                    <Pressable key={item.key} onPress={() => setFilter(item.key)} className={selected ? "setup__chip setup__chip--selected" : "setup__chip"} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.key === "requests" && incomingCount > 0 ? `Requests, ${incomingCount} received` : item.label}>
                      <Text className={selected ? "setup__chip-label setup__chip-label--selected" : "setup__chip-label"}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
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
        renderItem={({ item }) => {
          const button = friendButton(item.state);
          const busy = busyId === item.member.id;
          return (
            <View className="flex-row items-center gap-3 px-5 py-2.5">
              <Pressable onPress={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: item.member.id } })} className="flex-1 flex-row items-center gap-3" accessibilityRole="button" accessibilityLabel={`Open ${item.member.name}'s profile`}>
                <Avatar member={item.member} size={44} />
                <View className="flex-1">
                  <Text className="post__author" numberOfLines={1}>{item.member.name}</Text>
                  {item.note && <Text className="post__time" numberOfLines={1}>{item.note}</Text>}
                </View>
              </Pressable>
              {item.state === "friends" ? (
                <Pressable onPress={() => message(item.member)} className="home__icon-button" accessibilityRole="button" accessibilityLabel={`Message ${item.member.name}`}>
                  <SymbolView name={{ ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" }} size={18} tintColor={colors.forestInk} />
                </Pressable>
              ) : item.state === "outgoing" ? (
                <View className="home__icon-button" style={{ opacity: 0.5 }} accessibilityLabel={`Messaging ${item.member.name} unlocks when they accept`}>
                  <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={16} tintColor={colors.muted} />
                </View>
              ) : null}
              {item.state === "incoming" && (
                <Pressable onPress={() => act(item, "decline")} disabled={busy} className="group__join group__join--joined" style={{ opacity: busy ? 0.5 : 1 }} accessibilityRole="button" accessibilityLabel={`Decline ${item.member.name}'s request`}>
                  <Text className="group__join-label group__join-label--joined">Decline</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => onButton(item)}
                disabled={busy}
                className={button.tone === "primary" ? "group__join" : "group__join group__join--joined"}
                style={{ opacity: busy ? 0.5 : 1 }}
                accessibilityRole="button"
                accessibilityLabel={button.action === "request" ? `Add ${item.member.name} as a friend` : button.action === "accept" ? `Accept ${item.member.name}'s request` : button.action === "cancel" ? `Cancel your request to ${item.member.name}` : `Remove ${item.member.name} as a friend`}
              >
                {busy ? <ActivityIndicator color={button.tone === "primary" ? colors.white : colors.forest} /> : <Text className={button.tone === "primary" ? "group__join-label" : "group__join-label group__join-label--joined"}>{button.label}</Text>}
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
