import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { CatalogPicks } from "@/components/gym/CatalogPicks";
import { GymChips, GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { METHOD_LABEL, shortDate } from "@/data/gymDashboard";
import { gymApi, type PayMethod, type PlanUnit } from "@/lib/gymApi";
import { PlanLengthFields, durationValue } from "@/components/gym/PlanLengthFields";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";

// Gym admin › a member › PT: personal training they paid for (the package, its period, the
// amount, how). A new period follows on from one still running.
export default function GymPersonalTraining() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const load = useCallback((token: string | null) => gymApi.member(token, memberId), [memberId]);
  const { result, retry } = useGymData(load);
  const [pack, setPack] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("online");
  // The period this PT covers
  const [unit, setUnit] = useState<PlanUnit>("months");
  const [duration, setDuration] = useState("1");
  const { busy, error, save } = useGymSave(() => router.replace({ pathname: "/gym/members/[id]", params: { id: String(memberId) } }));
  const value = rupeesFromText(amount);
  const length = durationValue(duration, unit);
  const ready = pack.trim().length >= 2 && value >= 1 && length !== null;

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
          <PlanLengthFields unit={unit} onUnit={setUnit} duration={duration} onDuration={setDuration} />
          {result.data.member.pt?.active && <Text className="gym-tx__meta">{`Follows on from their current PT, which runs until ${shortDate(result.data.member.pt.until)}.`}</Text>}
          <GymField label="Amount (₹)" value={amount} onChangeText={(t) => setAmount(amountInput(t))} keyboardType="number-pad" placeholder="6000" />
          <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
          {error ? <FormAlert message={error} /> : null}
          <SaveButton label="Save PT payment" ready={ready} busy={busy} onPress={() => save((token) => gymApi.personalTraining(token, memberId, { package: pack.trim(), amount: value, method, unit, duration: length ?? 1 }))} />
        </>
      )}
    </GymScreen>
  );
}
