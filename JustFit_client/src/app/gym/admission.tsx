import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { CatalogPicks } from "@/components/gym/CatalogPicks";
import { GymChips, GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { METHOD_LABEL, dobFromText, dobInput, planLabel, rupees } from "@/data/gymDashboard";
import { PlanLengthFields, durationValue } from "@/components/gym/PlanLengthFields";
import { gymApi, type PayMethod, type PlanUnit } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";

// Gym admin › + › New admission: the member, their plan, the fee and what they paid now (the rest
// is owed). Saves the member and the payment together, then opens the member.
export default function GymAdmission() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [unit, setUnit] = useState<PlanUnit>("months");
  const [duration, setDuration] = useState("1");
  const [fee, setFee] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<PayMethod>("online");
  const { busy, error, save } = useGymSave((data: { member: { id: number } }) => router.replace({ pathname: "/gym/members/[id]", params: { id: String(data.member.id) } }));

  const feeValue = rupeesFromText(fee);
  const paidValue = rupeesFromText(paid);
  const dobValue = dobFromText(dob);
  const dobOk = dob.trim() === "" || dobValue !== null;
  const length = durationValue(duration, unit);
  const ready = length !== null && dobOk && name.trim().length >= 2 && feeValue >= 1 && paidValue >= 1 && paidValue <= feeValue;
  const due = ready ? feeValue - paidValue : 0;

  return (
    <GymScreen title="New admission">
      <GymField label="Member's name" value={name} onChangeText={setName} maxLength={80} placeholder="For example: Mohammed Asif" autoCapitalize="words" />
      <GymField label="Mobile number (optional)" value={phone} onChangeText={(t) => setPhone(t.replace(/[^0-9+ ]/g, "").slice(0, 15))} keyboardType="phone-pad" placeholder="98765 43210" />
      <GymField label="Date of birth (optional)" value={dob} onChangeText={(t) => setDob(dobInput(t))} keyboardType="number-pad" placeholder="DD-MM-YYYY" hint="For birthday wishes on Home." />
      <CatalogPicks kind="plan" label="From your plans" onPick={(item) => { if (item.duration && item.unit) { setUnit(item.unit); setDuration(String(item.duration)); } setFee(String(item.price)); setPaid(String(item.price)); }} />
      <PlanLengthFields unit={unit} onUnit={setUnit} duration={duration} onDuration={setDuration} />
      <GymField label="Plan fee (₹)" value={fee} onChangeText={(t) => setFee(amountInput(t))} keyboardType="number-pad" placeholder="4500" />
      <GymField label="Paid now (₹)" value={paid} onChangeText={(t) => setPaid(amountInput(t))} keyboardType="number-pad" placeholder="3000" />
      <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
      {ready && (
        <View className="gym-summary">
          <Text className="gym-tx__meta">{`${planLabel(length ?? 1, unit)} starting today`}</Text>
          <Text className="gym-tx__name">{due > 0 ? `${rupees(due)} will be owed` : "Paid in full"}</Text>
        </View>
      )}
      {paidValue > feeValue && <Text className="gym-tx__meta">{"The amount paid can't be more than the plan fee."}</Text>}
      {error ? <FormAlert message={error} /> : null}
      <SaveButton label="Save admission" ready={ready} busy={busy} onPress={() => save((token) => gymApi.admit(token, { name: name.trim(), phone: phone.trim(), dob: dobValue ?? "", unit, duration: length ?? 1, fee: feeValue, paid: paidValue, method }))} />
    </GymScreen>
  );
}
