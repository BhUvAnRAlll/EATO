import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";

import { Avatar } from "@/components/community/Avatar";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { EmptyState } from "@/components/community/CommunityStates";
import { FormAlert } from "@/components/FormAlert";
import { timeAgo } from "@/lib/community";
import { owner, type CustomAnswer, type TeamQuestion } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

const input = { borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 14, fontSize: 15, color: colors.forestInk } as const;

// One open question with its reply box (and Dismiss)
function OpenQuestion({ q, busy, onReply, onDismiss }: { q: TeamQuestion; busy: boolean; onReply: (text: string) => void; onDismiss: () => void }) {
  const [text, setText] = useState("");
  return (
    <View className="owner-card" accessibilityLabel={`Question from ${q.asker.name}`}>
      <View className="flex-row items-center gap-3">
        <Avatar member={q.asker} size={40} />
        <View className="min-w-0 flex-1">
          <Text className="friend-row__name" numberOfLines={1}>{q.asker.name}</Text>
          <Text className="friend-row__note">Asked {timeAgo(q.askedAt)}</Text>
        </View>
        <View className="owner-badge owner-badge--warning"><Text className="owner-badge__label">Open</Text></View>
      </View>
      <View className="owner-quote"><Text className="friend-row__note" style={{ color: colors.ink, fontSize: 15 }}>“{q.question}”</Text></View>
      <Text className="owner-stat__label">Your reply</Text>
      <TextInput value={text} onChangeText={(v) => setText(v.slice(0, 1000))} multiline placeholder="They'll see this in their chat with the assistant." placeholderTextColor={colors.faint}
        accessibilityLabel={`Reply to ${q.asker.name}`} style={{ ...input, minHeight: 88, paddingTop: 12, textAlignVertical: "top" }} />
      <View className="flex-row gap-2">
        <Pressable onPress={onDismiss} disabled={busy} className="owner-quick" style={{ height: 44 }} accessibilityRole="button" accessibilityLabel={`Dismiss ${q.asker.name}'s question`}>
          <Text className="owner-quick__label">Dismiss</Text>
        </Pressable>
        <Pressable onPress={() => onReply(text.trim())} disabled={busy || !text.trim()} className="owner-quick owner-quick--primary flex-1" style={{ height: 44, opacity: text.trim() && !busy ? 1 : 0.45 }} accessibilityRole="button" accessibilityLabel={`Send reply to ${q.asker.name}`}>
          {busy ? <ActivityIndicator color={colors.white} /> : <Text className="owner-quick__label owner-quick__label--primary">Send reply</Text>}
        </Pressable>
      </View>
    </View>
  );
}

