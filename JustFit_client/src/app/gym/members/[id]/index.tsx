import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { GymField } from "@/components/gym/GymField";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { PaymentRow } from "@/components/gym/PaymentRow";
import { SaveButton } from "@/components/gym/SaveButton";
import { STATUS_LABEL, initialsOf, planLabel, phoneText, rupees, shortDate } from "@/data/gymDashboard";
import { gymApi, type GymMemberDetail } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Gym admin › a member: their plan, what they owe, visits, Check in, Renew, Collect due, editing
// the name and phone, and their payments
export default function GymMember() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const load = useCallback((token: string | null) => gymApi.member(token, memberId), [memberId]);
  const { result, retry, set } = useGymData(load);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const checkIn = useGymSave((data: GymMemberDetail) => {
    set(data);
    setNotice(data.alreadyIn ? "Already checked in today." : "Checked in for today.");
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
    <GymScreen title={member.name}>
      <View className="gym-card p-4" style={{ gap: 12 }}>
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <View className="gym-avatar" style={{ width: 52, height: 52 }}>
            <Text className="gym-avatar__label">{initialsOf(member.name)}</Text>
          </View>
          <View className="min-w-0 flex-1" style={{ gap: 2 }}>
            <Text className="gym-tx__name" numberOfLines={1}>{member.name}</Text>
            <Text className="gym-tx__meta">{member.phone ? phoneText(member.phone) : "No phone number"}</Text>
          </View>
          <PressableScale
            onPress={() => {
              setName(member.name);
              setPhone(member.phone?.replace(/^\+91/, "") ?? "");
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
            <GymField label="Mobile number" value={phone} onChangeText={(t) => setPhone(t.replace(/[^0-9+ ]/g, "").slice(0, 15))} keyboardType="phone-pad" hint="Leave empty to remove it." />
            {edit.error ? <FormAlert message={edit.error} /> : null}
            <SaveButton label="Save changes" ready={name.trim().length >= 2} busy={edit.busy} onPress={() => edit.save((token) => gymApi.editMember(token, memberId, { name: name.trim(), phone: phone.trim() }))} />
          </View>
        )}
        <View className="gym-summary">
          <View className="flex-row items-center justify-between">
            <Text className="gym-tx__meta">{planLabel(member.planMonths)}</Text>
            <Text className="gym-tag__label" style={{ color: statusColor }}>{STATUS_LABEL[member.status]}</Text>
          </View>
          <Text className="gym-tx__name">{`Until ${shortDate(member.expiresOn)}`}</Text>
          <Text className="gym-tx__meta">{`Joined ${shortDate(member.joinedOn)} · ${member.visitsThisMonth} ${member.visitsThisMonth === 1 ? "visit" : "visits"} this month${member.lastVisit ? ` · last ${shortDate(member.lastVisit)}` : ""}`}</Text>
          <Text className="gym-tx__name" style={{ color: member.due > 0 ? colors.gymDanger : colors.gymSuccess }}>{member.due > 0 ? `Owes ${rupees(member.due)}` : "Nothing owed"}</Text>
        </View>
      </View>

      {notice ? <Text className="gym-tx__meta" accessibilityLiveRegion="polite">{notice}</Text> : null}
      {checkIn.error ? <FormAlert message={checkIn.error} /> : null}
      <PressableScale
        onPress={() => checkIn.save((token) => gymApi.checkIn(token, memberId))}
        disabled={checkIn.busy || member.inToday}
        haptic="tap"
        className={member.inToday ? "gym-btn gym-btn--outline" : "gym-btn"}
        accessibilityRole="button"
        accessibilityLabel={member.inToday ? "Checked in today" : "Check in for today"}
      >
        {checkIn.busy ? <ActivityIndicator size="small" color={colors.white} /> : <SymbolView name={{ ios: "touchid", android: "fingerprint", web: "fingerprint" }} size={18} tintColor={member.inToday ? colors.gymPrimary : colors.white} />}
        <Text className={member.inToday ? "gym-btn__label gym-btn__label--outline" : "gym-btn__label"}>{member.inToday ? "Checked in today" : "Check in"}</Text>
      </PressableScale>
      <View className="flex-row" style={{ gap: 10 }}>
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
          <Text className="gym-btn__label gym-btn__label--outline">Collect due</Text>
        </PressableScale>
      </View>

      <Text className="gym-section-title" accessibilityRole="header">Payments</Text>
      {payments.length === 0 ? <Text className="gym-tx__meta">No payments yet.</Text> : <View style={{ gap: 10 }}>{payments.map((p) => <PaymentRow key={p.id} payment={p} />)}</View>}
    </GymScreen>
  );
}
