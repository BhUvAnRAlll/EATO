import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { GymChips, GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { METHOD_LABEL, PLAN_MONTHS, planLabel, rupees } from "@/data/gymDashboard";
import { gymApi, type PayMethod } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";

// Gym admin › + › New admission: the member, their plan, the fee and what they paid now (the rest
// is owed). Saves the member and the payment together, then opens the member.
export default function GymAdmission() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [months, setMonths] = useState<number>(1);
  const [fee, setFee] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<PayMethod>("online");
  const { busy, error, save } = useGymSave((data: { member: { id: number } }) => router.replace({ pathname: "/gym/members/[id]", params: { id: String(data.member.id) } }));

  const feeValue = rupeesFromText(fee);
  const paidValue = rupeesFromText(paid);
  const ready = name.trim().length >= 2 && feeValue >= 1 && paidValue >= 1 && paidValue <= feeValue;
  const due = ready ? feeValue - paidValue : 0;

  return (
    <GymScreen title="New admission">
      <GymField label="Member's name" value={name} onChangeText={setName} maxLength={80} placeholder="For example: Mohammed Asif" autoCapitalize="words" />
      <GymField label="Mobile number (optional)" value={phone} onChangeText={(t) => setPhone(t.replace(/[^0-9+ ]/g, "").slice(0, 15))} keyboardType="phone-pad" placeholder="98765 43210" />
      <GymChips label="Plan" options={PLAN_MONTHS.map((m) => ({ value: m as number, label: planLabel(m) }))} value={months} onChange={setMonths} />
      <GymField label="Plan fee (₹)" value={fee} onChangeText={(t) => setFee(amountInput(t))} keyboardType="number-pad" placeholder="4500" />
      <GymField label="Paid now (₹)" value={paid} onChangeText={(t) => setPaid(amountInput(t))} keyboardType="number-pad" placeholder="3000" />
      <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
      {ready && (
        <View className="gym-summary">
          <Text className="gym-tx__meta">{`${planLabel(months)} starting today`}</Text>
          <Text className="gym-tx__name">{due > 0 ? `${rupees(due)} will be owed` : "Paid in full"}</Text>
        </View>
      )}
      {paidValue > feeValue && <Text className="gym-tx__meta">{"The amount paid can't be more than the plan fee."}</Text>}
      {error ? <FormAlert message={error} /> : null}
      <SaveButton label="Save admission" ready={ready} busy={busy} onPress={() => save((token) => gymApi.admit(token, { name: name.trim(), phone: phone.trim(), months, fee: feeValue, paid: paidValue, method }))} />
    </GymScreen>
  );
}
