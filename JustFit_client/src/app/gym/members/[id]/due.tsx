import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { FormAlert } from "@/components/FormAlert";
import { GymChips, GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymError, GymLoading } from "@/components/gym/GymStates";
import { GymScreen } from "@/components/gym/GymScreen";
import { SaveButton } from "@/components/gym/SaveButton";
import { METHOD_LABEL, rupees } from "@/data/gymDashboard";
import { gymApi, type PayMethod } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { useGymData } from "@/lib/useGymData";

// Gym admin › a member › Collect due: part or all of what they owe
export default function GymDue() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = Number(id);
  const load = useCallback((token: string | null) => gymApi.member(token, memberId), [memberId]);
  const { result, retry } = useGymData(load);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayMethod>("online");
  const { busy, error, save } = useGymSave(() => router.replace({ pathname: "/gym/members/[id]", params: { id: String(memberId) } }));
  const owed = result.state === "ready" ? result.data.member.due : 0;
  const value = rupeesFromText(amount);
  const ready = value >= 1 && value <= owed;

  return (
    <GymScreen title="Due payment">
      {result.state === "loading" && <GymLoading label="Loading the member" />}
      {result.state === "failed" && <GymError error={result.error} onRetry={retry} />}
      {result.state === "ready" && (
        <>
          <View className="gym-summary">
            <Text className="gym-tx__name">{result.data.member.name}</Text>
            <Text className="gym-tx__meta">{owed > 0 ? `Owes ${rupees(owed)}` : "Doesn't owe anything"}</Text>
          </View>
          {owed > 0 && (
            <>
              <GymField label="Amount paid (₹)" value={amount} onChangeText={(t) => setAmount(amountInput(t))} keyboardType="number-pad" placeholder={String(owed)} />
              <GymChips label="Paid by" options={(["online", "cash"] as const).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} />
              {value > owed && <Text className="gym-tx__meta">{`That's more than they owe (${rupees(owed)}).`}</Text>}
              {error ? <FormAlert message={error} /> : null}
              <SaveButton label="Save payment" ready={ready} busy={busy} onPress={() => save((token) => gymApi.collectDue(token, memberId, { amount: value, method }))} />
            </>
          )}
        </>
      )}
    </GymScreen>
  );
}
