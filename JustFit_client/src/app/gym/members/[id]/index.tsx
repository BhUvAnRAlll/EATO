import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { EditProfileSheet } from "@/components/gym/EditProfileSheet";
import { MemberActionsSheet } from "@/components/gym/MemberActionsSheet";
import { PaymentRow } from "@/components/gym/PaymentRow";
import { GENDER_LABEL, STATUS_LABEL, initialsOf, memberPlanText, phoneText, ptPackageText, rupees, shortDate } from "@/data/gymDashboard";
import { gymApi, type GymInfo, type GymMemberDetail } from "@/lib/gymApi";
import { durationText } from "@/lib/attendanceText";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { StandingCard } from "@/components/gym/StandingCard";
import { useCan } from "@/store/gymAccess";
import { useThemeColors } from "@/theme";

// Gym admin › a member: their plan, what they owe, visits, Check in / Check out, Renew, Collect due,
// Edit (the profile sheet: photo, name, phone, gender and the details) and their payments

export default function GymMember() {
  const colors = useThemeColors();
  // Role & Permission: a Staff login sees only the actions its areas allow, as Home does (the
  // server refuses the rest regardless; a shown button that answers 403 only confused, QA 2026-11-07)
  const can = useCan();
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const load = useCallback((token: string | null) => gymApi.member(token, memberId), [memberId]);
  const { result, retry, set, refreshing, refresh } = useGymData(load);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  // The options sheet (reminders, collect due, renew), and the gym for its messages: it comes
  // with the member (GET /members/:id) and is kept when a later answer (a check-in) leaves it out
  const [options, setOptions] = useState(false);
  const [gym, setGym] = useState<GymInfo | null>(null);
  const gymNow = result.state === "ready" ? result.data.gym ?? null : null;
  if (gymNow && gymNow !== gym) setGym(gymNow); // kept from the latest answer that carried it (the lint rule prefers this to an effect)
  const checkIn = useGymSave((data: GymMemberDetail) => {
    set(data);
    if (data.durationMin !== undefined) setNotice(`Checked out · ${durationText(data.durationMin ?? 0)} workout.`);
    else setNotice(data.alreadyIn ? "Already checked in." : "Checked in.");
  });

  if (result.state !== "ready") {
    return (
      <GymScreen title="Member">
        {result.state === "loading" ? <GymLoading label="Loading the member" /> : <GymError error={result.error} onRetry={retry} />}
      </GymScreen>
    );
  }
  const { member, payments } = result.data;
  const statusColor = member.status === "expired" ? colors.gymDanger : member.status === "expiring" ? colors.gymWarning : colors.gymSuccess;

  return (
    <GymScreen
      title={member.name}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.gymPrimary} onRefresh={refresh} />}
      right={
        gym ? (
          <PressableScale onPress={() => setOptions(true)} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel={`${member.name}: options`}>
            <GymIcon name="ellipsis" size={18} color={colors.gymInk} />
          </PressableScale>
        ) : undefined
      }
    >
      {options && gym && <MemberActionsSheet member={member} payments={payments} gym={gym} onMemberPage onClose={() => setOptions(false)} onChanged={(detail) => { set(detail); setOptions(false); }} />}
      {editing && <EditProfileSheet member={member} onClose={() => setEditing(false)} onSaved={(detail) => { set(detail); setEditing(false); }} />}
      <View className="gym-card p-4" style={{ gap: 12 }}>
        <View className="flex-row items-start" style={{ gap: 12 }}>
          <View className="gym-avatar" style={{ width: 52, height: 52 }}>
            <Text className="gym-avatar__label">{initialsOf(member.name)}</Text>
            <MemberPhotoImage url={member.photoUrl} />
          </View>
          <View className="min-w-0 flex-1" style={{ gap: 2 }}>
            <Text className="gym-tx__name" numberOfLines={1}>{member.name}</Text>
            <Text className="gym-tx__meta" style={{ color: colors.gymPrimaryText }} accessibilityLabel={`Member ID ${member.code}`}>{member.code}</Text>
            <Text className="gym-tx__meta">{member.phone ? phoneText(member.phone) : "No phone number"}</Text>
            {member.gender ? <Text className="gym-tx__meta">{GENDER_LABEL[member.gender]}</Text> : null}
            {/* Height and weight share a line (each kept whole, so a "·" never ends a line); the
                email has a line of its own and never breaks mid-word (2026-11-08) */}
            {member.heightCm || member.weightKg ? (
              <Text className="gym-tx__meta" numberOfLines={1}>{[member.heightCm ? `${member.heightCm} cm` : null, member.weightKg ? `${member.weightKg} kg` : null].filter(Boolean).join(" · ")}</Text>
            ) : null}
            {member.email ? <Text className="gym-tx__meta" numberOfLines={1} ellipsizeMode="middle">{member.email}</Text> : null}
            {member.address ? <Text className="gym-tx__meta" numberOfLines={2}>{member.address}</Text> : null}
            {member.notes ? <Text className="gym-tx__meta" numberOfLines={3}>{`Note: ${member.notes}`}</Text> : null}
            {member.birthdayToday ? <Text className="gym-tx__meta" style={{ color: colors.gymPrimaryText }}>Birthday today</Text> : member.dob ? <Text className="gym-tx__meta">{`Born ${shortDate(member.dob)}`}</Text> : null}
          </View>
          {can("members.edit") && <PressableScale onPress={() => setEditing(true)} hitSlop={8} style={{ paddingTop: 2 }} accessibilityRole="button" accessibilityLabel="Edit profile">
            <Text className="gym-link">Edit</Text>
          </PressableScale>}
        </View>
        <View className="gym-summary">
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <Text className="gym-tx__meta min-w-0 flex-1" numberOfLines={2}>{memberPlanText(member)}</Text>
            <Text className="gym-tag__label" style={{ color: statusColor }}>{STATUS_LABEL[member.status]}</Text>
          </View>
          <Text className="gym-tx__name">{`Until ${shortDate(member.expiresOn)}`}</Text>
          {/* Each fact its own piece, so a wrap never leaves a "·" at the end of a line */}
          <View className="flex-row flex-wrap" style={{ columnGap: 4 }}>
            <Text className="gym-tx__meta">{`Joined ${shortDate(member.joinedOn)}`}</Text>
            <Text className="gym-tx__meta">{`· ${member.visitsThisMonth} ${member.visitsThisMonth === 1 ? "visit" : "visits"} this month`}</Text>
            {member.lastVisit ? <Text className="gym-tx__meta">{`· last ${shortDate(member.lastVisit)}`}</Text> : null}
          </View>
          <Text className="gym-tx__name" style={{ color: member.due > 0 ? colors.gymDanger : colors.gymSuccess }}>{member.due > 0 ? `Due ${rupees(member.due)}${member.dueBy ? ` · pay by ${shortDate(member.dueBy)}` : ""}` : "No dues"}</Text>
          {member.overdue ? <Text className="gym-tag__label" style={{ color: colors.gymDanger }}>Overdue: the payment date has passed</Text> : null}
          {member.pause ? (
            <Text className="gym-tag__label" style={{ color: member.pause.status === "pending" ? colors.gymWarning : colors.gymPrimaryText }} accessibilityLiveRegion="polite">
              {member.pause.status === "pending"
                ? `Pause requested: ${shortDate(member.pause.from)} to ${shortDate(member.pause.until)} (${member.pause.days} days), waiting for your answer`
                : `${member.pausedNow ? "Paused" : "Pause"} ${shortDate(member.pause.from)} to ${shortDate(member.pause.until)} (${member.pause.days} days added to the plan)`}
            </Text>
          ) : null}
        </View>
        {/* Suspended or cancelled by the gym, and the change (Members › Suspend, cancel or reactivate) */}
        <StandingCard member={member} canChange={can("members.standing")} onSaved={set} />
        {/* The personal training they bought: the package, its dates and the trainer it's with */}
        {member.pt ? (
          <View className="gym-summary" accessibilityLabel={`Personal training: ${member.pt.label}, ${member.pt.active ? "active" : "ended"}, ${shortDate(member.pt.from)} to ${shortDate(member.pt.until)}${member.pt.trainer ? `, with ${member.pt.trainer.name}` : ""}`}>
            <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
              <Text className="gym-tx__meta min-w-0 flex-1" numberOfLines={1}>{ptPackageText(member.pt.label)}</Text>
              <Text className="gym-tag__label" style={{ color: member.pt.active ? colors.gymSuccess : colors.gymDanger }}>{member.pt.active ? "Active" : "Ended"}</Text>
            </View>
            <Text className="gym-tx__name">{`${shortDate(member.pt.from)} to ${shortDate(member.pt.until)}`}</Text>
            <Text className="gym-tx__meta">{member.pt.trainer ? `Trainer: ${member.pt.trainer.name}` : "No trainer picked"}</Text>
          </View>
        ) : null}
      </View>

      {notice ? <Text className="gym-tx__meta" accessibilityLiveRegion="polite">{notice}</Text> : null}
      {checkIn.error ? <FormAlert message={checkIn.error} /> : null}
      {/* Staff check-in and check-out (members with the app scan the QR code instead) */}
      {can("attendance.checkin") && <PressableScale
        onPress={() => checkIn.save((token) => (member.insideNow ? gymApi.checkOut(token, memberId) : gymApi.checkIn(token, memberId)))}
        disabled={checkIn.busy}
        haptic="tap"
        className={member.insideNow ? "gym-btn gym-btn--outline" : "gym-btn"}
        accessibilityRole="button"
        accessibilityLabel={member.insideNow ? "Check out" : "Check in"}
        accessibilityState={{ busy: checkIn.busy }}
      >
        {!member.insideNow && <GradientFill radius={14} />}
        {checkIn.busy ? <ActivityIndicator size="small" color={member.insideNow ? colors.gymPrimary : colors.white} /> : <GymIcon name={member.insideNow ? "log-out" : "log-in"} size={18} color={member.insideNow ? colors.gymPrimary : colors.white} />}
        <Text className={member.insideNow ? "gym-btn__label gym-btn__label--outline" : "gym-btn__label"}>{member.insideNow ? "Check out" : "Check in"}</Text>
      </PressableScale>}
      {can("attendance.view") && (
        <PressableScale onPress={() => router.push({ pathname: "/gym/attendance/member/[id]", params: { id: String(memberId), name: member.name } })} className="flex-row items-center self-start" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Attendance history">
          <GymIcon name="history" size={15} color={colors.gymPrimary} />
          <Text className="gym-link">Attendance history</Text>
        </PressableScale>
      )}
      {/* Three buttons share the row: their side padding is small and a label shrinks to fit
          rather than cutting off ("Pay d…" at a 360-wide phone's larger text, 2026-11-08) */}
      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        {can("payments.pt") && (
        <PressableScale onPress={() => router.push({ pathname: "/gym/members/[id]/pt", params: { id: String(memberId) } })} className="gym-btn gym-btn--outline flex-1" style={{ paddingHorizontal: 8 }} accessibilityRole="button" accessibilityLabel="Personal training payment">
          <Text className="gym-btn__label gym-btn__label--outline" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>PT</Text>
        </PressableScale>
        )}
        {can("members.renew") && (
        <PressableScale onPress={() => router.push({ pathname: "/gym/members/[id]/renew", params: { id: String(memberId) } })} className="gym-btn gym-btn--outline flex-1" style={{ paddingHorizontal: 8 }} accessibilityRole="button" accessibilityLabel="Renew plan">
          <Text className="gym-btn__label gym-btn__label--outline" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Renew</Text>
        </PressableScale>
        )}
        {can("payments.collect") && (
        <PressableScale
          onPress={() => router.push({ pathname: "/gym/members/[id]/due", params: { id: String(memberId) } })}
          disabled={member.due === 0}
          className="gym-btn gym-btn--outline flex-1"
          style={{ opacity: member.due === 0 ? 0.5 : 1, paddingHorizontal: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Collect due"
        >
          <Text className="gym-btn__label gym-btn__label--outline" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Pay due</Text>
        </PressableScale>
        )}
      </View>

      <Text className="gym-page-section" accessibilityRole="header">Payments</Text>
      {payments.length === 0 ? <Text className="gym-tx__meta">No payments yet.</Text> : <View style={{ gap: 10 }}>{payments.map((p) => <PaymentRow key={p.id} payment={p} invoice />)}</View>}
    </GymScreen>
  );
}
