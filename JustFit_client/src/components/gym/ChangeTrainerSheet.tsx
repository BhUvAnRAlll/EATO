import { useState } from "react";

import { FormAlert } from "@/components/FormAlert";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { TrainerChips } from "@/components/gym/TrainerChips";
import { gymApi, type GymMember, type GymMemberDetail } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";

// A member's ⋯ › Sales › Change Trainer: who their PT is with. The trainer then sees them in My Clients.
export function ChangeTrainerSheet({ member, onClose, onSaved }: { member: GymMember; onClose: () => void; onSaved: (detail: GymMemberDetail) => void }) {
  const current = member.pt?.trainer?.id ?? "";
  const [trainer, setTrainer] = useState(current);
  const { busy, error, save } = useGymSave(onSaved);
  return (
    <GymSheet title="Change Trainer" subtitle={`${member.name}'s personal training. Their trainer sees them in My Clients.`} onClose={onClose}>
      <TrainerChips value={trainer} onChange={setTrainer} />
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton label="Save trainer" ready={trainer !== current} busy={busy} onPress={() => save((token) => gymApi.setTrainer(token, member.id, trainer || null))} />
    </GymSheet>
  );
}
