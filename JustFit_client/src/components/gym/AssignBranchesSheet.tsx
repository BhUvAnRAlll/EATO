import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { haptic } from "@/lib/haptics";
import { gymApi, type GymTeam, type TeamMember } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useThemeColors } from "@/theme";

type Branch = { id: number; branch: string };

// Staff / Admin Login › ⋯ › Branches (2026-11-09): the outlets someone on the team works at, out of
// the ones this gym admin manages. Tick as many as they need (at least one: taking them off every
// branch is Remove). A branch they join gets the Role & Permission they have here; leaving a branch
// takes them off its team there. The server checks every branch (PUT /api/gym/staff/:id/branches).
export function AssignBranchesSheet({ member, branches, currentId, onClose, onSaved }: { member: TeamMember; branches: Branch[]; currentId: number; onClose: () => void; onSaved: (team: GymTeam) => void }) {
  const colors = useThemeColors();
  const [picked, setPicked] = useState<number[]>(member.branchIds);
  const { busy, error, save } = useGymSave(onSaved, "Branches saved");
  const name = member.name ?? "This person";
  const changed = picked.length !== member.branchIds.length || picked.some((id) => !member.branchIds.includes(id));
  const leavingHere = member.branchIds.includes(currentId) && !picked.includes(currentId);

  const toggle = (id: number) => {
    haptic.select();
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  };

  return (
    <GymSheet title={`Branches for ${name}`} subtitle="Pick every outlet they work at." onClose={onClose}>
      {branches.length < 2 ? (
        <>
          <View className="gym-note">
            <GymIcon name="info" size={18} color={colors.gymPrimary} />
            <Text className="gym-note__text">This gym has one outlet so far. Add another outlet, then come back to assign them to it.</Text>
          </View>
          <PressableScale onPress={() => { onClose(); router.push({ pathname: "/gym/branches", params: { add: "1" } }); }} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel="Add an outlet">
            <Text className="gym-btn__label" style={{ color: colors.gymPrimary }}>Add Outlet</Text>
          </PressableScale>
        </>
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <Text className="gym-field__label" style={{ fontSize: 14 }}>Branches</Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {branches.map((b) => {
                const on = picked.includes(b.id);
                return (
                  <PressableScale
                    key={b.id}
                    onPress={() => toggle(b.id)}
                    className={on ? "gym-choice gym-choice--selected flex-row items-center" : "gym-choice flex-row items-center"}
                    style={{ gap: 6 }}
                    accessibilityRole="checkbox"
                    aria-checked={on}
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${b.branch} branch`}
                  >
                    {on ? <GymIcon name="check" size={14} color={colors.white} /> : null}
                    <Text className={on ? "gym-choice__label gym-choice__label--selected" : "gym-choice__label"}>{`${b.branch} branch`}</Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
          {picked.length === 0 ? <Text className="gym-tx__meta">Pick at least one branch. To take them off the team, use Remove.</Text> : null}
          <View className="gym-note">
            <GymIcon name="info" size={18} color={colors.gymPrimary} />
            <Text className="gym-note__text">
              {member.kind === "trainer"
                ? "At a new branch they can be picked as a PT trainer. Leaving a branch leaves their PT members there without a trainer."
                : "At a new branch they open the same screens they can here (change it on Role & Permission there). Leaving a branch closes it for them."}
            </Text>
          </View>
          {leavingHere ? <Text className="gym-tx__meta">{"They'll leave this branch's list. You'll find them under the branches you picked."}</Text> : null}
          {error ? <FormAlert message={error} /> : null}
          <GymPrimaryButton label="Save Branches" icon="check" ready={changed && picked.length > 0} busy={busy} onPress={() => save((token) => gymApi.setStaffBranches(token, member.id, picked))} />
        </>
      )}
    </GymSheet>
  );
}
