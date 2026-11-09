import { useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { AddStaffSheet } from "@/components/gym/AddStaffSheet";
import { AssignBranchesSheet } from "@/components/gym/AssignBranchesSheet";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GradientFill } from "@/components/gym/GradientFill";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymSheet } from "@/components/gym/GymSheet";
import { GymEmpty, GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { initialsOf } from "@/data/gymDashboard";
import { optionsLine } from "@/lib/permissionTree";
import { gymApi, type GymTeam, type StaffInvite, type StaffKind, type TeamMember } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

const KIND_LABEL: Record<TeamMember["kind"], string> = { owner: "Gym admin", staff: "Staff", trainer: "Trainer" };

// Who the ⋯ sheet is about: a team member or an invite
type Picked = { type: "member"; member: TeamMember } | { type: "invite"; invite: StaffInvite };

// Gym admin › ☰ › Staff / Admin Login (also Home › + › Add Staff / Admin Login, which opens the Add
// sheet straight away with ?add=1). Only the branch's gym admin reaches it (the server answers Staff
// with a 403). The team (the gym admin first, then Staff and Trainers) and the numbers invited that
// haven't signed in yet; the round + (as on Members) adds someone, at this branch or another one
// the gym admin manages; ⋯ assigns their branches (outlets), removes them or cancels the invite.
export default function GymStaffScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ add?: string }>();
  const { result, retry, set } = useGymData(gymApi.team);
  // From Home's + (?add=1) the Add sheet is open from the start; it shows once the team has loaded
  const [adding, setAdding] = useState(params.add === "1");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [confirming, setConfirming] = useState(false);
  // ⋯ › Branches: the outlets this person works at
  const [assigning, setAssigning] = useState<TeamMember | null>(null);
  const [notice, setNotice] = useState("");
  const { busy, error, save, clearError } = useGymSave((data: GymTeam) => {
    set(data);
    setConfirming(false);
    setPicked(null);
  });
  // One person's failed Remove isn't shown when the next person's sheet opens (QA 2026-11-07)
  const open = (next: Picked | null) => {
    clearError();
    setPicked(next);
  };

  const ready = result.state === "ready";

  const tag = (kind: TeamMember["kind"], invited = false) => {
    const tone = invited ? { bg: colors.gymWarningSoft, ink: colors.gymWarningInk } : kind === "trainer" ? { bg: colors.gymSuccessSoft, ink: colors.gymSuccess } : { bg: colors.gymPrimarySoft, ink: colors.gymPrimaryText };
    return (
      <View className="gym-tag" style={{ backgroundColor: tone.bg }}>
        <Text className="gym-tag__label" style={{ color: tone.ink }}>{KIND_LABEL[kind]}</Text>
      </View>
    );
  };
  const more = (label: string, onPress: () => void) => (
    <PressableScale onPress={onPress} hitSlop={10} className="gym-icon-btn" accessibilityRole="button" accessibilityLabel={label}>
      <GymIcon name="ellipsis" size={16} color={colors.gymInkSoft} />
    </PressableScale>
  );

  const fab = ready ? (
    <PressableScale onPress={() => { setNotice(""); setAdding(true); }} haptic="tap" className="gym-fab" accessibilityRole="button" accessibilityLabel="Add Staff or a Trainer">
      <GradientFill radius={18} />
      <GymIcon name="plus" size={22} color={colors.white} />
    </PressableScale>
  ) : undefined;

  if (result.state !== "ready") {
    return (
      <GymScreen title="Staff / Admin Login">
        {result.state === "loading" ? <GymLoading label="Loading your team" /> : <GymError error={result.error} onRetry={retry} />}
      </GymScreen>
    );
  }
  const { gym, branches, team, invites, permissionTree } = result.data;
  const branchLine = `${gym.name}, ${gym.branch}`;
  const others = team.filter((m) => m.kind !== "owner");
  // "Tumkur, Kunigal": the branches someone works at, of those this gym admin manages
  const branchNames = (m: TeamMember) => branches.filter((b) => m.branchIds.includes(b.id)).map((b) => b.branch).join(", ");

  const memberRow = (m: TeamMember) => {
    const name = m.you ? "You" : m.name ?? "Name not added yet";
    return (
      <View key={m.id} className="gym-card gym-tx" accessible={m.kind === "owner"} accessibilityLabel={`${name}, ${KIND_LABEL[m.kind]}`}>
        <View className="gym-avatar">
          <Text className="gym-avatar__label">{m.name ? initialsOf(m.name) : m.you ? "You" : "?"}</Text>
        </View>
        <View className="min-w-0 flex-1" style={{ gap: 4 }}>
          <Text className="gym-tx__name" numberOfLines={1}>{name}</Text>
          <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
            {tag(m.kind)}
            {m.phone ? <Text className="gym-tx__meta" numberOfLines={1}>{m.phone}</Text> : null}
          </View>
          {branches.length > 1 && m.kind !== "owner" ? <Text className="gym-tx__meta" numberOfLines={1}>{`Branches: ${branchNames(m)}`}</Text> : null}
          {m.kind === "staff" ? <Text className="gym-tx__meta" numberOfLines={1}>{`Can open: ${optionsLine(permissionTree, m.options)}`}</Text> : null}
        </View>
        {m.kind !== "owner" && more(`${name}: options`, () => open({ type: "member", member: m }))}
      </View>
    );
  };
  const inviteRow = (i: StaffInvite) => (
    <View key={i.id} className="gym-card gym-tx">
      <View className="gym-avatar" style={{ backgroundColor: colors.gymWarningSoft, borderColor: colors.gymWarningLine }}>
        <GymIcon name="clock" size={18} color={colors.gymWarningInk} />
      </View>
      <View className="min-w-0 flex-1" style={{ gap: 4 }}>
        <Text className="gym-tx__name" numberOfLines={1}>{i.phone ?? "Invited number"}</Text>
        <View className="flex-row flex-wrap items-center" style={{ gap: 6 }}>
          {tag(i.kind, true)}
          <Text className="gym-tx__meta">Waiting for first sign-in</Text>
        </View>
      </View>
      {more(`Invite to ${i.phone ?? "a number"}: options`, () => open({ type: "invite", invite: i }))}
    </View>
  );

  // The ⋯ sheet: what removing does, then a confirm
  const pickedName = picked?.type === "member" ? picked.member.name ?? "This person" : picked?.invite.phone ?? "This number";
  const pickedKind: StaffKind | null = picked ? (picked.type === "member" ? (picked.member.kind === "owner" ? null : picked.member.kind) : picked.invite.kind) : null;
  const removeLine =
    picked?.type === "invite"
      ? "If you cancel it, this number won't join your team when it signs in."
      : pickedKind === "trainer"
        ? "Removing them takes them off this branch's team. If it's their only branch, they become a normal member again and AI Coach and Fitness come back. Their PT members here will show no trainer."
        : "Removing them takes them off this branch's team. If it's their only branch, the gym portal closes for them and they become a normal member again.";

  return (
    <GymScreen title="Staff / Admin Login" floating={fab}>
      <Text className="gym-tx__meta">{`Add people to the ${gym.branch} branch by their mobile number. Staff open this gym portal; Trainers see their PT clients in the justFit app.`}</Text>
      {notice ? (
        <Animated.View entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)} className="gym-note" accessibilityLiveRegion="polite">
          <GymIcon name="circle-check" size={18} color={colors.gymSuccess} />
          <Text className="gym-note__text">{notice}</Text>
        </Animated.View>
      ) : null}

      <Text className="gym-page-section" accessibilityRole="header">{`Team (${team.length})`}</Text>
      <View style={{ gap: 10 }}>{team.map(memberRow)}</View>
      {others.length === 0 && invites.length === 0 && (
        <GymEmpty icon="users" title="No Staff or Trainers yet" text="Tap + to give someone access by their mobile number." />
      )}

      {invites.length > 0 && (
        <>
          <Text className="gym-page-section" accessibilityRole="header">{`Pending invites (${invites.length})`}</Text>
          <View style={{ gap: 10 }}>{invites.map(inviteRow)}</View>
        </>
      )}

      {adding && (
        <AddStaffSheet
          gymName={gym.name}
          branches={branches}
          currentId={gym.id}
          onClose={() => setAdding(false)}
          onAdded={(data, outcome, kind, branch) => {
            set(data);
            setAdding(false);
            const label = kind === "staff" ? "Staff" : "a Trainer";
            // Added at another branch: say so, since this list is the open branch's
            const where = branch !== gym.branch ? ` at the ${branch} branch` : "";
            setNotice(outcome === "added" ? `Added as ${label}${where}. Their app switches the next time they open it.` : `Invited as ${label}${where}. They'll join your team when they first sign in to justFit with that number.`);
          }}
        />
      )}

      {assigning && (
        <AssignBranchesSheet
          member={assigning}
          branches={branches}
          currentId={gym.id}
          onClose={() => setAssigning(null)}
          onSaved={(data) => {
            set(data);
            setAssigning(null);
          }}
        />
      )}

      {picked && (
        <GymSheet
          title={pickedName}
          subtitle={picked.type === "member" ? `${KIND_LABEL[picked.member.kind]} · ${picked.member.phone ?? ""}` : `Invited as ${KIND_LABEL[picked.invite.kind]}`}
          onClose={() => { setPicked(null); setConfirming(false); }}
          onDismissOverlay={() => setConfirming(false)}
          overlay={
            confirming ? (
              <ConfirmDialog
                title={picked.type === "invite" ? "Cancel this invite?" : `Remove ${pickedName}?`}
                rows={[["Number", (picked.type === "member" ? picked.member.phone : picked.invite.phone) ?? "-"], ["Role", pickedKind ? KIND_LABEL[pickedKind] : "-"], ["Branch", branchLine]]}
                editLabel="Keep"
                confirmLabel={picked.type === "invite" ? "Yes, cancel it" : "Yes, remove"}
                onEdit={() => setConfirming(false)}
                onConfirm={() => {
                  setConfirming(false);
                  setNotice("");
                  save((token) => (picked.type === "member" ? gymApi.removeStaff(token, picked.member.id) : gymApi.cancelInvite(token, picked.invite.id)));
                }}
              />
            ) : null
          }
        >
          {picked.type === "member" ? (
            <PressableScale onPress={() => { const member = picked.member; setPicked(null); setAssigning(member); }} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel={`Branches for ${pickedName}`}>
              <Text className="gym-btn__label" style={{ color: colors.gymPrimary }} numberOfLines={1}>{`Branches · ${branchNames(picked.member) || gym.branch}`}</Text>
            </PressableScale>
          ) : null}
          {picked.type === "member" && picked.member.kind === "staff" ? (
            <PressableScale onPress={() => { setPicked(null); router.push({ pathname: "/gym/permissions/[userId]", params: { userId: picked.member.id } }); }} className="gym-btn gym-btn--outline" accessibilityRole="button" accessibilityLabel={`Role & Permission for ${pickedName}`}>
              <Text className="gym-btn__label" style={{ color: colors.gymPrimary }}>{`Role & Permission · ${optionsLine(permissionTree, picked.member.options)}`}</Text>
            </PressableScale>
          ) : null}
          <View className="gym-note">
            <GymIcon name="info" size={18} color={colors.gymPrimary} />
            <Text className="gym-note__text">{removeLine}</Text>
          </View>
          {error ? <FormAlert message={error} /> : null}
          <PressableScale
            onPress={() => setConfirming(true)}
            disabled={busy}
            className="gym-btn gym-btn--outline"
            style={{ borderColor: colors.gymDanger, opacity: busy ? 0.5 : 1 }}
            accessibilityRole="button"
            accessibilityLabel={picked.type === "invite" ? "Cancel invite" : `Remove ${pickedName} from the team`}
            accessibilityState={{ disabled: busy, busy }}
          >
            <Text className="gym-btn__label" style={{ color: colors.gymDanger }}>{picked.type === "invite" ? "Cancel invite" : "Remove from team"}</Text>
          </PressableScale>
        </GymSheet>
      )}
    </GymScreen>
  );
}
