import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView } from "@/components/SymbolView";

import { Avatar } from "@/components/community/Avatar";
import { ConfirmSheet } from "@/components/community/ConfirmSheet";
import { FormAlert } from "@/components/FormAlert";
import { audienceLabel, noticeAudiences, noticeTargets, noticeTemplates } from "@/data/owner";
import { timeAgo } from "@/lib/community";
import { gyms, type GymMember } from "@/lib/gyms";
import { owner, type NoticeAudience, type NoticeTarget, type SentNotice } from "@/lib/owner";
import { useSessionToken } from "@/lib/session";
import { useOwnerStore } from "@/store/owner";
import { colors } from "@/theme";

const TITLE_MAX = 60;
const BODY_MAX = 240;
type Audience = Exclude<NoticeAudience, "test">;

const input = { borderRadius: 14, borderWidth: 1, borderColor: colors.creamLine, backgroundColor: colors.white, paddingHorizontal: 14, fontSize: 15, color: colors.forestInk } as const;

// Notify members: a title and message (or a template), what tapping it opens, who gets it (each
// group with a live count; pending and suspended people are never included), a preview, then
// Test (only to you) or Send (after a confirmation). Sent notices are listed below.
export default function OwnerNotify() {
  const getToken = useSessionToken();
  const gymId = useOwnerStore((state) => state.gymId);
  const summary = useOwnerStore((state) => state.summary);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<NoticeTarget>("gym");
  const [audience, setAudience] = useState<Audience>("everyone");
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [members, setMembers] = useState<GymMember[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [sent, setSent] = useState<SentNotice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const gymName = summary?.gym.name ?? "Your gym";

  const load = useCallback(async () => {
    if (!gymId) return;
    const token = await getToken();
    const [a, s] = await Promise.all([owner.audiences(token, gymId), owner.notices(token, gymId)]);
    if (a.ok) setCounts(a.data.counts);
    if (s.ok) setSent(s.data.notices);
    if (!a.ok || !s.ok) setError((!a.ok ? a.error : !s.ok ? s.error : null) ?? null);
  }, [gymId, getToken]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  // The member list for Choose people, loaded the first time it's picked
  useEffect(() => {
    if (audience !== "chosen" || members !== null || !gymId) return;
    let cancelled = false;
    (async () => {
      const result = await gyms.members(await getToken(), gymId, "active");
      if (cancelled) return;
      if (result.ok) setMembers(result.data.members.filter((m) => !m.isMe));
      else setError(result.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [audience, members, gymId, getToken]);

  const reach = audience === "chosen" ? chosen.length : (counts?.[audience] ?? 0);
  const ready = title.trim() !== "" && body.trim() !== "";

  const send = async (test: boolean) => {
    if (!gymId || busy || !ready) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await owner.sendNotice(await getToken(), gymId, {
      title: title.trim(), body: body.trim(), target, ...(test ? { test: true } : { audience, ...(audience === "chosen" ? { userIds: chosen } : {}) }),
    });
    setBusy(false);
    setConfirming(false);
    if (!result.ok) return setError(result.error);
    if (test) return setNotice("Test sent to you. Check your notifications.");
    setNotice(`Sent to ${result.data.notice.reach} ${result.data.notice.reach === 1 ? "person" : "people"}.`);
    setTitle("");
    setBody("");
    setChosen([]);
    load();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.cream }}>
      <View className="screen-bar">
        <Pressable onPress={() => router.back()} className="screen-bar__back" accessibilityRole="button" accessibilityLabel="Back">
          <SymbolView name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }} size={20} tintColor={colors.ink} />
        </Pressable>
        <Text className="screen-bar__title">Notify members</Text>
        <View className="screen-bar__spacer" />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          {error && <FormAlert message={error} />}
          {notice && <Text className="friend-row__note" style={{ color: colors.ink }} accessibilityLiveRegion="polite">{notice}</Text>}

          <Text className="owner-stat__label">Start from a template</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {noticeTemplates.map((t) => (
              <Pressable key={t.label} onPress={() => { setTitle(t.title); setBody(t.body); setTarget(t.target); }} className="friend-chip" accessibilityRole="button" accessibilityLabel={`Template: ${t.label}`}>
                <Text className="friend-chip__label">{t.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text className="owner-stat__label">Title *</Text>
          <TextInput value={title} onChangeText={(v) => setTitle(v.slice(0, TITLE_MAX))} placeholder="Closing early today" placeholderTextColor={colors.faint} accessibilityLabel="Title" style={{ ...input, height: 48 }} />
          <Text className="owner-stat__label">{title.length}/{TITLE_MAX}</Text>

          <Text className="owner-stat__label">Message *</Text>
          <TextInput value={body} onChangeText={(v) => setBody(v.slice(0, BODY_MAX))} placeholder="What members should know" placeholderTextColor={colors.faint} multiline accessibilityLabel="Message" style={{ ...input, minHeight: 100, paddingTop: 12, textAlignVertical: "top" }} />
          <Text className="owner-stat__label">{body.length}/{BODY_MAX}</Text>

          <Text className="owner-stat__label">Tapping it opens</Text>
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            {noticeTargets.map((t) => {
              const on = target === t.key;
              return (
                <Pressable key={t.key} onPress={() => setTarget(t.key)} className={on ? "friend-chip friend-chip--selected" : "friend-chip"} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`Opens ${t.label}`}>
                  <Text className={on ? "friend-chip__label friend-chip__label--selected" : "friend-chip__label"}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text className="owner-stat__label">Send to</Text>
          <View accessibilityRole="radiogroup">
            {noticeAudiences.map((a, i) => {
              const on = audience === a.key;
              const count = a.key === "chosen" ? null : counts?.[a.key];
              return (
                <Pressable
                  key={a.key}
                  onPress={() => setAudience(a.key)}
                  className={`friend-row ${i === 0 ? "friend-row--first" : ""} ${i === noticeAudiences.length - 1 ? "friend-row--last" : ""}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${a.label}${count !== null && count !== undefined ? ` (${count})` : ""}`}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="friend-row__name">{a.label}{count !== null && count !== undefined ? ` (${count})` : ""}</Text>
                    <Text className="friend-row__note">{a.note}</Text>
                  </View>
                  <SymbolView name={on ? { ios: "largecircle.fill.circle", android: "radio_button_checked", web: "radio_button_checked" } : { ios: "circle", android: "radio_button_unchecked", web: "radio_button_unchecked" }} size={22} tintColor={on ? colors.ink : colors.faint} />
                </Pressable>
              );
            })}
          </View>

          {audience === "chosen" && (
            <View className="owner-card" style={{ padding: 0, gap: 0 }}>
              {members === null ? (
                <ActivityIndicator color={colors.forest} className="my-4" />
              ) : members.length === 0 ? (
                <Text className="friend-row__note p-4">No other members yet.</Text>
              ) : (
                members.map((m, i) => {
                  const on = chosen.includes(m.member.id);
                  return (
                    <Pressable
                      key={m.member.id}
                      onPress={() => setChosen((list) => (on ? list.filter((id) => id !== m.member.id) : [...list, m.member.id]))}
                      className="flex-row items-center gap-3 px-4 py-3"
                      style={i > 0 ? { borderTopWidth: 1, borderColor: colors.creamLine } : undefined}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`Send to ${m.member.name}`}
                    >
                      <Avatar member={m.member} size={34} />
                      <Text className="friend-row__name min-w-0 flex-1" numberOfLines={1}>{m.member.name}</Text>
                      <SymbolView name={on ? { ios: "checkmark.square.fill", android: "check_box", web: "check_box" } : { ios: "square", android: "check_box_outline_blank", web: "check_box_outline_blank" }} size={22} tintColor={on ? colors.ink : colors.faint} />
                    </Pressable>
                  );
                })
              )}
            </View>
          )}

          <Text className="owner-stat__label">Preview</Text>
          <View className="owner-card flex-row items-center gap-3" accessibilityLabel={`Preview: ${gymName}: ${title || "Your title"}. ${body || "Your message appears here."}`}>
            <View className="gym-logo" style={{ width: 40, height: 40, borderRadius: 12 }}>
              <Text className="gym-logo__initials" style={{ fontSize: 14 }}>{gymName.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")}</Text>
            </View>
            <View className="min-w-0 flex-1">
              <Text className="friend-row__name" numberOfLines={1}>{gymName}: {title || "Your title"}</Text>
              <Text className="friend-row__note" numberOfLines={3}>{body || "Your message appears here."}</Text>
            </View>
          </View>
          <Text className="friend-row__note">Reaches {reach} {reach === 1 ? "person" : "people"}, in their JustFit notifications. Pending and suspended members never get it.</Text>

          <Text className="gym-section__title mt-2">Sent ({sent?.length ?? 0})</Text>
          {sent === null ? (
            <ActivityIndicator color={colors.forest} />
          ) : sent.length === 0 ? (
            <View className="owner-card"><Text className="friend-row__note">Nothing sent yet.</Text></View>
          ) : (
            sent.map((n, i) => (
              <View key={n.id} className={`friend-row ${i === 0 ? "friend-row--first" : ""} ${i === sent.length - 1 ? "friend-row--last" : ""}`}>
                <View className="owner-icon owner-icon--neutral">
                  <SymbolView name={n.kind === "reminder" ? { ios: "calendar.badge.clock", android: "event_repeat", web: "event_repeat" } : { ios: "bell", android: "notifications", web: "notifications" }} size={16} tintColor={colors.ink} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="friend-row__name" numberOfLines={1}>{n.title}</Text>
                  <Text className="friend-row__note" numberOfLines={2}>{n.body}</Text>
                  <Text className="friend-row__note">{audienceLabel(n.audience)} · {n.reach} {n.reach === 1 ? "person" : "people"} · {timeAgo(n.sentAt)}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
        <View className="flex-row gap-3 px-5 py-3" style={{ borderTopWidth: 1, borderColor: colors.creamLine }}>
          <Pressable onPress={() => send(true)} disabled={!ready || busy} className="btn-outline" style={{ flex: 1, opacity: ready ? 1 : 0.5 }} accessibilityRole="button" accessibilityLabel="Send a test to yourself">
            <Text className="btn-outline__label">Test</Text>
          </Pressable>
          <Pressable onPress={() => setConfirming(true)} disabled={!ready || busy || reach === 0} className="btn-forest" style={{ flex: 2, height: 52, opacity: ready && reach > 0 ? 1 : 0.5 }} accessibilityRole="button" accessibilityLabel={`Send to ${reach}`}>
            <Text className="btn-forest__label">Send to {reach}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <ConfirmSheet
        visible={confirming}
        title={`Send to ${reach} ${reach === 1 ? "person" : "people"}?`}
        text={`“${title.trim()}” goes to ${audienceLabel(audience).toLowerCase()} now. You can't unsend it.`}
        confirmLabel="Send"
        busy={busy}
        onConfirm={() => send(false)}
        onCancel={() => setConfirming(false)}
      />
    </SafeAreaView>
  );
}
