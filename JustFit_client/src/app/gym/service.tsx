import { useState } from "react";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { CatalogPicks } from "@/components/gym/CatalogPicks";
import { GymChips, GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { METHOD_LABEL } from "@/data/gymDashboard";
import { gymApi, type PayMethod } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";

// Gym admin › + › Service: a service sold (a steam bath, a diet plan), its price and how it was paid
export default function GymService() {
  // The service picked from the catalogue, highlighted above the form; editing its name or price clears it
  const [picked, setPicked] = useState<number | null>(null);
  const [item, setItem] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const { busy, error, save } = useGymSave(() => router.replace("/gym"), "Service recorded");
  const value = rupeesFromText(amount);
  return (
    <GymScreen title="Service">
      <CatalogPicks kind="service" label="From your catalogue" selected={picked} onPick={(i) => { setPicked(i.id); setItem(i.name); setAmount(String(i.price)); }} />
      <GymField label="Service" icon="sparkles" pinLabel value={item} onChangeText={(t) => { setPicked(null); setItem(t); }} maxLength={80} placeholder="For example: Steam bath" />
      <GymField label="Amount (₹)" icon="banknote" pinLabel value={amount} onChangeText={(t) => { setPicked(null); setAmount(amountInput(t)); }} keyboardType="number-pad" placeholder="300" />
      <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
      {error ? <FormAlert message={error} /> : null}
      <SaveButton label="Save service" ready={item.trim().length >= 2 && value >= 1} busy={busy} onPress={() => save((token) => gymApi.service(token, { item: item.trim(), amount: value, method }))} />
    </GymScreen>
  );
}
