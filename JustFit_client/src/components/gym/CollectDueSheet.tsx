import { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { DateSelect } from "@/components/gym/DateSelect";
import { DueByField } from "@/components/gym/DueByField";
import { CheckRow, ChipRow, METHODS } from "@/components/gym/GymChoice";
import { GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { daysFromToday, rupees, shortDate } from "@/data/gymDashboard";
import { gymApi, type GymInfo, type GymMember, type GymMemberDetail, type PayMethod } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";

// Collect Due (the user's design): the collected date, the amount (all of what's owed to start; a
// part is fine, with a date for the rest), the mode and Send Invoice (opens the payment's Invoice
// screen once it's saved, 2026-11-07)
export function CollectDueSheet({ member, gym, onClose, onSaved }: { member: GymMember; gym: GymInfo; onClose: () => void; onSaved: (detail: GymMemberDetail) => void }) {
  const [paidOn, setPaidOn] = useState(daysFromToday(0));
  const [amount, setAmount] = useState(String(member.due));
  const [method, setMethod] = useState<PayMethod | "">("online");
  const [dueBy, setDueBy] = useState<string | null>(member.dueBy);
  const [sendInvoice, setSendInvoice] = useState(false);
  const { busy, error, save } = useGymSave((detail: GymMemberDetail) => {
    onSaved(detail);
    if (sendInvoice) router.push({ pathname: "/gym/invoice", params: { memberId: String(detail.member.id) } });
  }, "Payment recorded");
  const value = rupeesFromText(amount);
  const part = value >= 1 && value < member.due;
  const ready = value >= 1 && value <= member.due && method !== "" && (!part || dueBy !== null);

  return (
    <GymSheet title="Collect Due" subtitle="Collect pending due" onClose={onClose}>
      <DateSelect label="Collected Date" value={paidOn} onChange={setPaidOn} min={daysFromToday(-365)} max={daysFromToday(0)} />
      <GymField label="Due amount" icon="banknote" value={amount} onChangeText={(t) => setAmount(amountInput(t))} keyboardType="number-pad" placeholder="Due Amount" hint={value > member.due ? `That's more than their due (${rupees(member.due)}).` : undefined} />
      <Text className="gym-tx__meta text-center">Partial due amount collection is also supported</Text>
      <ChipRow label="Mode" options={METHODS} value={method} onChange={setMethod} />
      {part && <DueByField value={dueBy} onChange={setDueBy} label={`Pay the other ${rupees(member.due - value)} by`} />}
      {part && member.dueBy && dueBy === member.dueBy && <Text className="gym-tx__meta">{`Keeps the date they had: ${shortDate(member.dueBy)}.`}</Text>}
      <CheckRow label="Send Invoice" checked={sendInvoice} onChange={setSendInvoice} />
      {error ? <FormAlert message={error} /> : null}
      <GymPrimaryButton
        label="Collect Due"
        ready={ready}
        busy={busy}
        onPress={() => save((token) => gymApi.collectDue(token, member.id, { amount: value, method: method || "online", paidOn, ...(part && dueBy && dueBy !== member.dueBy ? { dueBy } : {}) }))}
      />
    </GymSheet>
  );
}
