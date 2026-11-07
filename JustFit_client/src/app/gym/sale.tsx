import { useState } from "react";
import { router } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { CatalogPicks } from "@/components/gym/CatalogPicks";
import { GymChips, GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { METHOD_LABEL, SALE_CATEGORIES } from "@/data/gymDashboard";
import { gymApi, type PayMethod, type SaleCategory } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";

// Gym admin › + › Product: what was sold (supplements, merchandise), the amount and how it was paid
export default function GymSale() {
  // The product picked from the catalogue, highlighted above the form; editing its name or price clears it
  const [picked, setPicked] = useState<number | null>(null);
  const [item, setItem] = useState("");
  const [category, setCategory] = useState<SaleCategory>("supplement");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const { busy, error, save } = useGymSave(() => router.replace("/gym"));
  const value = rupeesFromText(amount);
  const ready = item.trim().length >= 2 && value >= 1;
  return (
    <GymScreen title="Product">
      <CatalogPicks kind="product" label="From your products" selected={picked} onPick={(i) => { setPicked(i.id); setItem(i.name); setAmount(String(i.price)); }} />
      <GymField label="Item" value={item} onChangeText={(t) => { setPicked(null); setItem(t); }} maxLength={80} placeholder="For example: Whey Protein 1kg" />
      <GymChips label="Type" options={SALE_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} value={category} onChange={setCategory} />
      <GymField label="Amount (₹)" value={amount} onChangeText={(t) => { setPicked(null); setAmount(amountInput(t)); }} keyboardType="number-pad" placeholder="3200" />
      <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
      {error ? <FormAlert message={error} /> : null}
      <SaveButton label="Save product sale" ready={ready} busy={busy} onPress={() => save((token) => gymApi.sale(token, { item: item.trim(), category, amount: value, method }))} />
    </GymScreen>
  );
}
