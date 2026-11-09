import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymField } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { gymApi, type GymMember, type GymMemberDetail, type MemberStanding } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useThemeColors } from "@/theme";

const LABEL: Record<MemberStanding, string> = { active: "Active", suspended: "Suspended", cancelled: "Cancelled" };
const ACTION: Record<MemberStanding, string> = { active: "Reactivate", suspended: "Suspend", cancelled: "Cancel membership" };
// Which states each state can move to (the server checks the same: gym/standingRules.js MOVES)
const NEXT: Record<MemberStanding, MemberStanding[]> = { active: ["suspended", "cancelled"], suspended: ["active", "cancelled"], cancelled: ["active"] };

// A member's page › Membership status: suspended or cancelled by the gym (with the reason), and,
// for a login with Members › Suspend, cancel or reactivate, the change with its reason. A suspended
// or cancelled member can't check in or ask for a pause; the plan's dates stay as they are.
export function StandingCard({ member, canChange, onSaved }: { member: GymMember; canChange: boolean; onSaved: (data: GymMemberDetail) => void }) {
  const colors = useThemeColors();
  const standing = member.standing ?? "active";
  const [picked, setPicked] = useState<MemberStanding | null>(null);
  const [note, setNote] = useState("");
  const save = useGymSave((data: GymMemberDetail) => {
    onSaved(data);
    setPicked(null);
    setNote("");
  }, () => (picked === "active" ? "Membership reactivated" : picked === "suspended" ? "Membership suspended" : "Membership cancelled"));

  if (standing === "active" && !canChange) return null;
  const needsReason = picked !== null && picked !== "active";
  const ready = picked !== null && (!needsReason || note.trim().length >= 5);

  return (
    <View className="gym-summary" style={{ gap: 10 }}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Text className="gym-tx__meta flex-1">Membership status</Text>
        <Text className="gym-tag__label" style={{ color: standing === "active" ? colors.gymSuccess : colors.gymDanger }}>{LABEL[standing]}</Text>
      </View>
      {standing !== "active" ? (
        <Text className="gym-tx__meta">{`${member.standingNote ? `“${member.standingNote}” · ` : ""}No check-ins or pause requests until it's reactivated.`}</Text>
      ) : null}
      {canChange ? (
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {NEXT[standing].map((to) => (
            <PressableScale
              key={to}
              onPress={() => { setPicked(picked === to ? null : to); setNote(""); }}
              className={picked === to ? "gym-btn gym-btn--outline" : "gym-btn gym-btn--outline"}
              style={{ paddingHorizontal: 14, borderColor: picked === to ? colors.gymPrimary : undefined }}
              accessibilityRole="button"
              accessibilityState={{ selected: picked === to }}
            >
              <Text className="gym-btn__label gym-btn__label--outline" style={{ color: to === "active" ? colors.gymSuccess : colors.gymDanger }}>{ACTION[to]}</Text>
            </PressableScale>
          ))}
        </View>
      ) : null}
      {picked ? (
        <View style={{ gap: 10 }}>
          {needsReason ? (
            <GymField label="Reason (kept with the membership)" icon="message-square" value={note} onChangeText={(t) => setNote(t.slice(0, 200))} maxLength={200} placeholder={picked === "suspended" ? "e.g. Fees unpaid for two months" : "e.g. Moved to another city"} />
          ) : null}
          {save.error ? <FormAlert message={save.error} /> : null}
          <GymPrimaryButton label={ACTION[picked]} ready={ready} busy={save.busy} icon="check" onPress={() => ready && save.save((token) => gymApi.setStanding(token, member.id, picked, note))} />
        </View>
      ) : null}
    </View>
  );
}
