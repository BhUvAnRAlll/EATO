import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { GymField } from "@/components/gym/GymField";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { MemberActionsSheet } from "@/components/gym/MemberActionsSheet";
import { PaymentRow } from "@/components/gym/PaymentRow";
import { SaveButton } from "@/components/gym/SaveButton";
import { GENDER_LABEL, STATUS_LABEL, phoneInput, dobFromText, dobInput, dobText, initialsOf, planLabel, phoneText, rupees, shortDate } from "@/data/gymDashboard";
import { gymApi, type GymMemberDetail } from "@/lib/gymApi";
import { durationText } from "@/lib/attendanceText";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Gym admin › a member: their plan, what they owe, visits, Check in / Check out, Renew, Collect due, editing
// the name and phone, and their payments
// Height 50-250 cm and weight 10-300 kg, or empty (a typo like "72..5" must not clear the weight)
const detailsValid = ({ height, weight }: { height: string; weight: string }) =>
  (height === "" || (Number(height) >= 50 && Number(height) <= 250)) && (weight === "" || (Number.isFinite(Number(weight)) && Number(weight) >= 10 && Number(weight) <= 300));

export default function GymMember() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const load = useCallback((token: string | null) => gymApi.member(token, memberId), [memberId]);
  const { result, retry, set } = useGymData(load);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  // The options sheet (reminders, collect due, renew), and the gym for its messages
  const [options, setOptions] = useState(false);
  const { result: dash } = useGymData(gymApi.dashboard);
  const gym = dash.state === "ready" ? dash.data.gym : null;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [details, setDetails] = useState({ email: "", height: "", weight: "", address: "", notes: "" });
  const checkIn = useGymSave((data: GymMemberDetail) => {
    set(data);
    if (data.durationMin !== undefined) setNotice(`Checked out · ${durationText(data.durationMin ?? 0)} workout.`);
    else setNotice(data.alreadyIn ? "Already checked in." : "Checked in.");
  });
  const edit = useGymSave((data: GymMemberDetail) => {
    set(data);
    setEditing(false);
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
      right={
        gym ? (
          <PressableScale onPress={() => setOptions(true)} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel={`${member.name}: options`}>
            <GymIcon name="ellipsis" size={18} color={colors.gymInk} />
          </PressableScale>
        ) : undefined
      }
    >
      {options && gym && <MemberActionsSheet member={member} payments={payments} gym={gym} onMemberPage onClose={() => setOptions(false)} onChanged={(detail) => { set(detail); setOptions(false); }} />}
      <View className="gym-card p-4" style={{ gap: 12 }}>
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <View className="gym-avatar" style={{ width: 52, height: 52 }}>
            <Text className="gym-avatar__label">{initialsOf(member.name)}</Text>
            <MemberPhotoImage url={member.photoUrl} />
          </View>
          <View className="min-w-0 flex-1" style={{ gap: 2 }}>
            <Text className="gym-tx__name" numberOfLines={1}>{member.name}</Text>
            <Text className="gym-tx__meta" style={{ color: colors.gymPrimaryText }} accessibilityLabel={`Member ID ${member.code}`}>{member.code}</Text>
            <Text className="gym-tx__meta">{member.phone ? phoneText(member.phone) : "No phone number"}</Text>
            {member.gender ? <Text className="gym-tx__meta">{GENDER_LABEL[member.gender]}</Text> : null}
            {[member.heightCm ? `${member.heightCm} cm` : null, member.weightKg ? `${member.weightKg} kg` : null, member.email].filter(Boolean).length > 0 ? (
              <Text className="gym-tx__meta" numberOfLines={2}>{[member.heightCm ? `${member.heightCm} cm` : null, member.weightKg ? `${member.weightKg} kg` : null, member.email].filter(Boolean).join(" · ")}</Text>
            ) : null}
            {member.address ? <Text className="gym-tx__meta" numberOfLines={2}>{member.address}</Text> : null}
            {member.notes ? <Text className="gym-tx__meta" numberOfLines={3}>{`Note: ${member.notes}`}</Text> : null}
            {member.birthdayToday ? <Text className="gym-tx__meta" style={{ color: colors.gymPrimaryText }}>Birthday today</Text> : member.dob ? <Text className="gym-tx__meta">{`Born ${shortDate(member.dob)}`}</Text> : null}
          </View>
          <PressableScale
            onPress={() => {
              setName(member.name);
              setPhone(member.phone?.replace(/^\+91/, "") ?? "");
              setDob(dobText(member.dob));
              setDetails({ email: member.email ?? "", height: member.heightCm ? String(member.heightCm) : "", weight: member.weightKg ? String(member.weightKg) : "", address: member.address ?? "", notes: member.notes ?? "" });
              setEditing((e) => !e);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={editing ? "Cancel editing" : "Edit name and phone"}
          >
            <Text className="gym-link">{editing ? "Cancel" : "Edit"}</Text>
          </PressableScale>
        </View>
        {editing && (
          <View style={{ gap: 12 }}>
            <GymField label="Name" value={name} onChangeText={setName} maxLength={80} autoCapitalize="words" />
            <GymField label="Mobile number" value={phone} onChangeText={(t) => setPhone(phoneInput(t))} maxLength={16} keyboardType="phone-pad" hint="Leave empty to remove it." />
            <GymField label="Date of birth" value={dob} onChangeText={(t) => setDob(dobInput(t))} keyboardType="number-pad" placeholder="DD-MM-YYYY" hint="Leave empty to remove it." />
            <GymField label="Email" value={details.email} onChangeText={(email) => setDetails((d) => ({ ...d, email }))} maxLength={120} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            <View className="flex-row" style={{ gap: 10 }}>
              <View className="min-w-0 flex-1"><GymField label="Height (cm)" hint={detailsValid({ height: details.height, weight: "" }) ? undefined : "50 to 250 cm"} value={details.height} onChangeText={(t) => setDetails((d) => ({ ...d, height: t.replace(/\D/g, "").slice(0, 3) }))} keyboardType="number-pad" /></View>
              <View className="min-w-0 flex-1"><GymField label="Weight (kg)" hint={detailsValid({ height: "", weight: details.weight }) ? undefined : "10 to 300 kg"} value={details.weight} onChangeText={(t) => setDetails((d) => ({ ...d, weight: t.replace(/[^0-9.]/g, "").slice(0, 5) }))} keyboardType="decimal-pad" /></View>
            </View>
            <GymField label="Address" value={details.address} onChangeText={(address) => setDetails((d) => ({ ...d, address }))} maxLength={200} />
            <GymField label="Notes" value={details.notes} onChangeText={(notes) => setDetails((d) => ({ ...d, notes }))} maxLength={300} />
            {edit.error ? <FormAlert message={edit.error} /> : null}
            <SaveButton label="Save changes" ready={name.trim().length >= 2 && (dob.trim() === "" || dobFromText(dob) !== null) && detailsValid(details)} busy={edit.busy} onPress={() => edit.save((token) => gymApi.editMember(token, memberId, { name: name.trim(), phone: phone.trim(), dob: dobFromText(dob) ?? "", email: details.email.trim(), heightCm: details.height ? Number(details.height) : "", weightKg: details.weight ? Number(details.weight) : "", address: details.address.trim(), notes: details.notes.trim() }))} />
          </View>
        )}
        <View className="gym-summary">
          <View className="flex-row items-center justify-between">
            <Text className="gym-tx__meta">{planLabel(member.planLength.duration, member.planLength.unit)}</Text>
            <Text className="gym-tag__label" style={{ color: statusColor }}>{STATUS_LABEL[member.status]}</Text>
          </View>
          <Text className="gym-tx__name">{`Until ${shortDate(member.expiresOn)}`}</Text>
          <Text className="gym-tx__meta">{`Joined ${shortDate(member.joinedOn)} · ${member.visitsThisMonth} ${member.visitsThisMonth === 1 ? "visit" : "visits"} this month${member.lastVisit ? ` · last ${shortDate(member.lastVisit)}` : ""}`}</Text>
          <Text className="gym-tx__name" style={{ color: member.due > 0 ? colors.gymDanger : colors.gymSuccess }}>{member.due > 0 ? `Due ${rupees(member.due)}${member.dueBy ? ` · pay by ${shortDate(member.dueBy)}` : ""}` : "No dues"}</Text>
          {member.overdue ? <Text className="gym-tag__label" style={{ color: colors.gymDanger }}>Overdue: the payment date has passed</Text> : null}
        </View>
      </View>

      {notice ? <Text className="gym-tx__meta" accessibilityLiveRegion="polite">{notice}</Text> : null}
      {checkIn.error ? <FormAlert message={checkIn.error} /> : null}
      {/* Staff check-in and check-out (members with the app scan the QR code instead) */}
      <PressableScale
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
      </PressableScale>
      <PressableScale onPress={() => router.push({ pathname: "/gym/attendance/member/[id]", params: { id: String(memberId), name: member.name } })} className="flex-row items-center self-start" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Attendance history">
        <GymIcon name="history" size={15} color={colors.gymPrimary} />
        <Text className="gym-link">Attendance history</Text>
      </PressableScale>
      <View className="flex-row flex-wrap" style={{ gap: 10 }}>
        <PressableScale onPress={() => router.push({ pathname: "/gym/members/[id]/pt", params: { id: String(memberId) } })} className="gym-btn gym-btn--outline flex-1" accessibilityRole="button" accessibilityLabel="Personal training payment">
          <Text className="gym-btn__label gym-btn__label--outline">PT</Text>
        </PressableScale>
        <PressableScale onPress={() => router.push({ pathname: "/gym/members/[id]/renew", params: { id: String(memberId) } })} className="gym-btn gym-btn--outline flex-1" accessibilityRole="button" accessibilityLabel="Renew plan">
          <Text className="gym-btn__label gym-btn__label--outline">Renew</Text>
        </PressableScale>
        <PressableScale
          onPress={() => router.push({ pathname: "/gym/members/[id]/due", params: { id: String(memberId) } })}
          disabled={member.due === 0}
          className="gym-btn gym-btn--outline flex-1"
          style={{ opacity: member.due === 0 ? 0.5 : 1 }}
          accessibilityRole="button"
          accessibilityLabel="Collect due"
        >
          <Text className="gym-btn__label gym-btn__label--outline" numberOfLines={1}>Pay due</Text>
        </PressableScale>
      </View>

      <Text className="gym-section-title" accessibilityRole="header">Payments</Text>
      {payments.length === 0 ? <Text className="gym-tx__meta">No payments yet.</Text> : <View style={{ gap: 10 }}>{payments.map((p) => <PaymentRow key={p.id} payment={p} />)}</View>}
    </GymScreen>
  );
}
