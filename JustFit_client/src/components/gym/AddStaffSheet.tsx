import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { GymChips, GymField } from "@/components/gym/GymField";
import { GymIcon } from "@/components/gym/GymIcon";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { phoneInput } from "@/data/gymDashboard";
import { gymApi, type GymTeam, type StaffKind } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useThemeColors } from "@/theme";

const KIND_OPTIONS: { value: StaffKind; label: string }[] = [
  { value: "staff", label: "Staff" },
  { value: "trainer", label: "Trainer" },
];

// What each kind gets, said before adding them
const WHAT_THEY_GET: Record<StaffKind, string> = {
  staff: "They'll open this gym portal for the branch: members, payments, PT, enquiries and attendance. They can't manage the team.",
  trainer: "They'll use the justFit app with their PT clients. AI Coach and Fitness will be hidden for them.",
};

type Branch = { id: number; branch: string };
type Added = GymTeam & { result: "added" | "invited"; branch: string };

// Staff / Admin Login › + (the gym admin only): a mobile number, Staff or Trainer, and the branch
// (the one you're in, already picked; the other branches you manage as chips), then "Please
// confirm the details". The server decides the rest: a number with a justFit account joins at once
// (its role changes), one that has never signed in is invited. `onAdded` gets the team and the
// branch's name.
export function AddStaffSheet({ gymName, branches, currentId, onClose, onAdded }: { gymName: string; branches: Branch[]; currentId: number; onClose: () => void; onAdded: (team: GymTeam, result: "added" | "invited", kind: StaffKind, branch: string) => void }) {
  const colors = useThemeColors();
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState<StaffKind>("staff");
  const [branchId, setBranchId] = useState(currentId);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, save } = useGymSave((data: Added) => onAdded(data, data.result, kind, data.branch));
  const ready = /^[6-9][0-9]{9}$/.test(phone);
  const label = KIND_OPTIONS.find((o) => o.value === kind)!.label;
  const branchName = branches.find((b) => b.id === branchId)?.branch ?? "";
  const elsewhere = branchId !== currentId;

  const submit = () => {
    setConfirming(false);
    save((token) => gymApi.addStaff(token, phone, kind, branchId));
  };

  return (
    <GymSheet
      title="Add Staff / Trainer"
      subtitle="Add someone to your team by their mobile number."
      onClose={onClose}
      onDismissOverlay={() => setConfirming(false)}
      overlay={
        confirming ? (
          <ConfirmDialog
            rows={[["Mobile", `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`], ["Role", label], ["Branch", `${gymName}, ${branchName}`]]}
            onEdit={() => setConfirming(false)}
            onConfirm={submit}
            confirmLabel="Add"
          />
        ) : null
      }
    >
      <GymField
        label="Mobile number"
        icon="phone"
        value={phone}
        onChangeText={(t) => setPhone(phoneInput(t))}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        placeholder="Mobile Number (10 digits)"
        hint="The number they use, or will use, to sign in to justFit."
      />
      <GymChips label="Role" options={KIND_OPTIONS} value={kind} onChange={setKind} />
      {/* The branch they join: the open one is picked; only branches this gym admin manages are offered */}
      <GymChips label="Branch" options={branches.map((b) => ({ value: b.id, label: `${b.branch} branch` }))} value={branchId} onChange={setBranchId} />
      {elsewhere ? <Text className="gym-tx__meta">{`They'll be added at the ${branchName} branch, not the one you're in now.`}</Text> : null}
      <View className="gym-note">
        <GymIcon name="info" size={18} color={colors.gymPrimary} />
        <Text className="gym-note__text">{WHAT_THEY_GET[kind]}</Text>
      </View>
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label="Continue" ready={ready} busy={busy} onPress={() => setConfirming(true)} />
    </GymSheet>
  );
}
