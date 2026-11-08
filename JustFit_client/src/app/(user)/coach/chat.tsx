import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import Animated, { FadeIn, FadeInDown, ReduceMotion } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { SymbolView } from "@/components/SymbolView";
import { ChatProposals } from "@/components/coach/ChatProposals";
import { CoachAvatar } from "@/components/coach/CoachAvatar";
import { MicButton } from "@/components/coach/MicButton";
import { RevealText } from "@/components/motion/RevealText";
import { TypingDots } from "@/components/motion/TypingDots";
import { coachPrompts, coaches, type CoachId } from "@/data/coach";
import { fonts } from "@/constants/fonts";
import { CHAT_MAX_TEXT } from "@/lib/coach";
import { todayIso } from "@/lib/macro";
import { useSessionToken } from "@/lib/session";
import { useNewKeys } from "@/lib/useNewKeys";
import { useVoiceInput } from "@/lib/useVoiceInput";
import { mergeTranscript } from "@/lib/voiceInputRules";
import { proposalsFor, useCoachChatStore } from "@/store/coachChat";
import { useThemeColors } from "@/theme";

// A bubble that's new on screen: the member's rises in from the ask box, the coach's fades up
const SENT_IN = FadeInDown.duration(320).reduceMotion(ReduceMotion.System);
const REPLY_IN = FadeInDown.duration(260).reduceMotion(ReduceMotion.System);
const TYPING_IN = FadeIn.duration(200).reduceMotion(ReduceMotion.System);
const CARDS_IN = FadeInDown.duration(320).reduceMotion(ReduceMotion.System);

// A turn's identity on screen: a sent message keeps its clientId once it comes back saved
const keyOf = (turn: { id: string; role: string; clientId?: string }) => (turn.role === "member" && turn.clientId ? turn.clientId : turn.id);
// A link param may arrive as an array (the same key twice): the first value is the one meant
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
// Back to where the chat was opened from; opened cold (a link), the Coach tab
const back = () => (router.canGoBack() ? router.back() : router.replace("/coach"));

