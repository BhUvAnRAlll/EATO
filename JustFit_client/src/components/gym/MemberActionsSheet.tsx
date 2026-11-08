import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { WhatsAppMark } from "@/components/gym/WhatsAppMark";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { ChangeTrainerSheet } from "@/components/gym/ChangeTrainerSheet";
import { CollectDueSheet } from "@/components/gym/CollectDueSheet";
import { EditProfileSheet } from "@/components/gym/EditProfileSheet";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymSheet } from "@/components/gym/GymSheet";
import { MemberSaleSheet } from "@/components/gym/MemberSaleSheet";
import { PauseMembershipSheet } from "@/components/gym/PauseMembershipSheet";
import { SendReminderSheet, type ReminderKind } from "@/components/gym/SendReminderSheet";
import { initialsOf, memberPlanText, planStart, rupees, shortDate } from "@/data/gymDashboard";
import { call, daysLeftText, email, sms, whatsapp } from "@/lib/gymContact";
import type { GymInfo, GymMember, GymMemberDetail, GymPayment } from "@/lib/gymApi";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";

type Row = { label: string; icon: GymIconName; tone?: "danger"; onPress: () => void };

// A member's options (the user's designs): their card on the portal's gradient (Call, SMS,
// WhatsApp, Email; the plan and PT with their dates), Attendance History, Profile (Edit Profile:
// photo, name, mobile, gender and the details), Reminders (due, expired,
// invoice: each opens Send via, an SMS from justFit, the phone's SMS app or WhatsApp), Membership (Collect Payment Due, Renew Member, Edit
// Membership, Pause Membership, Transaction History) and Sales (Renew PT, Change Trainer once they
// have PT, Add Service, Sell Product).
// `onLeave` closes whatever opened this sheet (another sheet) when a row opens a screen; on the
// member's own page (`onMemberPage`) Transaction History just closes the sheet; Edit Membership opens
// the Edit Profile sheet (since 2026-11-07).
export function MemberActionsSheet({ member, payments, gym, onClose, onChanged, onLeave, onMemberPage = false }: { member: GymMember; payments?: GymPayment[]; gym: GymInfo; onClose: () => void; onChanged: (detail: GymMemberDetail) => void; onLeave?: () => void; onMemberPage?: boolean }) {
  const colors = useThemeColors();
  const [collecting, setCollecting] = useState(false);
  const [selling, setSelling] = useState<"product" | "service" | null>(null);
  const [changingTrainer, setChangingTrainer] = useState(false);
  const [reminding, setReminding] = useState<ReminderKind | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [pausing, setPausing] = useState(false);
  // Role & Permission: rows a Staff login's areas don't include are left out, as on Home (QA 2026-11-07)
  const can = useCan();
  const go = (href: Href) => { onClose(); onLeave?.(); router.push(href); };
  const openMember = () => (onMemberPage ? onClose() : go({ pathname: "/gym/members/[id]", params: { id: String(member.id) } }));
  const id = String(member.id);
  const start = planStart(member.expiresOn, member.planLength.duration, member.planLength.unit);

  const profile: Row[] = can("members.edit") ? [{ label: "Edit Profile", icon: "user-pen", onPress: () => setEditingProfile(true) }] : [];
  const reminders: Row[] = [
    ...(member.due > 0 && can("sms.send") ? [{ label: "Send Due Reminder", icon: "bell-ring", onPress: () => setReminding("due") } as Row] : []),
    ...(can("sms.send") ? [{ label: "Send Expired Reminder", icon: "message-square-warning", tone: "danger", onPress: () => setReminding("expired") } as Row] : []),
    // The Invoice screen (2026-11-07): the member's latest payment as a PDF to share
    { label: "Send Invoice", icon: "receipt-text", onPress: () => go({ pathname: "/gym/invoice", params: { memberId: id } }) },
  ];
  const membership: Row[] = [
    ...(member.due > 0 && can("payments.collect") ? [{ label: `Collect Payment Due : ${rupees(member.due)}`, icon: "credit-card", tone: "danger", onPress: () => setCollecting(true) } as Row] : []),
    ...(can("members.renew") ? [{ label: "Renew Member", icon: "calendar-sync", onPress: () => go({ pathname: "/gym/members/[id]/renew", params: { id } }) } as Row] : []),
    // Opens the Edit Profile sheet (2026-11-07, the user's request; it opened the member's page before)
    ...(can("members.edit") ? [{ label: "Edit Membership", icon: "square-pen", onPress: () => setEditingProfile(true) } as Row] : []),
    // Pause Membership (2026-11-07): staff pause it here (Option B); a member's own request from
    // the app waits on Pause requests; an approved pause shows its end
    ...(!can("members.pause")
      ? []
      : [member.pause?.status === "pending"
        ? { label: "Pause request waiting", icon: "circle-pause", onPress: () => go("/gym/pauses") } as Row
        : member.pause
          ? { label: `Paused until ${shortDate(member.pause.until)}`, icon: "circle-pause", onPress: () => go("/gym/pauses?view=all") } as Row
          : { label: "Pause Membership", icon: "circle-pause", onPress: () => setPausing(true) } as Row]),
    { label: "Transaction History", icon: "history", onPress: openMember },
  ];
  // PT, services and products are payments; Change Trainer is a member change
  const sales: Row[] = [
    ...(can("payments.pt") ? [{ label: member.pt ? "Renew PT" : "Add PT", icon: "refresh-ccw", onPress: () => go({ pathname: "/gym/members/[id]/pt", params: { id } }) } as Row] : []),
    ...(member.pt && can("members.edit") ? [{ label: member.pt.trainer ? `Change Trainer : ${member.pt.trainer.name}` : "Change Trainer", icon: "dumbbell", onPress: () => setChangingTrainer(true) } as Row] : []),
    ...(can("payments.sales") ? [{ label: "Add Service", icon: "plus", onPress: () => setSelling("service") } as Row, { label: "Sell Product", icon: "plus", onPress: () => setSelling("product") } as Row] : []),
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
  // WhatsApp shows its own mark instead of a line icon
  const contact = (label: string, icon: GymIconName | "whatsapp", onPress: () => void) => (
    <PressableScale key={label} onPress={onPress} className="gym-hero-btn" accessibilityRole="button" accessibilityLabel={`${label} ${member.name}`}>
      {icon === "whatsapp" ? <WhatsAppMark size={22} /> : <GymIcon name={icon} size={18} color={colors.white} />}
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
    <GymSheet
      onClose={onClose}
      stack={
        <>
          {selling && <MemberSaleSheet kind={selling} member={member} gym={gym} onClose={() => setSelling(null)} onSaved={(detail) => { setSelling(null); onChanged(detail); }} />}
          {changingTrainer && <ChangeTrainerSheet member={member} onClose={() => setChangingTrainer(false)} onSaved={(detail) => { setChangingTrainer(false); onChanged(detail); }} />}
          {reminding && <SendReminderSheet kind={reminding} member={member} gym={gym} payment={payments?.[0]} onClose={() => setReminding(null)} />}
          {editingProfile && <EditProfileSheet member={member} onClose={() => setEditingProfile(false)} onSaved={(detail) => { setEditingProfile(false); onChanged(detail); }} />}
          {pausing && <PauseMembershipSheet member={member} onClose={() => setPausing(false)} onSaved={(detail) => { setPausing(false); onChanged(detail); }} />}
          {collecting && <CollectDueSheet member={member} gym={gym} onClose={() => setCollecting(false)} onSaved={(detail) => { setCollecting(false); onChanged(detail); }} />}
        </>
      }
    >
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
          {contact("WhatsApp", "whatsapp", () => whatsapp(member))}
          {contact("Email", "mail", () => email(member, `${gym.name} membership`))}
        </View>
        <View className="gym-member-hero__line" />
        {period(memberPlanText(member), daysLeftText(member.daysLeft), start, member.expiresOn)}
        {member.pt && (
          <>
            <View className="gym-member-hero__line" />
            {period(member.pt.trainer ? `${member.pt.label} · ${member.pt.trainer.name}` : member.pt.label, member.pt.active ? daysLeftText(ptDays) : "PT ended", member.pt.from, member.pt.until, "PT")}
          </>
        )}
      </View>
      {can("attendance.view") && (
        <Pressable onPress={() => go({ pathname: "/gym/attendance/member/[id]", params: { id, name: member.name } })} className="gym-card flex-row items-center" style={{ gap: 12, padding: 14 }} accessibilityRole="button" accessibilityLabel="Attendance history">
          <GymIcon name="history" size={20} color={colors.gymInkSoft} />
          <Text className="gym-menu__label flex-1">Attendance History</Text>
          <Text className="gym-link">{member.insideNow ? "Inside now" : "View"}</Text>
        </Pressable>
      )}
      {profile.length > 0 && section("Profile", profile)}
      {reminders.length > 0 && section("Reminders", reminders)}
      {section("Membership", membership)}
      {sales.length > 0 && section("Sales", sales)}
    </GymSheet>
  );
}
