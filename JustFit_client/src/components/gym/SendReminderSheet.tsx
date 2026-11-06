import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";

import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymSheet } from "@/components/gym/GymSheet";
import { dueReminder, expiredReminder, invoice, sms, whatsapp } from "@/lib/gymContact";
import { gymApi, type GymInfo, type GymMember, type GymPayment, type GymSms, type SmsKind } from "@/lib/gymApi";
import { SMS_KIND_LABEL, membershipKind } from "@/lib/gymSms";
import { haptic } from "@/lib/haptics";
import { useSessionToken } from "@/lib/session";
import { useThemeColors } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";

export type ReminderKind = "due" | "expired" | "invoice";

const TITLE: Record<ReminderKind, string> = { due: "Send Due Reminder", expired: "Send Expired Reminder", invoice: "Send Invoice" };

// Send via (the member's ⋯ › Reminders): the message about to go, then three ways to send it:
// an SMS from justFit (1 credit, the registered template; after a confirm), the phone's own SMS
// app, or WhatsApp. An invoice has no registered SMS template, so it goes from the phone only.
export function SendReminderSheet({ kind, member, gym, payment, onClose }: { kind: ReminderKind; member: GymMember; gym: GymInfo; payment?: GymPayment; onClose: () => void }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const text = kind === "due" ? dueReminder(member, gym) : kind === "expired" ? expiredReminder(member, gym) : invoice(member, gym, payment);
  const smsKind: SmsKind | null = kind === "due" ? "due" : kind === "expired" ? membershipKind(member) : null;

  // justFit SMS: whether the server can send and the branch's credits, read when the sheet opens
  const [status, setStatus] = useState<GymSms | null | "loading" | "error">(smsKind ? "loading" : null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!smsKind) return;
    let live = true;
    (async () => {
      const answer = await gymApi.sms(await getToken().catch(() => null));
      if (live) setStatus(answer.ok ? answer.data : "error");
    })();
    return () => {
      live = false;
    };
  }, [getToken, smsKind]);

  const say = (title: string, body: string) => {
    if (Platform.OS === "web") globalThis.alert?.(`${title}\n\n${body}`);
    else Alert.alert(title, body);
  };
  const viaApp = typeof status === "object" && status !== null ? status : null;
  const appNote = !smsKind ? "Not available for invoices" : status === "loading" ? "Checking credits…" : status === "error" ? "Couldn't check credits" : !viaApp?.sending ? "SMS sending is off" : viaApp.credits < 1 ? "No credits left" : `1 credit · ${viaApp.credits} left`;
  const appReady = Boolean(viaApp?.sending && viaApp.credits > 0 && smsKind);

  const send = async () => {
    if (!smsKind || sending) return;
    setSending(true);
    setConfirming(false);
    const answer = await gymApi.memberSms(await getToken().catch(() => null), member.id, smsKind);
    setSending(false);
    if (answer.ok) {
      haptic.success();
      onClose();
      say("Reminder sent", `${SMS_KIND_LABEL[smsKind]} sent to ${member.name}. ${answer.data.credits} ${answer.data.credits === 1 ? "credit" : "credits"} left.`);
    } else say("Not sent", answer.error);
  };
  const fromPhone = (open: () => void) => {
    haptic.select();
    onClose();
    open();
  };

  const row = (label: string, note: string, icon: GymIconName, onPress: () => void, disabled = false) => (
    <Pressable key={label} onPress={onPress} disabled={disabled} className="gym-addrow" style={disabled ? { opacity: 0.45 } : undefined} accessibilityRole="button" accessibilityLabel={`${label}. ${note}`} accessibilityState={{ disabled }}>
      <View className="gym-addrow__icon"><GymIcon name={icon} size={18} color={colors.gymPrimary} /></View>
      <View className="min-w-0 flex-1">
        <Text className="gym-menu__label" numberOfLines={1}>{label}</Text>
        <Text className="gym-tx__meta" numberOfLines={1}>{note}</Text>
      </View>
      <GymIcon name="chevron-right" size={13} color={colors.gymInk} />
    </Pressable>
  );

  return (
    <GymSheet
      title={TITLE[kind]}
      subtitle={`To ${member.name}`}
      onClose={onClose}
      overlay={
        confirming && viaApp && smsKind ? (
          <ConfirmDialog
            title={`Send ${SMS_KIND_LABEL[smsKind].toLowerCase()}?`}
            rows={[["To", member.name], ["Cost", "1 credit"], ["Credits left", String(viaApp.credits)]]}
            editLabel="Cancel"
            confirmLabel="Send SMS"
            onEdit={() => setConfirming(false)}
            onConfirm={send}
          />
        ) : null
      }
    >
      <View className="gym-card" style={{ padding: 14 }}>
        <Text className="gym-section-title" style={{ marginBottom: 6 }}>Message</Text>
        <Text className="gym-menu__label" style={{ fontSize: 14, lineHeight: 21 }}>{text}</Text>
      </View>
      <View>
        <Text className="gym-section-title" style={{ marginBottom: 2 }}>Send via</Text>
        {row("SMS from justFit", appNote, "send", () => { haptic.select(); setConfirming(true); }, !appReady || sending)}
        {row("SMS app", "Your phone's Messages, no credits", "message-square-text", () => fromPhone(() => sms(member, text)))}
        {row("WhatsApp", "Opens WhatsApp with the message written", "message-circle", () => fromPhone(() => whatsapp(member, text)))}
      </View>
      {smsKind && viaApp?.sending ? <Text className="gym-tx__meta">An SMS from justFit uses the registered template, which may be worded a little differently.</Text> : null}
    </GymSheet>
  );
}