// Chat with the AI coach. Opened from the Coach tab's ask box (with what was typed, or a
// suggestion chip, as `q`, sent once the saved conversation is shown), or from the Macro tab's
// coach tip (its question as `draft`, in the box but not sent). Each message is one paid AI
// call, limited per member by the server; the server saves the conversation for 7 days, so it is
// still here after leaving the chat or restarting the app. A failed message can be tapped to send
// it again. A reply that recommends a change to the plan carries Apply cards (components/coach/ChatProposals).
// The mic beside Send (lib/useVoiceInput) turns speech into text, in English, Hindi or Kannada:
// with the phone's own recogniser, or, for a language it lacks, a short clip the server
// transcribes; the words go into the box for the member to read, fix and send.
export default function CoachChat() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ q?: string | string[]; draft?: string | string[]; name?: string | string[]; coach?: string | string[] }>();
  const q = one(params.q);
  const draft = one(params.draft);
  const name = one(params.name);
  const coach = one(params.coach);
  const getToken = useSessionToken();
  const turns = useCoachChatStore((state) => state.turns);
  const sending = useCoachChatStore((state) => state.sending);
  const status = useCoachChatStore((state) => state.status);
  const loadError = useCoachChatStore((state) => state.loadError);
  const load = useCoachChatStore((state) => state.load);
  const shownCoach = useCoachChatStore((state) => state.coach);
  const clear = useCoachChatStore((state) => state.clear);
  const send = useCoachChatStore((state) => state.send);
  const retry = useCoachChatStore((state) => state.retry);
  // `draft` (the Macro tab's coach tip) puts a question in the box without sending it
  const [text, setText] = useState(() => (draft ?? "").slice(0, CHAT_MAX_TEXT));
  const scroll = useRef<ScrollViewInstance>(null);
  const sentQuery = useRef(false);
  // Today as the screen has it, read again each time the chat comes into view: a reply's Apply
  // cards are only offered on the day it was written, so yesterday's go once midnight has passed
  const [today, setToday] = useState(todayIso);
  useFocusEffect(
    useCallback(() => {
      setToday(todayIso());
    }, []),
  );
  // The keyboard rising pushes the list up: the newest lines follow it instead of sliding under the box
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => scroll.current?.scrollToEnd({ animated: true }));
    return () => sub.remove();
  }, []);
  // What arrived after the saved conversation was shown animates in; a reply that just came back
  // is written in word by word, and its Apply cards follow once it's whole
  const added = useNewKeys(turns.map(keyOf), status === "ready");
  const [written, setWritten] = useState<Set<string>>(() => new Set());
  // Voice: what was in the box when the mic was tapped stays, the words heard follow it. A
  // session that ends with nothing heard (cancelled, or silence) leaves the box as it was.
  const voice = useVoiceInput();
  const typedBefore = useRef("");
  const wasListening = useRef(false);
  useEffect(() => {
    if (voice.listening) wasListening.current = true;
    if (voice.listening || voice.transcript) {
      setText(mergeTranscript(typedBefore.current, voice.transcript, CHAT_MAX_TEXT));
    } else if (wasListening.current) {
      wasListening.current = false;
      setText(typedBefore.current);
    }
  }, [voice.listening, voice.transcript]);
  const toggleMic = () => {
    if (voice.listening) {
      voice.stop();
      return;
    }
    typedBefore.current = text;
    voice.start();
  };

  const coachName = name || "Your coach";
  // Only a known coach id draws an avatar (the param is just a hint from the Coach tab)
  const coachId = coaches.find((c) => c.id === coach)?.id as CoachId | undefined;

  // The saved conversation, read the first time the chat opens in this app session
  useEffect(() => {
    if (status === "idle") load(getToken);
  }, [status, load, getToken]);

  // The coach changed since it was read (e.g. in the intake's Edit): theirs is a new conversation.
  // Read again once at most, so a stale hint can't keep reloading it.
  const reread = useRef(false);
  useEffect(() => {
    if (reread.current || status !== "ready" || !coachId || !shownCoach || shownCoach === coachId) return;
    reread.current = true;
    clear();
  }, [status, coachId, shownCoach, clear]);

  // A question from the Coach tab is sent once, after the conversation so far is on screen
  useEffect(() => {
    if (sentQuery.current || !q?.trim() || status !== "ready") return;
    sentQuery.current = true;
    send(getToken, q);
  }, [q, send, getToken, status]);

  const submit = (value: string) => {
    if (!value.trim() || sending || status !== "ready") return;
    setText("");
    send(getToken, value);
  };

  const canSend = text.trim().length > 0 && !sending && status === "ready" && !voice.listening && !voice.transcribing;
  const micAvailable = voice.supported && status === "ready";
  const chosenLanguage = voice.languages.find((l) => l.code === voice.language);

  return (
    <View className="coach__page">
      <StatusBar style="auto" />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right", "bottom"]}>
        <View className="flex-row items-center gap-3 px-4 pb-3 pt-2">
          <Pressable onPress={back} className="coach__circle-btn" accessibilityRole="button" accessibilityLabel="Back">
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
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          >
            <View className="coach__bubble">
              <Text className="coach__bubble-text">{`Hi! I'm ${coachName}. Ask me anything about your workouts, your food or your progress. I know your plan and what you've logged today.`}</Text>
            </View>

            {status === "loading" && (
              <View className="coach__bubble" accessibilityLabel="Loading your chat">
                <ActivityIndicator color={colors.leaf} />
              </View>
            )}

            {status === "error" && (
              <>
                <View className="coach__bubble coach__bubble--failed">
                  <Text className="coach__bubble-text">{loadError ?? "Your chat couldn't be loaded."}</Text>
                </View>
                <View className="flex-row flex-wrap gap-2">
                  <Pressable onPress={() => load(getToken)} className="coach__prompt" accessibilityRole="button" accessibilityLabel="Load your chat again">
                    <Text className="coach__prompt-label">Try again</Text>
                  </Pressable>
                </View>
              </>
            )}

            {status === "ready" && turns.length === 0 && !q && (
              <View className="flex-row flex-wrap gap-2">
                {coachPrompts.map((prompt) => (
                  <Pressable key={prompt} onPress={() => submit(prompt)} className="coach__prompt" accessibilityRole="button" accessibilityLabel={`Ask: ${prompt}`}>
                    <Text className="coach__prompt-label">{prompt}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {turns.map((turn) => {
              const proposals = proposalsFor(turn, today);
              return (
                <Fragment key={keyOf(turn)}>
                  {turn.role === "member" && turn.failed ? (
                    // Not sent: tapping it sends it again
                    <Pressable onPress={() => retry(getToken, turn.id)} disabled={sending} accessibilityRole="button" accessibilityLabel={`Not sent. Send again: ${turn.text}`}>
                      <View className="coach__bubble coach__bubble--me coach__bubble--failed">
                        <Text className="coach__bubble-text coach__bubble-text--me">{turn.text}</Text>
                      </View>
                      <Text className="coach__hint mt-1 self-end">Not sent · Tap to try again</Text>
                    </Pressable>
                  ) : (
                    <Animated.View
                      entering={added.has(keyOf(turn)) ? (turn.role === "member" ? SENT_IN : REPLY_IN) : undefined}
                      className={["coach__bubble", turn.role === "member" && "coach__bubble--me", turn.failed && "coach__bubble--failed"].filter(Boolean).join(" ")}
                    >
                      {turn.role === "member" ? (
                        <Text className="coach__bubble-text coach__bubble-text--me">{turn.text}</Text>
                      ) : (
                        <RevealText
                          className="coach__bubble-text"
                          text={turn.text}
                          animate={added.has(keyOf(turn)) && !turn.failed}
                          onDone={() => setWritten((done) => (done.has(turn.id) ? done : new Set(done).add(turn.id)))}
                        />
                      )}
                    </Animated.View>
                  )}
                  {/* Plan changes the reply recommends, each with an Apply button; for a new reply
                      they slide in once it has been written out */}
                  {proposals && (!added.has(keyOf(turn)) || written.has(turn.id)) && (
                    <Animated.View entering={added.has(keyOf(turn)) ? CARDS_IN : undefined}>
                      <ChatProposals turnId={turn.id} proposals={proposals} />
                    </Animated.View>
                  )}
                </Fragment>
              );
            })}

            {sending && (
              <Animated.View entering={TYPING_IN} className="coach__bubble" accessibilityLabel={`${coachName} is typing`}>
                <TypingDots />
              </Animated.View>
            )}
          </ScrollView>

          <View className="px-4 pb-2 pt-2">
            {(voice.listening || voice.transcribing) && (
              <Animated.View entering={TYPING_IN} className="coach__listen" accessibilityLiveRegion="polite">
                <View className="coach__listen-dot" />
                <Text className="coach__listen-text">
                  {voice.transcribing ? "Working out what you said…" : voice.engine === "server" ? `Listening in ${chosenLanguage?.native ?? ""} · sent to justFit to transcribe` : "Listening… tap the mic to stop"}
                </Text>
                {voice.listening && voice.languages.length > 1 && (
                  <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                    {voice.languages.map((language) => {
                      const on = language.code === voice.language;
                      return (
                        <Pressable
                          key={language.code}
                          onPress={() => voice.setLanguage(language.code)}
                          className={on ? "coach__lang coach__lang--on" : "coach__lang"}
                          accessibilityRole="radio"
                          accessibilityLabel={`Speak in ${language.label}`}
                          accessibilityState={{ checked: on }}
                        >
                          <Text className="coach__lang-label">{language.native}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </Animated.View>
            )}
            <View className="coach__ask">
              <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={18} tintColor={colors.leaf} />
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={voice.listening ? "Speak now…" : voice.transcribing ? "One moment…" : "Ask your coach..."}
                placeholderTextColor={colors.faint}
                maxLength={CHAT_MAX_TEXT}
                multiline
                editable={!voice.listening && !voice.transcribing}
                onSubmitEditing={() => submit(text)}
                submitBehavior="submit"
                returnKeyType="send"
                accessibilityLabel="Message your coach"
                className="outline-none"
                style={{ flex: 1, maxHeight: 110, paddingVertical: 10, color: colors.forestInk, fontFamily: fonts.regular, fontSize: 15, lineHeight: 20 }}
              />
              {voice.supported && <MicButton listening={voice.listening} busy={voice.transcribing} disabled={!micAvailable || sending} onPress={toggleMic} />}
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
            {voice.error && (
              <View className="flex-row flex-wrap items-center" accessibilityRole="alert" style={{ gap: 8 }}>
                <Text className="coach__voice-error">{voice.error.message}</Text>
                {voice.error.settings && Platform.OS !== "web" && (
                  <Pressable onPress={voice.openSettings} accessibilityRole="button" accessibilityLabel="Open Settings" hitSlop={8}>
                    <Text className="coach__voice-link">Open Settings</Text>
                  </Pressable>
                )}
                <Pressable onPress={voice.clearError} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8}>
                  <Text className="coach__voice-link">Dismiss</Text>
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
