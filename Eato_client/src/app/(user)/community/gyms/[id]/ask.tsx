import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { router, useLocalSearchParams } from "expo-router";

import { GymLogo } from "@/components/community/GymCard";
import { MyTeamReplies } from "@/components/owner/MyTeamReplies";
import { gyms, type Gym } from "@/lib/gyms";
import { useSessionToken } from "@/lib/session";
import { colors } from "@/theme";

type Turn = { id: number; from: "you" | "assistant"; text: string; contact?: string | null; failed?: boolean };

const SUGGESTIONS = ["Opening hours", "Membership prices", "Where are you?", "Who are the trainers?", "Upcoming events", "How do I join?"];
const MAX_QUESTION = 500;

// Ask the gym: a chat with the gym's assistant, the same agent as its WhatsApp. It answers from
// the gym's approved facts only; when it can't, it says so and shows the gym's contact. Each
// question is a separate paid AI call, limited per member by the server. A question it can't answer
// is kept for the gym's team; their replies show above the chat (MyTeamReplies).
export default function AskGym() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const getToken = useSessionToken();
  const [gym, setGym] = useState<Gym | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const nextId = useRef(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await gyms.get(await getToken(), id);
      if (!cancelled && result.ok) setGym(result.data.gym);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, getToken]);

  const ask = useCallback(async (question: string) => {
    const clean = question.trim().slice(0, MAX_QUESTION);
    if (!clean || asking) return;
    setText("");
    setTurns((current) => [...current, { id: nextId.current++, from: "you", text: clean }]);
    setAsking(true);
    const result = await gyms.ask(await getToken(), id, clean);
    setAsking(false);
    setTurns((current) => [
      ...current,
      result.ok
        ? { id: nextId.current++, from: "assistant", text: result.data.reply, contact: result.data.contact }
        : { id: nextId.current++, from: "assistant", text: result.error, failed: true },
    ]);
  }, [asking, getToken, id]);

  const name = gym?.name ?? "the gym";
  const contactUrl = (contact: string) => (contact.includes("@") ? `mailto:${contact}` : `tel:${contact.replace(/\s/g, "")}`);

  return (
    <View className="flex-1 bg-cream">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }}>
        <View className="screen-bar">
          <Pressable onPress={() => router.back()} hitSlop={12} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="screen-bar__title" numberOfLines={1}>Ask {name}</Text>
            <Text className="gym-card__meta">Automated assistant · answers from gym info</Text>
          </View>
          <View className="screen-bar__back" />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView ref={scroll} contentContainerStyle={{ padding: 20, gap: 12 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })} keyboardShouldPersistTaps="handled">
            <MyTeamReplies gymId={id} gymName={name} />
            <View className="flex-row items-center gap-1.5">
              <SymbolView name={{ ios: "sparkles", android: "smart_toy", web: "smart_toy" }} size={13} tintColor={colors.muted} />
              <Text className="ask__who">Assistant</Text>
            </View>
            <View className="ask__bubble">
              <Text className="ask__text">{`Hi! I'm ${name}'s assistant. Ask me anything about the gym: hours, prices, trainers, classes or joining. If I can't answer, I'll tell you how to reach the team.`}</Text>
            </View>
            {turns.length === 0 && (
              <View className="flex-row flex-wrap gap-2">
                {SUGGESTIONS.map((item) => (
                  <Pressable key={item} onPress={() => ask(item)} className="friend-chip" accessibilityRole="button" accessibilityLabel={`Ask: ${item}`}>
                    <Text className="friend-chip__label">{item}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {turns.map((turn) =>
              turn.from === "you" ? (
                <View key={turn.id} className="ask__bubble ask__bubble--you">
                  <Text className="ask__text ask__text--you">{turn.text}</Text>
                </View>
              ) : (
                <View key={turn.id} className={turn.failed ? "ask__bubble ask__bubble--failed" : "ask__bubble"}>
                  <Text className="ask__text">{turn.text}</Text>
                  {turn.contact && (
                    <Pressable onPress={() => turn.contact && Linking.openURL(contactUrl(turn.contact))} className="mt-2 flex-row items-center gap-1.5" accessibilityRole="link" accessibilityLabel={`Contact the gym: ${turn.contact}`}>
                      <SymbolView name={turn.contact.includes("@") ? { ios: "envelope", android: "mail", web: "mail" } : { ios: "phone", android: "call", web: "call" }} size={14} tintColor={colors.leaf} />
                      <Text className="gym-section__link">Contact the gym: {turn.contact}</Text>
                    </Pressable>
                  )}
                </View>
              ),
            )}
            {asking && (
              <View className="ask__bubble self-start">
                <ActivityIndicator color={colors.inkSoft} />
              </View>
            )}
          </ScrollView>

          <View className="comment-bar">
            {gym ? <GymLogo gym={gym} size={34} /> : <View style={{ width: 34 }} />}
            <TextInput
              className="comment-bar__input"
              value={text}
              onChangeText={setText}
              placeholder={`Ask about ${name}...`}
              placeholderTextColor={colors.faint}
              maxLength={MAX_QUESTION}
              onSubmitEditing={() => ask(text)}
              returnKeyType="send"
              editable={!asking}
              accessibilityLabel="Ask the gym"
            />
            <Pressable onPress={() => ask(text)} disabled={!text.trim() || asking} className={text.trim() && !asking ? "comment-bar__send" : "comment-bar__send comment-bar__send--disabled"} accessibilityRole="button" accessibilityLabel="Send question" accessibilityState={{ disabled: !text.trim() || asking }}>
              <SymbolView name={{ ios: "paperplane.fill", android: "send", web: "send" }} size={18} tintColor={colors.white} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
