import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { CatalogPicks } from "@/components/gym/CatalogPicks";
import { GymChips, GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { METHOD_LABEL, planLabel, rupees, shortDate } from "@/data/gymDashboard";
import { PlanLengthFields, durationValue } from "@/components/gym/PlanLengthFields";
import { gymApi, type PayMethod, type PlanUnit } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";

// Gym admin › a member › Renew: the new plan follows on from the current one (the server works out
// the dates); what isn't paid now is added to what they owe
export default function GymRenew() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const load = useCallback((token: string | null) => gymApi.member(token, memberId), [memberId]);
  const { result, retry } = useGymData(load);
  const [unit, setUnit] = useState<PlanUnit>("months");
  const [duration, setDuration] = useState("1");
  const [fee, setFee] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<PayMethod>("online");
  const { busy, error, save } = useGymSave(() => router.replace({ pathname: "/gym/members/[id]", params: { id: String(memberId) } }));
  const feeValue = rupeesFromText(fee);
  const paidValue = rupeesFromText(paid);
  const length = durationValue(duration, unit);
  const ready = length !== null && feeValue >= 1 && paidValue >= 1 && paidValue <= feeValue;

  return (
    <GymScreen title="Renewal">
      {result.state === "loading" && <GymLoading label="Loading the member" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && (
        <>
          <View className="gym-summary">
            <Text className="gym-tx__name">{result.data.member.name}</Text>
            <Text className="gym-tx__meta">{`${planLabel(result.data.member.planLength.duration, result.data.member.planLength.unit)} · until ${shortDate(result.data.member.expiresOn)}${result.data.member.due > 0 ? ` · owes ${rupees(result.data.member.due)}` : ""}`}</Text>
          </View>
          <CatalogPicks kind="plan" label="From your plans" onPick={(item) => { if (item.duration && item.unit) { setUnit(item.unit); setDuration(String(item.duration)); } setFee(String(item.price)); setPaid(String(item.price)); }} />
          <PlanLengthFields unit={unit} onUnit={setUnit} duration={duration} onDuration={setDuration} />
          <GymField label="Plan fee (₹)" value={fee} onChangeText={(t) => setFee(amountInput(t))} keyboardType="number-pad" placeholder="4500" />
          <GymField label="Paid now (₹)" value={paid} onChangeText={(t) => setPaid(amountInput(t))} keyboardType="number-pad" placeholder="3000" />
          <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
          {ready && feeValue > paidValue && <Text className="gym-tx__meta">{`${rupees(feeValue - paidValue)} will be added to what they owe.`}</Text>}
          {paidValue > feeValue && <Text className="gym-tx__meta">{"The amount paid can't be more than the plan fee."}</Text>}
          {error ? <FormAlert message={error} /> : null}
          <SaveButton label="Save renewal" ready={ready} busy={busy} onPress={() => save((token) => gymApi.renew(token, memberId, { unit, duration: length ?? 1, fee: feeValue, paid: paidValue, method }))} />
        </>
      )}
    </GymScreen>
  );
}
