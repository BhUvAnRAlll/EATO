import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { AdminField } from "@/components/admin/AdminField";
import { phoneInput } from "@/data/gymDashboard";
import { adminPlatform } from "@/lib/adminPlatform";
import type { AdminGymDetail } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { confirmChoice } from "@/lib/nativeSheets";

// Super Admin › a gym › Transfer ownership (the brief's section 7): the branch gets a new gym admin
// by sign-in number and the current owners leave it, in one audited step with the reason.
export function TransferOwnerCard({ gymId, onDone }: { gymId: number; onDone: (data: AdminGymDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const save = useGymSave((data: AdminGymDetail) => {
    onDone(data);
    setOpen(false);
    setPhone("");
    setReason("");
  }, "Ownership moved");
  const ready = /^[6-9]\d{9}$/.test(phone) && reason.trim().length >= 5;

  const submit = async () => {
    if (!ready) return;
    const sure = await confirmChoice({ title: "Move this branch to a new owner?", message: "The current gym admins of this branch lose it. This is recorded in the audit log.", confirmLabel: "Transfer" });
    if (sure) save.save((token) => adminPlatform.transfer(token, gymId, phone, reason.trim()));
  };

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} className="card" accessibilityRole="button">
        <Text className="card__title">Transfer ownership</Text>
        <Text className="meta-text">Give this branch a new gym admin by their sign-in number.</Text>
      </Pressable>
    );
  }
  return (
    <View className="card" style={{ gap: 10 }}>
      <Text className="card__title">Transfer ownership</Text>
      <AdminField label="New owner's mobile number" value={phone} onChangeText={(t) => setPhone(phoneInput(t))} keyboardType="phone-pad" maxLength={10} placeholder="10 digits" />
      <AdminField label="Reason" value={reason} onChangeText={setReason} maxLength={200} multiline placeholder="e.g. The gym was sold to a new owner" />
      {save.error ? <FormAlert message={save.error} /> : null}
      <Pressable onPress={submit} disabled={!ready || save.busy} className={ready ? "btn-forest" : "btn-forest btn--disabled"} accessibilityRole="button">
        <Text className={ready ? "btn-forest__label" : "btn-forest__label btn--disabled-label"}>{save.busy ? "Moving…" : "Transfer"}</Text>
      </Pressable>
    </View>
  );
}
