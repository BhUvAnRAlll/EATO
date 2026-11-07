import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { GymField } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { gymApi, type GymBranches } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";

// Branches › Add branch (also Home's + › Add Outlet): the gym admin adds another branch of their
// gym with its name and location (area and city). The server links them to it as its gym admin;
// the branch that was open stays open, and the new one is in the list to switch to.
export function AddBranchSheet({ gym, onClose, onSaved }: { gym: string; onClose: () => void; onSaved: (data: GymBranches) => void }) {
  const [branch, setBranch] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const { busy, error, save } = useGymSave(onSaved);
  const ready = [branch, area, city].every((v) => v.trim().length >= 2);

  return (
    <GymSheet title="Add Branch" subtitle={`Another branch of ${gym}. Its members, payments and QR code are its own.`} onClose={onClose}>
      <View style={{ gap: 14 }}>
        <GymField label="Branch name" value={branch} onChangeText={setBranch} maxLength={80} placeholder="For example: Kunigal" autoCapitalize="words" />
        <Text className="gym-section-title">Location</Text>
        <GymField label="Area" value={area} onChangeText={setArea} maxLength={80} placeholder="For example: Main Road" autoCapitalize="words" />
        <GymField label="City" value={city} onChangeText={setCity} maxLength={60} placeholder="For example: Tumakuru" autoCapitalize="words" />
        {error ? <FormAlert message={error} /> : null}
        <GymPrimaryButton label="Add Branch" icon="map-pin" ready={ready} busy={busy} onPress={() => save((token) => gymApi.addBranch(token, { branch: branch.trim(), area: area.trim(), city: city.trim() }))} />
      </View>
    </GymSheet>
  );
}
