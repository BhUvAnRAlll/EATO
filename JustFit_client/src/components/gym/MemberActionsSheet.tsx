import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { ChangeTrainerSheet } from "@/components/gym/ChangeTrainerSheet";
import { CollectDueSheet } from "@/components/gym/CollectDueSheet";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberSaleSheet } from "@/components/gym/MemberSaleSheet";
import { initialsOf, planLabel, planStart, rupees, shortDate } from "@/data/gymDashboard";
import { comingSoon } from "@/lib/gymPortal";
import { call, daysLeftText, dueReminder, email, expiredReminder, invoice, sms, whatsapp } from "@/lib/gymContact";
import type { GymInfo, GymMember, GymMemberDetail, GymPayment } from "@/lib/gymApi";
import { useThemeColors } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";

type Row = { label: string; icon: GymIconName; tone?: "danger"; onPress: () => void };

// A member's options (the user's designs): their card on the portal's gradient (Call, SMS,
// WhatsApp, Email; the plan and PT with their dates), Attendance History, Reminders (due, expired, invoice:
// WhatsApp with the message written), Membership (Collect Payment Due, Renew Member, Edit
// Membership, Pause Membership, Transaction History) and Sales (Renew PT, Change Trainer once they
// have PT, Add Service, Sell Product).
// `onLeave` closes whatever opened this sheet (another sheet) when a row opens a screen; on the
// member's own page (`onMemberPage`) Edit Membership and Transaction History just close the sheet.
export function MemberActionsSheet({ member, payments, gym, onClose, onChanged, onLeave, onMemberPage = false }: { member: GymMember; payments?: GymPayment[]; gym: GymInfo; onClose: () => void; onChanged: (detail: GymMemberDetail) => void; onLeave?: () => void; onMemberPage?: boolean }) {
  const colors = useThemeColors();
  const [collecting, setCollecting] = useState(false);
  const [selling, setSelling] = useState<"product" | "service" | null>(null);
  const [changingTrainer, setChangingTrainer] = useState(false);
  const go = (href: Href) => { onClose(); onLeave?.(); router.push(href); };
  const openMember = () => (onMemberPage ? onClose() : go({ pathname: "/gym/members/[id]", params: { id: String(member.id) } }));
  const id = String(member.id);
  const start = planStart(member.expiresOn, member.planLength.duration, member.planLength.unit);

  const reminders: Row[] = [
    ...(member.due > 0 ? [{ label: "Send Due Reminder", icon: "bell-ring", onPress: () => whatsapp(member, dueReminder(member, gym)) } as Row] : []),
    { label: "Send Expired Reminder", icon: "message-square-warning", tone: "danger", onPress: () => whatsapp(member, expiredReminder(member, gym)) },
    { label: "Send Invoice", icon: "receipt-text", onPress: () => whatsapp(member, invoice(member, gym, payments?.[0])) },
  ];
  const membership: Row[] = [
    ...(member.due > 0 ? [{ label: `Collect Payment Due : ${rupees(member.due)}`, icon: "credit-card", tone: "danger", onPress: () => setCollecting(true) } as Row] : []),
    { label: "Renew Member", icon: "calendar-sync", onPress: () => go({ pathname: "/gym/members/[id]/renew", params: { id } }) },
    { label: "Edit Membership", icon: "square-pen", onPress: openMember },
    { label: "Pause Membership", icon: "circle-pause", onPress: () => comingSoon("Pause Membership") },
    { label: "Transaction History", icon: "history", onPress: openMember },
  ];
  const sales: Row[] = [{ label: member.pt ? "Renew PT" : "Add PT", icon: "refresh-ccw", onPress: () => go({ pathname: "/gym/members/[id]/pt", params: { id } }) },
    ...(member.pt ? [{ label: member.pt.trainer ? `Change Trainer : ${member.pt.trainer.name}` : "Change Trainer", icon: "dumbbell", onPress: () => setChangingTrainer(true) } as Row] : []),
    { label: "Add Service", icon: "plus", onPress: () => setSelling("service") },
    { label: "Sell Product", icon: "plus", onPress: () => setSelling("product") },
  ];

  const section = (title: string, rows: Row[]) => (
    <View>
      <Text className="gym-section-title" style={{ marginBottom: 2 }}>{title}</Text>
      {rows.map((row) => (
        <Pressable key={row.label} onPress={row.onPress} className="gym-addrow" accessibilityRole="button" accessibilityLabel={row.label}>
          <View className="gym-addrow__icon" style={row.tone === "danger" ? { backgroundColor: colors.gymDangerSoft } : undefined}>
            <GymIcon name={row.icon} size={18} color={row.tone === "danger" ? colors.gymDanger : colors.gymPrimary} />
          </View>
          <Text className="gym-menu__label flex-1" numberOfLines={1}>{row.label}</Text>
          <GymIcon name="chevron-right" size={13} color={colors.gymInk} />
        </Pressable>
      ))}
    </View>
  );
  const contact = (label: string, icon: GymIconName, onPress: () => void) => (
    <PressableScale key={label} onPress={onPress} className="gym-hero-btn" accessibilityRole="button" accessibilityLabel={`${label} ${member.name}`}>
      <GymIcon name={icon} size={18} color={colors.white} />
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
      <GymIcon name="arrow-right" size={12} color={colors.white} />
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
            <View className="gym-member-hero__avatar"><Text className="gym-member-photo__initials" style={{ fontSize: 20 }}>{initialsOf(member.name)}</Text><MemberPhotoImage url={member.photoUrl} /></View>
            <View className="min-w-0 flex-1">
              <Text className="gym-member-hero__name" numberOfLines={1}>{member.name}</Text>
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <GymIcon name="id-card" size={13} color={colors.white} />
                <Text className="gym-hero__note">{member.code}</Text>
              </View>
            </View>
          </View>
          <View className="flex-row" style={{ gap: 8 }}>
            {contact("Call", "phone", () => call(member))}
            {contact("SMS", "message-square-text", () => sms(member))}
            {contact("WhatsApp", "message-circle", () => whatsapp(member))}
            {contact("Email", "mail", () => email(member, `${gym.name} membership`))}
          </View>
          <View className="gym-member-hero__line" />
          {period(planLabel(member.planLength.duration, member.planLength.unit), daysLeftText(member.daysLeft), start, member.expiresOn)}
          {member.pt && (
            <>
              <View className="gym-member-hero__line" />
              {period(member.pt.trainer ? `${member.pt.label} · ${member.pt.trainer.name}` : member.pt.label, member.pt.active ? daysLeftText(ptDays) : "PT ended", member.pt.from, member.pt.until, "PT")}
            </>
          )}
        </View>
        <Pressable onPress={() => go({ pathname: "/gym/attendance/member/[id]", params: { id, name: member.name } })} className="gym-card flex-row items-center" style={{ gap: 12, padding: 14 }} accessibilityRole="button" accessibilityLabel="Attendance history">
          <GymIcon name="history" size={20} color={colors.gymInkSoft} />
          <Text className="gym-menu__label flex-1">Attendance History</Text>
          <Text className="gym-link">{member.insideNow ? "Inside now" : "View"}</Text>
        </Pressable>
        {section("Reminders", reminders)}
        {section("Membership", membership)}
        {section("Sales", sales)}
      </GymSheet>
      {selling && <MemberSaleSheet kind={selling} member={member} gym={gym} onClose={() => setSelling(null)} onSaved={(detail) => { setSelling(null); onChanged(detail); }} />}
      {changingTrainer && <ChangeTrainerSheet member={member} onClose={() => setChangingTrainer(false)} onSaved={(detail) => { setChangingTrainer(false); onChanged(detail); }} />}
      {collecting && <CollectDueSheet member={member} gym={gym} onClose={() => setCollecting(false)} onSaved={(detail) => { setCollecting(false); onChanged(detail); }} />}
    </>
  );
}
