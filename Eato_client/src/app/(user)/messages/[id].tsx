import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { Avatar } from "@/components/community/Avatar";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { community, type Member, type Message } from "@/lib/community";
import { useSessionToken } from "@/lib/session";
import { useCommunityStore } from "@/store/community";
import { colors } from "@/theme";

const MAX_LENGTH = 1000;

// One conversation: messages newest at the bottom (the list is inverted), older pages on
// scroll up, and a text box to reply. Opening it marks the conversation read.
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const loadUnread = useCommunityStore((state) => state.loadUnread);
  const [other, setOther] = useState<Member | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    const result = await community.messages(token, id);
    if (!result.ok) {
      setError(result.error);
      setStatus("error");
      return;
    }
    setOther(result.data.other);
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

  const loadOlder = async () => {
    if (!cursor) return;
    const result = await community.messages(await getToken(), id, cursor);
    if (result.ok) {
      setMessages((current) => [...current, ...result.data.messages.filter((m) => !current.some((item) => item.id === m.id))]);
      setCursor(result.data.nextCursor);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const result = await community.sendMessage(await getToken(), id, body);
    setSending(false);
    if (!result.ok) return setError(result.error);
    setText("");
    setMessages((current) => [result.data.message, ...current]);
  };

  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="h-12 flex-row items-center gap-3 px-5">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.forestInk} />
          </Pressable>
          {other && <Avatar member={other} size={32} />}
          <Text className="type-subhead flex-1 text-forest-ink" numberOfLines={1}>
            {other?.name ?? "Conversation"}
          </Text>
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
              data={messages}
              inverted
              keyExtractor={(message) => message.id}
              contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12, gap: 8 }}
              ListEmptyComponent={<Text className="home__note text-center" style={{ transform: [{ scaleY: -1 }] }}>Say hello to {other?.name ?? "them"}.</Text>}
              onEndReached={loadOlder}
              onEndReachedThreshold={0.3}
              renderItem={({ item }) => (
                <View className={item.isOwn ? "bubble bubble--own" : "bubble"} accessibilityLabel={`${item.isOwn ? "You" : other?.name ?? "They"}: ${item.body}`}>
                  <Text className={item.isOwn ? "bubble__text bubble__text--own" : "bubble__text"}>{item.body}</Text>
                  <Text className="bubble__time mt-1" style={item.isOwn ? { color: "rgba(255,255,255,0.7)", textAlign: "right" } : undefined}>{time(item.createdAt)}</Text>
                </View>
              )}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            />
          )}

          {error && status === "ready" && (
            <Pressable onPress={() => setError(null)} className="px-5 pb-2">
              <FormAlert message={error} />
            </Pressable>
          )}
          <View className="flex-row items-end gap-2 border-t border-cream-line bg-cream px-5 py-3">
            <TextInput className="reply" value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={colors.faint} multiline maxLength={MAX_LENGTH} accessibilityLabel="Message" />
            <Pressable onPress={send} disabled={!text.trim() || sending} className="reply__send" style={{ opacity: text.trim() && !sending ? 1 : 0.5 }} accessibilityRole="button" accessibilityLabel="Send message">
              {sending ? <ActivityIndicator color={colors.white} /> : <SymbolView name={{ ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" }} size={20} tintColor={colors.white} />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
