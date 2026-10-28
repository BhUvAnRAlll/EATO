import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "@/components/SymbolView";
import * as Crypto from "expo-crypto";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { ActionSheet, type SheetAction } from "@/components/community/ActionSheet";
import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { community, OFFLINE_MESSAGE, type Member, type Message } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

const MAX_LENGTH = 1000;
// While the screen is open, the newest page is fetched this often so replies show up
// without a reload (there is no push or socket connection)
const POLL_INTERVAL_MS = 10_000;

// A message the member sent that the server hasn't confirmed yet. It keeps the same id
// through every retry, so a send repeated after a timeout can't create a second copy.
type PendingMessage = { id: string; body: string; status: "sending" | "failed"; error: string | null };

type Item = { kind: "message"; message: Message } | { kind: "pending"; pending: PendingMessage };

// Newest first, the order the inverted list expects (same rule as the server)
const newestFirst = (list: Message[]) => [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

// One conversation: messages newest at the bottom (the list is inverted), older pages on
// scroll up, new replies every few seconds, and a text box to reply. Opening it marks the
// conversation read. A send that fails stays on screen with Retry and Delete.
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const loadUnread = useCommunityStore((state) => state.loadUnread);
  const loadFeed = useCommunityStore((state) => state.loadFeed);
  const [other, setOther] = useState<Member | null>(null);
  // Friends only: when the server says no, the composer gives way to its reason
  const [lockReason, setLockReason] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [blocking, setBlocking] = useState(false);
  // Ids already on screen, so a page, a poll and a send can overlap without repeating a message
  const knownIds = useRef(new Set<string>());
  const polling = useRef(false);

  // Adds what isn't on screen yet and returns those messages. A message the server returns
  // is stored, so an unconfirmed copy of it (same id) leaves the "Not sent" list: this is the
  // send whose reply was lost, arriving through a poll instead.
  const addMessages = useCallback((incoming: Message[]) => {
    const fresh = incoming.filter((message) => !knownIds.current.has(message.id));
    for (const message of fresh) knownIds.current.add(message.id);
    if (fresh.length > 0) setMessages((current) => newestFirst([...fresh, ...current]));
    const stored = new Set(incoming.map((message) => message.id));
    setPending((current) => (current.some((p) => stored.has(p.id)) ? current.filter((p) => !stored.has(p.id)) : current));
    return fresh;
  }, []);

  const load = useCallback(async () => {
    const token = await getToken();
    const result = await community.messages(token, id);
    if (!result.ok) {
      setError(result.error);
      setStatus("error");
      return;
    }
    knownIds.current = new Set(result.data.messages.map((message) => message.id));
    setOther(result.data.other);
    setLockReason(result.data.canSend ? null : result.data.lockReason);
    setMessages(result.data.messages);
    setCursor(result.data.nextCursor);
    setStatus("ready");
    loadUnread(token);
  }, [id, getToken, loadUnread]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // The newest page again; anything new is merged in. A failed poll is silent (the next
  // one tries again), so a flaky connection doesn't cover the chat with errors.
  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const token = await getToken();
      const result = await community.messages(token, id);
      if (!result.ok) return;
      setOther(result.data.other);
      setLockReason(result.data.canSend ? null : result.data.lockReason);
      const fresh = addMessages(result.data.messages);
      if (fresh.some((message) => !message.isOwn)) loadUnread(token);
    } catch {
      // Offline, Clerk couldn't refresh the token: wait for the next tick
    } finally {
      polling.current = false;
    }
  }, [id, getToken, addMessages, loadUnread]);

  useFocusEffect(
    useCallback(() => {
      if (status !== "ready") return;
      const timer = setInterval(poll, POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [status, poll]),
  );

  const loadOlder = async () => {
    if (!cursor) return;
    const result = await community.messages(await getToken(), id, cursor);
    if (result.ok) {
      addMessages(result.data.messages);
      setCursor(result.data.nextCursor);
    }
  };

  // Sends (or re-sends) one pending message. The server answers with the stored message;
  // if it was stored by an earlier attempt it answers with that one.
  const deliver = async (item: PendingMessage) => {
    setPending((current) => [...current.filter((p) => p.id !== item.id), { ...item, status: "sending", error: null }]);
    // Offline, Clerk can't refresh an expired token: treat it like any other failed send
    const token = await getToken().catch(() => undefined);
    const result = token === undefined ? { ok: false as const, error: OFFLINE_MESSAGE } : await community.sendMessage(token, id, item.body, item.id);
    if (result.ok) {
      setPending((current) => current.filter((p) => p.id !== item.id));
      addMessages([result.data.message]);
    } else {
      setPending((current) => current.map((p) => (p.id === item.id ? { ...p, status: "failed", error: result.error } : p)));
    }
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    deliver({ id: Crypto.randomUUID(), body, status: "sending", error: null });
  };

  const discard = (item: PendingMessage) => setPending((current) => current.filter((p) => p.id !== item.id));

  // Blocking hides this conversation for both members (the server enforces it), so leave it
  // The sheet always closes, even when the token can't be refreshed offline
  const block = async () => {
    if (!other || blocking) return;
    setBlocking(true);
    try {
      const token = await getToken();
      const result = await community.setBlock(token, other.id, true);
      if (!result.ok) return setError(result.error);
      await Promise.all([loadFeed(token, { force: true }), loadUnread(token)]);
      if (router.canGoBack()) router.back();
      else router.replace("/messages");
    } catch {
      setError(OFFLINE_MESSAGE);
    } finally {
      setBlocking(false);
      setConfirmingBlock(false);
    }
  };

  const menuActions: SheetAction[] = other
    ? [
        { label: "View profile", onPress: () => router.push({ pathname: "/community/profile/[userId]", params: { userId: other.id } }) },
        { label: `Block ${other.name}`, destructive: true, onPress: () => setConfirmingBlock(true) },
      ]
    : [];

  // Unconfirmed sends sit at the bottom (index 0 of an inverted list), newest last
  const items: Item[] = [
    ...[...pending].reverse().map((p): Item => ({ kind: "pending", pending: p })),
    ...messages.map((message): Item => ({ kind: "message", message })),
  ];

  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const renderItem = ({ item }: { item: Item }) => {
    if (item.kind === "message") {
      const { message } = item;
      return (
        <View className={message.isOwn ? "max-w-[78%] items-end self-end" : "max-w-[78%] items-start self-start"}>
          <View className={message.isOwn ? "bubble bubble--own max-w-full" : "bubble max-w-full"} accessibilityLabel={`${message.isOwn ? "You" : other?.name ?? "They"}: ${message.body}`}>
            <Text className={message.isOwn ? "bubble__text bubble__text--own" : "bubble__text"}>{message.body}</Text>
          </View>
          <Text className="bubble__time mx-2 mt-1">{time(message.createdAt)}</Text>
        </View>
      );
    }
    const { pending: p } = item;
    const failed = p.status === "failed";
    return (
      <View className="max-w-[78%] items-end self-end">
        <View className="bubble bubble--own max-w-full" style={{ opacity: failed ? 0.55 : 0.75 }} accessibilityLabel={`You: ${p.body}, ${failed ? "not sent" : "sending"}`}>
          <Text className="bubble__text bubble__text--own">{p.body}</Text>
          <Text className="bubble__time mt-1" style={{ color: "rgba(255,255,255,0.7)", textAlign: "right" }}>{failed ? "Not sent" : "Sending…"}</Text>
        </View>
        {failed && (
          <View className="mt-1 items-end">
            {p.error && <Text className="bubble__time text-right" style={{ color: colors.danger }}>{p.error}</Text>}
            <View className="mt-1 flex-row gap-4">
              <Pressable onPress={() => deliver(p)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry sending">
                <Text className="bubble__time" style={{ color: colors.forest, fontWeight: "600" }}>Retry</Text>
              </Pressable>
              <Pressable onPress={() => discard(p)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Discard message">
                <Text className="bubble__time" style={{ color: colors.danger, fontWeight: "600" }}>Delete</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <Text className="screen-bar__title" numberOfLines={1}>{other?.name ?? "Conversation"}</Text>
          {other ? (
            // The photo opens the options: View profile, Block
            <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Conversation options">
              <Avatar member={other} size={36} />
            </Pressable>
          ) : (
            <View className="screen-bar__back" />
          )}
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {status === "loading" ? (
            <ActivityIndicator color={colors.forest} className="mt-6" />
          ) : status === "error" ? (
            <View className="px-5 pt-4">
              <EmptyState icon={{ ios: "lock", android: "lock", web: "lock" }} title="Can't open this conversation" text={error ?? "Please try again."} actionLabel="Retry" onAction={load} />
            </View>
          ) : (
            <FlatList
              data={items}
              inverted
              keyExtractor={(item) => (item.kind === "message" ? item.message.id : `pending-${item.pending.id}`)}
              contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12, gap: 8 }}
              ListEmptyComponent={<Text className="home__note text-center" style={{ transform: [{ scaleY: -1 }] }}>Say hello to {other?.name ?? "them"}.</Text>}
              onEndReached={loadOlder}
              onEndReachedThreshold={0.3}
              renderItem={renderItem}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            />
          )}

          {error && status === "ready" && (
            <Pressable onPress={() => setError(null)} className="px-5 pb-2">
              <FormAlert message={error} />
            </Pressable>
          )}
          {lockReason ? (
            // The chat stays readable; only sending is locked
            <View className="compose__footer">
              <View className="info-banner flex-1 items-start">
                <SymbolView name={{ ios: "lock", android: "lock", web: "lock" }} size={16} tintColor={colors.inkSoft} />
                <View className="flex-1 gap-1">
                  <Text className="info-banner__text">{lockReason}</Text>
                  {other && (
                    <Pressable onPress={() => router.push({ pathname: "/community/profile/[userId]", params: { userId: other.id } })} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Open ${other.name}'s profile`}>
                      <Text className="gym-section__link">View profile</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </View>
          ) : (
            <View className="comment-bar">
              <TextInput className="comment-bar__input" value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={colors.faint} multiline numberOfLines={1} maxLength={MAX_LENGTH} accessibilityLabel="Message" />
              <Pressable onPress={send} disabled={!text.trim()} className={text.trim() ? "comment-bar__send" : "comment-bar__send comment-bar__send--disabled"} accessibilityRole="button" accessibilityLabel="Send message" accessibilityState={{ disabled: !text.trim() }}>
                <SymbolView name={{ ios: "paperplane.fill", android: "send", web: "send" }} size={18} tintColor={colors.white} />
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ActionSheet visible={menuOpen} title={other?.name} actions={menuActions} onClose={() => setMenuOpen(false)} />
      {confirmingBlock && other && (
        <View className="confirm__backdrop" accessibilityViewIsModal>
          <Pressable style={{ flex: 1 }} onPress={blocking ? undefined : () => setConfirmingBlock(false)} accessibilityLabel="Close" />
          <View className="confirm__sheet">
            <Text className="setup__section text-center">Block {other.name}?</Text>
            <Text className="home__note mt-1 text-center">{"You won't see each other's posts or messages, and this conversation is hidden. You can unblock them from their profile."}</Text>
            <Pressable onPress={block} disabled={blocking} className="btn-forest mt-4" style={{ backgroundColor: colors.danger, opacity: blocking ? 0.6 : 1 }} accessibilityRole="button" accessibilityLabel="Confirm block">
              {blocking ? <ActivityIndicator color={colors.white} /> : <Text className="btn-forest__label">Block</Text>}
            </Pressable>
            <Pressable onPress={() => setConfirmingBlock(false)} disabled={blocking} className="btn-outline mt-2" accessibilityRole="button" accessibilityLabel="Keep chatting">
              <Text className="btn-outline__label">Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
