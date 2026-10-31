import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useLocalSearchParams } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { CoachAvatar } from "@/components/coach/CoachAvatar";
import { coachPrompts, coaches, type CoachId } from "@/data/coach";
import { fonts } from "@/constants/fonts";
import { CHAT_MAX_TEXT } from "@/lib/coach";
import { useSessionToken } from "@/lib/session";
import { useCoachChatStore } from "@/store/coachChat";
import { colors } from "@/theme";

// A coach reply with its main points marked **like this** → runs of Text, the marked ones semibold.
// Only the coach's text is parsed; what the member typed is shown exactly as written.
function boldPoints(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/);
  if (parts.length === 1) return text;
  return parts.map((part, i) => (i % 2 ? <Text key={i} style={{ fontFamily: fonts.semibold }}>{part}</Text> : part));
}

// Chat with the AI coach. Opened from the Coach tab's ask box (with what was typed, or a
// suggestion chip, as `q`, sent straight away). Each message is one paid AI call, limited per
// member by the server; nothing is saved, so the chat lasts until the app closes or sign-out.
export default function CoachChat() {
  const { q, name, coach } = useLocalSearchParams<{ q?: string; name?: string; coach?: string }>();
  const getToken = useSessionToken();
  const turns = useCoachChatStore((state) => state.turns);
  const sending = useCoachChatStore((state) => state.sending);
  const send = useCoachChatStore((state) => state.send);
  const [text, setText] = useState("");
  const scroll = useRef<ScrollViewInstance>(null);
  const sentQuery = useRef(false);

  const coachName = name || "Your coach";
  // Only a known coach id draws an avatar (the param is just a hint from the Coach tab)
  const coachId = coaches.find((c) => c.id === coach)?.id as CoachId | undefined;

  // A question from the Coach tab is sent once, when the screen opens
  useEffect(() => {
    if (sentQuery.current || !q?.trim()) return;
    sentQuery.current = true;
    send(getToken, q);
  }, [q, send, getToken]);

  const submit = (value: string) => {
    if (!value.trim() || sending) return;
    setText("");
    send(getToken, value);
  };

  const canSend = text.trim().length > 0 && !sending;

  return (
    <View className="coach__page">
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right", "bottom"]}>
        <View className="flex-row items-center gap-3 px-4 pb-3 pt-2">
          <Pressable onPress={() => router.back()} className="coach__circle-btn" accessibilityRole="button" accessibilityLabel="Back">
            <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={18} tintColor={colors.forestInk} />
          </Pressable>
          {coachId && <CoachAvatar coach={coachId} size={40} />}
          <View className="flex-1">
            <Text className="coach__option-title" accessibilityRole="header" numberOfLines={1}>{coachName}</Text>
            <Text className="coach__hint">AI Coach · fitness guidance, not medical advice</Text>
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            ref={scroll}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
          >
            <View className="coach__bubble">
              <Text className="coach__bubble-text">{`Hi! I'm ${coachName}. Ask me anything about your workouts, your food or your progress. I know your plan and what you've logged today.`}</Text>
            </View>

            {turns.length === 0 && !q && (
              <View className="flex-row flex-wrap gap-2">
                {coachPrompts.map((prompt) => (
                  <Pressable key={prompt} onPress={() => submit(prompt)} className="coach__prompt" accessibilityRole="button" accessibilityLabel={`Ask: ${prompt}`}>
                    <Text className="coach__prompt-label">{prompt}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {turns.map((turn) => (
              <View
                key={turn.id}
                className={["coach__bubble", turn.role === "member" && "coach__bubble--me", turn.failed && "coach__bubble--failed"].filter(Boolean).join(" ")}
              >
                <Text className={turn.role === "member" ? "coach__bubble-text coach__bubble-text--me" : "coach__bubble-text"}>{turn.role === "member" ? turn.text : boldPoints(turn.text)}</Text>
              </View>
            ))}

            {sending && (
              <View className="coach__bubble" accessibilityLabel={`${coachName} is typing`}>
                <ActivityIndicator color={colors.primary} />
              </View>
            )}
          </ScrollView>

          <View className="px-4 pb-2 pt-2">
            <View className="coach__ask">
              <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={18} tintColor={colors.primary} />
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Ask your coach..."
                placeholderTextColor={colors.faint}
                maxLength={CHAT_MAX_TEXT}
                multiline
                onSubmitEditing={() => submit(text)}
                submitBehavior="submit"
                returnKeyType="send"
                accessibilityLabel="Message your coach"
                className="outline-none"
                style={{ flex: 1, maxHeight: 110, paddingVertical: 10, color: colors.forestInk, fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 }}
              />
              <Pressable
                onPress={() => submit(text)}
                disabled={!canSend}
                className={canSend ? "coach__send" : "coach__send coach__send--disabled"}
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: !canSend }}
              >
                <SymbolView name={{ ios: "paperplane.fill", android: "send", web: "send" }} size={18} tintColor={colors.onPrimary} />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