// Gym assistant (owner side): questions the assistant passed to the team, answered here (the reply
// appears in the asker's chat and bell), and custom answers the assistant uses before anything else.
export default function OwnerAssistant() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const summary = useOwnerStore((state) => state.summary);
  const loadSummary = useOwnerStore((state) => state.loadSummary);
  const [view, setView] = useState<"questions" | "answers">("questions");
  const [open, setOpen] = useState<TeamQuestion[] | null>(null);
  const [closed, setClosed] = useState<TeamQuestion[]>([]);
  const [faqs, setFaqs] = useState<CustomAnswer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string | null; question: string; answer: string } | null>(null);
  const [deleting, setDeleting] = useState<CustomAnswer | null>(null);
  const memberApp = summary?.gym.as !== "platform";

  const load = useCallback(async () => {
    if (!gymId) return;
    const token = await getToken();
    const [q, f] = await Promise.all([owner.questions(token, gymId), owner.faqs(token, gymId)]);
    if (q.ok) {
      setOpen(q.data.open);
      setClosed(q.data.closed);
    }
    if (f.ok) setFaqs(f.data.faqs);
    setError(!q.ok ? q.error : !f.ok ? f.error : null);
  }, [gymId, getToken]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const done = async (message: string) => {
    setNotice(message);
    await load();
    loadSummary(await getToken());
  };

  const reply = async (q: TeamQuestion, answer: string) => {
    if (!gymId || !answer) return;
    setBusyId(q.id);
    const result = await owner.replyQuestion(await getToken(), gymId, q.id, answer);
    setBusyId(null);
    if (!result.ok) return setError(result.error);
    await done(`Reply sent to ${q.asker.name}. They'll see it in their chat.`);
  };

  const dismiss = async (q: TeamQuestion) => {
    if (!gymId) return;
    setBusyId(q.id);
    const result = await owner.dismissQuestion(await getToken(), gymId, q.id);
    setBusyId(null);
    if (!result.ok) return setError(result.error);
    await done("Question dismissed.");
  };

  const saveFaq = async () => {
    if (!gymId || !draft) return;
    setBusyId("faq");
    const token = await getToken();
    const body = { question: draft.question.trim(), answer: draft.answer.trim() };
    const result = draft.id ? await owner.updateFaq(token, gymId, draft.id, body) : await owner.createFaq(token, gymId, body);
    setBusyId(null);
    if (!result.ok) return setError(result.error);
    setDraft(null);
    await done(draft.id ? "Custom answer saved." : "Custom answer added. The assistant uses it first.");
  };

  const toggleFaq = async (faq: CustomAnswer, active: boolean) => {
    if (!gymId) return;
    setFaqs((list) => list?.map((f) => (f.id === faq.id ? { ...f, active } : f)) ?? list);
    const result = await owner.updateFaq(await getToken(), gymId, faq.id, { active });
    if (!result.ok) {
      setError(result.error);
      load();
    }
  };

  const removeFaq = async () => {
    if (!gymId || !deleting) return;
    setBusyId("faq");
    const result = await owner.deleteFaq(await getToken(), gymId, deleting.id);
    setBusyId(null);
    setDeleting(null);
    if (!result.ok) return setError(result.error);
    await done("Custom answer deleted.");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }}>
      <View className="screen-bar">
        <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
        </Pressable>
        <Text className="screen-bar__title">Gym assistant</Text>
        {memberApp && gymId ? (
          <Pressable onPress={() => router.push({ pathname: "/community/gyms/[id]/ask", params: { id: gymId } })} className="screen-bar__back" style={{ width: 56 }} accessibilityRole="button" accessibilityLabel="Try the assistant">
            <Text className="gym-section__link">Try it</Text>
          </Pressable>
        ) : (
          <View className="screen-bar__back" />
        )}
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
          <Text className="owner__subtitle">The assistant answers from your gym profile (hours, prices, facilities, trainers, events). Add custom answers for anything else; it uses them first.</Text>
          <View className="segment" accessibilityRole="tablist">
            {(["questions", "answers"] as const).map((key) => {
              const on = view === key;
              const label = key === "questions" ? `Questions (${open?.length ?? 0} open)` : `Custom answers (${faqs?.length ?? 0})`;
              return (
                <Pressable key={key} onPress={() => setView(key)} className={on ? "segment__item segment__item--active" : "segment__item"} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}>
                  <Text className={on ? "segment__label segment__label--active" : "segment__label"} numberOfLines={1}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          {error && <Pressable onPress={() => setError(null)}><FormAlert message={error} /></Pressable>}
          {notice && <Text className="friend-row__note" style={{ color: colors.ink }} accessibilityLiveRegion="polite">{notice}</Text>}

          {open === null || faqs === null ? (
            <ActivityIndicator color={colors.forest} />
          ) : view === "questions" ? (
            <>
              {open.length === 0 && closed.length === 0 && (
                <EmptyState icon={{ ios: "bubble.left.and.text.bubble.right", android: "smart_toy", web: "smart_toy" }} title="No questions yet" text="When the assistant can't answer something, the question comes here for you." />
              )}
              {open.map((q) => <OpenQuestion key={q.id} q={q} busy={busyId === q.id} onReply={(text) => reply(q, text)} onDismiss={() => dismiss(q)} />)}
              {closed.map((q) => (
                <View key={q.id} className="owner-card" accessibilityLabel={`${q.status === "answered" ? "Answered" : "Dismissed"} question from ${q.asker.name}`}>
                  <View className="flex-row items-center gap-3">
                    <Avatar member={q.asker} size={40} />
                    <View className="min-w-0 flex-1">
                      <Text className="friend-row__name" numberOfLines={1}>{q.asker.name}</Text>
                      <Text className="friend-row__note">Asked {timeAgo(q.askedAt)}</Text>
                    </View>
                    <View className={q.status === "answered" ? "owner-badge owner-badge--accent" : "owner-badge"}>
                      <Text className="owner-badge__label">{q.status === "answered" ? "Answered" : "Dismissed"}</Text>
                    </View>
                  </View>
                  <View className="owner-quote"><Text className="friend-row__note" style={{ color: colors.ink, fontSize: 15 }}>“{q.question}”</Text></View>
                  {q.answer && <Text className="friend-row__note" style={{ color: colors.ink }}><Text style={{ fontWeight: "700" }}>{q.answeredBy ? `${q.answeredBy} replied: ` : "You replied: "}</Text>{q.answer}</Text>}
                </View>
              ))}
            </>
          ) : (
            <>
              {draft ? (
                <View className="owner-card">
                  <Text className="owner-stat__label">Question</Text>
                  <TextInput value={draft.question} onChangeText={(v) => setDraft({ ...draft, question: v.slice(0, 200) })} placeholder="Do you have a student discount?" placeholderTextColor={colors.faint} accessibilityLabel="Custom answer question" style={{ ...input, height: 48 }} />
                  <Text className="owner-stat__label">Answer</Text>
                  <TextInput value={draft.answer} onChangeText={(v) => setDraft({ ...draft, answer: v.slice(0, 1000) })} multiline placeholder="Students get 20% off with a valid college ID." placeholderTextColor={colors.faint} accessibilityLabel="Custom answer text" style={{ ...input, minHeight: 88, paddingTop: 12, textAlignVertical: "top" }} />
                  <View className="flex-row gap-2">
                    <Pressable onPress={() => setDraft(null)} className="owner-quick flex-1" style={{ height: 44 }} accessibilityRole="button" accessibilityLabel="Cancel">
                      <Text className="owner-quick__label">Cancel</Text>
                    </Pressable>
                    <Pressable onPress={saveFaq} disabled={busyId === "faq" || !draft.question.trim() || !draft.answer.trim()} className="owner-quick owner-quick--primary flex-1" style={{ height: 44, opacity: draft.question.trim() && draft.answer.trim() ? 1 : 0.45 }} accessibilityRole="button" accessibilityLabel="Save custom answer">
                      <Text className="owner-quick__label owner-quick__label--primary">Save</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable onPress={() => setDraft({ id: null, question: "", answer: "" })} className="btn-forest" style={{ height: 48 }} accessibilityRole="button" accessibilityLabel="Add a custom answer">
                  <Text className="btn-forest__label">Add a custom answer</Text>
                </Pressable>
              )}
              {faqs.length === 0 && !draft && <EmptyState icon={{ ios: "text.bubble", android: "chat", web: "chat" }} title="No custom answers" text="Add answers to questions members often ask, like discounts or guest passes." />}
              {faqs.map((faq) => (
                <View key={faq.id} className="owner-card" accessibilityLabel={`Custom answer: ${faq.question}`}>
                  <View className="flex-row items-start gap-3">
                    <View className="min-w-0 flex-1 gap-1">
                      <Text className="friend-row__name">{faq.question}</Text>
                      <Text className="friend-row__note" style={{ color: colors.ink }}>{faq.answer}</Text>
                    </View>
                    <Switch value={faq.active} onValueChange={(v) => toggleFaq(faq, v)} trackColor={{ true: colors.leaf, false: colors.creamTab }} accessibilityLabel={`Use: ${faq.question}`} />
                  </View>
                  <View className="flex-row gap-2">
                    <Pressable onPress={() => setDraft({ id: faq.id, question: faq.question, answer: faq.answer })} className="owner-quick flex-1" style={{ height: 40 }} accessibilityRole="button" accessibilityLabel={`Edit ${faq.question}`}>
                      <Text className="owner-quick__label">Edit</Text>
                    </Pressable>
                    <Pressable onPress={() => setDeleting(faq)} className="owner-quick flex-1" style={{ height: 40 }} accessibilityRole="button" accessibilityLabel={`Delete ${faq.question}`}>
                      <Text className="owner-quick__label" style={{ color: colors.danger }}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <ConfirmSheet visible={deleting !== null} title="Delete this custom answer?" text="The assistant stops using it at once." confirmLabel="Delete" busy={busyId === "faq"} onConfirm={removeFaq} onCancel={() => setDeleting(null)} />
    </SafeAreaView>
  );
}
