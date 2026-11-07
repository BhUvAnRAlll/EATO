import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform, Text, TextInput, View } from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GymIcon } from "@/components/gym/GymIcon";
import { WhatsAppMark } from "@/components/gym/WhatsAppMark";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import type { GymIconName } from "@/constants/gymIcons";
import { planLabel, rupees } from "@/data/gymDashboard";
import { daysLeftText, dueReminder, expiredReminder, invoice, sms, whatsapp } from "@/lib/gymContact";
import { gymApi, type GymInfo, type GymMember, type GymPayment, type GymSms, type SmsKind } from "@/lib/gymApi";
import { memberStatus } from "@/lib/gymMember";
import { SMS_KIND_LABEL, membershipKind } from "@/lib/gymSms";
import { haptic } from "@/lib/haptics";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";

export type ReminderKind = "due" | "expired" | "invoice";
type Channel = "whatsapp" | "sms";
const MAX_CHARS = 300;

// Send Reminder (the user's design, 2026-11-07; from a card's bell and the ⋯ sheet's Reminders):
// the member's card (status, days left, payment due, plan), Send via as tiles you can combine
// (WhatsApp, SMS; Notification is coming soon: justFit has no push server), and the message, from
// Use Template (payment due, membership expiry or expired, the invoice when there is a payment)
// and editable up to 300 characters. Send Reminder: an SMS goes through justFit (1 credit, after a
// confirm) only while sending is on, credits are left and the message is still the registered
// template word for word; otherwise it opens the phone's Messages app with the text, as WhatsApp
// opens WhatsApp. Two phone apps open one after the other: the second when you come back.
export function SendReminderSheet({ kind, member, gym, payment, onClose, onSent }: { kind: ReminderKind; member: GymMember; gym: GymInfo; payment?: GymPayment; onClose: () => void; onSent?: () => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const templates: { id: ReminderKind; label: string; text: string }[] = [
    { id: "due", label: "Payment due", text: dueReminder(member, gym) },
    { id: "expired", label: member.daysLeft < 0 ? "Membership expired" : "Membership expiry", text: expiredReminder(member, gym) },
    ...(payment ? [{ id: "invoice" as const, label: "Invoice", text: invoice(member, gym, payment) }] : []),
  ];
  const start = templates.find((t) => t.id === kind) ?? templates[0];
  const [template, setTemplate] = useState<ReminderKind>(start.id);
  const [text, setText] = useState(start.text);
  const [picking, setPicking] = useState(false);
  const [channels, setChannels] = useState<Set<Channel>>(new Set(["whatsapp"]));
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  // The phone apps still to open, one each time the app comes back to the front
  const [queue, setQueue] = useState<(() => void)[]>([]);
  const afterConfirm = useRef<(() => void)[]>([]);

  // justFit SMS: whether the server can send and the branch's credits, read when the sheet opens
  const [status, setStatus] = useState<GymSms | "loading" | "error">("loading");
  useEffect(() => {
    let live = true;
    (async () => {
      const answer = await gymApi.sms(await getToken().catch(() => null));
      if (live) setStatus(answer.ok ? answer.data : "error");
    })();
    return () => {
      live = false;
    };
  }, [getToken]);

  const say = (title: string, body: string) => {
    if (Platform.OS === "web") globalThis.alert?.(`${title}\n\n${body}`);
    else Alert.alert(title, body);
  };
  const viaApp = typeof status === "object" ? status : null;
  const smsKind: SmsKind | null = template === "due" ? "due" : template === "expired" ? membershipKind(member) : null;
  const unedited = text === templates.find((t) => t.id === template)?.text;
  const viaJustfit = channels.has("sms") && Boolean(viaApp?.sending && viaApp.credits > 0) && smsKind !== null && unedited;
  const smsNote = !channels.has("sms") ? null
    : status === "loading" ? "Checking justFit SMS credits…"
    : viaJustfit && viaApp ? `Via justFit: 1 credit · ${viaApp.credits} left`
    : !smsKind ? "An invoice goes from your phone's Messages app"
    : !unedited ? "An edited message goes from your phone's Messages app"
    : status === "error" ? "Couldn't check credits: opens your phone's Messages app"
    : !viaApp?.sending ? "SMS sending is off: opens your phone's Messages app"
    : "No credits left: opens your phone's Messages app";

  const toggle = (channel: Channel) => {
    haptic.select();
    setChannels((current) => {
      const next = new Set(current);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  };
  const pickTemplate = (id: ReminderKind) => {
    haptic.select();
    setTemplate(id);
    setText(templates.find((t) => t.id === id)?.text ?? "");
    setPicking(false);
  };

  const finish = () => {
    haptic.success();
    onSent?.();
    onClose();
  };
  // Open the first phone app now; the rest follow as the app comes back to the front
  const openApps = (apps: (() => void)[]) => {
    const [first, ...rest] = apps;
    if (!first) return finish();
    first();
    if (rest.length === 0) return finish();
    setQueue(rest);
  };
  useEffect(() => {
    if (queue.length === 0) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const [next, ...rest] = queue;
      next();
      setQueue(rest);
      if (rest.length === 0) finish();
    });
    return () => sub.remove();
    // finish only closes the sheet; it never changes while the queue is waiting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  const send = () => {
    if (channels.size === 0 || !text.trim() || sending) return;
    const message = text.trim();
    const apps = [
      ...(channels.has("whatsapp") ? [() => whatsapp(member, message)] : []),
      ...(channels.has("sms") && !viaJustfit ? [() => sms(member, message)] : []),
    ];
    if (viaJustfit) {
      afterConfirm.current = apps;
      setConfirming(true);
      return;
    }
    openApps(apps);
  };
  const sendViaJustfit = async () => {
    if (!smsKind || sending) return;
    setSending(true);
    setConfirming(false);
    const answer = await gymApi.memberSms(await getToken().catch(() => null), member.id, smsKind);
    setSending(false);
    if (!answer.ok) return say("Not sent", answer.error);
    say("Reminder sent", `${SMS_KIND_LABEL[smsKind]} sent to ${member.name}. ${answer.data.credits} ${answer.data.credits === 1 ? "credit" : "credits"} left.`);
    openApps(afterConfirm.current);
  };

  const state = memberStatus(member);
  const tone = state.id === "expired" ? { color: colors.gymDanger, ground: colors.gymDangerSoft }
    : state.id === "active" ? { color: colors.gymSuccess, ground: colors.gymSuccessSoft }
    : { color: colors.gymWarning, ground: colors.gymWarningSoft };

  const tile = (channel: Channel | "notification", label: string, icon: GymIconName | "whatsapp", iconColor: string, iconGround: string) => {
    const soon = channel === "notification";
    const on = !soon && channels.has(channel);
    return (
      <PressableScale
        key={channel}
        onPress={() => { if (!soon) toggle(channel); }}
        disabled={soon}
        className={on ? "gym-remind__tile gym-remind__tile--on" : "gym-remind__tile"}
        style={soon ? { opacity: 0.55 } : undefined}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on, disabled: soon }}
        accessibilityLabel={soon ? "Notification, coming soon" : `Send by ${label}`}
      >
        <View className="flex-row items-start justify-between">
          <View className="gym-remind__tile-icon" style={{ backgroundColor: iconGround }}>
            {icon === "whatsapp" ? <WhatsAppMark size={28} /> : <GymIcon name={icon} size={24} color={iconColor} />}
          </View>
          <View className={on ? "gym-remind__tick gym-remind__tick--on" : "gym-remind__tick"}>
            {on && <GymIcon name="check" size={13} color={colors.white} />}
          </View>
        </View>
        <Text className="gym-remind__tile-label" numberOfLines={1}>{label}</Text>
        {soon && <Text className="gym-tx__meta" numberOfLines={1}>Coming soon</Text>}
      </PressableScale>
    );
  };

  return (
    <GymSheet
      onClose={onClose}
      overlay={
        confirming && viaApp && smsKind ? (
          <ConfirmDialog
            title={`Send ${SMS_KIND_LABEL[smsKind].toLowerCase()}?`}
            rows={[["To", member.name], ["Cost", "1 credit"], ["Credits left", String(viaApp.credits)]]}
            editLabel="Cancel"
            confirmLabel="Send SMS"
            onEdit={() => setConfirming(false)}
            onConfirm={sendViaJustfit}
          />
        ) : null
      }
    >
      <View className="flex-row items-center" style={{ gap: 14 }}>
        <View className="gym-remind__icon">
          <GymIcon name="bell" size={30} color={colors.gymPrimary} />
        </View>
        <View className="min-w-0 flex-1" style={{ gap: 2 }}>
          <Text className="gym-sheet__title" accessibilityRole="header">Send Reminder</Text>
          <Text className="gym-sheet__subtitle">Notify member about payment or membership</Text>
        </View>
        <PressableScale onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close Send Reminder">
          <GymIcon name="x" size={22} color={colors.gymInk} />
        </PressableScale>
      </View>

      <View className="gym-remind__member">
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <View className="gym-mcard__avatar" style={{ width: 56, height: 56 }}>
            <GymIcon name="user" size={26} color={colors.gymMuted} />
            <MemberPhotoImage url={member.photoUrl} />
          </View>
          <View className="min-w-0 flex-1" style={{ gap: 4 }}>
            <Text className="gym-mcard__name" numberOfLines={1}>{member.name}</Text>
            <View className="flex-row items-center" style={{ gap: 6 }}>
              <GymIcon name="id-card" size={16} color={colors.gymFaint} />
              <Text className="gym-mcard__code" numberOfLines={1} style={{ flexShrink: 1 }}>{member.code}</Text>
            </View>
          </View>
          <View className="gym-mcard__status" style={{ backgroundColor: tone.ground }} accessibilityLabel={`Status: ${state.label}`}>
            <View className="gym-mcard__dot" style={{ backgroundColor: tone.color }} />
            <Text className="gym-mcard__status-label" style={{ color: tone.color }}>{state.label}</Text>
          </View>
        </View>
        <View className="gym-remind__stats">
          <View className="gym-remind__stat">
            <View className="gym-remind__stat-icon" style={member.daysLeft < 0 ? { backgroundColor: colors.gymDangerSoft } : undefined}><GymIcon name="calendar" size={18} color={member.daysLeft < 0 ? colors.gymDanger : colors.gymPrimary} /></View>
            <View className="min-w-0 flex-1">
              <Text className="gym-remind__stat-label" numberOfLines={1}>Membership</Text>
              <Text className="gym-remind__stat-value" numberOfLines={1} style={member.daysLeft < 0 ? { color: colors.gymDanger } : undefined}>{daysLeftText(member.daysLeft)}</Text>
            </View>
          </View>
          <View className="gym-remind__stat">
            <View className="gym-remind__stat-icon" style={member.due > 0 ? { backgroundColor: colors.gymDangerSoft } : undefined}><GymIcon name="credit-card" size={18} color={member.due > 0 ? colors.gymDanger : colors.gymFaint} /></View>
            <View className="min-w-0 flex-1">
              <Text className="gym-remind__stat-label" numberOfLines={1}>Payment Due</Text>
              <Text className="gym-remind__stat-value" numberOfLines={1} style={{ color: member.due > 0 ? colors.gymDanger : colors.gymFaint }}>{member.due > 0 ? rupees(member.due) : "None"}</Text>
            </View>
          </View>
          <View className="gym-remind__stat">
            <View className="gym-remind__stat-icon"><GymIcon name="layers" size={18} color={colors.gymPrimary} /></View>
            <View className="min-w-0 flex-1">
              <Text className="gym-remind__stat-label" numberOfLines={1}>Plan</Text>
              <Text className="gym-remind__stat-value" numberOfLines={1}>{planLabel(member.planLength.duration, member.planLength.unit)}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <View className="flex-row items-end justify-between" style={{ gap: 10 }}>
          <Text className="gym-remind__heading">Send via</Text>
          <Text className="gym-tx__meta">Select one or more channels</Text>
        </View>
        <View className="flex-row" style={{ gap: 10 }}>
          {tile("whatsapp", "WhatsApp", "whatsapp", colors.gymSuccess, colors.gymSuccessSoft)}
          {tile("sms", "SMS", "message-square-text", colors.gymPrimary, colors.gymPrimarySoft)}
          {tile("notification", "Notification", "bell", colors.gymPrimary, colors.gymPrimarySoft)}
        </View>
        {smsNote && <Text className="gym-tx__meta">{smsNote}</Text>}
      </View>

      <View style={{ gap: 10 }}>
        <View className="flex-row items-center justify-between" style={{ gap: 10 }}>
          <Text className="gym-remind__heading">Message</Text>
          <PressableScale onPress={() => { haptic.select(); setPicking((v) => !v); }} hitSlop={6} className="flex-row items-center" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Use Template" accessibilityState={{ expanded: picking }}>
            <GymIcon name="file-text" size={18} color={colors.gymPrimary} />
            <Text className="gym-remind__template">Use Template</Text>
            <GymIcon name="chevron-down" size={16} color={colors.gymPrimary} />
          </PressableScale>
        </View>
        {picking && (
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {templates.map((t) => {
              const selected = t.id === template;
              return (
                <PressableScale key={t.id} onPress={() => pickTemplate(t.id)} className={selected ? "gym-kind gym-kind--selected" : "gym-kind"} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`Template: ${t.label}`}>
                  <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>{t.label}</Text>
                </PressableScale>
              );
            })}
          </View>
        )}
        <View className="gym-remind__box">
          <TextInput
            value={text}
            onChangeText={(v) => setText(v.slice(0, MAX_CHARS))}
            multiline
            maxLength={MAX_CHARS}
            textAlignVertical="top"
            style={{ minHeight: 96, fontFamily: "Poppins-Regular", fontSize: 15, lineHeight: 22, color: colors.gymInk, padding: 0 }}
            accessibilityLabel="Message"
          />
          <Text className="gym-remind__count">{`${text.length} / ${MAX_CHARS}`}</Text>
        </View>
      </View>

      <GymPrimaryButton label="Send Reminder" icon="send" ready={channels.size > 0 && text.trim().length > 0} busy={sending} onPress={send} />
    </GymSheet>
  );
}
