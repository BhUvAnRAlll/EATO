import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { CatalogPicks } from "@/components/gym/CatalogPicks";
import { GymChips, GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { METHOD_LABEL } from "@/data/gymDashboard";
import { gymApi, type PayMethod } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";

// Gym admin › a member › PT: personal training they paid for (the package, the amount, how)
export default function GymPersonalTraining() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const load = useCallback((token: string | null) => gymApi.member(token, memberId), [memberId]);
  const { result, retry } = useGymData(load);
  const [pack, setPack] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("online");
  const { busy, error, save } = useGymSave(() => router.replace({ pathname: "/gym/members/[id]", params: { id: String(memberId) } }));
  const value = rupeesFromText(amount);
  const ready = pack.trim().length >= 2 && value >= 1;

  return (
    <GymScreen title="Personal training">
      {result.state === "loading" && <GymLoading label="Loading the member" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && (
        <>
          <View className="gym-summary">
            <Text className="gym-tx__name">{result.data.member.name}</Text>
            <Text className="gym-tx__meta">Personal training payment</Text>
          </View>
          <CatalogPicks kind="pt" label="From your PT packages" onPick={(item) => { setPack(item.name); setAmount(String(item.price)); }} />
          <GymField label="Package" value={pack} onChangeText={setPack} maxLength={60} placeholder="For example: 12 sessions" />
          <GymField label="Amount (₹)" value={amount} onChangeText={(t) => setAmount(amountInput(t))} keyboardType="number-pad" placeholder="6000" />
          <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
          {error ? <FormAlert message={error} /> : null}
          <SaveButton label="Save PT payment" ready={ready} busy={busy} onPress={() => save((token) => gymApi.personalTraining(token, memberId, { package: pack.trim(), amount: value, method }))} />
        </>
      )}
    </GymScreen>
  );
}
