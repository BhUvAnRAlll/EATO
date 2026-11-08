import { useCallback, useRef, useState } from "react";
import { Alert, Platform, Switch, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymSheet } from "@/components/gym/GymSheet";
import { gymApi, type SmsGroupId, type SmsKind, type SmsLog, type SmsSendResult } from "@/lib/gymApi";
import { haptic } from "@/lib/haptics";
import { SMS_KIND_LABEL } from "@/lib/gymSms";
import { useSessionToken } from "@/lib/session";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors, type Palette } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";

type Page = "home" | "auto" | "manual" | "logs";

const say = (title: string, text: string) => {
  if (Platform.OS === "web") globalThis.alert?.(`${title}\n\n${text}`);
  else Alert.alert(title, text);
};

// Each reminder's soft colour and icon (the user's Auto Reminders design)
const reminderLook = (colors: Palette): Record<SmsKind, { box: string; tint: string; icon: GymIconName }> => ({
  expiry: { box: colors.gymTileBlueBox, tint: colors.gymTileBlueIcon, icon: "clock" },
  expired: { box: colors.gymDangerSoft, tint: colors.gymDanger, icon: "calendar-x" },
  due: { box: colors.gymTileOrangeBox, tint: colors.gymTileOrangeIcon, icon: "wallet" },
  birthday: { box: colors.gymTilePurpleBox, tint: colors.gymTilePurpleIcon, icon: "cake" },
});

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// Send Bulk SMS (the user's designs): the branch's credits (1 credit = 1 SMS; Buy Credits says
// how to get more, as justFit takes no payments), then Quick Actions: Auto Reminders (switches
// with a preview of each message), Manual Send (one group of members, confirmed with its cost)
// and Message Logs. One sheet whose pages swap, with a back arrow on the inner ones.
export function BulkSmsSheet({ onClose }: { onClose: () => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const { result, retry, set } = useGymData(gymApi.sms);
  const [page, setPage] = useState<Page>("home");
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null);
  const [group, setGroup] = useState<SmsGroupId | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SmsSendResult | null>(null);
  const data = result.state === "ready" ? result.data : null;
  const look = reminderLook(colors);
  const back = () => { setPage("home"); setSent(null); setGroup(null); };

  // A switch: shown at once, put back if the server refuses
  const toggle = async (kind: SmsKind, on: boolean) => {
    if (!data) return;
    haptic.select();
    const before = data;
    set({ ...data, reminders: data.reminders.map((r) => (r.kind === kind ? { ...r, on } : r)) });
    const answer = await gymApi.smsSettings(await getToken().catch(() => null), { [kind]: on });
    if (answer.ok) set(answer.data);
    else {
      set(before);
      say("Couldn't change that", answer.error);
    }
  };

  // A ref, not state: two taps on Send in the same frame would start two sends (QA 2026-11-07)
  const sendingRef = useRef(false);
  const send = async () => {
    if (!group || sendingRef.current) return;
    sendingRef.current = true;
    setConfirming(false);
    setSending(true);
    const answer = await gymApi.smsSend(await getToken().catch(() => null), group);
    sendingRef.current = false;
    setSending(false);
    if (!answer.ok) return say("Not sent", answer.error);
    haptic.success();
    setSent(answer.data);
    if (data) set({ ...data, credits: answer.data.credits });
  };

  const credits = data?.credits ?? 0;
  const chosen = data?.groups.find((g) => g.id === group) ?? null;
  const chosenPreview = chosen ? data?.reminders.find((r) => r.kind === chosen.kind)?.preview : null;

  const offNote = data && !data.sending && (
    <View className="gym-warning">
      <GymIcon name="triangle-alert" size={18} color={colors.gymWarning} />
      <Text className="gym-warning__text">{"SMS sending isn't switched on for justFit yet. Reminders from the member list open your phone's SMS app instead."}</Text>
    </View>
  );

  const titles: Record<Page, [string, string]> = {
    home: ["Send Bulk SMS", "Send bulk SMS within India."],
    auto: ["Auto Reminders", "Enable automated SMS reminders for your members."],
    manual: ["Manual Send", "Send SMS to specific member groups."],
    logs: ["Message Logs", "SMS sent to your members from this branch."],
  };

  const overlay = preview ? (
    <Animated.View entering={FadeIn.duration(140).reduceMotion(ReduceMotion.System)} className="gym-confirm" accessibilityViewIsModal>
      <View className="gym-confirm__card">
        <Text className="gym-confirm__title" accessibilityRole="header">{preview.title}</Text>
        <Text className="gym-reminder__when" style={{ color: colors.gymInk }}>{preview.text}</Text>
        <Text className="gym-tx__meta">{"The member's name and details are filled in for each message."}</Text>
        <View className="flex-row justify-end">
          <PressableScale onPress={() => setPreview(null)} className="gym-confirm__action" accessibilityRole="button" accessibilityLabel="Close preview">
            <Text className="gym-confirm__action-label">Close</Text>
          </PressableScale>
        </View>
      </View>
    </Animated.View>
  ) : confirming && chosen ? (
    <ConfirmDialog
      title="Send these SMS?"
      rows={[["Group", chosen.label], ["Members", String(chosen.count)], ["Credits used", `Up to ${chosen.count}`], ["Credits left", String(credits)]]}
      editLabel="Cancel"
      confirmLabel="Send"
      onEdit={() => setConfirming(false)}
      onConfirm={send}
    />
  ) : null;

  return (
    <GymSheet title={titles[page][0]} subtitle={titles[page][1]} onClose={onClose} onBack={page === "home" ? undefined : back} overlay={overlay} onDismissOverlay={() => setConfirming(false)}>
      {result.state === "loading" && <GymLoading label="Loading SMS" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}

      {data && page === "home" && (
        <>
          {offNote}
          <View className="gym-credits">
            <View className="flex-1" style={{ gap: 2 }}>
              <Text className="gym-credits__label">Available Credits</Text>
              <View className="flex-row items-center" style={{ gap: 10 }} accessible accessibilityLabel={`${credits} credits`}>
                <GymIcon name="message-square-text" size={20} color={colors.white} />
                <Text className="gym-credits__value">{credits.toLocaleString("en-IN")}</Text>
              </View>
              <Text className="gym-credits__note">1 Credit = 1 SMS</Text>
            </View>
            <PressableScale onPress={() => say("Buy Credits", "SMS credits are added by the justFit team. Contact them to top up this branch.")} className="gym-credits__buy" accessibilityRole="button" accessibilityLabel="Buy credits">
              <GymIcon name="circle-plus" size={18} color={colors.white} />
              <Text className="gym-credits__buy-label">Buy Credits</Text>
            </PressableScale>
          </View>
          <View className="gym-section-rule">
            <Text className="gym-section-rule__label">QUICK ACTIONS</Text>
            <View className="gym-section-rule__line" />
          </View>
          <View style={{ gap: 14 }}>
            {(
              [
                { id: "auto", title: "Auto Reminders", text: "Manage scheduled SMS reminders", bg: colors.gymTileBlue, box: colors.gymTileBlueBox, ink: colors.gymPrimaryText, icon: "bell" },
                { id: "manual", title: "Manual Send", text: "Send SMS to specific member groups", bg: colors.gymTilePurple, box: colors.gymTilePurpleBox, ink: colors.gymTilePurpleIcon, icon: "send" },
                { id: "logs", title: "Message Logs", text: "View sent SMS history", bg: colors.gymTileGreen, box: colors.gymTileGreenBox, ink: colors.gymSuccess, icon: "history" },
              ] as { id: Page; title: string; text: string; bg: string; box: string; ink: string; icon: GymIconName }[]
            ).map((q) => (
              <PressableScale key={q.id} onPress={() => { haptic.select(); setPage(q.id); }} className="gym-quick" style={{ backgroundColor: q.bg }} accessibilityRole="button" accessibilityLabel={`${q.title}. ${q.text}`}>
                <View className="gym-quick__icon" style={{ backgroundColor: q.box }}>
                  <GymIcon name={q.icon} size={22} color={q.ink} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="gym-quick__title" style={{ color: q.ink }} numberOfLines={1}>{q.title}</Text>
                  <Text className="gym-quick__text" style={{ color: colors.gymMuted }} numberOfLines={2}>{q.text}</Text>
                </View>
                <GymIcon name="chevron-right" size={14} color={q.ink} />
              </PressableScale>
            ))}
          </View>
        </>
      )}

      {data && page === "auto" && (
        <>
          <View className="gym-warning">
            <GymIcon name="triangle-alert" size={18} color={colors.gymWarning} />
            <Text className="gym-warning__text">Make sure you have enough SMS credits. Reminders will be skipped if your balance runs out.</Text>
          </View>
          {offNote}
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <GymIcon name="info" size={14} color={colors.gymFaint} />
            <Text className="gym-tx__meta" style={{ color: colors.gymFaint }}>{`1 Credit = 1 SMS · ${credits.toLocaleString("en-IN")} left`}</Text>
          </View>
          <View>
            {data.reminders.map((r, i) => (
              <View key={r.kind} className="gym-reminder" style={i > 0 ? { borderTopWidth: 1, borderColor: colors.gymLine } : undefined}>
                <View className="gym-reminder__icon" style={{ backgroundColor: look[r.kind].box }}>
                  <GymIcon name={look[r.kind].icon} size={22} color={look[r.kind].tint} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="gym-reminder__title" numberOfLines={2}>{r.title}</Text>
                  <Text className="gym-reminder__when">
                    {`${r.when} · `}
                    <Text onPress={() => setPreview({ title: r.title, text: r.preview })} style={{ color: look[r.kind].tint, fontFamily: "Poppins-Medium" }} accessibilityRole="link" accessibilityLabel={`Preview the ${r.title}`}>Preview</Text>
                  </Text>
                </View>
                <Switch
                  value={r.on}
                  onValueChange={(on) => toggle(r.kind, on)}
                  trackColor={{ false: colors.gymLine, true: colors.gymPrimary }}
                  thumbColor={colors.white}
                  ios_backgroundColor={colors.gymLine}
                  accessibilityLabel={`${r.title}, ${r.when}`}
                />
              </View>
            ))}
          </View>
        </>
      )}

      {data && page === "manual" && (
        sent ? (
          <View style={{ gap: 14 }}>
            <GymEmpty
              icon="circle-check"
              title={`${sent.sent} SMS sent`}
              text={[sent.failed > 0 ? `${sent.failed} couldn't be sent (their credits were given back).` : "", sent.skipped > 0 ? `${sent.skipped} skipped: not enough credits.` : "", `${sent.credits.toLocaleString("en-IN")} credits left.`].filter(Boolean).join(" ")}
            />
            <GymPrimaryButton label="Done" ready onPress={back} />
          </View>
        ) : (
          <>
            {offNote}
            <Text className="gym-field__label">Who should get it?</Text>
            <View style={{ gap: 10 }}>
              {data.groups.map((g) => {
                const selected = g.id === group;
                return (
                  <PressableScale key={g.id} onPress={() => { haptic.select(); setGroup(g.id); }} className="gym-card flex-row items-center" style={{ gap: 12, padding: 10, ...(selected ? { borderColor: colors.gymPrimary, backgroundColor: colors.gymPrimarySoft } : null) }} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${g.label}, ${g.count} members, ${SMS_KIND_LABEL[g.kind]}`}>
                    <View className="gym-reminder__icon" style={{ width: 40, height: 40, backgroundColor: look[g.kind].box }}>
                      <GymIcon name={look[g.kind].icon} size={18} color={look[g.kind].tint} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className={selected ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"} numberOfLines={1}>{g.label}</Text>
                      <Text className="gym-tx__meta" numberOfLines={1}>{SMS_KIND_LABEL[g.kind]}</Text>
                    </View>
                    <Text className="gym-tx__amount" style={{ color: colors.gymInk, paddingRight: 6 }}>{g.count}</Text>
                  </PressableScale>
                );
              })}
            </View>
            {chosen && chosenPreview && (
              <View className="gym-card" style={{ padding: 14, gap: 6, backgroundColor: colors.gymBar }}>
                <Text className="gym-field__label">Message preview</Text>
                <Text className="gym-reminder__when" style={{ color: colors.gymInk }}>{chosenPreview}</Text>
              </View>
            )}
            {chosen && (
              <Text className="gym-tx__meta">
                {chosen.count === 0 ? "Nobody in this group has a mobile number on file." : `Uses ${chosen.count} ${chosen.count === 1 ? "credit" : "credits"}. You have ${credits.toLocaleString("en-IN")}.${credits < chosen.count ? " Members past your balance are skipped." : ""}`}
              </Text>
            )}
            <GymPrimaryButton
              label={chosen && chosen.count > 0 ? `Send to ${chosen.count} ${chosen.count === 1 ? "member" : "members"}` : "Send SMS"}
              ready={Boolean(data.sending && chosen && chosen.count > 0 && credits > 0)}
              busy={sending}
              onPress={() => setConfirming(true)}
            />
            {data.sending && credits === 0 && <Text className="gym-tx__meta" style={{ color: colors.gymDanger }}>You have no SMS credits left. Ask the justFit team to add more.</Text>}
          </>
        )
      )}

      {data && page === "logs" && <SmsLogs />}
    </GymSheet>
  );
}

// Message Logs: newest first, 30 at a time
function SmsLogs() {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const load = useCallback((token: string | null) => gymApi.smsLogs(token, null), []);
  const { result, retry } = useGymData(load);
  const [more, setMore] = useState<{ logs: SmsLog[]; next: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  if (result.state === "loading") return <GymLoading label="Loading messages" />;
  if (result.state === "failed") return <GymError error={result.error} onRetry={retry} />;
  const logs = [...result.data.logs, ...(more?.logs ?? [])];
  const next = more ? more.next : result.data.next;
  if (logs.length === 0) return <GymEmpty icon="history" title="No SMS sent yet" text="Reminders and messages you send show here." />;

  const loadMore = async () => {
    if (!next || loading) return;
    setLoading(true);
    const answer = await gymApi.smsLogs(await getToken().catch(() => null), next);
    setLoading(false);
    if (answer.ok) setMore({ logs: [...(more?.logs ?? []), ...answer.data.logs], next: answer.data.next });
    else say("Couldn't load more", answer.error);
  };
  const status = { sent: { label: "Sent", ink: colors.gymSuccess, bg: colors.gymSuccessSoft }, failed: { label: "Failed", ink: colors.gymDanger, bg: colors.gymDangerSoft }, sending: { label: "Sending", ink: colors.gymWarning, bg: colors.gymWarningSoft } };

  return (
    <View style={{ gap: 10 }}>
      {logs.map((l) => (
        <View key={l.id} className="gym-card" style={{ padding: 14, gap: 6 }} accessible accessibilityLabel={`${SMS_KIND_LABEL[l.kind]} to ${l.name}, ${status[l.status].label}, ${when(l.at)}`}>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Text className="gym-tx__name flex-1" numberOfLines={1}>{l.name}</Text>
            <View className="gym-tag" style={{ backgroundColor: status[l.status].bg }}>
              <Text className="gym-tag__label" style={{ color: status[l.status].ink }}>{status[l.status].label}</Text>
            </View>
          </View>
          <Text className="gym-tx__meta" numberOfLines={1}>{`${SMS_KIND_LABEL[l.kind]} · ${l.source === "auto" ? "Auto" : "Manual"} · ${when(l.at)} · ${l.code}`}</Text>
          <Text className="gym-tx__meta" style={{ color: colors.gymInkSoft }} numberOfLines={3}>{l.text}</Text>
        </View>
      ))}
      {next && <GymPrimaryButton label="Load older messages" ready busy={loading} onPress={loadMore} />}
    </View>
  );
}
