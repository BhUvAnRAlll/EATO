import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { CollectDueSheet } from "@/components/gym/CollectDueSheet";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymSheet } from "@/components/gym/GymSheet";
import { initialsOf, planLabel, planStart, rupees, shortDate } from "@/data/gymDashboard";
import { comingSoon } from "@/lib/gymPortal";
import { call, daysLeftText, dueReminder, email, expiredReminder, invoice, sms, whatsapp } from "@/lib/gymContact";
import type { GymInfo, GymMember, GymMemberDetail, GymPayment } from "@/lib/gymApi";
import { useThemeColors } from "@/theme";
import type { Icon } from "@/types/profile";

type Row = { label: string; icon: Icon; tone?: "danger"; onPress: () => void };

// A member's options (the user's designs): their card on the portal's gradient (Call, SMS,
// WhatsApp, Email; the plan and PT with their dates), Biometric, Reminders (due, expired, invoice:
// WhatsApp with the message written), Membership (Collect Payment Due, Renew Member, Edit
// Membership, Pause Membership, Transaction History) and Sales (Renew PT)
export function MemberActionsSheet({ member, payments, gym, onClose, onChanged }: { member: GymMember; payments?: GymPayment[]; gym: GymInfo; onClose: () => void; onChanged: (detail: GymMemberDetail) => void }) {
  const colors = useThemeColors();
  const [collecting, setCollecting] = useState(false);
  const go = (href: Href) => { onClose(); router.push(href); };
  const id = String(member.id);
  const start = planStart(member.expiresOn, member.planLength.duration, member.planLength.unit);

  const reminders: Row[] = [
    ...(member.due > 0 ? [{ label: "Send Due Reminder", icon: { ios: "bell.badge", android: "notifications_active", web: "notifications_active" }, onPress: () => whatsapp(member, dueReminder(member, gym)) } as Row] : []),
    { label: "Send Expired Reminder", icon: { ios: "exclamationmark.bubble", android: "sms_failed", web: "sms_failed" }, tone: "danger", onPress: () => whatsapp(member, expiredReminder(member, gym)) },
    { label: "Send Invoice", icon: { ios: "doc.text", android: "receipt_long", web: "receipt_long" }, onPress: () => whatsapp(member, invoice(member, gym, payments?.[0])) },
  ];
  const membership: Row[] = [
    ...(member.due > 0 ? [{ label: `Collect Payment Due : ${rupees(member.due)}`, icon: { ios: "creditcard", android: "credit_card", web: "credit_card" }, tone: "danger", onPress: () => setCollecting(true) } as Row] : []),
    { label: "Renew Member", icon: { ios: "arrow.clockwise.circle", android: "autorenew", web: "autorenew" }, onPress: () => go({ pathname: "/gym/members/[id]/renew", params: { id } }) },
    { label: "Edit Membership", icon: { ios: "square.and.pencil", android: "edit_note", web: "edit_note" }, onPress: () => go({ pathname: "/gym/members/[id]", params: { id } }) },
    { label: "Pause Membership", icon: { ios: "pause.circle", android: "pause_circle", web: "pause_circle" }, onPress: () => comingSoon("Pause Membership") },
    { label: "Transaction History", icon: { ios: "clock.arrow.circlepath", android: "history", web: "history" }, onPress: () => go({ pathname: "/gym/members/[id]", params: { id } }) },
  ];
  const sales: Row[] = [{ label: member.pt ? "Renew PT" : "Add PT", icon: { ios: "arrow.triangle.2.circlepath", android: "sync", web: "sync" }, onPress: () => go({ pathname: "/gym/members/[id]/pt", params: { id } }) }];

  const section = (title: string, rows: Row[]) => (
    <View>
      <Text className="gym-section-title" style={{ marginBottom: 2 }}>{title}</Text>
      {rows.map((row) => (
        <Pressable key={row.label} onPress={row.onPress} className="gym-addrow" accessibilityRole="button" accessibilityLabel={row.label}>
          <View className="gym-addrow__icon" style={row.tone === "danger" ? { backgroundColor: colors.gymDangerSoft } : undefined}>
            <SymbolView name={row.icon} size={18} tintColor={row.tone === "danger" ? colors.gymDanger : colors.gymPrimary} />
          </View>
          <Text className="gym-menu__label flex-1" numberOfLines={1}>{row.label}</Text>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }} size={13} tintColor={colors.gymInk} />
        </Pressable>
      ))}
    </View>
  );
  const contact = (label: string, icon: Icon, onPress: () => void) => (
    <PressableScale key={label} onPress={onPress} className="gym-hero-btn" accessibilityRole="button" accessibilityLabel={`${label} ${member.name}`}>
      <SymbolView name={icon} size={18} tintColor={colors.white} />
    </PressableScale>
  );
  const period = (title: string, note: string, from: string, until: string, tag?: string) => (
    <View className="flex-row items-center" style={{ gap: 10 }} accessible accessibilityLabel={`${title}, ${note}, ${shortDate(from)} to ${shortDate(until)}`}>
      <View className="min-w-0 flex-1" style={{ gap: 2 }}>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          {tag ? <View className="gym-hero-tag"><Text className="gym-hero-tag__label">{tag}</Text></View> : null}
          <Text className="gym-hero__plan" numberOfLines={1}>{title}</Text>
        </View>
        <Text className="gym-hero__note">{note}</Text>
      </View>
      <View className="gym-hero-date"><Text className="gym-hero-date__label">{shortDate(from)}</Text></View>
      <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={12} tintColor={colors.white} />
      <View className="gym-hero-date"><Text className="gym-hero-date__label">{shortDate(until)}</Text></View>
    </View>
  );
  const ptDays = member.pt ? Math.round((Date.parse(`${member.pt.until}T00:00:00Z`) - Date.parse(`${member.expiresOn}T00:00:00Z`)) / 86400000) + member.daysLeft : 0;

  return (
    <>
      <GymSheet onClose={onClose}>
        <View className="gym-member-hero">
          <GradientFill radius={24} />
          <View className="flex-row items-center" style={{ gap: 12 }}>
            <View className="gym-member-hero__avatar"><Text className="gym-member-photo__initials" style={{ fontSize: 20 }}>{initialsOf(member.name)}</Text></View>
            <View className="min-w-0 flex-1">
              <Text className="gym-member-hero__name" numberOfLines={1}>{member.name}</Text>
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <SymbolView name={{ ios: "ticket", android: "confirmation_number", web: "confirmation_number" }} size={13} tintColor={colors.white} />
                <Text className="gym-hero__note">{member.code}</Text>
              </View>
            </View>
          </View>
          <View className="flex-row" style={{ gap: 8 }}>
            {contact("Call", { ios: "phone.fill", android: "call", web: "call" }, () => call(member))}
            {contact("SMS", { ios: "message.fill", android: "sms", web: "sms" }, () => sms(member))}
            {contact("WhatsApp", { ios: "bubble.left.and.bubble.right.fill", android: "forum", web: "forum" }, () => whatsapp(member))}
            {contact("Email", { ios: "envelope.fill", android: "mail", web: "mail" }, () => email(member, `${gym.name} membership`))}
          </View>
          <View className="gym-member-hero__line" />
          {period(planLabel(member.planLength.duration, member.planLength.unit), daysLeftText(member.daysLeft), start, member.expiresOn)}
          {member.pt && (
            <>
              <View className="gym-member-hero__line" />
              {period(member.pt.label, member.pt.active ? daysLeftText(ptDays) : "PT ended", member.pt.from, member.pt.until, "PT")}
            </>
          )}
        </View>
        <Pressable onPress={() => comingSoon("Biometric")} className="gym-card flex-row items-center" style={{ gap: 12, padding: 14 }} accessibilityRole="button" accessibilityLabel="Biometric, add. Coming soon">
          <SymbolView name={{ ios: "touchid", android: "fingerprint", web: "fingerprint" }} size={20} tintColor={colors.gymInkSoft} />
          <Text className="gym-menu__label flex-1">Biometric</Text>
          <Text className="gym-link">Add</Text>
        </Pressable>
        {section("Reminders", reminders)}
        {section("Membership", membership)}
        {section("Sales", sales)}
      </GymSheet>
      {collecting && <CollectDueSheet member={member} gym={gym} onClose={() => setCollecting(false)} onSaved={(detail) => { setCollecting(false); onChanged(detail); }} />}
    </>
  );
}
