import { useState } from "react";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { GymField } from "@/components/gym/GymField";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { phoneInput } from "@/data/gymDashboard";
import { gymApi } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";

// Gym admin › + › Enquiry: someone asking about joining
export default function GymEnquiry() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const { busy, error, save } = useGymSave(() => router.replace("/gym/enquiries"));
  return (
    <GymScreen title="Enquiry">
      <GymField label="Name" value={name} onChangeText={setName} maxLength={80} placeholder="For example: Priya" autoCapitalize="words" />
      <GymField label="Mobile number (optional)" value={phone} onChangeText={(t) => setPhone(phoneInput(t))} maxLength={16} keyboardType="phone-pad" placeholder="91234 56780" />
      <GymField label="Note (optional)" value={note} onChangeText={setNote} maxLength={200} placeholder="Evening timings? Personal training?" multiline style={{ minHeight: 80, textAlignVertical: "top" }} />
      {error ? <FormAlert message={error} /> : null}
      <SaveButton label="Save enquiry" ready={name.trim().length >= 2} busy={busy} onPress={() => save((token) => gymApi.addEnquiry(token, { name: name.trim(), phone: phone.trim(), note: note.trim() }))} />
    </GymScreen>
  );
}
